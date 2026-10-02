"""Isolated execution facade. User code never runs in the FastAPI process.

Python runs in a sandboxed `sys.settrace` worker. The other languages are instrumented
with tree-sitter (see instrument.py), compiled, and run with a tiny trace runtime.
Both paths produce the same frame shape and the same Big-O benchmark.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from tracer.diagnose import diagnose
from tracer.frames import build_frames, describe, enrich_arrays, error_frame
from tracer.instrument import NATIVE_LANGUAGES, ScaleTarget, find_scale_target
from tracer.native import BuildError, build_program, missing_tool

MAX_STEPS = 5_000
MAX_OUTPUT_BYTES = 64_000
EXECUTION_TIMEOUT_SECONDS = 3
ALIASES = {"py": "python", "js": "javascript", "ts": "typescript", "c++": "cpp", "golang": "go"}
# Benchmark sizes: array literals grow geometrically; an `n` knob is stepped finely so
# exponential programs still yield several points before hitting the step cap.
ARRAY_SIZES = [8, 16, 32, 64, 128, 256, 512]
N_SIZES = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 64, 128, 256, 512]
PYTHON_STEP_CAP = 400_000
NATIVE_STEP_CAP = 3_000_000
BENCHMARK_BUDGET_SECONDS = 25
GROWTH_MODELS: list[tuple[str, Callable[[float], float]]] = [
    ("O(1)", lambda n: 0.0),
    ("O(log N)", lambda n: math.log(math.log2(max(n, 2)))),
    ("O(N)", lambda n: math.log(n)),
    ("O(N log N)", lambda n: math.log(n) + math.log(math.log2(max(n, 2)))),
    ("O(N^2)", lambda n: 2 * math.log(n)),
    ("O(N^3)", lambda n: 3 * math.log(n)),
    ("O(2^N)", lambda n: n * math.log(2)),
]


def _normalize(language: str) -> str:
    lang = (language or "").strip().lower()
    return ALIASES.get(lang, lang)


def _run_worker(payload: dict[str, Any], timeout: float = EXECUTION_TIMEOUT_SECONDS) -> dict[str, Any]:
    worker = Path(__file__).with_name("worker.py")
    worker_env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP") if key in os.environ}
    worker_env.update({"PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"})
    try:
        with tempfile.TemporaryDirectory(prefix="graphmind-") as cwd:
            completed = subprocess.run(
                [sys.executable, "-I", str(worker)], input=json.dumps(payload), text=True,
                encoding="utf-8", capture_output=True, cwd=cwd, timeout=timeout, env=worker_env,
            )
    except subprocess.TimeoutExpired:
        return {"error": f"Execution timed out after {timeout:g} seconds.", "timed_out": True}
    except OSError as exc:
        return {"error": f"Could not start isolated execution worker: {exc}"}
    if completed.returncode:
        return {"error": f"Execution worker failed: {(completed.stderr or 'unexpected exit').strip()[:500]}"}
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {"error": "Execution worker returned an invalid response."}


def _unsupported(message: str) -> dict[str, Any]:
    return {"supported": False, "message": message, "frames": [], "stdout": "", "error": None}


# ----------------------------------------------------------------------------- tracing
def _python_trace(code: str, input_text: str) -> dict[str, Any]:
    result = _run_worker({"mode": "trace", "code": code, "input": input_text, "max_steps": MAX_STEPS, "max_output": MAX_OUTPUT_BYTES})
    frames = result.get("frames", [])
    lines = code.splitlines()
    previous = None
    for frame in frames:
        line = frame.get("activeLine", 0)
        text = lines[line - 1].strip() if 0 < line <= len(lines) else ""
        enrich_arrays(frame, previous, text)
        if frame.get("event") != "exception":
            frame["description"] = describe(frame, previous, text)
        previous = frame
    return {"supported": True, "message": None, "frames": frames, "stdout": result.get("stdout", ""), "error": result.get("error")}


def _native_trace(code: str, lang: str, input_text: str) -> dict[str, Any]:
    tool = missing_tool(lang)
    if tool:
        return _unsupported(f"Cannot run {lang}: '{tool}' is not installed on the backend. Install it or use the Docker image, which includes every supported toolchain.")
    try:
        program, instrumented = build_program(lang, code)
    except BuildError as exc:
        frames = [error_frame(1, exc.line, str(exc))] if exc.line else []
        return {"supported": True, "message": None, "frames": frames, "stdout": "", "error": str(exc)}
    with program:
        run = program.run(input_text, MAX_STEPS)
    frames = build_frames(run.records, code, instrumented.loops, lang)
    if run.error and not run.limited:
        line = run.error_line or (frames[-1]["activeLine"] if frames else 1)
        frames.append(error_frame(len(frames) + 1, line, run.error, frames[-1] if frames else None))
    return {"supported": True, "message": None, "frames": frames, "stdout": run.stdout, "error": run.error}


def _error_line(frames: list[dict[str, Any]]) -> int | None:
    """Where the error started: the first exception frame after the last normal step."""
    last_step = max((i for i, f in enumerate(frames) if f.get("event") in ("line", "call")), default=-1)
    origin = next((f for f in frames[last_step + 1:] if f.get("operation") == "ERROR"), None)
    if origin is None and frames and frames[-1].get("operation") == "ERROR":
        origin = frames[-1]
    return origin.get("activeLine") if origin else None


def trace_execution(code: str, language: str, input_text: str = "") -> dict[str, Any]:
    lang = _normalize(language)
    if lang == "python":
        result = _python_trace(code, input_text)
    elif lang in NATIVE_LANGUAGES:
        result = _native_trace(code, lang, input_text)
    else:
        return _unsupported(f"Execution is not configured for '{language}'. Choose one of the listed languages.")
    if result.get("supported") and result.get("error"):
        result["diagnosis"] = diagnose(code, lang, result["error"], _error_line(result["frames"]), result["frames"])
    return result


# ----------------------------------------------------------------------------- Big-O
def _line_fit_rms(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Least-squares line through (xs, ys): returns (slope, rms residual)."""
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs) or 1e-12
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    rms = math.sqrt(sum((y - my - slope * (x - mx)) ** 2 for x, y in zip(xs, ys)) / len(xs))
    return slope, rms


def classify(ns: list[int], counts: list[int]) -> str | None:
    """Pick the growth model whose shape best fits the samples (least squares in log space)."""
    if len(ns) < 3:
        return None
    logs = [math.log(max(c, 1)) for c in counts]
    # Exponential growth is a straight line against N (any base, e.g. fib's 1.618^N);
    # polynomial growth is a straight line against log N.
    growth, exp_rms = _line_fit_rms([float(n) for n in ns], logs)
    _, power_rms = _line_fit_rms([math.log(n) for n in ns], logs)
    if growth > 0.15 and exp_rms < power_rms * 0.5:
        return "O(2^N)"
    best: tuple[float, str] | None = None
    for label, model in GROWTH_MODELS[:-1]:
        residuals = [y - model(n) for n, y in zip(ns, logs)]
        mean = sum(residuals) / len(residuals)
        rms = math.sqrt(sum((r - mean) ** 2 for r in residuals) / len(residuals))
        # Models are ordered simplest-first; a more complex one must fit clearly better.
        if best is None or rms < best[0] - 0.02:
            best = (rms, label)
    return best[1] if best else None


def _measure(sizes: list[int], run_for: Callable[[int], tuple[int, bool, str | None]]) -> tuple[list[int], list[int], str | None]:
    started = time.monotonic()
    ns: list[int] = []
    counts: list[int] = []
    for n in sizes:
        if time.monotonic() - started > BENCHMARK_BUDGET_SECONDS:
            break
        steps, limited, error = run_for(n)
        if error:
            if ns:
                break  # keep the sizes that completed
            return ns, counts, f"{error} (while benchmarking N={n})"
        if limited:
            break
        ns.append(n)
        counts.append(steps)
    return ns, counts, None


def _benchmark_result(ns: list[int], counts: list[int], error: str | None, target: ScaleTarget | None) -> dict[str, Any]:
    if not error and len(ns) < 3:
        error = "Not enough benchmark sizes completed to estimate growth — the program may be too slow or exponential."
    note = None
    if target is not None:
        note = "Scaled the array literal in your program to N elements." if target.kind == "array" else "Scaled the size value in your program (n) to N."
    return {"supported": True, "message": note, "n_values": ns, "step_counts": counts,
            "estimated_big_o": classify(ns, counts) if len(ns) >= 3 else None, "error": error}


def _python_benchmark(code: str, input_text: str) -> dict[str, Any]:
    target = find_scale_target(code, "python")
    source = code.encode("utf-8")

    def variant(n: int) -> str:
        if target is None:
            return f"n = {n}\nN = {n}\n" + code  # legacy: programs that read a global n
        return (source[:target.start] + target.regenerate(n).encode() + source[target.end:]).decode("utf-8")

    def run_for(n: int) -> tuple[int, bool, str | None]:
        result = _run_worker({"mode": "trace", "code": variant(n), "input": input_text, "count_only": True,
                              "max_steps": PYTHON_STEP_CAP, "max_output": MAX_OUTPUT_BYTES})
        if result.get("timed_out"):
            return 0, True, None
        return int(result.get("steps", 0)), bool(result.get("limited")), result.get("error")

    sizes = ARRAY_SIZES if target is None or target.kind == "array" else N_SIZES
    return _benchmark_result(*_measure(sizes, run_for), target)


def _native_benchmark(code: str, lang: str, input_text: str) -> dict[str, Any]:
    empty = {"n_values": [], "step_counts": [], "estimated_big_o": None, "error": None}
    tool = missing_tool(lang)
    if tool:
        return {"supported": False, "message": f"Cannot benchmark {lang}: '{tool}' is not installed on the backend.", **empty}
    target = find_scale_target(code, lang)
    if target is None:
        return {"supported": False, "message": "To measure Big-O, GraphMind grows your input: add an array literal (e.g. [5, 2, 8, 1]) or a size variable named n.", **empty}
    sizes = ARRAY_SIZES if target.kind == "array" else N_SIZES

    if target.runtime is not None:
        try:
            program, _ = build_program(lang, code, target)
        except BuildError as exc:
            return {"supported": True, "message": None, **empty, "error": str(exc)}
        with program:
            def run_for(n: int) -> tuple[int, bool, str | None]:
                run = program.run(input_text, NATIVE_STEP_CAP, counting=True, n=n, ascending=target.ascending, timeout=8)
                return run.steps, run.limited or run.timed_out, None if run.timed_out else run.error
            return _benchmark_result(*_measure(sizes, run_for), target)

    # C / C++ fixed arrays: the literal is rewritten per size, so compile all sizes in parallel first.
    def build(n: int):
        try:
            return build_program(lang, code, target, n)[0]
        except BuildError as exc:
            return exc
    with ThreadPoolExecutor(max_workers=4) as pool:
        built = dict(zip(sizes, pool.map(build, sizes)))
    try:
        def run_for(n: int) -> tuple[int, bool, str | None]:
            program = built[n]
            if isinstance(program, BuildError):
                return 0, False, str(program)
            run = program.run(input_text, NATIVE_STEP_CAP, counting=True, timeout=8)
            return run.steps, run.limited or run.timed_out, None if run.timed_out else run.error
        return _benchmark_result(*_measure(sizes, run_for), target)
    finally:
        for program in built.values():
            if not isinstance(program, BuildError):
                program.folder.cleanup()


def run_complexity_benchmark(code: str, language: str, input_text: str = "") -> dict[str, Any]:
    lang = _normalize(language)
    if lang == "python":
        return _python_benchmark(code, input_text)
    if lang in NATIVE_LANGUAGES:
        return _native_benchmark(code, lang, input_text)
    return {"supported": False, "message": f"Benchmarking is not configured for '{language}'.", "n_values": [], "step_counts": [], "estimated_big_o": None, "error": None}
