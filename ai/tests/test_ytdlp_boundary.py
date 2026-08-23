from pathlib import Path
import unittest


class YtDlpBoundaryTest(unittest.TestCase):
    def test_ytdlp_module_owns_recovery_and_token_configuration(self):
        ai_dir = Path(__file__).resolve().parents[1]
        ytdlp = (ai_dir / "ytdlp_captions.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def fetch_yt_dlp_caption_segments", ytdlp)
        self.assertIn("def yt_dlp_recovery_args", ytdlp)
        self.assertIn("def youtube_subtitle_po_token", ytdlp)
        self.assertIn("import ytdlp_captions as ytdlp_captions_module", main)
        self.assertNotIn("def fetch_yt_dlp_caption_segments", main)
        self.assertNotIn("def yt_dlp_recovery_args", main)


if __name__ == "__main__":
    unittest.main()
