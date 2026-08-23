from pathlib import Path
import unittest


class AppBoundaryTest(unittest.TestCase):
    def test_app_factory_owns_http_composition(self):
        ai_dir = Path(__file__).resolve().parents[1]
        app_factory = (ai_dir / "app_factory.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def create_application", app_factory)
        self.assertIn("import app_factory", main)
        self.assertIn("app = application_runtime.app", main)
        self.assertNotIn("@app.get", main)
        self.assertNotIn("@app.post", main)
        self.assertNotIn("@app.middleware", main)
        self.assertNotIn("app.mount", main)


if __name__ == "__main__":
    unittest.main()
