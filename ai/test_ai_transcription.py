import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qsl, urlparse

import embeddings as embeddings_module
import caption_translation as caption_translation_module
import main
import youtube_search as youtube_search_module
import ytdlp_captions as ytdlp_captions_module
from main import (
    build_quiz_response,
    build_study_plan,
    handle_mcp_request,
    load_translated_captions,
)

class AiServiceTest(unittest.TestCase):
    def test_transcription_is_disabled_by_default_before_adapter_or_upload(self):
        adapter = mock.Mock()
        with mock.patch.dict(os.environ, {}, clear=True):
            response = main.transcribe_youtube_audio(
                {
                    "videoId": "caption0001",
                    "durationSeconds": 120,
                    "model": "gpt-4o-mini-transcribe-2025-12-15",
                },
                adapter=adapter,
            )

        self.assertEqual(response["errorCode"], "STT_DISABLED")
        self.assertEqual(response["segments"], [])
        adapter.assert_not_called()

    def test_transcription_fake_adapter_returns_normalized_progressive_segments(self):
        adapter = mock.Mock(
            return_value={
                "sourceLanguage": "zh",
                "segments": [
                    {"start": 0, "end": 2, "text": "你好"},
                    {"start": 2, "end": 4, "text": "世界"},
                ],
            }
        )
        with mock.patch.dict(
            os.environ,
            {
                "STT_PROVIDER_ENABLED": "true",
                "STT_COST_APPROVAL_ID": "test-only-approval",
            },
            clear=True,
        ):
            response = main.transcribe_youtube_audio(
                {
                    "videoId": "caption0001",
                    "durationSeconds": 120,
                    "model": "gpt-4o-mini-transcribe-2025-12-15",
                },
                adapter=adapter,
            )

        self.assertEqual(response["provider"], "fake-transcription")
        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["sourceLanguage"], "zh")
        self.assertEqual(response["segments"][0]["text"], "你好")
        adapter.assert_called_once_with(
            {
                "videoId": "caption0001",
                "durationSeconds": 120,
                "model": "gpt-4o-mini-transcribe-2025-12-15",
            }
        )

    def test_transcription_uses_the_production_adapter_when_enabled(self):
        production_adapter = mock.Mock(
            return_value={
                "sourceLanguage": "en",
                "segments": [{"start": 0, "end": 30, "text": "hello"}],
                "translatedSegments": [
                    {"start": 0, "end": 30, "text": "안녕하세요"}
                ],
                "mediaDurationSeconds": 190,
            }
        )
        with mock.patch.dict(
            os.environ,
            {
                "STT_PROVIDER_ENABLED": "true",
                "STT_COST_APPROVAL_ID": "approved-production-budget",
            },
            clear=True,
        ), mock.patch.object(
            main,
            "production_transcription_adapter",
            production_adapter,
            create=True,
        ):
            response = main.transcribe_youtube_audio(
                {
                    "videoId": "caption0001",
                    "startSeconds": 0,
                    "durationSeconds": 30,
                    "model": "gpt-4o-mini-transcribe-2025-12-15",
                }
            )

        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["mediaDurationSeconds"], 190)
        production_adapter.assert_called_once()

    def test_production_transcription_adapter_uses_a_bounded_audio_window(self):
        captured = {}

        def downloader(request, directory):
            captured["download"] = dict(request)
            audio_path = directory / "window.mp3"
            audio_path.write_bytes(b"test-audio")
            return audio_path, 190

        class Transcriptions:
            @staticmethod
            def create(**kwargs):
                captured["transcription"] = kwargs
                return type("Response", (), {"text": "hello world"})()

        client = type(
            "Client",
            (),
            {"audio": type("Audio", (), {"transcriptions": Transcriptions()})()},
        )()
        request = {
            "videoId": "caption0001",
            "startSeconds": 30,
            "durationSeconds": 30,
            "model": "gpt-4o-mini-transcribe-2025-12-15",
        }

        try:
            result = main.production_transcription_adapter(
                request,
                downloader=downloader,
                client=client,
            )
        except TypeError:
            result = None

        self.assertIsNotNone(result)
        self.assertEqual(result["mediaDurationSeconds"], 190)
        self.assertEqual(result["segments"][0]["start"], 30)
        self.assertEqual(result["segments"][-1]["end"], 60)
        self.assertEqual(captured["download"]["durationSeconds"], 30)
        self.assertEqual(
            captured["transcription"]["model"],
            "gpt-4o-mini-transcribe-2025-12-15",
        )

    def test_audio_download_keeps_the_original_format_without_ffmpeg(self):
        captured_command = []

        def fake_run(command, **_kwargs):
            captured_command.extend(command)
            output = command[command.index("--output") + 1]
            Path(output.replace("%(ext)s", "webm")).write_bytes(b"audio")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            main,
            "fetch_yt_dlp_metadata",
            return_value=({"duration": 190}, ""),
        ), mock.patch.object(
            main,
            "yt_dlp_commands",
            return_value=[["python", "-m", "yt_dlp"]],
        ), mock.patch.object(
            main,
            "yt_dlp_secret_config_args",
            return_value=nullcontext([]),
        ), mock.patch.object(main.subprocess, "run", side_effect=fake_run):
            audio_path, duration = main.download_youtube_audio_window(
                {
                    "videoId": "caption0001",
                    "startSeconds": 0,
                    "durationSeconds": 600,
                },
                Path(directory),
            )

        self.assertEqual(audio_path.suffix, ".webm")
        self.assertEqual(duration, 190)
        self.assertNotIn("--extract-audio", captured_command)
        self.assertNotIn("--audio-format", captured_command)
        self.assertNotIn("--download-sections", captured_command)
        self.assertNotIn("--force-keyframes-at-cuts", captured_command)

    def test_production_transcription_translates_the_ready_source_window(self):
        source = [{"start": 0, "end": 5, "text": "hello"}]
        translated = [{"start": 0, "end": 5, "text": "안녕하세요"}]
        with mock.patch.dict(
            os.environ,
            {
                "STT_PROVIDER_ENABLED": "true",
                "STT_COST_APPROVAL_ID": "approved-production-budget",
            },
            clear=True,
        ), mock.patch.object(
            main,
            "production_transcription_adapter",
            return_value={
                "provider": "openai-audio-transcription",
                "sourceLanguage": "en",
                "segments": source,
                "translatedSegments": [],
                "mediaDurationSeconds": 5,
            },
        ), mock.patch.object(
            main,
            "translate_caption_segments",
            return_value=translated,
        ) as translate:
            response = main.transcribe_youtube_audio(
                {
                    "videoId": "caption0001",
                    "durationSeconds": 5,
                    "targetLanguage": "ko",
                    "model": "gpt-4o-mini-transcribe-2025-12-15",
                }
            )

        self.assertEqual(response["translatedSegments"], translated)
        translate.assert_called_once_with(source, "ko")

    def test_production_transcription_clamps_the_last_window_to_video_end(self):
        def downloader(_request, directory):
            audio_path = directory / "last.mp3"
            audio_path.write_bytes(b"test-audio")
            return audio_path, 45

        class Transcriptions:
            @staticmethod
            def create(**_kwargs):
                return type("Response", (), {"text": "last words"})()

        client = type(
            "Client",
            (),
            {"audio": type("Audio", (), {"transcriptions": Transcriptions()})()},
        )()
        result = main.production_transcription_adapter(
            {
                "videoId": "caption0001",
                "startSeconds": 30,
                "durationSeconds": 30,
                "model": "gpt-4o-mini-transcribe-2025-12-15",
            },
            downloader=downloader,
            client=client,
        )

        self.assertEqual(result["segments"][-1]["end"], 45)

    def test_transcription_rejects_media_capability_before_adapter(self):
        cases = [
            ({"isLive": True}, "VIDEO_LIVE_UNSUPPORTED"),
            ({"restriction": "region"}, "VIDEO_RESTRICTED"),
            ({"authenticationRequired": True}, "VIDEO_AUTH_REQUIRED"),
            ({"durationSeconds": 14401}, "VIDEO_TOO_LONG"),
        ]
        for capability, error_code in cases:
            with self.subTest(error_code=error_code):
                adapter = mock.Mock()
                with mock.patch.dict(
                    os.environ,
                    {
                        "STT_PROVIDER_ENABLED": "true",
                        "STT_COST_APPROVAL_ID": "test-only-approval",
                    },
                    clear=True,
                ):
                    response = main.transcribe_youtube_audio(
                        {
                            "videoId": "caption0001",
                            "durationSeconds": 120,
                            "model": "gpt-4o-mini-transcribe-2025-12-15",
                            "mediaCapability": capability,
                        },
                        adapter=adapter,
                    )
                self.assertEqual(response["errorCode"], error_code)
                adapter.assert_not_called()

    def test_transcription_exception_does_not_expose_credentials_or_urls(self):
        adapter = mock.Mock(
            side_effect=RuntimeError(
                "Bearer stt-secret https://u:url-secret@example.invalid/?token=query-secret"
            )
        )
        with mock.patch.dict(
            os.environ,
            {
                "STT_PROVIDER_ENABLED": "true",
                "STT_COST_APPROVAL_ID": "test-only-approval",
            },
            clear=True,
        ):
            response = main.transcribe_youtube_audio(
                {
                    "videoId": "caption0001",
                    "durationSeconds": 120,
                    "model": "gpt-4o-mini-transcribe-2025-12-15",
                },
                adapter=adapter,
            )

        serialized = json.dumps(response)
        self.assertEqual(
            response["errorCode"], "TRANSCRIPTION_PROVIDER_UNAVAILABLE"
        )
        self.assertNotIn("stt-secret", serialized)
        self.assertNotIn("url-secret", serialized)
        self.assertNotIn("query-secret", serialized)

if __name__ == "__main__":
    unittest.main()
