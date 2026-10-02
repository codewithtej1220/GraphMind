"""Short-lived JSON worker with restricted builtins and bounded output."""
from __future__ import annotations

import builtins
import ast
import io
import json
import re
import sys
import os
from typing import Any

# Enforced inside the short-lived worker on Unix containers. Windows does not
# expose rlimit, so the parent timeout and Docker compose limits remain active.
if os.name != "nt":
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))


class LimitError(RuntimeError): pass


class LimitedOutput(io.StringIO):
    def __init__(self, maximum: int): super().__init__(); self.maximum, self.count = maximum, 0
    def write(self, value: str) -> int:
        self.count += len(value.encode("utf-8", errors="replace"))
        if self.count > self.maximum: raise LimitError(f"Output exceeded {self.maximum} bytes.")
        return super().write(value)


def safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)): return value
    if isinstance(value, (list, tuple)): return [safe(v) for v in value[:500]]
    if isinstance(value, dict): return {str(k): safe(v) for k, v in list(value.items())[:200]}
    return repr(value)[:200]


def _integer_expression(node: ast.AST, local: dict[str, Any]) -> int | None:
    """Evaluate only integer literals, local integer names, and basic math."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int): return node.value
    if isinstance(node, ast.Name):
        value = local.get(node.id)
        return value if isinstance(value, int) and not isinstance(value, bool) else None
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _integer_expression(node.operand, local)
        return value if value is None or isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.FloorDiv, ast.Mod)):
        left, right = _integer_expression(node.left, local), _integer_expression(node.right, local)
        if left is None or right is None: return None
        try:
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            if isinstance(node.op, ast.FloorDiv): return left // right
            return left % right
        except (ZeroDivisionError, OverflowError): return None
    return None


def _loop_specs(code: str) -> list[dict[str, Any]]:
    try: tree = ast.parse(code)
    except SyntaxError: return []
    specs = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.For, ast.AsyncFor, ast.While)): continue
        target = node.target if isinstance(node, (ast.For, ast.AsyncFor)) else None
        variable = target.id if isinstance(target, ast.Name) else None
        body_start = min((statement.lineno for statement in node.body), default=node.lineno)
        specs.append({
            "start": node.lineno,
            "end": getattr(node, "end_lineno", node.lineno),
            "body_start": body_start,
            "var": variable,
            "iterator": node.iter if isinstance(node, (ast.For, ast.AsyncFor)) else None,
        })
    return specs


def _loop_total(spec: dict[str, Any], local: dict[str, Any]) -> int | None:
    iterator = spec["iterator"]
    if isinstance(iterator, ast.Call) and isinstance(iterator.func, ast.Name) and iterator.func.id == "range":
        args = [_integer_expression(arg, local) for arg in iterator.args]
        if not args or any(value is None for value in args) or len(args) > 3: return None
        try: return len(range(*args))
        except (ValueError, OverflowError): return None
    if isinstance(iterator, ast.Name):
        value = local.get(iterator.id)
        if isinstance(value, (list, tuple, str, dict, set, range)): return len(value)
    return None


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    code, lines = payload.get("code", ""), payload.get("code", "").splitlines()
    loops = _loop_specs(code)
    loop_counters: dict[tuple[int, int], int] = {}
    input_lines = iter(str(payload.get("input", "")).splitlines())
    output, frames, steps = LimitedOutput(int(payload.get("max_output", 64000))), [], 0
    def input_fn(prompt: str = "") -> str:
        if prompt: output.write(str(prompt))
        try: return next(input_lines)
        except StopIteration as exc: raise EOFError("GraphMind input exhausted") from exc
    names = "abs all any bool chr dict enumerate float int isinstance len list max min pow print range reversed round set sorted str sum tuple zip"
    allowed = {name: getattr(builtins, name) for name in names.split()}; allowed["input"] = input_fn
    env: dict[str, Any] = {"__name__": "__main__", "__builtins__": allowed}
    old_stdout, old_trace = sys.stdout, sys.gettrace()
    count_only = bool(payload.get("count_only"))
    def tracer(frame, event, arg):
        nonlocal steps
        if frame.f_code.co_filename != "<graphmind-user>" or event not in ("call", "line", "return", "exception"): return tracer
        steps += 1
        if steps > int(payload.get("max_steps", 5000)): raise LimitError(f"Execution exceeded {payload.get('max_steps')} traced steps; possible infinite loop.")
        if count_only: return tracer
        local = {k: v for k, v in frame.f_locals.items() if not k.startswith("__")}
        arrays = [(k,v) for k,v in local.items() if isinstance(v,(list,tuple)) and len(v)<=500]
        array_name, array = arrays[0] if arrays else (None, [])
        pointers = {k:v for k,v in local.items() if k in {"i","j","k","idx","index","left","right","low","high"} and isinstance(v,int) and 0<=v<len(array)}
        line = frame.f_lineno; text = lines[line-1].strip() if 0<line<=len(lines) else ""
        active_loops = [loop for loop in loops if loop["start"] <= line <= loop["end"]]
        active_loop = max(active_loops, key=lambda loop: loop["start"], default=None)
        loop_info = None
        if active_loop:
            key = (id(frame), active_loop["start"])
            if event == "line" and line == active_loop["body_start"]:
                loop_counters[key] = loop_counters.get(key, 0) + 1
            iteration = loop_counters.get(key, 0)
            variable = active_loop["var"]
            variable_value = local.get(variable) if variable else None
            if isinstance(variable_value, int) and not isinstance(variable_value, bool):
                iterator = active_loop["iterator"]
                if isinstance(iterator, ast.Call) and isinstance(iterator.func, ast.Name) and iterator.func.id == "range":
                    args = [_integer_expression(arg, local) for arg in iterator.args]
                    if args and all(value is not None for value in args):
                        start, step = (0, 1) if len(args) == 1 else (args[0], 1) if len(args) == 2 else (args[0], args[2])
                        if step and (variable_value - start) % step == 0:
                            iteration = (variable_value - start) // step + 1
                elif iteration == 0:
                    iteration = variable_value + 1
            if iteration > 0:
                loop_info = {"var": variable, "iteration": iteration, "total": _loop_total(active_loop, local)}
        operation = "ERROR" if event == "exception" else "LOOP" if re.match(r"(for|while)\b",text) else "COMPARE" if re.match(r"(if|elif|while)\b",text) else "WRITE" if re.search(r"(?<![=!<>])=(?!=)",text) else "RETURN" if text.startswith("return") or event=="return" else "CALL" if event=="call" else "EXEC"
        stack=[]; current=frame
        while current:
            if current.f_code.co_filename=="<graphmind-user>": stack.append(current.f_code.co_name)
            current=current.f_back
        stack.reverse()
        description = f"{type(arg[1]).__name__}: {arg[1]}" if event == "exception" and isinstance(arg, tuple) and len(arg) > 1 else f"Step {steps}: {text or event}"
        frames.append({"step":steps,"activeLine":line,"event":event,"operation":operation,"description":description,"callStack":stack,"variables":{k:safe(v) for k,v in local.items() if not isinstance(v,(list,tuple)) and not callable(v)},"arrays":{k:safe(v) for k,v in arrays},"arrayName":array_name,"arrayState":safe(array),"pointers":pointers,"loop":loop_info,"callInfo":{"function":frame.f_code.co_name,"value":safe(arg)} if event=="return" else None})
        if event == "return":
            frame_id = id(frame)
            for key in [key for key in loop_counters if key[0] == frame_id]:
                del loop_counters[key]
        return tracer
    try:
        compile(code,"<graphmind-user>","exec")
        sys.stdout=output; sys.settrace(tracer); exec(compile(code,"<graphmind-user>","exec"),env,env)
        return {"frames":frames,"stdout":output.getvalue(),"error":None,"steps":steps,"limited":False}
    except SyntaxError as exc:
        error = f"SyntaxError: {exc.msg} (line {exc.lineno})"
        frames.append({"step":len(frames)+1,"activeLine":exc.lineno or 1,"event":"exception","operation":"ERROR","description":error,"callStack":[],"variables":{},"arrayName":None,"arrayState":[],"pointers":{},"loop":None,"callInfo":None})
        return {"frames":frames,"stdout":output.getvalue(),"error":error}
    except LimitError as exc:
        if count_only: return {"frames":[],"stdout":"","error":None,"steps":steps,"limited":True}
        return {"frames":frames,"stdout":output.getvalue(),"error":str(exc)}
    except Exception as exc: return {"frames":frames,"stdout":output.getvalue(),"error":f"{type(exc).__name__}: {exc}"}
    finally: sys.settrace(old_trace); sys.stdout=old_stdout


def main() -> None:
    try:
        payload=json.loads(sys.stdin.read()); result=execute(payload)
    except Exception as exc: result={"error":f"WorkerError: {type(exc).__name__}: {exc}"}
    sys.__stdout__.write(json.dumps(result,ensure_ascii=True))
if __name__ == "__main__": main()
