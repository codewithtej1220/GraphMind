"""Multi-language step tracing and Big-O benchmarking.

Each language test skips when its toolchain is not installed on this machine.
"""
import shutil
import unittest

from fastapi.testclient import TestClient

from main import app
from parsers.ast_parser import get_parser
from tracer.execution import classify
from tracer.instrument import find_scale_target, instrument

client = TestClient(app)

BUBBLE = {
    "python": """def sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

print(sort([5, 2, 8, 1]))
""",
    "javascript": """function sort(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    }
  }
  return arr;
}
console.log(sort([5, 2, 8, 1]).join(","));
""",
    "typescript": """function sort(arr: number[]): number[] {
  const n: number = arr.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) { const t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t; }
    }
  }
  return arr;
}
console.log(sort([5, 2, 8, 1]).join(","));
""",
    "c": """#include <stdio.h>
void sort(int arr[], int n) {
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n - i - 1; j++)
      if (arr[j] > arr[j + 1]) { int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t; }
}
int main() {
  int a[] = {5, 2, 8, 1};
  sort(a, 4);
  printf("%d,%d,%d,%d", a[0], a[1], a[2], a[3]);
  return 0;
}
""",
    "cpp": """#include <iostream>
#include <vector>
using namespace std;
void sort(vector<int>& arr) {
  int n = arr.size();
  for (int i = 0; i < n; i++)
    for (int j = 0; j < n - i - 1; j++)
      if (arr[j] > arr[j + 1]) swap(arr[j], arr[j + 1]);
}
int main() {
  vector<int> a = {5, 2, 8, 1};
  sort(a);
  cout << a[0] << ',' << a[1] << ',' << a[2] << ',' << a[3];
}
""",
    "java": """public class Main {
  static void sort(int[] arr) {
    int n = arr.length;
    for (int i = 0; i < n; i++)
      for (int j = 0; j < n - i - 1; j++)
        if (arr[j] > arr[j + 1]) { int t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t; }
  }
  public static void main(String[] args) {
    int[] a = {5, 2, 8, 1};
    sort(a);
    System.out.print(a[0] + "," + a[1] + "," + a[2] + "," + a[3]);
  }
}
""",
    "go": """package main

import "fmt"

func sort(arr []int) {
	n := len(arr)
	for i := 0; i < n; i++ {
		for j := 0; j < n-i-1; j++ {
			if arr[j] > arr[j+1] {
				arr[j], arr[j+1] = arr[j+1], arr[j]
			}
		}
	}
}

func main() {
	a := []int{5, 2, 8, 1}
	sort(a)
	fmt.Printf("%d,%d,%d,%d", a[0], a[1], a[2], a[3])
}
""",
    "r": """sort_it <- function(arr) {
  n <- length(arr)
  for (i in 1:(n - 1)) {
    for (j in 1:(n - i)) {
      if (arr[j] > arr[j + 1]) {
        t <- arr[j]; arr[j] <- arr[j + 1]; arr[j + 1] <- t
      }
    }
  }
  arr
}
cat(sort_it(c(5, 2, 8, 1)), sep = ",")
""",
}
TOOLS = {"python": None, "javascript": "node", "typescript": "node", "c": "gcc", "cpp": "g++", "java": "javac", "go": "go", "r": "Rscript"}
OS_BLOCKED = "operating system refused"


class TracingTests(unittest.TestCase):
    def trace(self, language: str) -> dict:
        tool = TOOLS[language]
        if tool and not shutil.which(tool):
            self.skipTest(f"{tool} is not installed")
        result = client.post("/api/trace", json={"code": BUBBLE[language], "language": language}).json()
        if OS_BLOCKED in (result["error"] or ""):
            self.skipTest("the OS blocked the compiled program (e.g. Windows Smart App Control)")
        return result

    def check_bubble(self, language: str) -> None:
        result = self.trace(language)
        self.assertTrue(result["supported"])
        self.assertIsNone(result["error"])
        self.assertIn("1", result["stdout"])
        frames = result["frames"]
        self.assertGreater(len(frames), 10)
        # The array is captured, compared cells are known, and it ends sorted.
        self.assertTrue(any(f["arrayState"] == [5, 2, 8, 1] for f in frames))
        self.assertTrue(any(f["operation"] == "COMPARE" and f["accessed"] for f in frames))
        self.assertTrue(any(f["arrayState"] == [1, 2, 5, 8] for f in frames))
        self.assertTrue(any(len(f["callStack"]) >= 2 for f in frames))
        self.assertTrue(any(f["loop"] and f["loop"]["total"] for f in frames))

    def test_python(self): self.check_bubble("python")
    def test_javascript(self): self.check_bubble("javascript")
    def test_typescript(self): self.check_bubble("typescript")
    def test_c(self): self.check_bubble("c")
    def test_cpp(self): self.check_bubble("cpp")
    def test_java(self): self.check_bubble("java")
    def test_go(self): self.check_bubble("go")
    def test_r(self): self.check_bubble("r")

    def test_compile_error_points_at_user_line_without_hooks(self):
        if not shutil.which("javac"):
            self.skipTest("javac is not installed")
        code = 'public class Main {\n  public static void main(String[] a) {\n    int x = "s";\n  }\n}\n'
        result = client.post("/api/trace", json={"code": code, "language": "java"}).json()
        self.assertEqual(result["frames"][-1]["activeLine"], 3)
        self.assertNotIn("GMTrace", result["error"])

    def test_runtime_error_and_input(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        code = 'const n = Number(require("fs").readFileSync(0, "utf8"));\nconsole.log(n * 2);\nnope();\n'
        result = client.post("/api/trace", json={"code": code, "language": "javascript", "input": "21"}).json()
        self.assertEqual(result["stdout"].strip(), "42")
        self.assertEqual(result["frames"][-1]["operation"], "ERROR")
        self.assertNotIn("__gm", result["error"])


class InstrumentTests(unittest.TestCase):
    def test_instrumented_sources_still_parse(self):
        for language in ("javascript", "typescript", "c", "cpp", "java", "go", "r"):
            source = instrument(BUBBLE[language], language).source
            self.assertFalse(get_parser(language).parse(source.encode()).root_node.has_error, language)
            # Hooks are inserted inline, so line numbers are preserved.
            self.assertEqual(source.count("\n"), BUBBLE[language].count("\n"), language)

    def test_scale_targets(self):
        for language, code in BUBBLE.items():
            target = find_scale_target(code, language)
            self.assertIsNotNone(target, language)
            self.assertEqual(target.kind, "array", language)
        fib = find_scale_target("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\nprint(fib(10))\n", "python")
        self.assertEqual(fib.kind, "n")


class BenchmarkTests(unittest.TestCase):
    def test_classifier(self):
        ns = [8, 16, 32, 64, 128]
        self.assertEqual(classify(ns, [30] * 5), "O(1)")
        self.assertEqual(classify(ns, [3 * n for n in ns]), "O(N)")
        self.assertEqual(classify(ns, [n * n for n in ns]), "O(N^2)")
        small = [2, 4, 6, 8, 10, 12]
        self.assertEqual(classify(small, [round(1.618 ** n) + 3 for n in small]), "O(2^N)")

    def test_python_bubble_sort_is_quadratic(self):
        result = client.post("/api/complexity", json={"code": BUBBLE["python"], "language": "python"}).json()
        self.assertEqual(result["estimated_big_o"], "O(N^2)")

    def test_javascript_benchmark(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        result = client.post("/api/complexity", json={"code": BUBBLE["javascript"], "language": "javascript"}).json()
        self.assertEqual(result["estimated_big_o"], "O(N^2)")
