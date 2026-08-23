from pathlib import Path
import unittest


class CaptionUtilsBoundaryTest(unittest.TestCase):
    def test_caption_utils_own_parsing_and_normalization(self):
        ai_dir = Path(__file__).resolve().parents[1]
        caption_utils = (ai_dir / "caption_utils.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def parse_timedtext_response", caption_utils)
        self.assertIn("def normalize_caption_segments", caption_utils)
        self.assertIn("from caption_utils import", main)
        self.assertNotIn("def parse_timedtext_response", main)
        self.assertNotIn("def normalize_caption_segments", main)


if __name__ == "__main__":
    unittest.main()
