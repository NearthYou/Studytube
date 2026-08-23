from pathlib import Path
import unittest


class VideoSummaryBoundaryTest(unittest.TestCase):
    def test_video_summary_module_owns_summary_cache_and_selection(self):
        ai_dir = Path(__file__).resolve().parents[1]
        video_summary = (ai_dir / "video_summary.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def build_youtube_summary", video_summary)
        self.assertIn("def key_transcript_segments", video_summary)
        self.assertIn("import video_summary as video_summary_module", main)
        self.assertNotIn("def build_youtube_summary", main)
        self.assertNotIn("def key_transcript_segments", main)


if __name__ == "__main__":
    unittest.main()
