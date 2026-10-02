import unittest

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class ApiTests(unittest.TestCase):
 def test_health(self):
    self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

 def test_cors_preflight(self):
    response=client.options("/api/trace", headers={"Origin":"http://localhost:3000", "Access-Control-Request-Method":"POST"})
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:3000")


 def test_parse_python_and_javascript(self):
    python = client.post("/api/parse", json={"code": "def add(a, b):\n return a+b", "language": "python"})
    self.assertEqual(python.status_code, 200); self.assertTrue(any(node["category"] == "function" for node in python.json()["nodes"]))
    javascript = client.post("/api/parse", json={"code": "function add(a,b) { return a+b; }", "language": "javascript"})
    self.assertEqual(javascript.status_code, 200); self.assertFalse(javascript.json()["hasError"])


 def test_trace_input_and_unsupported_language(self):
    result = client.post("/api/trace", json={"code": "x = int(input())\nprint(x + 1)", "language": "python", "input": "4"}).json()
    self.assertTrue(result["supported"]); self.assertEqual(result["stdout"], "5\n"); self.assertIsNone(result["error"])
    unsupported = client.post("/api/trace", json={"code": "print 1", "language": "cobol"}).json()
    self.assertFalse(unsupported["supported"]); self.assertEqual(unsupported["frames"], [])


 def test_trace_syntax_error_and_step_cap(self):
    syntax = client.post("/api/trace", json={"code": "if :", "language": "python"}).json()
    self.assertTrue(syntax["error"].startswith("SyntaxError"))
    limited = client.post("/api/trace", json={"code": "while True:\n    pass", "language": "python"}).json()
    self.assertIn("exceeded", limited["error"])

 def test_session_persistence_and_github_url_validation(self):
    saved=client.post("/api/sessions", json={"name":"test","language":"python","code":"print(1)"})
    self.assertEqual(saved.status_code, 201); session_id=saved.json()["id"]
    self.assertEqual(client.get(f"/api/sessions/{session_id}").json()["code"], "print(1)")
    self.assertEqual(client.post("/api/github/import", json={"url":"https://example.com/x/y"}).status_code, 400)
    self.assertEqual(client.delete(f"/api/sessions/{session_id}").status_code, 200)
