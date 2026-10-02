"""Error -> "this line is wrong, change it to this" suggestions."""
import unittest

from fastapi.testclient import TestClient

from main import app
from tracer.diagnose import diagnose

client = TestClient(app)


class DiagnoseRuleTests(unittest.TestCase):
    def check(self, code, language, error, line, fix_line, suggestion, frames=None):
        result = diagnose(code, language, error, line, frames)
        self.assertIsNotNone(result)
        self.assertEqual(result["fixLine"], fix_line, result)
        self.assertEqual(result["suggestion"], suggestion, result)
        self.assertNotEqual(result["fixedCode"], code)
        return result

    def test_python_missing_colon(self):
        self.check("for n in nums\n    print(n)\n", "python", "SyntaxError: expected ':' (line 1)", 1, 1, "for n in nums:")

    def test_typo_uses_closest_name(self):
        self.check("total = 1\nprint(totl)\n", "python", "NameError: name 'totl' is not defined", 2, 2, "print(total)")
        self.check("const nums = [1];\nconsole.log(numz);\n", "javascript", "ReferenceError: numz is not defined", 2, 2, "console.log(nums);")

    def test_other_language_habits(self):
        self.check("done = true\n", "python", "NameError: name 'true' is not defined", 1, 1, "done = True")

    def test_missing_semicolon_on_previous_line(self):
        code = "int main() {\n    int x = 3\n    return x;\n}\n"
        self.check(code, "c", "program.c:3:5: error: expected ',' or ';' before 'return'", 3, 2, "    int x = 3;")

    def test_off_by_one_loop(self):
        code = "int[] a = {1, 2};\nfor (int i = 0; i <= a.length; i++) {\n  System.out.println(a[i]);\n}\n"
        self.check(code, "java", "java.lang.ArrayIndexOutOfBoundsException: Index 2 out of bounds for length 2", 3, 2,
                   "for (int i = 0; i < a.length; i++) {")

    def test_const_reassignment_fixes_the_declaration(self):
        code = "const total = 0;\ntotal += 1;\n"
        self.check(code, "javascript", "TypeError: Assignment to constant variable.", 2, 1, "let total = 0;")

    def test_infinite_while_gets_an_update(self):
        code = "i = 0\nwhile i < 5:\n    print(i)\nprint('done')\n"
        frames = [{"activeLine": 2, "operation": "LOOP"}] * 5
        result = self.check(code, "python", "Execution exceeded 5000 traced steps; possible infinite loop.", 3, 4, "    i += 1", frames)
        self.assertEqual(result["line"], 2)  # points at the loop, not wherever execution stopped

    def test_unknown_error_still_points_at_the_line(self):
        result = diagnose("x = 1\ny = 2\n", "python", "SomeWeirdError: boom", 2)
        self.assertEqual(result["line"], 2)
        self.assertEqual(result["action"], "none")


class DiagnoseApiTests(unittest.TestCase):
    def test_trace_returns_a_diagnosis_for_python_errors(self):
        code = "nums = [3, 1, 2]\npirnt(nums)\n"
        result = client.post("/api/trace", json={"code": code, "language": "python"}).json()
        diagnosis = result["diagnosis"]
        self.assertEqual(diagnosis["line"], 2)
        self.assertEqual(diagnosis["suggestion"], "print(nums)")
        self.assertEqual(diagnosis["fixedCode"], "nums = [3, 1, 2]\nprint(nums)\n")

    def test_no_diagnosis_without_error(self):
        result = client.post("/api/trace", json={"code": "print(1)\n", "language": "python"}).json()
        self.assertIsNone(result["diagnosis"])
