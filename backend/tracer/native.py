"""Build and run instrumented programs for the non-Python languages."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tracer.instrument import Instrumented, ScaleTarget, instrument

RUNTIME_DIR = Path(__file__).with_name("runtime")
MAX_OUTPUT_BYTES = 64_000
COMPILE_TIMEOUT_SECONDS = 30
RUN_TIMEOUT_SECONDS = 10
_ENV_KEYS = (
    "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
    "GOCACHE", "GOPATH", "GOMODCACHE", "GOROOT", "JAVA_HOME", "R_HOME", "LANG",
)
TOOLS = {"javascript": "node", "typescript": "node", "c": "gcc", "cpp": "g++", "java": "javac", "go": "go", "r": "Rscript"}
TS_DECLARATIONS = "declare const __gm: any, __gmE: any, __gmX: any, __gmN: any, __gmData: any; "


class BuildError(Exception):
    """Compilation failed; `line` is the first source line the compiler blamed."""

    def __init__(self, message: str, line: int | None) -> None:
        super().__init__(message)
        self.line = line


@dataclass
class RunResult:
    records: list[dict[str, Any]] = field(default_factory=list)
    stdout: str = ""
    error: str | None = None
    error_line: int | None = None
    steps: int = 0
    limited: bool = False
    timed_out: bool = False


def missing_tool(language: str) -> str | None:
    tool = TOOLS[language]
    if language == "typescript":
        return None if shutil.which("node") else "node"
    return None if shutil.which(tool) else tool


def _env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {key: os.environ[key] for key in _ENV_KEYS if key in os.environ}
    env.setdefault("HOME", tempfile.gettempdir())
    if extra:
        env.update(extra)
    return env


HOOK_PATTERNS = [
    re.compile(r"__gm\(\d+,\d+,\[[^\]]*\],(?:null|\(\)=>\[[^\]]*\])\);"),  # JS / TS
    re.compile(r'__gmE\("[^"]*"\);try\{|\}finally\{__gmX\(\);\}'),
    re.compile(r"GMTrace\.h\(\d+,\d+(?:,\"[^\"]*\",[A-Za-z_$][\w$]*)*\);"),  # Java
    re.compile(r'GMTrace\.enter\("[^"]*"\);try\{|\}finally\{GMTrace\.exit\(\);\}'),
    re.compile(r"if\((?:__gm_begin|gmrt::begin)\(\d+,\d+\)\)\{.*?(?:__gm_end|gmrt::end)\(\);\}"),  # C / C++
    re.compile(r'__GM_SCOPE\("[^"]*"\);|gmrt::Scope __gm_scope\("[^"]*"\);'),
    re.compile(r"__gm\(\d+,\d+(?:,\"[^\"]*\",[A-Za-z_]\w*)*\);"),  # Go
    re.compile(r'__gmE\("[^"]*"\);(?:defer __gmFinish\(false\);)?defer __gmX\(\);'),
    re.compile(r"\.gm\(\d+L,\d+L\);"),  # R
]


def clean_message(message: str) -> str:
    for pattern in HOOK_PATTERNS:
        message = pattern.sub("", message)
    message = message.replace(TS_DECLARATIONS, "")
    # Caret markers no longer line up once hooks are removed; runtime-header notes are noise.
    lines = [line for line in message.splitlines() if not re.fullmatch(r"\s*\|?\s*[\^~]+[\^~\s]*", line) and "gm_rt.h" not in line]
    return "\n".join(lines)


def _first_line(pattern: str, text: str) -> int | None:
    match = re.search(pattern, text)
    return int(match.group(1)) if match else None


class NativeProgram:
    """A language-specific workspace: write sources, compile once, run many times."""

    def __init__(self, language: str, code: str) -> None:
        self.language = language
        self.code = code
        self.folder = tempfile.TemporaryDirectory(prefix="graphmind-native-")
        self.work = Path(self.folder.name)
        self.command: list[str] = []

    def __enter__(self) -> "NativeProgram":
        return self

    def __exit__(self, *_: Any) -> None:
        self.folder.cleanup()

    def _compile(self, command: list[str], line_pattern: str) -> None:
        try:
            built = subprocess.run(command, text=True, encoding="utf-8", errors="replace", capture_output=True,
                                   cwd=self.work, timeout=COMPILE_TIMEOUT_SECONDS, env=_env())
        except subprocess.TimeoutExpired as exc:
            raise BuildError("Compilation timed out.", None) from exc
        if built.returncode:
            message = (built.stderr or built.stdout).strip()[:MAX_OUTPUT_BYTES] or "Compilation failed."
            # Hide the work folder so messages read like the user's own file.
            message = clean_message(message.replace(str(self.work) + os.sep, "").replace(str(self.work), ""))
            raise BuildError(message, _first_line(line_pattern, message))

    def build(self, program: Instrumented) -> None:
        lang, work, source = self.language, self.work, program.source
        node = shutil.which("node") or "node"
        if lang == "javascript":
            (work / "program.js").write_text(source, encoding="utf-8")
            self.command = [node, "--require", str(RUNTIME_DIR / "gm_rt.cjs"), "program.js"]
        elif lang == "typescript":
            (work / "program.ts").write_text(TS_DECLARATIONS + source, encoding="utf-8")
            tsc = shutil.which("tsc")
            if tsc:
                self._compile([tsc, "--target", "ES2022", "--module", "commonjs", "--skipLibCheck", "--outDir", str(work), "program.ts"], r"program\.ts\((\d+),")
                self.command = [node, "--require", str(RUNTIME_DIR / "gm_rt.cjs"), "program.js"]
            else:
                self.command = [node, "--no-warnings", "--experimental-transform-types", "--require", str(RUNTIME_DIR / "gm_rt.cjs"), "program.ts"]
        elif lang in ("c", "cpp"):
            # The runtime is force-included (-include), so program.c holds exactly the user's lines
            # and compiler snippets/line numbers match what they wrote.
            header = "gm_rt.h" if lang == "c" else "gm_rt.hpp"
            shutil.copy(RUNTIME_DIR / header, work / header)
            name = "program.c" if lang == "c" else "program.cpp"
            (work / name).write_text(source, encoding="utf-8")
            binary = work / ("program.exe" if os.name == "nt" else "program")
            compiler = shutil.which("gcc" if lang == "c" else "g++") or ("gcc" if lang == "c" else "g++")
            standard = "-std=gnu17" if lang == "c" else "-std=gnu++20"
            self._compile([compiler, standard, "-O0", "-w", "-include", header, name, "-o", str(binary), "-lm"], r"program\.(?:c|cpp):(\d+)(?::\d+)?:\s*(?:fatal )?error")
            self.command = [str(binary)]
        elif lang == "java":
            match = re.search(r"\bpublic\s+(?:final\s+|abstract\s+)*class\s+(\w+)", self.code) or re.search(r"\bclass\s+(\w+)", self.code)
            class_name = match.group(1) if match else "Main"
            runtime = (RUNTIME_DIR / "GMTrace.java").read_text(encoding="utf-8")
            (work / f"{class_name}.java").write_text(source + "\n" + runtime, encoding="utf-8")
            javac = shutil.which("javac") or "javac"
            self._compile([javac, "-encoding", "UTF-8", "-nowarn", "-d", ".", f"{class_name}.java"], r"\.java:(\d+)(?:\)|:)")
            self.command = [shutil.which("java") or "java", "-Xss16m", "-cp", ".", class_name]
        elif lang == "go":
            (work / "program.go").write_text(source, encoding="utf-8")
            shutil.copy(RUNTIME_DIR / "gm_rt.go", work / "gm_rt.go")
            binary = work / ("program.exe" if os.name == "nt" else "program")
            go = shutil.which("go") or "go"
            self._compile([go, "build", "-o", str(binary), "program.go", "gm_rt.go"], r"program\.go:(\d+)")
            self.command = [str(binary)]
        elif lang == "r":
            (work / "program.R").write_text(source, encoding="utf-8")
            shutil.copy(RUNTIME_DIR / "gm_rt.R", work / "gm_rt.R")
            (work / "runner.R").write_text('source("gm_rt.R")\nsource("program.R", print.eval = TRUE)\n', encoding="utf-8")
            self.command = [shutil.which("Rscript") or "Rscript", "--vanilla", "runner.R"]
        else:
            raise ValueError(f"Unsupported language: {lang}")

    def run(self, input_text: str, max_steps: int, counting: bool = False, n: int | None = None,
            ascending: bool = False, timeout: float = RUN_TIMEOUT_SECONDS) -> RunResult:
        trace_file = self.work / "trace.jsonl"
        trace_file.unlink(missing_ok=True)
        env = _env({"GM_TRACE": str(trace_file), "GM_MAX": str(max_steps), "GM_COUNT": "1" if counting else "0",
                    "GM_N": str(n or 0), "GM_SORTED": "1" if ascending else "0"})
        result = RunResult()
        try:
            completed = subprocess.run(self.command, input=input_text, text=True, encoding="utf-8", errors="replace",
                                       capture_output=True, cwd=self.work, timeout=timeout, env=env)
            result.stdout = completed.stdout[:MAX_OUTPUT_BYTES]
            stderr = clean_message(completed.stderr[:MAX_OUTPUT_BYTES].strip().replace(str(self.work) + os.sep, ""))
            if completed.returncode:
                result.error = stderr or f"Program exited with status {completed.returncode}."
                result.error_line = (_first_line(r"program\.(?:js|ts|go|R|c|cpp):(\d+)", result.error)
                                     or _first_line(r"\.java:(\d+)\)", result.error))
            elif stderr and self.language not in ("r",):
                result.error = stderr
        except subprocess.TimeoutExpired as exc:
            result.timed_out = True
            result.stdout = exc.stdout[:MAX_OUTPUT_BYTES] if isinstance(exc.stdout, str) else ""
            result.error = f"Execution timed out after {timeout:g} seconds."
        except OSError as exc:
            # e.g. Windows Smart App Control refusing a freshly compiled, unsigned executable.
            result.error = f"The operating system refused to start the compiled program: {exc}"
        if trace_file.exists():
            for raw in trace_file.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    record = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if record.get("done"):
                    result.steps = int(record.get("steps", 0))
                    result.limited = bool(record.get("limited"))
                else:
                    result.records.append(record)
        if not result.steps:
            result.steps = len(result.records)
        if result.limited and not counting:
            result.error = f"Execution exceeded {max_steps} traced steps; possible infinite loop. Showing the first {max_steps}."
        return result


def build_program(language: str, code: str, scale: ScaleTarget | None = None, n: int | None = None) -> tuple[NativeProgram, Instrumented]:
    program = NativeProgram(language, code)
    instrumented = instrument(code, language, scale, n)
    try:
        program.build(instrumented)
    except Exception:
        program.folder.cleanup()
        raise
    return program, instrumented
