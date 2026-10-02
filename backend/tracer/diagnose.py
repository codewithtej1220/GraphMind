"""Turn compiler / runtime errors into "this line is wrong — change it to this" suggestions.

Rules are offline and deterministic: each looks at the error message, the language and
the source, and either returns a concrete line fix (plus the whole corrected program)
or declines. The first rule that matches wins; otherwise a plain explanation is returned.
"""
from __future__ import annotations

import difflib
import re
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Callable

BUILTINS = {
    "python": ["print", "len", "range", "input", "int", "str", "float", "list", "dict", "set", "tuple", "sum", "min", "max",
               "sorted", "reversed", "enumerate", "zip", "abs", "round", "True", "False", "None", "append", "isinstance"],
    "javascript": ["console", "log", "length", "push", "pop", "Math", "Number", "String", "Array", "Object", "JSON",
                   "parseInt", "parseFloat", "true", "false", "null", "undefined", "let", "const", "function", "return"],
    "c": ["printf", "scanf", "puts", "malloc", "free", "strlen", "strcmp", "strcpy", "sizeof", "return", "int", "char", "double"],
    "cpp": ["cout", "cin", "endl", "vector", "string", "size", "push_back", "sort", "swap", "max", "min", "return"],
    "java": ["System", "out", "println", "print", "length", "String", "Math", "Integer", "Arrays", "ArrayList", "return"],
    "go": ["fmt", "Println", "Printf", "len", "append", "make", "range", "return", "int", "string"],
    "r": ["print", "length", "cat", "paste", "c", "seq_len", "seq_along", "TRUE", "FALSE", "NULL", "return", "function"],
}
BUILTINS["typescript"] = BUILTINS["javascript"]

# Name -> correct spelling for habits carried over from other languages.
FOREIGN_NAMES = {
    "python": {"true": "True", "false": "False", "null": "None", "none": "None", "nil": "None", "printf": "print",
               "println": "print", "echo": "print", "length": "len", "console": "print"},
    "javascript": {"True": "true", "False": "false", "None": "null", "nil": "null", "print": "console.log"},
    "r": {"True": "TRUE", "False": "FALSE", "true": "TRUE", "false": "FALSE", "None": "NULL", "null": "NULL", "len": "length"},
    "java": {"println": "System.out.println", "print": "System.out.println", "printf": "System.out.printf", "len": "length"},
    "go": {"println": "fmt.Println", "print": "fmt.Println", "printf": "fmt.Printf", "nil": "nil"},
}
FOREIGN_NAMES["typescript"] = FOREIGN_NAMES["javascript"]

C_HEADERS = {
    "printf": "<stdio.h>", "scanf": "<stdio.h>", "puts": "<stdio.h>", "getchar": "<stdio.h>", "fgets": "<stdio.h>",
    "malloc": "<stdlib.h>", "free": "<stdlib.h>", "calloc": "<stdlib.h>", "exit": "<stdlib.h>", "rand": "<stdlib.h>", "abs": "<stdlib.h>", "qsort": "<stdlib.h>",
    "strlen": "<string.h>", "strcpy": "<string.h>", "strcmp": "<string.h>", "strcat": "<string.h>", "memset": "<string.h>", "memcpy": "<string.h>",
    "sqrt": "<math.h>", "pow": "<math.h>", "floor": "<math.h>", "ceil": "<math.h>", "fabs": "<math.h>",
    "bool": "<stdbool.h>", "true": "<stdbool.h>", "false": "<stdbool.h>", "INT_MAX": "<limits.h>", "INT_MIN": "<limits.h>",
}
CPP_HEADERS = {
    "cout": "<iostream>", "cin": "<iostream>", "endl": "<iostream>", "cerr": "<iostream>", "vector": "<vector>", "string": "<string>",
    "sort": "<algorithm>", "swap": "<algorithm>", "max": "<algorithm>", "min": "<algorithm>", "reverse": "<algorithm>",
    "map": "<map>", "unordered_map": "<unordered_map>", "set": "<set>", "queue": "<queue>", "priority_queue": "<queue>",
    "stack": "<stack>", "pair": "<utility>", "INT_MAX": "<climits>",
}
KEYWORDS = {
    "if", "else", "elif", "for", "while", "do", "return", "def", "class", "function", "int", "char", "double", "float", "void",
    "long", "short", "const", "let", "var", "import", "from", "include", "using", "namespace", "public", "static", "private",
    "new", "in", "of", "and", "or", "not", "is", "func", "package", "switch", "case", "break", "continue", "true", "false",
}


@dataclass
class Diagnosis:
    line: int  # where the error was reported
    title: str
    explanation: str
    original: str  # source text of the line being changed
    fixLine: int | None = None  # line the fix changes (or inserts before)
    suggestion: str | None = None  # the corrected / inserted line
    action: str = "replace"  # "replace" | "insert" | "none"
    fixedCode: str | None = None
    confidence: str = "medium"  # "high" | "medium" | "low"
    message: str = ""  # one-line summary of the raw error


class Context:
    def __init__(self, code: str, language: str, error: str, line: int | None, frames: list[dict[str, Any]]) -> None:
        self.code = code
        self.lines = code.split("\n")
        self.language = language
        self.error = error
        self.line = line if line and 1 <= line <= len(self.lines) else self._line_from_error()
        self.frames = frames
        self.message = summarize(error)

    def _line_from_error(self) -> int:
        match = re.search(r"\(line (\d+)\)|line (\d+)|:(\d+):", self.error)
        if match:
            value = int(next(g for g in match.groups() if g))
            if 1 <= value <= len(self.lines):
                return value
        return 1

    def text(self, n: int) -> str:
        return self.lines[n - 1] if 1 <= n <= len(self.lines) else ""

    def indent(self, n: int) -> str:
        text = self.text(n)
        return text[: len(text) - len(text.lstrip())]

    def prev_code_line(self, n: int) -> int | None:
        for m in range(n - 1, 0, -1):
            stripped = self.text(m).strip()
            if stripped and not stripped.startswith(("//", "#", "/*", "*")):
                return m
        return None

    def replace(self, n: int, new_text: str, title: str, explanation: str, confidence: str = "medium") -> Diagnosis:
        fixed = list(self.lines)
        fixed[n - 1] = new_text
        return Diagnosis(self.line, title, explanation, self.text(n).rstrip(), n, new_text.rstrip(), "replace", "\n".join(fixed), confidence, self.message)

    def insert(self, n: int, new_text: str, title: str, explanation: str, confidence: str = "medium") -> Diagnosis:
        """Insert `new_text` as a new line before line `n` (n = len + 1 appends)."""
        fixed = list(self.lines)
        fixed.insert(n - 1, new_text)
        return Diagnosis(self.line, title, explanation, self.text(min(n, len(self.lines))).rstrip(), n, new_text.rstrip(), "insert", "\n".join(fixed), confidence, self.message)

    def explain(self, title: str, explanation: str, confidence: str = "low") -> Diagnosis:
        return Diagnosis(self.line, title, explanation, self.text(self.line).rstrip(), None, None, "none", None, confidence, self.message)


def summarize(error: str) -> str:
    lines = [l.strip() for l in error.strip().splitlines() if l.strip()]
    for pattern in (r"error[:\s]", r"\w+(Error|Exception)\b", r"panic:", r"^Error"):
        for line in lines:
            if re.search(pattern, line):
                return re.sub(r"^\S+?\.(?:c|cpp|java|go|js|ts|R):\d+(?::\d+)?:\s*", "", line)[:200]
    return (lines[-1] if lines else error)[:200]


def _sub_word(text: str, old: str, new: str) -> str:
    return re.sub(rf"(?<![\w.]){re.escape(old)}(?!\w)", new, text, count=1)


def _identifiers(code: str) -> set[str]:
    return {w for w in re.findall(r"[A-Za-z_]\w*", re.sub(r"(\"[^\"\n]*\"|'[^'\n]*')", "", code)) if w not in KEYWORDS}


def _last_include_line(ctx: Context) -> int:
    last = 0
    for i, line in enumerate(ctx.lines, start=1):
        if line.strip().startswith(("#include", "import ", "package ")):
            last = i
    return last


# ----------------------------------------------------------------------------- rules
def missing_include(ctx: Context) -> Diagnosis | None:
    if ctx.language not in ("c", "cpp"):
        return None
    header = re.search(r"forget to '#include (<[\w./]+>)'", ctx.error) or re.search(r"include '(<[\w./]+>)' or provide", ctx.error)
    name = re.search(r"implicit declaration of function '(\w+)'|'(\w+)' (?:undeclared|was not declared)", ctx.error)
    missing = (name.group(1) or name.group(2)) if name else None
    table = C_HEADERS if ctx.language == "c" else {**C_HEADERS, **CPP_HEADERS}
    include = header.group(1) if header else table.get(missing or "")
    if include and f"#include {include}" not in ctx.code:
        return ctx.insert(1, f"#include {include}", f"Missing #include {include}",
                          f"`{missing or include}` is declared in {include}, which this program never includes. Add it at the top.", "high")
    if ctx.language == "cpp" and missing in CPP_HEADERS and "using namespace std" not in ctx.code and "std::" + missing not in ctx.code:
        where = _last_include_line(ctx) + 1
        return ctx.insert(where, "using namespace std;", f"`{missing}` lives in the std namespace",
                          f"`{missing}` is part of the C++ standard library (std::{missing}). Add `using namespace std;` after the includes, or write std::{missing}.", "high")
    return None


def go_imports(ctx: Context) -> Diagnosis | None:
    if ctx.language != "go":
        return None
    unused = re.search(r'"([\w/]+)" imported and not used', ctx.error)
    if unused:
        for i, line in enumerate(ctx.lines, start=1):
            if re.fullmatch(rf'\s*(import\s+)?"{re.escape(unused.group(1))}"\s*', line):
                return ctx.replace(i, "", f'Unused import "{unused.group(1)}"', "Go refuses to compile programs with unused imports. Remove this import.", "high")
    undefined = re.search(r"undefined: (fmt|strings|strconv|math|sort|os)\b", ctx.error)
    if undefined and f'"{undefined.group(1)}"' not in ctx.code:
        package_line = next((i for i, l in enumerate(ctx.lines, 1) if l.startswith("package ")), 0)
        return ctx.insert(package_line + 1, f'import "{undefined.group(1)}"', f'Missing import "{undefined.group(1)}"',
                          f"The {undefined.group(1)} package is used but never imported.", "high")
    unused_var = re.search(r"declared and not used: (\w+)|(\w+) declared (?:and|but) not used", ctx.error)
    if unused_var:
        name = unused_var.group(1) or unused_var.group(2)
        return ctx.insert(ctx.line + 1, f"{ctx.indent(ctx.line)}_ = {name}", f"`{name}` is declared but never used",
                          f"Go refuses to compile unused variables. Use `{name}` somewhere, delete it, or mark it as intentionally unused with `_ = {name}`.", "medium")
    return None


UNDEFINED_PATTERNS = [
    r"name '(\w+)' is not defined", r"ReferenceError: (\w+) is not defined", r"'(\w+)' undeclared", r"'(\w+)' was not declared in this scope",
    r"symbol:\s+(?:variable|method|class) (\w+)", r"undefined: (\w+)", r"object '(\w+)' not found", r'could not find function "(\w+)"',
    r"Cannot find name '(\w+)'", r"implicit declaration of function '(\w+)'", r"use of undeclared identifier '(\w+)'",
]


def undefined_name(ctx: Context) -> Diagnosis | None:
    name = None
    for pattern in UNDEFINED_PATTERNS:
        match = re.search(pattern, ctx.error)
        if match:
            name = match.group(1)
            break
    if not name:
        return None
    line = ctx.line if re.search(rf"(?<![\w]){re.escape(name)}(?!\w)", ctx.text(ctx.line)) else next(
        (i for i, l in enumerate(ctx.lines, 1) if re.search(rf"(?<![\w.]){re.escape(name)}(?!\w)", l)), ctx.line)
    original = ctx.text(line)
    foreign = FOREIGN_NAMES.get(ctx.language, {}).get(name)
    if foreign:
        return ctx.replace(line, _sub_word(original, name, foreign), f"`{name}` isn't {ctx.language.capitalize()}",
                           f"`{name}` comes from another language. In {ctx.language.capitalize()} write `{foreign}`.", "high")
    candidates = (_identifiers(ctx.code) | set(BUILTINS.get(ctx.language, []))) - {name}
    close = difflib.get_close_matches(name, sorted(candidates), n=1, cutoff=0.6)
    if close:
        return ctx.replace(line, _sub_word(original, name, close[0]), f"`{name}` is not defined — did you mean `{close[0]}`?",
                           f"Nothing called `{name}` exists at this point. It looks like a typo for `{close[0]}`.", "high")
    return ctx.explain(f"`{name}` is not defined",
                       f"`{name}` is used before anything with that name is declared. Declare or assign it first, or check the spelling.", "medium")


def missing_colon(ctx: Context) -> Diagnosis | None:
    if ctx.language != "python" or not re.search(r"expected ':'|invalid syntax|SyntaxError", ctx.error):
        return None
    for n in (ctx.line, ctx.prev_code_line(ctx.line) or 0):
        stripped = ctx.text(n).rstrip()
        code = stripped.split("#")[0].rstrip()
        if re.match(r"\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b", code) and not code.endswith(":"):
            return ctx.replace(n, code + ":", "Missing colon",
                               "Lines that start a block in Python (if, elif, else, for, while, def, class, try…) must end with `:`.", "high")
    return None


def assignment_in_condition(ctx: Context) -> Diagnosis | None:
    if not re.search(r"Maybe you meant '=='|cannot be converted to boolean|invalid syntax|SyntaxError", ctx.error):
        return None
    text = ctx.text(ctx.line)
    match = re.match(r"(\s*(?:if|elif|while|else if)\b\s*\(?.*?[^=!<>+\-*/%])=([^=].*)", text)
    if not match:
        return None
    return ctx.replace(ctx.line, f"{match.group(1)}=={match.group(2)}", "`=` used where `==` was meant",
                       "A single `=` assigns a value. To compare two values in a condition, use `==`.", "high")


def missing_semicolon(ctx: Context) -> Diagnosis | None:
    if ctx.language not in ("c", "cpp", "java", "javascript", "typescript"):
        return None
    if not re.search(r"expected ';'|';' expected|Missing semicolon|expected ',' or ';'|';' expected", ctx.error):
        return None
    candidates = [ctx.line]
    previous = ctx.prev_code_line(ctx.line)
    if previous:
        candidates.append(previous)
    for n in candidates:
        code = re.sub(r"//.*$", "", ctx.text(n)).rstrip()
        stripped = code.strip()
        if not stripped or stripped.startswith(("#", "}", "{", "if", "for", "while", "else", "switch", "case", "default", "@")):
            continue
        if code.endswith((";", "{", "}", ":", ",", "(", "&&", "||", "+")):
            continue
        return ctx.replace(n, code + ";", "Missing semicolon", "Each statement must end with `;`. This line is missing one.", "high")
    return None


def unclosed_string(ctx: Context) -> Diagnosis | None:
    if not re.search(r"unterminated string|EOL while scanning|unclosed string literal|missing terminating|Invalid or unexpected token|Unterminated string", ctx.error):
        return None
    text = ctx.text(ctx.line)
    for quote in ('"', "'"):
        if text.count(quote) % 2 == 1:
            match = re.match(r"(.*?)([);:,\s]*)$", text)
            body, tail = (match.group(1), match.group(2)) if match else (text, "")
            return ctx.replace(ctx.line, f"{body}{quote}{tail}", "String is never closed",
                               f"This text starts with {quote} but never ends. Add the closing {quote}.", "high")
    return None


PAIRS = {"(": ")", "[": "]", "{": "}"}


def unbalanced(ctx: Context) -> Diagnosis | None:
    if not re.search(r"never closed|unexpected EOF|end of input|reached end of file|expected '\)'|missing \)|'\)' expected|expected '}' at end|Unexpected end|unexpected end of input|was not closed", ctx.error):
        return None
    # A bracket left open on the reported line.
    for n in (ctx.line, ctx.prev_code_line(ctx.line) or 0):
        text = re.sub(r"(\"[^\"]*\"|'[^']*')", "", ctx.text(n))
        missing = ""
        for opener, closer in (("(", ")"), ("[", "]")):
            if text.count(opener) > text.count(closer):
                missing += closer * (text.count(opener) - text.count(closer))
        if missing:
            original = ctx.text(n).rstrip()
            match = re.match(r"(.*?)(\s*[:{;]?)$", original)
            body, tail = (match.group(1), match.group(2)) if match else (original, "")
            return ctx.replace(n, body + missing + tail, f"Missing `{missing}`",
                               "A bracket opened on this line is never closed.", "high")
    # A block brace never closed: append it at the end of the program.
    code = re.sub(r"(\"[^\"\n]*\"|'[^'\n]*')", "", ctx.code)
    if ctx.language not in ("python", "r") and code.count("{") > code.count("}"):
        last = len(ctx.lines)
        while last > 1 and not ctx.lines[last - 1].strip():
            last -= 1
        return ctx.insert(last + 1, "}" * (code.count("{") - code.count("}")), "Missing closing `}`",
                          "A `{` that opens a block is never closed. Add the missing `}` at the end.", "medium")
    return None


def indentation(ctx: Context) -> Diagnosis | None:
    if ctx.language != "python" or not re.search(r"IndentationError|expected an indented block|unindent|unexpected indent", ctx.error):
        return None
    previous = ctx.prev_code_line(ctx.line)
    base = ctx.indent(previous) if previous else ""
    opener = previous is not None and ctx.text(previous).split("#")[0].rstrip().endswith(":")
    target = base + ("    " if opener else "")
    return ctx.replace(ctx.line, target + ctx.text(ctx.line).lstrip(), "Wrong indentation",
                       "Python uses indentation to group code. " + ("Lines inside a block must be indented one level deeper than the line ending in `:`." if opener else "This line should line up with the line above it."), "high")


def string_concat(ctx: Context) -> Diagnosis | None:
    if ctx.language != "python":
        return None
    text = ctx.text(ctx.line)
    if re.search(r'can only concatenate str \(not "\w+"\) to str', ctx.error):
        fixed = re.sub(r"(\+\s*)(?![\"'])([A-Za-z_][\w.\[\]]*(?:\([^()]*\))?)", lambda m: m.group(1) + (m.group(2) if m.group(2).startswith("str(") else f"str({m.group(2)})"), text)
        fixed = re.sub(r"(?<![\w\"'])([A-Za-z_][\w.\[\]]*(?:\([^()]*\))?)(\s*\+\s*[\"'])", lambda m: (m.group(1) if m.group(1).startswith("str(") else f"str({m.group(1)})") + m.group(2), fixed)
        if fixed != text:
            return ctx.replace(ctx.line, fixed, "Text and numbers can't be joined with +",
                               "Python can't add a number to a string. Convert the number with str() first (or use an f-string).", "high")
    if re.search(r"unsupported operand type\(s\) for [+\-*/]: '(int|float)' and 'str'|unsupported operand type\(s\) for [+\-*/]: 'str' and '(int|float)'|'<' not supported between instances of 'str' and 'int'", ctx.error) and "input(" in text:
        return _wrap_input(ctx, text)
    return None


def _wrap_input(ctx: Context, text: str) -> Diagnosis:
    fixed = re.sub(r"(?<!int\()input\(([^()]*)\)", r"int(input(\1))", text, count=1)
    return ctx.replace(ctx.line, fixed, "input() returns text, not a number",
                       "input() always gives back a string. Wrap it in int(...) (or float(...)) before doing maths with it.", "high")


ATTRIBUTE_FIXES = {
    "python": {"push": "append", "add": "append", "size": None, "length": None},
    "javascript": {"append": "push", "add": "push", "size": "length"},
    "java": {},
}
ATTRIBUTE_FIXES["typescript"] = ATTRIBUTE_FIXES["javascript"]


def wrong_method(ctx: Context) -> Diagnosis | None:
    text = ctx.text(ctx.line)
    py = re.search(r"'(\w+)' object has no attribute '(\w+)'", ctx.error)
    if ctx.language == "python" and py:
        attr = py.group(2)
        if attr in ("length", "size", "len"):
            fixed = re.sub(rf"([\w\[\]]+)\.{attr}(\(\))?", r"len(\1)", text, count=1)
            return ctx.replace(ctx.line, fixed, f"Python has no `.{attr}`", "Use the built-in len(...) to get the size of a list or string.", "high")
        replacement = ATTRIBUTE_FIXES["python"].get(attr)
        if replacement:
            return ctx.replace(ctx.line, text.replace(f".{attr}(", f".{replacement}(", 1), f"Lists use `.{replacement}()`, not `.{attr}()`",
                               f"Python lists add items with `.{replacement}()`.", "high")
    js = re.search(r"\w+(?:\.\w+)*\.(\w+) is not a function", ctx.error)
    if ctx.language in ("javascript", "typescript") and js:
        attr = js.group(1)
        if attr == "length":
            return ctx.replace(ctx.line, text.replace(".length()", ".length", 1), "`.length` is not a function",
                               "Arrays and strings expose `.length` as a property — drop the parentheses.", "high")
        replacement = ATTRIBUTE_FIXES["javascript"].get(attr)
        if replacement:
            fixed = text.replace(f".{attr}(", f".{replacement}(", 1) if replacement != "length" else text.replace(f".{attr}()", ".length", 1)
            return ctx.replace(ctx.line, fixed, f"Arrays use `.{replacement}`", f"JavaScript arrays have no `.{attr}()` — use `.{replacement}`.", "high")
    if ctx.language == "java":
        if re.search(r"symbol:\s+method length\(\)[\s\S]*of type \w+\[\]", ctx.error) and ".length()" in text:
            return ctx.replace(ctx.line, text.replace(".length()", ".length", 1), "Arrays use `.length` without ()",
                               "In Java, arrays have a `length` field; only Strings have a `length()` method.", "high")
        if re.search(r"symbol:\s+variable length[\s\S]*of type String", ctx.error):
            return ctx.replace(ctx.line, re.sub(r"\.length\b(?!\()", ".length()", text, count=1), "Strings use `.length()`",
                               "A Java String's size comes from the `length()` method — add the parentheses.", "high")
    return None


def const_reassign(ctx: Context) -> Diagnosis | None:
    if ctx.language not in ("javascript", "typescript") or not re.search(r"Assignment to constant variable|Cannot assign to '(\w+)' because it is a constant", ctx.error):
        return None
    target = re.search(r"Cannot assign to '(\w+)'", ctx.error)
    name = target.group(1) if target else None
    if not name:
        match = re.search(r"([A-Za-z_$][\w$]*)\s*(?:[-+*/%]?=(?!=)|\+\+|--)", ctx.text(ctx.line))
        name = match.group(1) if match else None
    if not name:
        return None
    for i, line in enumerate(ctx.lines, start=1):
        if re.search(rf"\bconst\s+{re.escape(name)}\b", line):
            return ctx.replace(i, re.sub(rf"\bconst(\s+{re.escape(name)}\b)", r"let\1", line, count=1), f"`{name}` is a constant",
                               f"`{name}` is declared with `const`, so it can't be changed later (line {ctx.line} changes it). Declare it with `let` instead.", "high")
    return None


def _enclosing_loop(ctx: Context, n: int) -> int | None:
    for m in range(n, max(0, n - 25), -1):
        if re.match(r"\s*(for|while)\b", ctx.text(m)):
            return m
    return None


def out_of_bounds(ctx: Context) -> Diagnosis | None:
    if not re.search(r"IndexError|ArrayIndexOutOfBounds|index out of range|out of bounds|subscript out of bounds|Segmentation fault|status 3221225477|status -1073741819|status 139|StringIndexOutOfBounds", ctx.error):
        return None
    loop = _enclosing_loop(ctx, ctx.line)
    explanation = "An index went past the end of the array — usually an off-by-one in the loop bound."
    if loop is None:
        return ctx.explain("Index out of range", explanation + " Check the index used on this line.", "low")
    header = ctx.text(loop)
    length = r"(?:len\(\w+\)|\w+\.length(?:\(\))?|\w+\.size\(\)|length\(\w+\)|n|N|size|len|count)"
    if re.search(rf"<=\s*{length}\b", header):
        return ctx.replace(loop, re.sub(rf"<=(\s*{length})", r"<\1", header, count=1), "Loop runs one step too far",
                           explanation + " Valid indexes go from 0 to length − 1, so the loop must stop *before* the length: use `<`, not `<=`.", "high")
    plus_one = re.search(r"range\(\s*(len\(\w+\)|\w+)\s*\+\s*1\s*\)", header)
    if plus_one:
        return ctx.replace(loop, header.replace(plus_one.group(0), f"range({plus_one.group(1)})", 1), "Loop runs one step too far",
                           explanation + f" range({plus_one.group(1)}) already covers every valid index.", "high")
    if re.search(r"\[\s*\w+\s*\+\s*1\s*\]", ctx.text(ctx.line)):
        py = re.search(r"range\(\s*(len\(\w+\)|\w+)\s*\)", header)
        if py:
            return ctx.replace(loop, header.replace(py.group(0), f"range({py.group(1)} - 1)", 1), "`[i + 1]` reads past the end",
                               explanation + " The body reads the *next* element, so the loop must stop one step earlier.", "high")
        c_style = re.search(rf"<\s*({length})(\s*;)", header)
        if c_style:
            return ctx.replace(loop, header.replace(c_style.group(0), f"< {c_style.group(1)} - 1{c_style.group(2)}", 1), "`[i + 1]` reads past the end",
                               explanation + " The body reads the *next* element, so the loop must stop one step earlier.", "high")
    return ctx.explain("Index out of range", explanation, "low")


def endless_loop(ctx: Context) -> Diagnosis | None:
    if not re.search(r"exceeded \d+ traced steps|timed out", ctx.error):
        return None
    loops = Counter(f["activeLine"] for f in ctx.frames if f.get("operation") == "LOOP")
    if not loops:
        return ctx.explain("Program never finishes", "Execution hit the step limit. Look for a loop whose condition never becomes false.", "low")
    loop = loops.most_common(1)[0][0]
    header = ctx.text(loop)
    ctx.line = loop
    explanation = "This loop never stops: its condition stays true forever, so the program hit the step limit."
    wrong_way = re.search(r"(\w+)\s*<=?\s*[^;]+;\s*\1\s*--", header) or re.search(r"(\w+)\s*>=?\s*[^;]+;\s*\1\s*\+\+", header)
    if wrong_way:
        var = wrong_way.group(1)
        fixed = header.replace(f"{var}--", f"{var}++") if f"{var}--" in header else header.replace(f"{var}++", f"{var}--")
        return ctx.replace(loop, fixed, "Loop counter moves the wrong way", explanation + f" `{var}` moves away from the end condition instead of towards it.", "high")
    condition = re.match(r"\s*while\s*\(?\s*(\w+)\s*(<=|<|>=|>|!=)", header)
    if condition:
        var, op = condition.group(1), condition.group(2)
        step = "+= 1" if op in ("<", "<=", "!=") else "-= 1"
        if ctx.language == "python":
            body_end, indent = loop, None
            for m in range(loop + 1, len(ctx.lines) + 1):
                text = ctx.text(m)
                if not text.strip():
                    continue
                if len(text) - len(text.lstrip()) <= len(ctx.indent(loop)):
                    break
                indent = indent or ctx.indent(m)
                body_end = m
            body = "\n".join(ctx.lines[loop:body_end])
            if indent and not re.search(rf"\b{var}\s*([-+*/]?=(?!=))", body):
                return ctx.insert(body_end + 1, f"{indent}{var} {step}", f"`{var}` never changes inside the loop",
                                  explanation + f" Update `{var}` inside the loop so the condition eventually becomes false.", "high")
        elif ctx.language in ("c", "cpp", "java", "javascript", "typescript", "go") and "{" in header:
            depth, end = 0, None
            for m in range(loop, len(ctx.lines) + 1):
                depth += ctx.text(m).count("{") - ctx.text(m).count("}")
                if depth <= 0 and m > loop:
                    end = m
                    break
            if end:
                body = "\n".join(ctx.lines[loop:end - 1])
                if not re.search(rf"\b{var}\s*([-+*/]?=(?!=)|\+\+|--)|(\+\+|--){var}\b", body):
                    semi = "" if ctx.language == "go" else ";"
                    update = f"{var}++" if step == "+= 1" else f"{var}--"
                    return ctx.insert(end, f"{ctx.indent(loop)}    {update}{semi}", f"`{var}` never changes inside the loop",
                                      explanation + f" Update `{var}` inside the loop so the condition eventually becomes false.", "high")
    return ctx.explain("Loop never ends", explanation + " Make sure something inside the loop moves it towards its stopping condition.", "medium")


def recursion(ctx: Context) -> Diagnosis | None:
    if not re.search(r"RecursionError|maximum recursion depth|StackOverflowError|Maximum call stack size exceeded|stack overflow|goroutine stack exceeds|evaluation nested too deeply", ctx.error):
        return None
    stack = next((f.get("callStack") for f in reversed(ctx.frames) if f.get("callStack")), []) or []
    name = stack[-1] if stack else "the function"
    return ctx.explain(f"`{name}` calls itself forever",
                       f"`{name}` keeps calling itself without stopping. Add (or fix) a base case — an `if` that returns without recursing — and make sure each call moves towards it.", "medium")


def type_mismatch_java(ctx: Context) -> Diagnosis | None:
    if ctx.language != "java":
        return None
    match = re.search(r"incompatible types: String cannot be converted to (int|double|long)", ctx.error)
    text = ctx.text(ctx.line)
    if match:
        literal = re.search(r"=\s*\"(-?\d+(?:\.\d+)?)\"", text)
        if literal:
            return ctx.replace(ctx.line, text.replace(f'"{literal.group(1)}"', literal.group(1), 1), "A number written as text",
                               f"`\"{literal.group(1)}\"` is a String. Remove the quotes to make it a {match.group(1)}.", "high")
        parser = {"int": "Integer.parseInt", "double": "Double.parseDouble", "long": "Long.parseLong"}[match.group(1)]
        value = re.search(r"=\s*(.+?);", text)
        if value:
            return ctx.replace(ctx.line, text.replace(value.group(1), f"{parser}({value.group(1)})", 1), "Text assigned to a number",
                               f"Convert the String with {parser}(...) before storing it in a {match.group(1)}.", "high")
    lossy = re.search(r"possible lossy conversion from (double|long|float) to (int|long|float)", ctx.error)
    if lossy:
        value = re.search(r"(=\s*)(.+?);", text)
        if value:
            return ctx.replace(ctx.line, text.replace(value.group(0), f"{value.group(1)}({lossy.group(2)}) ({value.group(2)});", 1), "Possible loss of precision",
                               f"A {lossy.group(1)} can't be stored in a {lossy.group(2)} silently. Cast it explicitly if that's intended.", "medium")
    if "missing return statement" in ctx.error:
        return ctx.explain("Missing return", "Every path through a non-void method must end with `return`. Add a return for the case that falls through.", "medium")
    return None


def needs_input(ctx: Context) -> Diagnosis | None:
    if not re.search(r"EOFError|input exhausted|NoSuchElementException|EOF when reading", ctx.error):
        return None
    return ctx.explain("The program is waiting for input",
                       "This line reads input, but the Program Input box ran out of values. Type one value per line in Program Input and run again.", "high")


def division_by_zero(ctx: Context) -> Diagnosis | None:
    if not re.search(r"ZeroDivisionError|/ by zero|division by zero|integer divide by zero|Floating point exception|status 3221225620|status -1073741676", ctx.error):
        return None
    divisor = re.search(r"[/%]\s*([A-Za-z_]\w*(?:\[[^\]]+\])?|\([^()]+\))", ctx.text(ctx.line))
    hint = f" Here the divisor is `{divisor.group(1)}`." if divisor else ""
    return ctx.explain("Division by zero", f"Dividing by zero is undefined.{hint} Check it isn't 0 before dividing (e.g. with an `if`).", "medium")


RULES: list[Callable[[Context], Diagnosis | None]] = [
    needs_input, endless_loop, recursion, missing_include, go_imports, const_reassign, missing_colon, indentation,
    unclosed_string, assignment_in_condition, missing_semicolon, unbalanced, type_mismatch_java, string_concat,
    wrong_method, undefined_name, out_of_bounds, division_by_zero,
]


def diagnose(code: str, language: str, error: str | None, line: int | None, frames: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Best explanation + fix for an error, as a JSON-ready dict (None when there is no error)."""
    if not error:
        return None
    ctx = Context(code, language, error, line, frames or [])
    for rule in RULES:
        try:
            result = rule(ctx)
        except (re.error, IndexError, ValueError):
            result = None
        if result is not None:
            if result.fixedCode is not None and result.fixedCode == code:
                continue  # a "fix" that changes nothing is no fix
            return asdict(result)
    return asdict(ctx.explain(f"Error on line {ctx.line}", ctx.message, "low"))
