import unittest
from unittest import mock

import transcription
import main


class LiveCaptionTranscriptionTest(unittest.TestCase):
    def test_live_chunks_use_a_short_non_retrying_openai_client(self):
        client = object()
        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}), mock.patch.object(
            main, "OpenAI", return_value=client
        ) as constructor:
            created = main.transcription_runtime().live_openai_client()

        self.assertIs(created, client)
        constructor.assert_called_once_with(timeout=30.0, max_retries=0)

    def test_browser_audio_is_disabled_without_the_bounded_flag(self):
        with mock.patch.dict("os.environ", {"BROWSER_STT_ENABLED": "false"}):
            result = transcription.transcribe_browser_audio_chunk(
                {
                    "audioBase64": "dGVzdA==",
                    "mimeType": "audio/webm",
                    "durationSeconds": 5,
                    "model": transcription.STT_MODEL_SNAPSHOT,
                }
            )

        self.assertEqual(result["status"], "disabled")
        self.assertEqual(result["errorCode"], "STT_DISABLED")

    def test_internal_route_uses_the_browser_chunk_handler(self):
        original = main.transcribe_browser_audio_chunk
        captured = []
        main.transcribe_browser_audio_chunk = lambda payload: captured.append(payload) or {
            "status": "ready",
            "source": "hello",
            "korean": "안녕하세요",
            "sourceLanguage": "en",
        }
        try:
            response = main.live_caption_transcribe_endpoint({"audioBase64": "dGVzdA=="})
        finally:
            main.transcribe_browser_audio_chunk = original

        self.assertEqual(captured, [{"audioBase64": "dGVzdA=="}])
        self.assertEqual(response["source"], "hello")

    def test_transcribes_a_bounded_browser_audio_chunk(self):
        response = mock.Mock(text="Containers share the host kernel.")
        client = mock.Mock()
        client.audio.transcriptions.create.return_value = response

        result = transcription.transcribe_browser_audio_chunk(
            {
                "audioBase64": "dGVzdA==",
                "mimeType": "audio/webm;codecs=opus",
                "durationSeconds": 8,
                "model": transcription.STT_MODEL_SNAPSHOT,
            },
            client=client,
            translator=lambda segments, _language: [
                {**segments[0], "text": "컨테이너는 호스트 커널을 공유합니다."}
            ],
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["source"], "Containers share the host kernel.")
        self.assertEqual(result["korean"], "컨테이너는 호스트 커널을 공유합니다.")
        client.audio.transcriptions.create.assert_called_once()

    def test_rejects_audio_larger_than_one_short_chunk(self):
        result = transcription.transcribe_browser_audio_chunk(
            {
                "audioBase64": "dGVzdA==",
                "mimeType": "audio/webm",
                "durationSeconds": 13,
                "model": transcription.STT_MODEL_SNAPSHOT,
            },
            client=mock.Mock(),
        )

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["errorCode"], "TRANSCRIPTION_PROVIDER_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
