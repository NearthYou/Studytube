from pathlib import Path
import unittest


class CaptionTranslationBoundaryTest(unittest.TestCase):
    def test_translation_module_owns_batching_and_budgeting(self):
        ai_dir = Path(__file__).resolve().parents[1]
        translation = (ai_dir / "caption_translation.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def translate_caption_segments", translation)
        self.assertIn("def compact_caption_segments_for_translation", translation)
        self.assertIn("import caption_translation as caption_translation_module", main)
        self.assertNotIn("def translate_caption_segments", main)


if __name__ == "__main__":
    unittest.main()
