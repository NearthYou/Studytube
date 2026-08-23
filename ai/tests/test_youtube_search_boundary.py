from pathlib import Path
import unittest


class YoutubeSearchBoundaryTest(unittest.TestCase):
    def test_youtube_search_owns_lookup_and_metadata_normalization(self):
        ai_dir = Path(__file__).resolve().parents[1]
        module = (ai_dir / "youtube_search.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def lookup_youtube", module)
        self.assertIn("def search_youtube_page", module)
        self.assertIn("import youtube_search as youtube_search_module", main)
        self.assertNotIn("def lookup_youtube", main)


if __name__ == "__main__":
    unittest.main()
