from pathlib import Path
import unittest


class QuizGenerationBoundaryTest(unittest.TestCase):
    def test_quiz_module_owns_caption_grounded_generation(self):
        ai_dir = Path(__file__).resolve().parents[1]
        quiz = (ai_dir / "quiz_generation.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def build_quiz_response", quiz)
        self.assertIn("import quiz_generation as quiz_generation_module", main)
        self.assertNotIn("def build_quiz_response", main)


if __name__ == "__main__":
    unittest.main()
