from pathlib import Path
import unittest


class YoutubeCaptionTracksBoundaryTest(unittest.TestCase):
    def test_track_module_owns_timed_text_discovery(self):
        ai_dir = Path(__file__).resolve().parents[1]
        tracks = (ai_dir / "youtube_caption_tracks.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def fetch_youtube_caption_tracks", tracks)
        self.assertIn("def fetch_caption_segments_from_urls", tracks)
        self.assertIn("import youtube_caption_tracks as caption_tracks_module", main)
        self.assertNotIn("def fetch_youtube_caption_tracks", main)
        self.assertNotIn("def fetch_caption_segments_from_urls", main)


if __name__ == "__main__":
    unittest.main()
