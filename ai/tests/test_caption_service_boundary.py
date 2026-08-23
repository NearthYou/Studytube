from pathlib import Path
import unittest


class CaptionServiceBoundaryTest(unittest.TestCase):
    def test_caption_service_owns_cache_and_provider_ordering(self):
        ai_dir = Path(__file__).resolve().parents[1]
        service = (ai_dir / "caption_service.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def load_translated_captions", service)
        self.assertIn("def caption_response_cache_key", service)
        self.assertIn("import caption_service as caption_service_module", main)
        self.assertNotIn("def load_translated_captions", main)
        self.assertNotIn("def caption_response_cache_key", main)


if __name__ == "__main__":
    unittest.main()
