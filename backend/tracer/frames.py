"""Turn raw trace records into the TraceFrame shape the frontend renders.

Shared by every language: the Python worker's frames go through `enrich_arrays`, and
native runtimes' JSON records go through `build_frames` (which calls it too).
"""
from __future__ import annotations

import ast
import re
from typing import Any

from tracer.instrument import LoopSpec

POINTER_NAMES = (
    "i", "j", "k", "idx", "index", "left", "right", "low", "high", "lo", "hi", "mid", "start", "end",
    "l", "r", "p", "q", "pos", "slow", "fast", "cur", "curr", "current", "top", "front", "rear", "head", "tail",
    "min_idx", "minIdx", "min_index", "minIndex", "max_idx", "maxIdx", "smallest", "largest", "pivot_index", "pivotIndex", "pi",
)
INDEX_ACCESS = re.compile(r"\b([A-Za-z_]\w*)\s*\[\[?\s*([^\[\]]+?)\s*\]?\]\s*(?:\[\s*([^\[\]]+?)\s*\])?")
ASSIGNMENT = re.compile(r"(?<![=!<>])=(?!=)|\+\+|--|[-+*/%]=|<-|:=")


def _is_array(value: Any) -> bool:
    return isinstance(value, list)


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def evaluate(expression: str | None, scalars: dict[str, Any], arrays: dict[str, list]) -> int | None:
    """Evaluate a small integer expression from source text (indices, loop bounds) against a frame."""
    if not expression:
        return None
    text = expression.strip().rstrip(";")
    lengths = {name: len(value) for name, value in arrays.items()}
    lengths.update({name: len(value) for name, value in scalars.items() if isinstance(value, str)})

    def length_of(match: re.Match) -> str:
        name = match.group(1)
        return str(lengths[name]) if name in lengths else match.group(0)

    text = re.sub(r"\b(\w+)\.(?:length|size)\b(?:\(\))?", length_of, text)
    text = re.sub(r"\b(?:len|length|size)\(\s*(\w+)\s*\)", length_of, text)
    text = re.sub(r"sizeof\s*\(?\s*(\w+)\s*\)?\s*/\s*sizeof\s*\(?\s*\(?\1\)?\s*\[\s*0\s*\]\s*\)?", length_of, text)
    text = text.replace("&&", " and ").replace("||", " or ")
    try:
        tree = ast.parse(text, mode="eval").body
    except SyntaxError:
        return None

    def walk(node: ast.AST) -> int | None:
        if isinstance(node, ast.Constant):
            return _int(node.value)
        if isinstance(node, ast.Name):
            return _int(scalars.get(node.id))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = walk(node.operand)
            return None if value is None else (value if isinstance(node.op, ast.UAdd) else -value)
        if isinstance(node, ast.BinOp):
            left, right = walk(node.left), walk(node.right)
            if left is None or right is None:
                return None
            try:
                if isinstance(node.op, ast.Add): return left + right
                if isinstance(node.op, ast.Sub): return left - right
                if isinstance(node.op, ast.Mult): return left * right
                if isinstance(node.op, (ast.Div, ast.FloorDiv)): return int(left / right) if right else None
                if isinstance(node.op, ast.Mod): return left % right if right else None
                if isinstance(node.op, ast.RShift): return left >> right
                if isinstance(node.op, ast.LShift): return left << right
            except (OverflowError, ValueError):
                return None
        return None

    return walk(tree)


def accessed_indices(text: str, scalars: dict[str, Any], arrays: dict[str, list], one_based: bool) -> dict[str, list]:
    """Which cells a line is about to touch, e.g. `arr[j] > arr[j + 1]` -> {"arr": [j, j+1]}."""
    result: dict[str, list] = {}
    offset = 1 if one_based else 0
    for match in INDEX_ACCESS.finditer(text):
        name, first, second = match.group(1), match.group(2), match.group(3)
        array = arrays.get(name)
        if array is None:
            continue
        row = evaluate(first, scalars, arrays)
        if row is None:
            continue
        row -= offset
        if second is not None and array and _is_array(array[0]):
            col = evaluate(second, scalars, arrays)
            if col is not None and 0 <= row < len(array) and 0 <= col - offset < len(array[row]):
                cell = [row, col - offset]
                if cell not in result.setdefault(name, []):
                    result[name].append(cell)
        elif 0 <= row < len(array) and row not in result.setdefault(name, []):
            result[name].append(row)
    return {k: v for k, v in result.items() if v}


def enrich_arrays(frame: dict[str, Any], previous: dict[str, Any] | None, line_text: str, one_based: bool = False) -> None:
    """Fill arrays / accessed / primary array / pointers on a frame in place."""
    arrays: dict[str, list] = frame.get("arrays") or {}
    scalars: dict[str, Any] = frame.get("variables") or {}
    previous_arrays: dict[str, list] = (previous or {}).get("arrays") or {}
    accessed = accessed_indices(line_text, scalars, arrays, one_based)

    primary = None
    changed = [name for name, value in arrays.items() if name in previous_arrays and previous_arrays[name] != value]
    if changed:
        primary = changed[0]
    elif previous and previous.get("arrayName") in arrays:
        primary = previous["arrayName"]
    elif accessed:
        primary = next(iter(accessed))
    elif arrays:
        primary = max(arrays, key=lambda name: (bool(arrays[name]), not (arrays[name] and _is_array(arrays[name][0])), len(arrays[name])))

    pointers: dict[str, int] = {}
    if primary is not None and arrays[primary] and not _is_array(arrays[primary][0]):
        size = len(arrays[primary])
        for name in POINTER_NAMES:
            value = _int(scalars.get(name))
            if value is None:
                continue
            value -= 1 if one_based else 0
            if 0 <= value < size:
                pointers[name] = value

    frame["arrays"] = arrays
    frame["accessed"] = accessed
    frame["arrayName"] = primary
    frame["arrayState"] = arrays.get(primary, []) if primary else []
    frame["pointers"] = pointers


def _operation(text: str, kind: int) -> str:
    if kind == 1 or re.match(r"(for|while|do|repeat)\b", text):
        return "LOOP"
    if re.match(r"(\}\s*)?(if|else\s+if|elif|switch|case|match)\b", text):
        return "COMPARE"
    if re.match(r"return\b", text):
        return "RETURN"
    if ASSIGNMENT.search(re.sub(r"\"[^\"]*\"|'[^']*'", "", text)):
        return "WRITE"
    return "EXEC"


def _after_condition(text: str) -> str | None:
    match = re.match(r"(?:\}\s*)?(?:else\s+)?(?:if|while)\s*\(", text)
    if not match:
        return None
    depth = 1
    for i in range(match.end(), len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[i + 1:].strip().lstrip("{").strip() or None
    return None


def _format(value: Any) -> str:
    if isinstance(value, str):
        return f'"{value}"' if len(value) < 40 else f'"{value[:37]}…"'
    if isinstance(value, list):
        inner = ", ".join(_format(v) for v in value[:6])
        return f"[{inner}{', …' if len(value) > 6 else ''}]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def _clip(text: str, size: int = 80) -> str:
    text = " ".join(text.split())
    return text if len(text) <= size else text[: size - 1] + "…"


def _loop_total(spec: LoopSpec, scalars: dict[str, Any], arrays: dict[str, list], language: str) -> int | None:
    if spec.kind == "foreach" and spec.iterable:
        iterable = spec.iterable.strip()
        if iterable in arrays:
            return len(arrays[iterable])
        if isinstance(scalars.get(iterable), str):
            return len(scalars[iterable])
        range_match = re.fullmatch(r"\(?(.+?)\)?\s*:\s*\(?(.+?)\)?", iterable) if language == "r" else None
        if range_match:
            a, b = evaluate(range_match.group(1), scalars, arrays), evaluate(range_match.group(2), scalars, arrays)
            return abs(b - a) + 1 if a is not None and b is not None else None
        seq = re.fullmatch(r"seq_(?:len|along)\((\w+)\)", iterable)
        if seq:
            name = seq.group(1)
            return len(arrays[name]) if name in arrays else _int(scalars.get(name))
        return None
    if spec.kind != "for" or not spec.var or not spec.cond or spec.init is None:
        return None
    start = evaluate(spec.init, scalars, arrays)
    cond = re.fullmatch(rf"\s*{re.escape(spec.var)}\s*(<=|<|>=|>|!=)\s*(.+)", spec.cond)
    if start is None or cond is None:
        return None
    bound = evaluate(cond.group(2), scalars, arrays)
    update = (spec.update or "").replace(" ", "")
    if update in (f"{spec.var}++", f"++{spec.var}", f"{spec.var}+=1", f"{spec.var}={spec.var}+1"):
        step = 1
    elif update in (f"{spec.var}--", f"--{spec.var}", f"{spec.var}-=1", f"{spec.var}={spec.var}-1"):
        step = -1
    else:
        return None
    if bound is None:
        return None
    op = cond.group(1)
    if step > 0 and op in ("<", "!="):
        return max(0, bound - start)
    if step > 0 and op == "<=":
        return max(0, bound - start + 1)
    if step < 0 and op in (">", "!="):
        return max(0, start - bound)
    if step < 0 and op == ">=":
        return max(0, start - bound + 1)
    return None


def describe(frame: dict[str, Any], previous: dict[str, Any] | None, text: str, iteration: bool = False) -> str:
    """One plain-English sentence for the step, shared by every language."""
    arrays, scalars = frame.get("arrays") or {}, frame.get("variables") or {}
    stack = frame.get("callStack") or ["<main>"]
    operation, loop = frame.get("operation"), frame.get("loop")
    touched = ", ".join(
        f"{name}[{index if not isinstance(index, list) else ']['.join(map(str, index))}]="
        f"{_format(arrays[name][index] if not isinstance(index, list) else arrays[name][index[0]][index[1]])}"
        for name, indices in (frame.get("accessed") or {}).items() for index in indices[:3]
    )
    loop_var = (loop or {}).get("var")
    if frame.get("event") == "call" and stack[-1] == "<module>":
        description = "Program starts"
    elif frame.get("event") == "call":
        args = (frame.get("callInfo") or {}).get("args") or {**scalars, **arrays}
        description = f"Call {stack[-1]}({', '.join(f'{k}={_format(v)}' for k, v in list(args.items())[:4])})"
    elif frame.get("event") == "return":
        value = (frame.get("callInfo") or {}).get("value")
        description = "Program finished" if stack[-1] == "<module>" else f"{stack[-1]}() returns {_format(value)}"
    elif operation == "LOOP" and loop and iteration:
        total = f" of {loop['total']}" if loop.get("total") else ""
        value = f" — {loop_var} = {_format(scalars[loop_var])}" if loop_var in scalars else ""
        description = f"Loop iteration {loop['iteration']}{total}{value}"
    elif operation == "LOOP" and loop and previous is not None and previous.get("activeLine", 0) > frame.get("activeLine", 0):
        # Python revisits the loop header after each pass, before advancing the loop variable.
        description = f"Iteration {loop['iteration']} done — back to {_clip(text, 50)}"
    elif operation == "COMPARE":
        description = f"Check {_clip(text, 60)}" + (f"  →  {touched}" if touched else "")
    elif operation == "LOOP":
        description = f"Start loop: {_clip(text, 60)}"
    elif operation == "RETURN":
        description = f"Return from {stack[-1]}: {_clip(text, 60)}"
    elif operation == "WRITE":
        description = f"Update: {_clip(text, 60)}" + (f"  ({touched})" if touched else "")
    else:
        description = f"Run: {_clip(text, 60)}" + (f"  ({touched})" if touched else "")
    previous_stack = (previous or {}).get("callStack") or []
    if previous is not None and len(stack) < len(previous_stack) and frame.get("event") != "return":
        description = f"Back in {stack[-1]} · {description}"
    return description


def build_frames(records: list[dict[str, Any]], code: str, loops: list[LoopSpec], language: str) -> list[dict[str, Any]]:
    lines = code.splitlines()
    one_based = language == "r"
    frames: list[dict[str, Any]] = []
    counters: dict[tuple[int, int], int] = {}
    previous: dict[str, Any] | None = None
    previous_record: dict[str, Any] | None = None
    loop_starts = {spec.start: spec for spec in loops}

    for step, record in enumerate(records, start=1):
        line = int(record.get("l", 0))
        kind = int(record.get("k", 0))
        stack = [str(s) for s in record.get("s") or []] or ["<main>"]
        raw_vars = {k: v for k, v in (record.get("v") or {}).items() if v != "?"}
        arrays = {k: v for k, v in raw_vars.items() if _is_array(v)}
        scalars = {k: v for k, v in raw_vars.items() if not _is_array(v)}
        text = lines[line - 1].strip() if 0 < line <= len(lines) else ""
        depth = len(stack)

        # Loop iteration counting: entering a loop resets it, each iteration hook advances it.
        spec_here = loop_starts.get(line)
        if spec_here is not None:
            key = (depth, spec_here.start)
            if kind == 1:
                counters[key] = counters.get(key, 0) + 1
            elif not (previous_record and previous_record.get("l") == line and previous_record.get("k") == 1):
                counters[key] = 0  # entering the loop (not a statement sharing the loop's line)
        containing = [spec for spec in loops if spec.start <= line <= spec.end and counters.get((depth, spec.start), 0) > 0]
        active = max(containing, key=lambda spec: spec.start, default=None)
        loop = None
        if active is not None:
            loop = {"var": active.var, "iteration": counters[(depth, active.start)], "total": _loop_total(active, scalars, arrays, language)}

        operation = _operation(text, kind)
        if kind == 0 and previous is not None and previous["activeLine"] == line and previous["operation"] == "COMPARE":
            # A one-line `if (cond) body;` — this hook is the body running, so classify the part after the condition.
            body = _after_condition(text)
            if body:
                operation, text = _operation(body, 0), body
        previous_stack = (previous or {}).get("callStack") or []
        entered = previous is None and depth > 1 or (previous is not None and (depth > len(previous_stack) or (depth == len(previous_stack) and stack[-1] != previous_stack[-1])))
        call_info = None
        event = "line"
        if entered and depth > 1:
            event, operation = "call", "CALL"
            call_info = {"function": stack[-1], "args": {k: v for k, v in raw_vars.items()}}

        frame: dict[str, Any] = {
            "step": step, "activeLine": line, "event": event, "operation": operation, "description": "",
            "callStack": stack, "variables": scalars, "arrays": arrays, "loop": loop, "callInfo": call_info,
        }
        enrich_arrays(frame, previous, text, one_based)
        frame["description"] = describe(frame, previous, text, iteration=kind == 1)
        frames.append(frame)
        previous = frame
        previous_record = record
    return frames


def error_frame(step: int, line: int, message: str, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    base = previous or {}
    return {
        "step": step, "activeLine": line, "event": "exception", "operation": "ERROR", "description": message[:500],
        "callStack": base.get("callStack", []), "variables": base.get("variables", {}), "arrays": base.get("arrays", {}),
        "accessed": {}, "arrayName": base.get("arrayName"), "arrayState": base.get("arrayState", []),
        "pointers": base.get("pointers", {}), "loop": None, "callInfo": None,
    }
