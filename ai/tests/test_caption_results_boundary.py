from pathlib import Path
import unittest


class CaptionResultsBoundaryTest(unittest.TestCase):
    def test_caption_results_own_transcript_and_response_assembly(self):
        ai_dir = Path(__file__).resolve().parents[1]
        results = (ai_dir / "caption_results.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def fetch_transcript_api_segments", results)
        self.assertIn("def yt_dlp_caption_response", results)
        self.assertIn("import caption_results as caption_results_module", main)
        self.assertNotIn("def fetch_transcript_api_segments", main)
        self.assertNotIn("def yt_dlp_caption_response", main)


if __name__ == "__main__":
    unittest.main()
