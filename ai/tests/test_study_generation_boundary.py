from pathlib import Path
import unittest


class StudyGenerationBoundaryTest(unittest.TestCase):
    def test_study_plan_and_agent_helpers_have_one_owner(self):
        ai_dir = Path(__file__).resolve().parents[1]
        module = (ai_dir / "study_generation.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def build_study_plan", module)
        self.assertIn("def choose_agent_tool", module)
        self.assertIn("from study_generation import", main)
        self.assertNotIn("def choose_agent_tool", main)


if __name__ == "__main__":
    unittest.main()
