import type { LanguageId } from "@/lib/types";

export type HintLevel = "info" | "tip" | "warn";

export interface CodeHint {
  level: HintLevel;
  title: string;
  detail: string;
}

const INPUT_PATTERN = /\b(input\s*\(|readLine\s*\(|Scanner\s*\(|BufferedReader|fmt\.Scan|scanf\s*\(|cin\s*>>|getline\s*\(|readline\s*\(|readLines\s*\()/i;
const LOOP_PATTERN = /^\s*(for|while)\b/;

/** Deepest nesting of loops, judged by indentation (Python) or braces (C-like). */
function loopDepth(code: string, language: LanguageId): number {
  const lines = code.split("\n");
  if (language === "python") {
    const stack: number[] = [];
    let deepest = 0;
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const indent = line.length - line.trimStart().length;
      while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
      if (LOOP_PATTERN.test(line)) {
        stack.push(indent);
        deepest = Math.max(deepest, stack.length);
      }
    }
    return deepest;
  }
  // C-like: track brace depth at which each loop opened.
  let depth = 0;
  const loopAt: number[] = [];
  let deepest = 0;
  for (const line of lines) {
    if (LOOP_PATTERN.test(line)) {
      loopAt.push(depth);
      deepest = Math.max(deepest, loopAt.length);
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        while (loopAt.length && loopAt[loopAt.length - 1] >= depth) loopAt.pop();
      }
    }
  }
  return deepest;
}

/** Source of a function body: the indented block (Python) or the matching braces (C-like). */
function functionBody(code: string, headerEnd: number, language: LanguageId): string {
  if (language === "python") {
    const lineStart = code.lastIndexOf("\n", headerEnd) + 1;
    const indent = code.slice(lineStart).search(/\S/);
    const rest = code.slice(code.indexOf("\n", headerEnd) + 1).split("\n");
    const body: string[] = [];
    for (const line of rest) {
      if (line.trim() && line.search(/\S/) <= indent) break;
      body.push(line);
    }
    return body.join("\n");
  }
  const open = code.indexOf("{", headerEnd);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

/** Functions whose own body calls themselves. */
function recursiveFunctions(code: string, language: LanguageId): string[] {
  return [...code.matchAll(/(?:def|function|func|fn)\s+([A-Za-z_]\w*)\s*\(/g)]
    .filter((match) => {
      const body = functionBody(code, (match.index ?? 0) + match[0].length, language);
      return new RegExp(`\\b${match[1]}\\s*\\(`).test(body);
    })
    .map((match) => match[1]);
}

/** Lightweight, offline static hints — no code leaves the browser. */
export function analyzeCode(code: string, language: LanguageId, userInput: string): CodeHint[] {
  const hints: CodeHint[] = [];
  const trimmed = code.trim();

  if (!trimmed) {
    return [{ level: "tip", title: "Start with an example", detail: "Pick an algorithm from the reference bar above the editor, or type your own code and press Run & Visualize." }];
  }

  if (["c", "cpp", "java", "go", "typescript"].includes(language)) {
    hints.push({ level: "info", title: "Compiled before tracing", detail: "GraphMind compiles this language first, so the first run can take a few seconds." });
  }
  // The Big-O benchmark grows an array literal, a size variable `n`, or a numeric call argument.
  const hasScaleKnob =
    /\[\s*-?\d[\d\s,.-]*\]|\{\s*-?\d[\d\s,.-]*\}|\bc\(\s*-?\d[\d\s,.-]*\)/.test(code) ||
    /\b(n|N|size|num|count)\s*(=|<-|:=)\s*\d+/.test(code) ||
    /\b\w+\(\s*\d+\s*[,)]/.test(code);
  if (!hasScaleKnob) {
    hints.push({ level: "tip", title: "Give Big-O something to grow", detail: "Add an array literal like [5, 2, 8, 1] or a size variable n = 10 — the benchmark scales it to measure growth." });
  }

  const depth = loopDepth(code, language);
  if (depth >= 3) {
    hints.push({ level: "warn", title: `${depth} nested loops`, detail: "Triple-nested loops usually mean O(N³). Check whether a hash map or sorting step can remove a level." });
  } else if (depth === 2) {
    hints.push({ level: "info", title: "Nested loops detected", detail: "Two nested loops over the same input usually means O(N²). The Big-O tab will confirm it empirically." });
  } else if (depth === 1) {
    hints.push({ level: "info", title: "Single loop", detail: "One pass over the data is typically O(N) — a good baseline." });
  }

  const recursive = recursiveFunctions(code, language);
  if (recursive.length) {
    const name = recursive[0];
    const hasBaseCase = /\bif\b[^\n]*(<=|==|<|not\b)/.test(code);
    hints.push(
      hasBaseCase
        ? { level: "info", title: `Recursion in ${name}()`, detail: "Watch the call stack grow and unwind in the Visual Memory tab." }
        : { level: "warn", title: `${name}() may never stop`, detail: "I couldn't spot a base case. Make sure the recursion has an if-branch that returns without calling itself." }
    );
  }

  if (INPUT_PATTERN.test(code) && !userInput.trim()) {
    hints.push({ level: "warn", title: "Program reads input", detail: "Fill the Program Input box (one value per line) before running, or GraphMind will ask you for it." });
  }

  if (/while\s*\(?\s*(True|true|1)\s*\)?\s*[:{]/.test(code) && !/\bbreak\b/.test(code)) {
    hints.push({ level: "warn", title: "Infinite loop risk", detail: "This while-loop is always true and has no break — execution will hit the step limit." });
  }

  if (language === "python") {
    if (/def\s+\w+\([^)]*=\s*(\[\]|\{\})/.test(code)) {
      hints.push({ level: "warn", title: "Mutable default argument", detail: "Defaults like `x=[]` are shared between calls. Use `x=None` and create the list inside the function." });
    }
    if (/range\s*\(\s*len\s*\(/.test(code) && !/\[\s*\w+\s*[+-]\s*1\s*\]/.test(code)) {
      hints.push({ level: "tip", title: "Try enumerate()", detail: "`for i, value in enumerate(items)` is clearer than indexing with range(len(items))." });
    }
    if (/[=!]=\s*None/.test(code)) {
      hints.push({ level: "tip", title: "Compare None with `is`", detail: "Prefer `x is None` / `x is not None` over `==` / `!=`." });
    }
    if (!/\bprint\s*\(/.test(code)) {
      hints.push({ level: "tip", title: "No output yet", detail: "Add a print(...) so you can see the result in the Output panel after running." });
    }
  }
  if (!/\[[^\]]*\]|\{[^}]*\d[^}]*\}|\bc\(/.test(code)) {
    hints.push({ level: "tip", title: "Use an array to see animations", detail: "The Step Inspector animates arrays — compares, writes and swaps light up as your code touches them." });
  }

  if (hints.length === 0 || hints.every((h) => h.level !== "warn")) {
    hints.push({ level: "tip", title: "Looks good", detail: "No obvious problems spotted. Press Run & Visualize to trace it step by step." });
  }

  return hints;
}
