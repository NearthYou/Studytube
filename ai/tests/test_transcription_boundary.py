from pathlib import Path
import unittest


class TranscriptionBoundaryTest(unittest.TestCase):
    def test_transcription_module_owns_disabled_provider_contract(self):
        ai_dir = Path(__file__).resolve().parents[1]
        transcription = (ai_dir / "transcription.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def transcribe_youtube_audio", transcription)
        self.assertIn("def transcription_failure", transcription)
        self.assertIn("import transcription as transcription_module", main)
        self.assertNotIn("def transcribe_youtube_audio", main)
        self.assertNotIn("def transcription_failure", main)


if __name__ == "__main__":
    unittest.main()
