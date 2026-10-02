export interface LoopInfo {
  var: string | null;
  iteration: number;
  total: number | null;
}

export interface CallInfo {
  function: string;
  args?: Record<string, unknown>;
  value?: unknown;
}

export interface TraceFrame {
  step: number;
  activeLine: number;
  event: "line" | "call" | "return" | "exception";
  operation: "READ" | "WRITE" | "COMPARE" | "CALL" | "RETURN" | "LOOP" | "EXEC" | "ERROR";
  description: string;
  callStack: string[];
  variables: Record<string, unknown>;
  arrayName: string | null;
  arrayState: unknown[];
  pointers: Record<string, number>;
  loop: LoopInfo | null;
  callInfo: CallInfo | null;
  /** Every list/array in scope (1-D or 2-D), keyed by variable name. */
  arrays?: Record<string, unknown[]>;
  /** Cells the active line reads/compares/writes: an index, or [row, col] for 2-D arrays. */
  accessed?: Record<string, Array<number | [number, number]>>;
}

export interface Diagnosis {
  /** Line the error was reported on. */
  line: number;
  title: string;
  explanation: string;
  /** Source of the line the fix changes (or, with no fix, the error line). */
  original: string;
  /** Line the fix replaces ("replace") or inserts before ("insert"). */
  fixLine: number | null;
  suggestion: string | null;
  action: "replace" | "insert" | "none";
  /** The whole program with the fix applied. */
  fixedCode: string | null;
  confidence: "high" | "medium" | "low";
  message: string;
}

export interface TraceResult {
  supported: boolean;
  message: string | null;
  frames: TraceFrame[];
  stdout: string;
  error: string | null;
  diagnosis?: Diagnosis | null;
}

export interface ComplexityResult {
  supported: boolean;
  message: string | null;
  n_values: number[];
  step_counts: number[];
  estimated_big_o: string | null;
  error: string | null;
}

export type NodeCategory =
  | "module"
  | "function"
  | "loop"
  | "condition"
  | "variable"
  | "call"
  | "return"
  | "import"
  | "class";

export interface GraphNode {
  id: string;
  type: string;
  category: NodeCategory;
  label: string;
  startLine: number;
  endLine: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "child" | "flow" | "call" | "import";
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export const LANGUAGES = [
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "cpp", label: "C++" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "go", label: "Go" },
  { id: "r", label: "R" },
] as const;

export type LanguageId = (typeof LANGUAGES)[number]["id"];

export const BOILERPLATE: Record<LanguageId, string> = {
  python: `def bubble_sort(arr):
    """Bubble sort with visual tracking"""
    n = len(arr)
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j + 1]:
                # Swap elements
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

# Visualize sorting
numbers = [5, 2, 8, 1, 9, 3]
result = bubble_sort(numbers)
print("Sorted:", result)
`,
  javascript: `function add(a, b) {
  return a + b;
}

let total = 0;
for (let i = 0; i < 4; i++) {
  total = add(total, i);
}

console.log(total);
`,
  typescript: `function add(a: number, b: number): number {
  return a + b;
}

let total = 0;
for (let i = 0; i < 4; i++) {
  total = add(total, i);
}

console.log(total);
`,
  cpp: `#include <iostream>
using namespace std;

int add(int a, int b) {
    return a + b;
}

int main() {
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total = add(total, i);
    }
    cout << total << endl;
    return 0;
}
`,
  java: `public class Main {
    static int add(int a, int b) {
        return a + b;
    }

    public static void main(String[] args) {
        int total = 0;
        for (int i = 0; i < 4; i++) {
            total = add(total, i);
        }
        System.out.println(total);
    }
}
`,
  c: `#include <stdio.h>

int add(int a, int b) {
    return a + b;
}

int main() {
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total = add(total, i);
    }
    printf("%d\\n", total);
    return 0;
}
`,
  go: `package main

import "fmt"

func add(a int, b int) int {
	return a + b
}

func main() {
	total := 0
	for i := 0; i < 4; i++ {
		total = add(total, i)
	}
	fmt.Println(total)
}
`,
  r: `add <- function(a, b) {
  return(a + b)
}

total <- 0
for (i in 0:3) {
  total <- add(total, i)
}

print(total)
`,
};
