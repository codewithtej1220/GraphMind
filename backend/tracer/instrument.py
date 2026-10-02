"""Tree-sitter source instrumentation for step tracing in compiled and scripting languages.

Every statement gets a trace hook inserted *on the same line* just before it, so line
numbers (and compiler diagnostics) stay unchanged. Hooks pass the variables that are in
scope and initialised at that point to a small per-language runtime (see ``runtime/``),
which appends one JSON line per step to the file named by ``$GM_TRACE``.

Hook kinds: 0 = about to run a statement, 1 = a loop is starting another iteration.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from parsers.ast_parser import get_parser

NATIVE_LANGUAGES = ("javascript", "typescript", "c", "cpp", "java", "go", "r")
MAX_HOOK_VARS = 40
LENGTH_PARAM_NAMES = ("n", "N", "size", "len", "length", "count", "num", "sz", "arr_size", "arrSize", "array_size")
SCALE_VARIABLE_NAMES = ("n", "N", "size", "num", "count")


def data_value(index: int, ascending: bool) -> int:
    """Deterministic benchmark data; must match the runtimes' generators."""
    return index * 3 + 1 if ascending else (index * 7919 + 13) % 1000


@dataclass
class Var:
    name: str
    emit: str
    ready: bool = True


@dataclass
class LoopSpec:
    start: int
    end: int
    kind: str  # "for" | "foreach" | "while"
    var: str | None = None
    init: str | None = None
    cond: str | None = None
    update: str | None = None
    iterable: str | None = None


@dataclass
class ScaleTarget:
    start: int
    end: int
    kind: str  # "array" | "n"
    ascending: bool
    runtime: str | None  # replacement for languages that read N at run time
    regenerate: Callable[[int], str] | None = None  # literal text for compile-time languages
    extra: list[tuple[int, int, str]] = field(default_factory=list)


class Editor:
    """Collects insertions/replacements by byte offset and renders them in one pass."""

    def __init__(self, source: bytes) -> None:
        self.source = source
        self.insertions: list[tuple[int, int, int, bytes]] = []
        self.replacements: dict[int, tuple[int, bytes]] = {}
        self.seq = 0

    def open(self, offset: int, text: str) -> None:
        self.seq += 1
        self.insertions.append((offset, 1, self.seq, text.encode()))

    def close(self, offset: int, text: str) -> None:
        # Closers at the same offset come before openers, innermost first.
        self.seq += 1
        self.insertions.append((offset, 0, -self.seq, text.encode()))

    def replace(self, start: int, end: int, text: str) -> None:
        self.replacements[start] = (end, text.encode())

    def render(self) -> str:
        by_offset: dict[int, list[bytes]] = {}
        for offset, _, _, text in sorted(self.insertions):
            by_offset.setdefault(offset, []).append(text)
        points = sorted(set(by_offset) | set(self.replacements))
        out: list[bytes] = []
        pos = 0
        for point in points:
            if point < pos:
                continue  # inside a replaced region
            out.append(self.source[pos:point])
            out.extend(by_offset.get(point, []))
            if point in self.replacements:
                end, text = self.replacements[point]
                out.append(text)
                pos = end
            else:
                pos = point
        out.append(self.source[pos:])
        return b"".join(out).decode("utf-8", errors="replace")


class Instrumenter:
    """Language-neutral walk; subclasses describe grammar node types and hook syntax."""

    language = ""
    containers: frozenset[str] = frozenset()
    braced: frozenset[str] = frozenset()
    function_types: frozenset[str] = frozenset()
    loop_types: frozenset[str] = frozenset()
    branch_types: frozenset[str] = frozenset({"if_statement"})
    else_types: frozenset[str] = frozenset({"else_clause"})
    skip_statements: frozenset[str] = frozenset({"comment", "line_comment", "block_comment", "empty_statement"})
    statement_skip_fields: frozenset[str] = frozenset({"value", "label"})
    top_level_hooks = False
    has_epilogue = False

    def __init__(self, code: str) -> None:
        self.code = code
        self.source = code.encode("utf-8")
        self.tree = get_parser(self.language).parse(self.source)
        self.editor = Editor(self.source)
        self.loops: list[LoopSpec] = []

    # ----- helpers -------------------------------------------------------
    def text(self, node: Any) -> str:
        return self.source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    @staticmethod
    def line(node: Any) -> int:
        return node.start_point[0] + 1

    @staticmethod
    def field(node: Any, name: str) -> Any | None:
        return node.child_by_field_name(name)

    def fields(self, node: Any, name: str) -> list[Any]:
        return list(node.children_by_field_name(name))

    def statements(self, node: Any) -> list[Any]:
        result = []
        for i, child in enumerate(node.children):
            if not child.is_named or child.type in ("comment", "line_comment", "block_comment"):
                continue
            if node.field_name_for_child(i) in self.statement_skip_fields:
                continue
            result.append(child)
        return result

    @staticmethod
    def visible(scope: list[dict[str, Var]]) -> list[Var]:
        merged: dict[str, Var] = {}
        for level in scope:
            merged.update(level)
        ready = [v for v in merged.values() if v.ready and v.emit]
        return ready[-MAX_HOOK_VARS:]

    # ----- language hooks (overridden) ------------------------------------
    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        raise NotImplementedError

    def declarations(self, node: Any) -> list[Var]:
        return []

    def params(self, function: Any) -> list[Var]:
        return []

    def loop_vars(self, loop: Any) -> list[Var]:
        return []

    def header_vars(self, branch: Any) -> list[Var]:
        return []

    def loop_spec(self, loop: Any) -> LoopSpec:
        return LoopSpec(self.line(loop), loop.end_point[0] + 1, "while", cond=self.text_of(loop, "condition"))

    def loop_body(self, loop: Any) -> Any | None:
        return self.field(loop, "body")

    def function_name(self, function: Any) -> str:
        name = self.field(function, "name")
        return self.text(name) if name is not None else "<anonymous>"

    def function_body(self, function: Any) -> Any | None:
        return self.field(function, "body")

    def prologue(self, name: str, function: Any) -> str:
        return ""

    def epilogue(self) -> str:
        return ""

    def hookable(self, node: Any) -> bool:
        return node.type not in self.skip_statements

    def promote(self, statement: Any, var: Var) -> bool:
        """Whether `statement` (a direct child of the current block) initialises `var`."""
        return False

    def text_of(self, node: Any, name: str) -> str | None:
        child = self.field(node, name)
        return self.text(child).strip().rstrip(";").strip() if child is not None else None

    # ----- walk ------------------------------------------------------------
    def instrument(self) -> str:
        root = self.tree.root_node
        self.visit(root, [{}] if self.top_level_hooks else None)
        return self.editor.render()

    def visit(self, node: Any, scope: list[dict[str, Var]] | None) -> None:
        if node.type in self.function_types and self.function_body(node) is not None:
            self.function(node)
            return
        if scope is not None:
            if node.type in self.containers:
                self.block(node, scope)
                return
            if node.type in self.loop_types:
                self.loop(node, scope)
                return
            if node.type in self.branch_types:
                self.branch(node, scope)
                return
        for child in node.named_children:
            self.visit(child, scope)

    def block(self, node: Any, scope: list[dict[str, Var]]) -> None:
        scope = scope + [{}]
        for statement in self.statements(node):
            if self.hookable(statement):
                self.editor.open(statement.start_byte, self.hook(self.line(statement), 0, self.visible(scope)))
            self.visit(statement, scope)
            for var in self.declarations(statement):
                scope[-1][var.name] = var
            for level in scope:
                for var in list(level.values()):
                    if not var.ready and self.promote(statement, var):
                        # Only initialised from here to the end of the current block.
                        scope[-1][var.name] = Var(var.name, var.emit, True)

    def slot(self, body: Any, scope: list[dict[str, Var]], prefix: str = "") -> None:
        """A statement position (loop body, if branch): hook it, wrapping single statements in braces."""
        if body.type in self.braced:
            if prefix:
                self.editor.open(body.start_byte + 1, prefix)
            self.visit(body, scope)
            return
        hook = self.hook(self.line(body), 0, self.visible(scope)) if self.hookable(body) else ""
        self.editor.open(body.start_byte, "{" + prefix + hook)
        self.visit(body, scope)
        self.editor.close(body.end_byte, "}")

    def loop(self, node: Any, scope: list[dict[str, Var]]) -> None:
        spec = self.loop_spec(node)
        self.loops.append(spec)
        inner = scope + [{v.name: v for v in self.loop_vars(node)}]
        body = self.loop_body(node)
        if body is None:
            return
        self.slot(body, inner, self.hook(spec.start, 1, self.visible(inner)))

    def branch(self, node: Any, scope: list[dict[str, Var]]) -> None:
        inner = scope + [{v.name: v for v in self.header_vars(node)}]
        for name in ("consequence", "alternative"):
            for child in self.fields(node, name):
                if child.type in self.else_types:
                    statements = [c for c in child.named_children if c.type not in self.skip_statements]
                    if statements:
                        self.slot(statements[0], inner)
                else:
                    self.slot(child, inner)
        condition = self.field(node, "condition")
        if condition is not None:
            self.visit(condition, scope)

    def function(self, node: Any) -> None:
        body = self.function_body(node)
        if body is None or body.type not in self.braced or not self.instrument_function(node):
            if body is not None:
                self.visit(body, None)
            return
        name = self.function_name(node)
        prologue = self.prologue(name, node)
        if prologue:
            self.editor.open(body.start_byte + 1, prologue)
        if self.has_epilogue:
            self.editor.close(body.end_byte - 1, self.epilogue())
        self.visit(body, [{v.name: v for v in self.params(node)}])

    def instrument_function(self, node: Any) -> bool:
        return True


# ======================================================================= JavaScript / TypeScript
class JavaScriptInstrumenter(Instrumenter):
    language = "javascript"
    containers = frozenset({"program", "statement_block", "switch_case", "switch_default"})
    braced = frozenset({"statement_block"})
    function_types = frozenset({"function_declaration", "function_expression", "function", "arrow_function", "method_definition", "generator_function_declaration", "generator_function"})
    loop_types = frozenset({"for_statement", "for_in_statement", "while_statement", "do_statement"})
    skip_statements = Instrumenter.skip_statements | frozenset({
        "function_declaration", "generator_function_declaration", "class_declaration", "import_statement",
        "interface_declaration", "type_alias_declaration", "ambient_declaration", "abstract_class_declaration", "module", "internal_module",
    })
    top_level_hooks = True
    has_epilogue = True

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        if not variables:
            return f"__gm({line},{kind},[],null);"
        names = ",".join(f'"{v.name}"' for v in variables)
        values = ",".join(v.name for v in variables)
        return f"__gm({line},{kind},[{names}],()=>[{values}]);"

    def hookable(self, node: Any) -> bool:
        if node.type not in self.skip_statements and node.type == "expression_statement":
            first = node.named_children[0] if node.named_children else None
            if first is not None and first.type in ("string", "template_string"):
                return False  # directive prologue such as "use strict"
        return node.type not in self.skip_statements

    def pattern_names(self, node: Any | None) -> list[str]:
        if node is None:
            return []
        if node.type in ("identifier", "shorthand_property_identifier_pattern"):
            return [self.text(node)]
        if node.type == "pair_pattern":
            return self.pattern_names(self.field(node, "value"))
        if node.type in ("assignment_pattern", "object_assignment_pattern"):
            return self.pattern_names(self.field(node, "left"))
        if node.type in ("required_parameter", "optional_parameter"):
            return self.pattern_names(self.field(node, "pattern"))
        if node.type in ("type_annotation", "this", "predefined_type"):
            return []
        names: list[str] = []
        for child in node.named_children:
            names.extend(self.pattern_names(child))
        return names

    def vars(self, names: list[str]) -> list[Var]:
        return [Var(n, n) for n in names if n not in ("this", "undefined")]

    def declarations(self, node: Any) -> list[Var]:
        if node.type in ("lexical_declaration", "variable_declaration"):
            names: list[str] = []
            for declarator in node.named_children:
                if declarator.type == "variable_declarator":
                    names.extend(self.pattern_names(self.field(declarator, "name")))
            return self.vars(names)
        return []

    def params(self, function: Any) -> list[Var]:
        params = self.field(function, "parameters")
        if params is None:
            single = self.field(function, "parameter")
            return self.vars(self.pattern_names(single)) if single is not None else []
        return self.vars(self.pattern_names(params))

    def loop_vars(self, loop: Any) -> list[Var]:
        if loop.type == "for_statement":
            init = self.field(loop, "initializer")
            return self.declarations(init) if init is not None else []
        if loop.type == "for_in_statement":
            return self.vars(self.pattern_names(self.field(loop, "left")))
        return []

    def loop_spec(self, loop: Any) -> LoopSpec:
        start, end = self.line(loop), loop.end_point[0] + 1
        if loop.type == "for_statement":
            init = self.field(loop, "initializer")
            var = init_value = None
            if init is not None:
                declarator = next((c for c in init.named_children if c.type == "variable_declarator"), None)
                if declarator is not None:
                    var, init_value = self.text_of(declarator, "name"), self.text_of(declarator, "value")
                elif init.named_children and init.named_children[0].type == "assignment_expression":
                    assignment = init.named_children[0]
                    var, init_value = self.text_of(assignment, "left"), self.text_of(assignment, "right")
            return LoopSpec(start, end, "for", var, init_value, self.text_of(loop, "condition"), self.text_of(loop, "increment"))
        if loop.type == "for_in_statement":
            names = self.pattern_names(self.field(loop, "left"))
            operator = self.field(loop, "operator")
            kind = "foreach" if operator is None or self.text(operator) == "of" else "forin"
            return LoopSpec(start, end, kind, names[0] if names else None, iterable=self.text_of(loop, "right"))
        return LoopSpec(start, end, "while", cond=self.text_of(loop, "condition"))

    def function_name(self, function: Any) -> str:
        name = self.field(function, "name")
        if name is not None:
            return self.text(name)
        parent = function.parent
        if parent is not None and parent.type == "variable_declarator":
            return self.text_of(parent, "name") or "<anonymous>"
        if parent is not None and parent.type in ("pair", "assignment_expression", "field_definition", "public_field_definition"):
            key = self.field(parent, "key") or self.field(parent, "left") or self.field(parent, "property") or self.field(parent, "name")
            return self.text(key).split(".")[-1] if key is not None else "<anonymous>"
        return "<anonymous>"

    def prologue(self, name: str, function: Any) -> str:
        return f'__gmE("{name}");try{{'

    def epilogue(self) -> str:
        return "}finally{__gmX();}"


class TypeScriptInstrumenter(JavaScriptInstrumenter):
    language = "typescript"


# ======================================================================= Java
class JavaInstrumenter(Instrumenter):
    language = "java"
    containers = frozenset({"block", "constructor_body", "switch_block_statement_group"})
    braced = frozenset({"block", "constructor_body"})
    function_types = frozenset({"method_declaration", "constructor_declaration", "lambda_expression", "compact_constructor_declaration"})
    loop_types = frozenset({"for_statement", "enhanced_for_statement", "while_statement", "do_statement"})
    skip_statements = Instrumenter.skip_statements | frozenset({
        "switch_label", "explicit_constructor_invocation", "local_class_declaration", "class_declaration",
        "record_declaration", "interface_declaration", "enum_declaration",
    })
    has_epilogue = True

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        args = "".join(f',"{v.name}",{v.name}' for v in variables)
        return f"GMTrace.h({line},{kind}{args});"

    def prologue(self, name: str, function: Any) -> str:
        return f'GMTrace.enter("{name}");try{{'

    def epilogue(self) -> str:
        return "}finally{GMTrace.exit();}"

    def function(self, node: Any) -> None:
        body = self.function_body(node)
        if node.type in ("constructor_declaration", "compact_constructor_declaration") and body is not None:
            # A constructor may need super(...)/this(...) first, so it gets hooks but no try/finally.
            self.visit(body, [{v.name: v for v in self.params(node)}])
            return
        if node.type == "lambda_expression" and (body is None or body.type != "block"):
            if body is not None:
                self.visit(body, None)
            return
        super().function(node)

    def function_name(self, function: Any) -> str:
        if function.type == "lambda_expression":
            return "lambda"
        return super().function_name(function)

    def declarations(self, node: Any) -> list[Var]:
        if node.type != "local_variable_declaration":
            return []
        result = []
        for declarator in self.fields(node, "declarator"):
            name = self.text_of(declarator, "name")
            if name:
                result.append(Var(name, name, self.field(declarator, "value") is not None))
        return result

    def promote(self, statement: Any, var: Var) -> bool:
        return statement.type == "expression_statement" and re.match(rf"\s*{re.escape(var.name)}\s*=(?!=)", self.text(statement)) is not None

    def params(self, function: Any) -> list[Var]:
        params = self.field(function, "parameters")
        if params is None or (function.type == "method_declaration" and self.function_name(function) == "main"):
            return []  # main's String[] args is noise in the visualizer
        names: list[str] = []
        if params.type == "identifier":
            names.append(self.text(params))
        for child in params.named_children:
            if child.type in ("formal_parameter", "spread_parameter"):
                name = self.field(child, "name")
                if name is None:
                    declarator = next((c for c in child.named_children if c.type == "variable_declarator"), None)
                    name = self.field(declarator, "name") if declarator is not None else None
                if name is not None:
                    names.append(self.text(name))
            elif child.type == "identifier":
                names.append(self.text(child))
        return [Var(n, n) for n in names]

    def loop_vars(self, loop: Any) -> list[Var]:
        if loop.type == "for_statement":
            result: list[Var] = []
            for init in self.fields(loop, "init"):
                result.extend(self.declarations(init))
            return result
        if loop.type == "enhanced_for_statement":
            name = self.text_of(loop, "name")
            return [Var(name, name)] if name else []
        return []

    def loop_spec(self, loop: Any) -> LoopSpec:
        start, end = self.line(loop), loop.end_point[0] + 1
        if loop.type == "for_statement":
            var = init_value = None
            for init in self.fields(loop, "init"):
                if init.type == "local_variable_declaration":
                    declarator = self.field(init, "declarator")
                    if declarator is not None:
                        var, init_value = self.text_of(declarator, "name"), self.text_of(declarator, "value")
                elif init.type == "assignment_expression":
                    var, init_value = self.text_of(init, "left"), self.text_of(init, "right")
            return LoopSpec(start, end, "for", var, init_value, self.text_of(loop, "condition"), self.text_of(loop, "update"))
        if loop.type == "enhanced_for_statement":
            return LoopSpec(start, end, "foreach", self.text_of(loop, "name"), iterable=self.text_of(loop, "value"))
        return LoopSpec(start, end, "while", cond=self.text_of(loop, "condition"))


# ======================================================================= Go
class GoInstrumenter(Instrumenter):
    language = "go"
    containers = frozenset({"statement_list"})
    braced = frozenset({"block"})
    function_types = frozenset({"function_declaration", "method_declaration", "func_literal"})
    loop_types = frozenset({"for_statement"})
    skip_statements = Instrumenter.skip_statements | frozenset({"type_declaration"})

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        args = "".join(f',"{v.name}",{v.name}' for v in variables)
        return f"__gm({line},{kind}{args});"

    def prologue(self, name: str, function: Any) -> str:
        finish = "defer __gmFinish(false);" if function.type == "function_declaration" and name == "main" else ""
        return f'__gmE("{name}");{finish}defer __gmX();'

    def function_name(self, function: Any) -> str:
        return "func" if function.type == "func_literal" else super().function_name(function)

    def names(self, node: Any | None) -> list[str]:
        if node is None:
            return []
        if node.type == "identifier":
            return [] if self.text(node) == "_" else [self.text(node)]
        if node.type == "expression_list":
            return [n for c in node.named_children for n in self.names(c)]
        return []

    def declarations(self, node: Any) -> list[Var]:
        names: list[str] = []
        if node.type == "short_var_declaration":
            names = self.names(self.field(node, "left"))
        elif node.type in ("var_declaration", "const_declaration"):
            for spec in node.named_children:
                if spec.type in ("var_spec", "const_spec"):
                    names.extend(n for c in self.fields(spec, "name") for n in self.names(c))
                elif spec.type == "var_spec_list":
                    for inner in spec.named_children:
                        names.extend(n for c in self.fields(inner, "name") for n in self.names(c))
        return [Var(n, n) for n in names]

    def params(self, function: Any) -> list[Var]:
        names: list[str] = []
        for field_name in ("receiver", "parameters", "result"):
            params = self.field(function, field_name)
            if params is None or params.type != "parameter_list":
                continue
            for p in params.named_children:
                if p.type in ("parameter_declaration", "variadic_parameter_declaration"):
                    names.extend(n for c in self.fields(p, "name") for n in self.names(c))
        return [Var(n, n) for n in names]

    def header_vars(self, branch: Any) -> list[Var]:
        init = self.field(branch, "initializer")
        return self.declarations(init) if init is not None else []

    def clause(self, loop: Any) -> Any | None:
        return next((c for c in loop.named_children if c.type in ("for_clause", "range_clause")), None)

    def loop_vars(self, loop: Any) -> list[Var]:
        clause = self.clause(loop)
        if clause is None:
            return []
        if clause.type == "for_clause":
            init = self.field(clause, "initializer")
            return self.declarations(init) if init is not None else []
        return [Var(n, n) for n in self.names(self.field(clause, "left"))]

    def loop_spec(self, loop: Any) -> LoopSpec:
        start, end = self.line(loop), loop.end_point[0] + 1
        clause = self.clause(loop)
        if clause is None:
            condition = next((c for c in loop.named_children if c.type not in ("block", "comment")), None)
            return LoopSpec(start, end, "while", cond=self.text(condition) if condition is not None else None)
        if clause.type == "for_clause":
            init = self.field(clause, "initializer")
            var = init_value = None
            if init is not None and init.type in ("short_var_declaration", "assignment_statement"):
                names = self.names(self.field(init, "left"))
                var = names[0] if names else None
                init_value = self.text_of(init, "right")
            return LoopSpec(start, end, "for", var, init_value, self.text_of(clause, "condition"), self.text_of(clause, "update"))
        names = self.names(self.field(clause, "left"))
        return LoopSpec(start, end, "foreach", names[-1] if names else None, iterable=self.text_of(clause, "right"))


# ======================================================================= C / C++
C_ARRAY_FUNCTIONS = {
    "int": "__gm_ai", "signed": "__gm_ai", "signed int": "__gm_ai",
    "long": "__gm_al", "long int": "__gm_al", "long long": "__gm_all", "long long int": "__gm_all",
    "unsigned": "__gm_au", "unsigned int": "__gm_au", "short": "__gm_ah", "short int": "__gm_ah",
    "double": "__gm_ad", "float": "__gm_af", "bool": "__gm_ab", "_Bool": "__gm_ab",
}
INTEGER_TYPE = re.compile(r"^((un)?signed\s+)?((short|long|long\s+long)\s+)?(int|short|long|char)?$|^(bool|_Bool|size_t|ssize_t|ptrdiff_t|u?int(8|16|32|64)_t)$")


@dataclass
class CDeclarator:
    name: str
    pointers: int = 0
    dims: int = 0
    initialized: bool = False
    names: list[str] = field(default_factory=list)  # structured bindings


class CInstrumenter(Instrumenter):
    language = "c"
    containers = frozenset({"compound_statement", "case_statement"})
    braced = frozenset({"compound_statement"})
    function_types = frozenset({"function_definition"})
    loop_types = frozenset({"for_statement", "while_statement", "do_statement"})
    skip_statements = Instrumenter.skip_statements | frozenset({
        "preproc_include", "preproc_def", "preproc_function_def", "preproc_call", "preproc_if", "preproc_ifdef",
        "type_definition", "struct_specifier", "enum_specifier", "union_specifier",
    })
    statement_skip_fields = frozenset({"value", "label"})

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        body = "".join(v.emit + ";" for v in variables)
        return f"if(__gm_begin({line},{kind})){{{body}__gm_end();}}"

    def prologue(self, name: str, function: Any) -> str:
        return f'__GM_SCOPE("{name}");'

    def function_name(self, function: Any) -> str:
        declarator = self.field(function, "declarator")
        while declarator is not None and declarator.type != "function_declarator":
            declarator = self.field(declarator, "declarator")
        if declarator is not None:
            inner = self.field(declarator, "declarator")
            if inner is not None:
                return self.text(inner).split("::")[-1]
        return "<anonymous>"

    def unwrap(self, node: Any) -> CDeclarator | None:
        info = CDeclarator("")
        if node.type == "init_declarator":
            info.initialized = True
            node = self.field(node, "declarator")
        while node is not None:
            if node.type in ("identifier", "field_identifier"):
                info.name = self.text(node)
                return info
            if node.type == "pointer_declarator":
                info.pointers += 1
                node = self.field(node, "declarator")
            elif node.type == "array_declarator":
                info.dims += 1
                node = self.field(node, "declarator")
            elif node.type in ("reference_declarator", "parenthesized_declarator"):
                node = next((c for c in node.named_children if c.type != "type_qualifier"), None)
            elif node.type == "structured_binding_declarator":
                info.names = [self.text(c) for c in node.named_children if c.type == "identifier"]
                info.name = ",".join(info.names)
                return info
            else:
                return None  # function declarators, abstract declarators, ...
        return None

    def base_type(self, type_node: Any | None) -> str:
        return " ".join(self.text(type_node).split()) if type_node is not None else ""

    def emit(self, base: str, d: CDeclarator, is_param: bool, length: str | None) -> Var | None:
        name = d.name
        array_fn = C_ARRAY_FUNCTIONS.get(base)
        if d.dims and not is_param:
            if d.dims == 1 and "char" in base:
                return Var(name, f'__gm_s("{name}",{name},(long)sizeof({name}))')
            if not array_fn:
                return None
            if d.dims == 1:
                return Var(name, f'{array_fn}("{name}",{name},(long)(sizeof({name})/sizeof(({name})[0])))')
            if d.dims == 2:
                return Var(name, f'{array_fn}2("{name}",&{name}[0][0],(long)(sizeof({name})/sizeof({name}[0])),(long)(sizeof({name}[0])/sizeof({name}[0][0])))')
            return None
        if (d.dims == 1 and is_param) or (d.pointers == 1 and is_param and "char" not in base):
            if not array_fn:
                return None
            if length:
                return Var(name, f'{array_fn}("{name}",{name},(long)({length}))')
            return Var(name, f'{array_fn}p("{name}",{name})')
        if d.pointers == 1 and "char" in base and not d.dims:
            return Var(name, f'__gm_s("{name}",{name},200)', d.initialized or is_param)
        if d.pointers or d.dims:
            return None
        ready = d.initialized or is_param
        if base in ("char", "signed char", "unsigned char"):
            return Var(name, f'__gm_c("{name}",{name})', ready)
        if base in ("float", "double", "long double"):
            return Var(name, f'__gm_d("{name}",(double)({name}))', ready)
        if INTEGER_TYPE.match(base) and base:
            return Var(name, f'__gm_i("{name}",(long long)({name}))', ready)
        return None

    def declaration_vars(self, node: Any, is_param: bool = False, length: str | None = None) -> list[Var]:
        base = self.base_type(self.field(node, "type"))
        result = []
        for declarator in self.fields(node, "declarator"):
            info = self.unwrap(declarator)
            if info is None or not info.name:
                continue
            var = self.emit(base, info, is_param, length)
            if var is not None:
                result.append(var)
        return result

    def declarations(self, node: Any) -> list[Var]:
        return self.declaration_vars(node) if node.type == "declaration" else []

    def parameter_nodes(self, function: Any) -> list[Any]:
        declarator = self.field(function, "declarator")
        while declarator is not None and declarator.type not in ("function_declarator", "abstract_function_declarator", "lambda_declarator"):
            declarator = self.field(declarator, "declarator")
        params = self.field(declarator, "parameters") if declarator is not None else None
        return [p for p in params.named_children if p.type in ("parameter_declaration", "optional_parameter_declaration")] if params is not None else []

    def params(self, function: Any) -> list[Var]:
        nodes = self.parameter_nodes(function)
        names = set()
        for p in nodes:
            d = self.field(p, "declarator")
            info = self.unwrap(d) if d is not None else None
            if info is not None and not info.pointers and not info.dims:
                names.add(info.name)
        length = next((n for n in LENGTH_PARAM_NAMES if n in names), None)
        result: list[Var] = []
        for p in nodes:
            result.extend(self.declaration_vars(p, is_param=True, length=length))
        return result

    PROMOTE = r"\b{n}\s*(=(?!=)|\+\+|--|[-+*/%&|^]=)|>>\s*{n}\b|&\s*{n}\b|(\+\+|--)\s*{n}\b|getline\s*\([^)]*\b{n}\b"

    def promote(self, statement: Any, var: Var) -> bool:
        return re.search(self.PROMOTE.format(n=re.escape(var.name)), self.text(statement)) is not None

    def loop_vars(self, loop: Any) -> list[Var]:
        init = self.field(loop, "initializer")
        if init is not None and init.type == "declaration":
            return self.declarations(init)
        return []

    def loop_spec(self, loop: Any) -> LoopSpec:
        start, end = self.line(loop), loop.end_point[0] + 1
        if loop.type == "for_statement":
            init = self.field(loop, "initializer")
            var = init_value = None
            if init is not None and init.type == "declaration":
                declarator = self.field(init, "declarator")
                if declarator is not None and declarator.type == "init_declarator":
                    var, init_value = self.text_of(declarator, "declarator"), self.text_of(declarator, "value")
            elif init is not None and init.type == "assignment_expression":
                var, init_value = self.text_of(init, "left"), self.text_of(init, "right")
            return LoopSpec(start, end, "for", var, init_value, self.text_of(loop, "condition"), self.text_of(loop, "update"))
        if loop.type == "for_range_loop":
            info = self.unwrap(self.field(loop, "declarator")) if self.field(loop, "declarator") is not None else None
            return LoopSpec(start, end, "foreach", info.name if info else None, iterable=self.text_of(loop, "right"))
        return LoopSpec(start, end, "while", cond=self.text_of(loop, "condition"))


class CppInstrumenter(CInstrumenter):
    language = "cpp"
    function_types = frozenset({"function_definition", "lambda_expression"})
    loop_types = CInstrumenter.loop_types | frozenset({"for_range_loop"})
    skip_statements = CInstrumenter.skip_statements | frozenset({
        "class_specifier", "namespace_definition", "using_declaration", "alias_declaration", "template_declaration",
        "static_assert_declaration", "concept_definition",
    })
    PRIMITIVE = re.compile(r"^(const\s+)?((un)?signed\s+)?((short|long|long\s+long)\s+)?(int|short|long|char|bool|float|double|wchar_t|char8_t|char16_t|char32_t)?$|_t$")

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        body = "".join(v.emit + ";" for v in variables)
        return f"if(gmrt::begin({line},{kind})){{{body}gmrt::end();}}"

    def prologue(self, name: str, function: Any) -> str:
        return f'gmrt::Scope __gm_scope("{name}");'

    def instrument_function(self, node: Any) -> bool:
        # Hooks are not constexpr, so leave constexpr/consteval functions untouched.
        header = self.source[node.start_byte:self.function_body(node).start_byte].decode("utf-8", errors="replace")
        return not re.search(r"\b(constexpr|consteval)\b", header)

    def function_name(self, function: Any) -> str:
        return "lambda" if function.type == "lambda_expression" else super().function_name(function)

    def emit(self, base: str, d: CDeclarator, is_param: bool, length: str | None) -> Var | None:
        name = d.name
        if d.names:
            return Var(name, ";".join(f'gmrt::var("{n}",{n})' for n in d.names))
        primitive = bool(self.PRIMITIVE.search(base)) or base in ("auto", "")
        if d.dims and not is_param:
            # sizeof-based lengths also work for variable-length arrays such as dp[n + 1].
            if d.dims == 1 and "char" in base:
                return Var(name, f'gmrt::var("{name}",{name})')
            if d.dims == 1:
                return Var(name, f'gmrt::arr("{name}",&{name}[0],(long long)(sizeof({name})/sizeof({name}[0])))')
            if d.dims == 2:
                return Var(name, f'gmrt::arr2("{name}",&{name}[0][0],(long long)(sizeof({name})/sizeof({name}[0])),(long long)(sizeof({name}[0])/sizeof({name}[0][0])))')
            return None
        if (d.dims == 1 and is_param) or (d.pointers == 1 and is_param and "char" not in base):
            if not primitive or base == "auto":
                return None
            if length:
                return Var(name, f'gmrt::arr("{name}",{name},{length})')
            return Var(name, f'gmrt::ptr("{name}",{name})')
        if d.pointers == 1 and "char" in base and not d.dims:
            return Var(name, f'gmrt::var("{name}",{name})', d.initialized or is_param)
        if d.pointers or d.dims:
            return None
        ready = d.initialized or is_param or not primitive
        return Var(name, f'gmrt::var("{name}",{name})', ready)

    def params(self, function: Any) -> list[Var]:
        if function.type == "lambda_expression":
            declarator = self.field(function, "declarator")
            params = self.field(declarator, "parameters") if declarator is not None else None
            if params is None:
                return []
            result: list[Var] = []
            for p in params.named_children:
                if p.type in ("parameter_declaration", "optional_parameter_declaration"):
                    result.extend(self.declaration_vars(p, is_param=True))
            return result
        return super().params(function)

    def function_body(self, function: Any) -> Any | None:
        return self.field(function, "body")

    def loop_vars(self, loop: Any) -> list[Var]:
        if loop.type == "for_range_loop":
            declarator = self.field(loop, "declarator")
            info = self.unwrap(declarator) if declarator is not None else None
            if info is None:
                return []
            if info.names:
                return [Var(n, f'gmrt::var("{n}",{n})') for n in info.names]
            return [Var(info.name, f'gmrt::var("{info.name}",{info.name})')]
        return super().loop_vars(loop)


# ======================================================================= R
class RInstrumenter(Instrumenter):
    language = "r"
    containers = frozenset({"program", "braced_expression"})
    braced = frozenset({"braced_expression"})
    function_types = frozenset({"function_definition"})
    loop_types = frozenset({"for_statement", "while_statement", "repeat_statement"})
    top_level_hooks = True
    statement_skip_fields = frozenset()

    def hook(self, line: int, kind: int, variables: list[Var]) -> str:
        return f".gm({line}L,{kind}L);"

    def loop_spec(self, loop: Any) -> LoopSpec:
        start, end = self.line(loop), loop.end_point[0] + 1
        if loop.type == "for_statement":
            return LoopSpec(start, end, "foreach", self.text_of(loop, "variable"), iterable=self.text_of(loop, "sequence"))
        return LoopSpec(start, end, "while", cond=self.text_of(loop, "condition"))

    def function(self, node: Any) -> None:
        body = self.function_body(node)
        if body is not None and body.type in self.braced:
            self.visit(body, [{}])
        elif body is not None:
            self.visit(body, None)


INSTRUMENTERS: dict[str, type[Instrumenter]] = {
    "javascript": JavaScriptInstrumenter,
    "typescript": TypeScriptInstrumenter,
    "java": JavaInstrumenter,
    "go": GoInstrumenter,
    "c": CInstrumenter,
    "cpp": CppInstrumenter,
    "r": RInstrumenter,
}


@dataclass
class Instrumented:
    source: str
    loops: list[LoopSpec]


def instrument(code: str, language: str, scale: ScaleTarget | None = None, n: int | None = None) -> Instrumented:
    instrumenter = INSTRUMENTERS[language](code)
    if scale is not None:
        if scale.runtime is not None:
            instrumenter.editor.replace(scale.start, scale.end, scale.runtime)
        elif scale.regenerate is not None and n is not None:
            instrumenter.editor.replace(scale.start, scale.end, scale.regenerate(n))
        for start, end, text in scale.extra:
            instrumenter.editor.replace(start, end, text)
    source = instrumenter.instrument()
    return Instrumented(source, instrumenter.loops)


# ======================================================================= Big-O scaling targets
NUMBER_TYPES = {
    "python": {"integer", "float"},
    "javascript": {"number"}, "typescript": {"number"},
    "c": {"number_literal"}, "cpp": {"number_literal"},
    "java": {"decimal_integer_literal", "decimal_floating_point_literal"},
    "go": {"int_literal", "float_literal"},
    "r": {"float", "integer"},
}
CALL_TYPES = {"call", "call_expression", "method_invocation"}
FUNCTION_TYPES = {"function_definition", "function_declaration", "method_declaration", "method_definition"}


def _walk(node: Any):
    yield node
    for child in node.named_children:
        yield from _walk(child)


def _number(node: Any, source: bytes, language: str) -> float | None:
    if node.type == "unary_expression" or node.type == "unary_operator":
        inner = node.named_children[-1] if node.named_children else None
        value = _number(inner, source, language) if inner is not None else None
        return -value if value is not None else None
    if node.type in ("literal_element", "argument") and node.named_children:
        return _number(node.named_children[-1], source, language)
    if node.type not in NUMBER_TYPES[language]:
        return None
    raw = source[node.start_byte:node.end_byte].decode().rstrip("LlUuFfDd").replace("_", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _numbers(children: list[Any], source: bytes, language: str) -> list[float] | None:
    values = [_number(c, source, language) for c in children if c.type not in ("comment", "comma")]
    return values if len(values) >= 3 and all(v is not None for v in values) else None  # type: ignore[return-value]


def _literal(n: int, ascending: bool, open_: str, close: str) -> str:
    return open_ + ", ".join(str(data_value(i, ascending)) for i in range(n)) + close


def find_scale_target(code: str, language: str) -> ScaleTarget | None:
    """The input-size knob for benchmarking: an array literal, else an `n` variable, else a numeric call argument."""
    source = code.encode("utf-8")
    root = get_parser(language).parse(source).root_node
    text = lambda node: source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")  # noqa: E731
    candidates: list[tuple[int, ScaleTarget]] = []

    for node in _walk(root):
        values: list[float] | None = None
        target: ScaleTarget | None = None
        if language == "python" and node.type == "list":
            values = _numbers(node.named_children, source, language)
            if values:
                target = ScaleTarget(node.start_byte, node.end_byte, "array", values == sorted(values), None)
                target.regenerate = (lambda asc: lambda n: _literal(n, asc, "[", "]"))(target.ascending)
        elif language in ("javascript", "typescript") and node.type == "array":
            values = _numbers(node.named_children, source, language)
            if values:
                target = ScaleTarget(node.start_byte, node.end_byte, "array", values == sorted(values), "__gmData()")
        elif language in ("c", "cpp") and node.type == "initializer_list":
            values = _numbers(node.named_children, source, language)
            parent = node.parent
            if values and parent is not None and parent.type in ("init_declarator", "declaration"):
                asc = values == sorted(values)
                declaration = parent.parent if parent.type == "init_declarator" else parent
                type_node = declaration.child_by_field_name("type") if declaration is not None else None
                if language == "cpp" and type_node is not None and "vector" in text(type_node):
                    # `v = {..}` / `v{..}` -> `v = gmrt::data()`: no recompilation per N.
                    before = source[:node.start_byte].rstrip()
                    replacement = "gmrt::data()" if before.endswith(b"=") else "= gmrt::data()"
                    target = ScaleTarget(node.start_byte, node.end_byte, "array", asc, replacement)
                else:
                    target = ScaleTarget(node.start_byte, node.end_byte, "array", asc, None, lambda n, asc=asc: _literal(n, asc, "{", "}"))
                    declarator = parent.child_by_field_name("declarator") if parent.type == "init_declarator" else None
                    size = declarator.child_by_field_name("size") if declarator is not None and declarator.type == "array_declarator" else None
                    if size is not None:
                        target.extra.append((size.start_byte, size.end_byte, ""))
        elif language == "java" and node.type == "array_initializer":
            values = _numbers(node.named_children, source, language)
            if values:
                holder = node.parent
                replace_node = holder if holder is not None and holder.type == "array_creation_expression" else node
                declaration = holder
                while declaration is not None and declaration.type != "local_variable_declaration" and declaration.type != "field_declaration":
                    declaration = declaration.parent
                type_node = declaration.child_by_field_name("type") if declaration is not None else None
                element = text(type_node).replace(" ", "") if type_node is not None else ""
                factory = {"int[]": "GMTrace.dataInt()", "long[]": "GMTrace.dataLong()", "double[]": "GMTrace.dataDouble()"}.get(element)
                if factory:
                    target = ScaleTarget(replace_node.start_byte, replace_node.end_byte, "array", values == sorted(values), factory)
        elif language == "java" and node.type == "method_invocation" and text(node).startswith(("Arrays.asList(", "List.of(")):
            arguments = node.child_by_field_name("arguments")
            values = _numbers(arguments.named_children, source, language) if arguments is not None else None
            if values:
                target = ScaleTarget(node.start_byte, node.end_byte, "array", values == sorted(values), "GMTrace.dataList()")
        elif language == "go" and node.type == "composite_literal":
            type_node = node.child_by_field_name("type")
            body = node.child_by_field_name("body")
            if type_node is not None and body is not None and type_node.type == "slice_type":
                values = _numbers(body.named_children, source, language)
                element = text(type_node).replace(" ", "")
                factory = {"[]int": "__gmDataInt()", "[]float64": "__gmDataFloat()"}.get(element)
                if values and factory:
                    target = ScaleTarget(node.start_byte, node.end_byte, "array", values == sorted(values), factory)
        elif language == "r" and node.type == "call" and text(node.child_by_field_name("function") or node).strip() == "c":
            arguments = node.child_by_field_name("arguments")
            values = _numbers([a for a in arguments.named_children if a.type == "argument"], source, language) if arguments is not None else None
            if values:
                target = ScaleTarget(node.start_byte, node.end_byte, "array", values == sorted(values), ".gm_data()")
        if target is not None and values:
            candidates.append((len(values), target))
    if candidates:
        best = max(candidates, key=lambda item: item[0])[0]
        return next(target for size, target in candidates if size == best)

    runtime_n = {"javascript": "__gmN()", "typescript": "__gmN()", "java": "GMTrace.n()", "go": "__gmN()", "r": ".gm_n()", "c": "__gm_n()", "cpp": "gmrt::n()"}.get(language)

    def n_target(literal: Any) -> ScaleTarget:
        regenerate = None if runtime_n else (lambda n: str(n))
        return ScaleTarget(literal.start_byte, literal.end_byte, "n", False, runtime_n, regenerate)

    # An integer variable conventionally named n / size / ...
    for node in _walk(root):
        name_node = value_node = None
        if node.type in ("variable_declarator", "init_declarator"):
            name_node = node.child_by_field_name("name") or node.child_by_field_name("declarator")
            value_node = node.child_by_field_name("value")
        elif node.type == "assignment" and language == "python":
            name_node, value_node = node.child_by_field_name("left"), node.child_by_field_name("right")
        elif node.type == "binary_operator" and language == "r":
            operator = node.child_by_field_name("operator")
            if operator is not None and text(operator) in ("<-", "="):
                name_node, value_node = node.child_by_field_name("lhs"), node.child_by_field_name("rhs")
        elif node.type == "short_var_declaration":
            left, right = node.child_by_field_name("left"), node.child_by_field_name("right")
            if left is not None and right is not None and len(left.named_children) == 1 and len(right.named_children) == 1:
                name_node, value_node = left.named_children[0], right.named_children[0]
        if name_node is not None and value_node is not None and text(name_node).strip() in SCALE_VARIABLE_NAMES:
            value = _number(value_node, source, language)
            if value is not None and value == int(value) and 1 <= value <= 100_000:
                return n_target(value_node)

    # A call to a function defined in this file with a small integer literal argument, e.g. fib(10).
    defined: set[str] = set()
    for node in _walk(root):
        if node.type in FUNCTION_TYPES:
            name = node.child_by_field_name("name")
            if name is None:
                declarator = node.child_by_field_name("declarator")
                while declarator is not None and declarator.type != "identifier" and declarator.child_by_field_name("declarator") is not None:
                    declarator = declarator.child_by_field_name("declarator")
                name = declarator
            if name is not None:
                defined.add(text(name).strip())
        elif language == "r" and node.type == "binary_operator":
            rhs = node.child_by_field_name("rhs")
            lhs = node.child_by_field_name("lhs")
            if rhs is not None and lhs is not None and rhs.type == "function_definition":
                defined.add(text(lhs).strip())
    for node in _walk(root):
        if node.type not in CALL_TYPES:
            continue
        callee = node.child_by_field_name("function") or node.child_by_field_name("name")
        if callee is None or text(callee).strip() not in defined:
            continue
        arguments = node.child_by_field_name("arguments")
        if arguments is None:
            continue
        for argument in arguments.named_children:
            value = _number(argument, source, language)
            if value is not None and value == int(value) and 2 <= value <= 64:
                literal = argument.named_children[-1] if argument.type == "argument" else argument
                return n_target(literal)
            break
    return None
