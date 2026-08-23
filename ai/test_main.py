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
from main import (
    build_quiz_response,
    build_study_plan,
    handle_mcp_request,
    load_translated_captions,
)


class ProductionSecretConfigTest(unittest.TestCase):
    def test_production_rejects_a_missing_or_placeholder_internal_key(self):
        for key in ("", "change-me", "replace-with-a-production-secret"):
            with self.subTest(key=key):
                with mock.patch.dict(
                    os.environ,
                    {"NODE_ENV": "production", "INTERNAL_AI_API_KEY": key},
                    clear=True,
                ):
                    with self.assertRaisesRegex(
                        RuntimeError, "INTERNAL_AI_API_KEY"
                    ):
                        main.require_production_internal_key()

    def test_production_accepts_a_long_non_placeholder_internal_key(self):
        with mock.patch.dict(
            os.environ,
            {
                "NODE_ENV": "production",
                "INTERNAL_AI_API_KEY": "a" * 32,
            },
            clear=True,
        ):
            main.require_production_internal_key()

    def test_non_production_does_not_require_an_internal_key(self):
        with mock.patch.dict(os.environ, {"NODE_ENV": "test"}, clear=True):
            main.require_production_internal_key()


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

    def test_internal_youtube_lookup_route_preserves_the_json_rpc_contract(self):
        original_handler = main.handle_mcp_request
        captured = []
        main.handle_mcp_request = lambda payload: captured.append(payload) or {
            "jsonrpc": "2.0",
            "id": payload.get("id"),
            "result": {"provider": "youtube-test", "videos": []},
        }
        request = {
            "jsonrpc": "2.0",
            "id": "nest-proxy",
            "method": "youtube.lookup",
            "params": {"query": "react hooks"},
        }
        try:
            response = main.youtube_lookup_endpoint(request)
        finally:
            main.handle_mcp_request = original_handler

        self.assertEqual(captured, [request])
        self.assertEqual(response["jsonrpc"], "2.0")
        self.assertEqual(response["id"], "nest-proxy")
        self.assertEqual(response["result"]["provider"], "youtube-test")

    def test_runtime_mounts_the_official_mcp_app_without_the_legacy_handler(self):
        legacy_endpoints = [
            getattr(route, "endpoint", None)
            for route in main.app.routes
            if getattr(route, "path", None) == "/mcp"
        ]
        mcp_route_paths = [route.path for route in main.mcp_application.routes]

        self.assertNotIn(main.handle_mcp_request, legacy_endpoints)
        self.assertIn("/mcp", mcp_route_paths)
        self.assertNotIn(
            "/.well-known/oauth-protected-resource/mcp",
            mcp_route_paths,
        )

    def test_internal_key_middleware_exempts_only_mcp_protocol_routes(self):
        original_key = os.environ.get("INTERNAL_AI_API_KEY")
        os.environ["INTERNAL_AI_API_KEY"] = "internal-test-key"

        async def invoke(path, internal_key=None):
            headers = []
            if internal_key is not None:
                headers.append(
                    (b"x-internal-api-key", internal_key.encode("ascii"))
                )
            request = main.Request(
                {
                    "type": "http",
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "path": path,
                    "raw_path": path.encode("ascii"),
                    "query_string": b"",
                    "headers": headers,
                    "client": ("127.0.0.1", 1),
                    "server": ("127.0.0.1", 8000),
                }
            )

            async def allowed(_request):
                return main.JSONResponse({"accepted": True})

            return await main.require_internal_service_key(request, allowed)

        try:
            self.assertEqual(asyncio.run(invoke("/mcp")).status_code, 200)
            self.assertEqual(
                asyncio.run(
                    invoke("/.well-known/oauth-protected-resource/mcp")
                ).status_code,
                401,
            )
            self.assertEqual(asyncio.run(invoke("/quiz/generate")).status_code, 401)
            self.assertEqual(asyncio.run(invoke("/youtube/lookup")).status_code, 401)
            self.assertEqual(
                asyncio.run(
                    invoke("/youtube/lookup", internal_key="internal-test-key")
                ).status_code,
                200,
            )
        finally:
            if original_key is None:
                os.environ.pop("INTERNAL_AI_API_KEY", None)
            else:
                os.environ["INTERNAL_AI_API_KEY"] = original_key

    def test_fastapi_lifespan_runs_the_mcp_session_manager(self):
        async def enter_runtime_lifespan():
            async with main.app.router.lifespan_context(main.app):
                self.assertIsNotNone(main.mcp_server.session_manager)

        asyncio.run(enter_runtime_lifespan())

    def test_quiz_generation_uses_five_cited_caption_ranges(self):
        original_loader = main.load_translated_captions
        main.load_translated_captions = lambda _payload: {
            "segments": [
                {"start": index * 10, "end": index * 10 + 8, "text": f"근거 문장 {index}"}
                for index in range(8)
            ]
        }
        try:
            response = build_quiz_response(
                {
                    "title": "트랜잭션 격리 수준",
                    "sourceUrl": "https://www.youtube.com/watch?v=example",
                    "timestampSeconds": 10,
                    "durationSeconds": 120,
                }
            )
        finally:
            main.load_translated_captions = original_loader

        self.assertEqual(response["schemaVersion"], 1)
        self.assertEqual(len(response["questions"]), 5)
        for question in response["questions"]:
            self.assertEqual(len(question["choices"]), 4)
            self.assertGreaterEqual(question["correctChoiceIndex"], 0)
            self.assertLess(question["correctChoiceIndex"], 4)
            self.assertEqual(
                question["sourceUrl"],
                "https://www.youtube.com/watch?v=example",
            )
            self.assertGreater(
                question["sourceEndSeconds"], question["sourceStartSeconds"]
            )

    def test_quiz_generation_rejects_non_youtube_sources(self):
        with self.assertRaisesRegex(ValueError, "allowed YouTube"):
            build_quiz_response(
                {
                    "title": "unsafe",
                    "sourceUrl": "https://example.com/video",
                    "timestampSeconds": 0,
                    "durationSeconds": 60,
                }
            )

    def test_health_reports_caption_runtime_configuration_without_secret_values(self):
        original_env = {
            name: os.environ.get(name)
            for name in [
                "OPENAI_API_KEY",
                "YOUTUBE_PO_TOKEN",
                "YOUTUBE_PROXY_URL",
                "YOUTUBE_COOKIES_FILE",
                "YOUTUBE_COOKIES_FROM_BROWSER",
            ]
        }
        original_yt_dlp_commands = main.yt_dlp_commands
        original_bgutil_home = main.youtube_bgutil_server_home

        os.environ["OPENAI_API_KEY"] = "sk-test-secret"
        os.environ["YOUTUBE_PO_TOKEN"] = "web.subs+po-secret"
        os.environ["YOUTUBE_PROXY_URL"] = "http://proxy.example"
        os.environ["YOUTUBE_COOKIES_FILE"] = "/tmp/youtube-cookies.txt"
        os.environ.pop("YOUTUBE_COOKIES_FROM_BROWSER", None)
        main.yt_dlp_commands = lambda: [["yt-dlp"]]
        main.youtube_bgutil_server_home = lambda: "/app/.tools/bgutil/server"

        try:
            response = main.health()
        finally:
            main.yt_dlp_commands = original_yt_dlp_commands
            main.youtube_bgutil_server_home = original_bgutil_home
            for name, value in original_env.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

        self.assertTrue(response["openaiConfigured"])
        self.assertEqual(
            response["youtubeCaptions"],
            {
                "ytDlpAvailable": True,
                "poTokenConfigured": True,
                "autoPoTokenEnabled": True,
                "bgutilConfigured": True,
                "proxyConfigured": True,
                "cookiesConfigured": True,
            },
        )
        self.assertNotIn("sk-test-secret", json.dumps(response))
        self.assertNotIn("po-secret", json.dumps(response))

    def test_youtube_http_requests_include_configured_cookie_file(self):
        original_cookie_file = os.environ.get("YOUTUBE_COOKIES_FILE")

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as file:
            file.write("# Netscape HTTP Cookie File\n")
            file.write(".youtube.com\tTRUE\t/\tTRUE\t2147483647\tVISITOR_INFO1_LIVE\tvisitor-test\n")
            file.write("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2147483647\tLOGIN_INFO\tlogin-test\n")
            file.write(".example.com\tTRUE\t/\tTRUE\t2147483647\tIGNORED\tignored\n")
            cookie_path = file.name

        os.environ["YOUTUBE_COOKIES_FILE"] = cookie_path

        try:
            kwargs = main.youtube_httpx_request_kwargs(timeout=8.0)
        finally:
            os.unlink(cookie_path)
            if original_cookie_file is None:
                os.environ.pop("YOUTUBE_COOKIES_FILE", None)
            else:
                os.environ["YOUTUBE_COOKIES_FILE"] = original_cookie_file

        self.assertEqual(
            kwargs["cookies"],
            {
                "VISITOR_INFO1_LIVE": "visitor-test",
                "LOGIN_INFO": "login-test",
            },
        )
        self.assertEqual(kwargs["timeout"], 8.0)

    def test_caption_payload_language_alias_selects_target_language(self):
        self.assertEqual(
            main.caption_target_language({"videoId": "abc123", "language": "en"}),
            "en",
        )

    def test_transcript_rows_are_normalized_to_latest_start_timing(self):
        segments = main.parse_transcript_api_rows(
            [
                {"start": 0, "duration": 6.72, "text": "첫 번째 문장"},
                {"start": 5.31, "duration": 5.67, "text": "두 번째 문장"},
                {"start": 6.72, "duration": 9, "text": "세 번째 문장"},
            ]
        )

        self.assertEqual(segments[0]["end"], 5.31)
        self.assertEqual(segments[1]["end"], 6.72)
        self.assertEqual(segments[2]["end"], 15.72)

    def test_caption_response_translates_when_target_language_text_mismatches(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {"content": json.dumps({"translations": ["안녕하세요 세계"]})},
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = main.transcript_api_caption_response(
                "abc123",
                "ko",
                "ko",
                False,
                [{"start": 0, "end": 4, "text": "Hello world"}],
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-caption-translation")
        self.assertTrue(response["translated"])
        self.assertEqual(response["segments"][0]["text"], "안녕하세요 세계")
        self.assertEqual(response["sourceSegments"][0]["text"], "Hello world")
        self.assertEqual(
            response["translatedSegments"][0]["text"], "안녕하세요 세계"
        )

    def test_caption_segment_translation_batches_all_segments(self):
        class FakeOpenAI:
            calls = 0

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        FakeOpenAI.calls += 1
                        content = kwargs["messages"][1]["content"]
                        payload = json.loads(content)
                        translations = [
                            f"번역 {index}" for index, _text in enumerate(payload["segments"])
                        ]
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {"translations": translations},
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        source_segments = [
            {"start": index * 2, "end": index * 2 + 2, "text": f"caption {index}"}
            for index in range(40)
        ]

        try:
            translated = main.translate_caption_segments(source_segments, "ko")
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(len(translated), 40)
        self.assertGreater(FakeOpenAI.calls, 1)
        self.assertEqual(translated[-1]["start"], 78)

    def test_caption_segment_translation_compacts_long_word_level_captions(self):
        class FakeOpenAI:
            calls = 0

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        FakeOpenAI.calls += 1
                        payload = json.loads(kwargs["messages"][1]["content"])
                        translations = [
                            f"{text} translated" for text in payload["segments"]
                        ]
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {"translations": translations},
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        source_segments = [
            {"start": index, "end": index + 1, "text": f"word{index}"}
            for index in range(300)
        ]

        try:
            translated = main.translate_caption_segments(source_segments, "ko")
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertLess(len(translated), len(source_segments))
        self.assertEqual(translated[0]["start"], 0)
        self.assertEqual(translated[-1]["end"], 300)
        self.assertLessEqual(
            max(segment["end"] - segment["start"] for segment in translated),
            main.CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS,
        )
        self.assertIn("word0", translated[0]["text"])
        self.assertIn("translated", translated[0]["text"])

    def test_caption_segment_translation_keeps_long_videos_within_background_budget(self):
        source_segments = [
            {"start": index * 2, "end": index * 2 + 2, "text": f"caption {index}"}
            for index in range(2700)
        ]

        compacted = main.compact_caption_segments_for_translation(source_segments)

        self.assertLessEqual(
            len(compacted),
            main.CAPTION_TRANSLATION_TARGET_SEGMENTS,
        )
        self.assertEqual(compacted[0]["start"], 0)
        self.assertEqual(compacted[-1]["end"], 5400)
        self.assertLessEqual(
            max(segment["end"] - segment["start"] for segment in compacted),
            main.CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS,
        )
        self.assertIn("caption 0", compacted[0]["text"])
        self.assertIn("caption 2699", compacted[-1]["text"])

    def test_caption_segment_translation_does_not_inline_long_video_jobs(self):
        class FakeOpenAI:
            pass

        source_segments = [
            {"start": index * 2, "end": index * 2 + 2, "text": f"caption {index}"}
            for index in range(2700)
        ]
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            compacted = main.compact_caption_segments_for_translation(source_segments)

            self.assertFalse(main.should_translate_caption_segments_inline(source_segments))
            self.assertGreater(
                len(compacted),
                main.CAPTION_TRANSLATION_INLINE_MAX_SEGMENTS,
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

    def test_caption_segment_translation_uses_concise_prompt_for_compacted_captions(self):
        class FakeOpenAI:
            system_prompt = ""

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        FakeOpenAI.system_prompt = kwargs["messages"][0]["content"]
                        payload = json.loads(kwargs["messages"][1]["content"])
                        translations = [
                            f"{text} translated" for text in payload["segments"]
                        ]
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {"translations": translations},
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            translated = main.translate_caption_segments(
                [
                    {"start": index * 2, "end": index * 2 + 2, "text": f"caption {index}"}
                    for index in range(2700)
                ],
                "ko",
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertLessEqual(len(translated), main.CAPTION_TRANSLATION_TARGET_SEGMENTS)
        self.assertGreater(len(translated), 20)
        self.assertLessEqual(
            max(segment["end"] - segment["start"] for segment in translated),
            main.CAPTION_TRANSLATION_COMPACT_MAX_DURATION_SECONDS,
        )
        self.assertIn("Condense each item", FakeOpenAI.system_prompt)

    def test_concise_caption_prompt_uses_requested_english_target(self):
        class FakeClient:
            system_prompt = ""
            user_payload = {}

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        FakeClient.system_prompt = kwargs["messages"][0]["content"]
                        FakeClient.user_payload = json.loads(
                            kwargs["messages"][1]["content"]
                        )
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {"translations": ["hello"]},
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        translations = main.request_caption_translations(
            FakeClient(),
            ["안녕하세요"],
            "en",
            use_concise_subtitles=True,
        )

        self.assertEqual(translations, ["hello"])
        self.assertEqual(FakeClient.user_payload["targetLanguage"], "en")
        self.assertIn("into English", FakeClient.system_prompt)
        self.assertNotIn("into Korean", FakeClient.system_prompt)

    def test_caption_segment_translation_runs_batches_concurrently(self):
        import threading

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        original_batch_size = caption_translation_module.CAPTION_TRANSLATION_BATCH_SIZE
        original_translate_batch = caption_translation_module.translate_caption_batch

        class FakeOpenAI:
            pass

        started_batches: list[list[str]] = []
        barrier = threading.Barrier(3, timeout=0.5)

        def fake_translate_batch(_client, batch, _target_language, _use_concise=False):
            texts = [segment["text"] for segment in batch]
            started_batches.append(texts)
            barrier.wait()
            return [f"{text} translated" for text in texts]

        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        caption_translation_module.CAPTION_TRANSLATION_BATCH_SIZE = 2
        caption_translation_module.translate_caption_batch = fake_translate_batch

        try:
            translated = main.translate_caption_segments(
                [
                    {"start": index, "end": index + 1, "text": f"caption {index}"}
                    for index in range(6)
                ],
                "ko",
            )
        finally:
            main.OpenAI = original_openai
            caption_translation_module.CAPTION_TRANSLATION_BATCH_SIZE = original_batch_size
            caption_translation_module.translate_caption_batch = original_translate_batch
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(len(started_batches), 3)
        self.assertEqual(
            [segment["text"] for segment in translated],
            [f"caption {index} translated" for index in range(6)],
        )

    def test_caption_segment_translation_splits_batch_when_model_drops_segments(self):
        class FakeOpenAI:
            calls = 0

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        FakeOpenAI.calls += 1
                        payload = json.loads(kwargs["messages"][1]["content"])
                        source = payload["segments"]
                        translations = (
                            ["too few"]
                            if len(source) > 1
                            else [f"{source[0]} translated"]
                        )
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {"translations": translations},
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            translated = main.translate_caption_segments(
                [
                    {"start": 0, "end": 1, "text": "first"},
                    {"start": 1, "end": 2, "text": "second"},
                    {"start": 2, "end": 3, "text": "third"},
                ],
                "ko",
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(
            [segment["text"] for segment in translated],
            ["first translated", "second translated", "third translated"],
        )
        self.assertGreater(FakeOpenAI.calls, 1)

    def test_youtube_summary_uses_openai_sections_from_transcript(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "sections": [
                                            {
                                                "label": "핵심 요약",
                                                "body": "이 영상은 표현을 실제 맥락에서 익히는 방법을 자세히 설명합니다.",
                                            },
                                            {
                                                "label": "복습 질문",
                                                "body": "영상에서 반복된 표현을 어떤 상황에 적용할 수 있나요?",
                                            },
                                        ]
                                    },
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = main.build_youtube_summary(
                {
                    "videoId": "study123",
                    "title": "English Expressions",
                    "channelName": "Study Channel",
                    "language": "ko",
                    "segments": [
                        {
                            "start": 0,
                            "end": 4,
                            "text": "Today we learn expressions from a sitcom.",
                        },
                        {
                            "start": 4,
                            "end": 9,
                            "text": "Focus on when native speakers use them.",
                        },
                    ],
                }
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-transcript-summary")
        self.assertEqual(response["sections"][0]["label"], "핵심 요약")
        self.assertIn("표현", response["sections"][0]["body"])

    def test_youtube_summary_fetches_caption_segments_when_payload_has_none(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        payload = json.loads(kwargs["messages"][1]["content"])
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "sections": [
                                            {
                                                "label": "핵심 요약",
                                                "body": f"{payload['title']} 자막을 기준으로 학습 요약을 만들었습니다.",
                                            }
                                        ]
                                    },
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        captured_caption_payloads = []

        def fake_load_translated_captions(payload):
            captured_caption_payloads.append(payload)
            return {
                "mode": "youtube-captions",
                "provider": "openai-caption-translation",
                "videoId": payload["videoId"],
                "language": "ko",
                "sourceLanguage": "en",
                "translated": True,
                "segments": [
                    {
                        "start": 0,
                        "end": 4,
                        "text": "React Query는 서버 상태를 캐시합니다.",
                    }
                ],
                "message": "translated",
            }

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        original_load_captions = main.load_translated_captions
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        main.load_translated_captions = fake_load_translated_captions

        try:
            response = main.build_youtube_summary(
                {
                    "videoId": "novnyCaa7To",
                    "title": "React Query Crash Course",
                    "channelName": "The Net Ninja",
                    "segments": [],
                }
            )
        finally:
            main.OpenAI = original_openai
            main.load_translated_captions = original_load_captions
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(captured_caption_payloads[0]["videoId"], "novnyCaa7To")
        self.assertFalse(captured_caption_payloads[0]["allowFallback"])
        self.assertEqual(response["provider"], "openai-transcript-summary")
        transcript_section = response["sections"][-1]
        self.assertIn("React Query는 서버 상태를 캐시합니다.", transcript_section["body"])

    def test_youtube_summary_reuses_cached_response_for_same_transcript(self):
        class FakeOpenAI:
            calls = 0

            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        FakeOpenAI.calls += 1
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "sections": [
                                            {
                                                "label": "핵심 요약",
                                                "body": "React Query 핵심을 서버 상태 중심으로 정리합니다.",
                                            }
                                        ]
                                    },
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        main.SUMMARY_RESPONSE_CACHE.clear()

        payload = {
            "videoId": "summary-cache",
            "title": "React Query Crash Course",
            "channelName": "The Net Ninja",
            "segments": [
                {
                    "start": 0,
                    "end": 5,
                    "text": "React Query caches server state.",
                }
            ],
        }

        try:
            first = main.build_youtube_summary(payload)
            calls_after_first_summary = FakeOpenAI.calls
            second = main.build_youtube_summary(payload)
        finally:
            main.SUMMARY_RESPONSE_CACHE.clear()
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(first["provider"], "openai-transcript-summary")
        self.assertEqual(second["provider"], "openai-transcript-summary")
        self.assertGreater(calls_after_first_summary, 0)
        self.assertEqual(FakeOpenAI.calls, calls_after_first_summary)

    def test_youtube_summary_is_korean_and_includes_timestamped_transcript(self):
        captured_payloads = []

        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        payload = json.loads(kwargs["messages"][1]["content"])
                        captured_payloads.append(payload)
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "sections": [
                                            {
                                                "label": "핵심 요약",
                                                "body": "한국어로 정리한 학습 요약입니다.",
                                            }
                                        ]
                                    },
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = main.build_youtube_summary(
                {
                    "videoId": "korean-summary",
                    "title": "React Hooks",
                    "channelName": "Study Channel",
                    "language": "en",
                    "segments": [
                        {"start": 0, "end": 3, "text": "첫 번째 설명입니다."},
                        {"start": 4, "end": 8, "text": "두 번째 예제입니다."},
                    ],
                }
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["language"], "ko")
        self.assertEqual(captured_payloads[0]["targetLanguage"], "ko")
        transcript_section = next(
            section
            for section in response["sections"]
            if section["label"] == "전체 스크립트 전사문"
        )
        self.assertIn(
            "00:00 첫 번째 설명입니다. 두 번째 예제입니다.",
            transcript_section["body"],
        )

    def test_timestamped_transcript_uses_long_timestamp_intervals(self):
        segments = [
            {"start": 0, "end": 4, "text": "인트로에서 오늘 배울 내용을 짧게 소개합니다."},
            {"start": 30, "end": 34, "text": "환경 설정을 빠르게 확인합니다."},
            {
                "start": 60,
                "end": 66,
                "text": "핵심 개념은 서버 상태와 클라이언트 상태를 분리하는 것입니다.",
            },
            {"start": 90, "end": 94, "text": "폴더 구조를 잠깐 살펴봅니다."},
            {
                "start": 150,
                "end": 158,
                "text": "예를 들어 캐시가 오래 남으면 사용자는 이전 데이터를 볼 수 있습니다.",
            },
            {"start": 180, "end": 184, "text": "짧은 연결 문장입니다."},
            {
                "start": 240,
                "end": 248,
                "text": "주의할 점은 실패한 요청을 다시 시도할 때 로딩 상태를 분리하는 것입니다.",
            },
            {"start": 270, "end": 274, "text": "다음 화면으로 이동합니다."},
            {
                "start": 330,
                "end": 338,
                "text": "실습에서는 쿼리 키를 바꿔서 데이터가 갱신되는 흐름을 확인합니다.",
            },
            {"start": 360, "end": 364, "text": "잠깐 쉬어 가는 설명입니다."},
            {
                "start": 420,
                "end": 428,
                "text": "정리하면 캐시 무효화 전략을 다시 보는 것이 중요합니다.",
            },
        ]

        body = main.timestamped_transcript_body(segments)
        lines = body.splitlines()

        self.assertLess(len(lines), len(segments))
        self.assertLessEqual(len(lines), 8)
        self.assertIn("01:00 핵심 개념은 서버 상태와 클라이언트 상태를 분리하는 것입니다.", body)
        self.assertIn("07:00 정리하면 캐시 무효화 전략을 다시 보는 것이 중요합니다.", body)
        self.assertNotEqual(
            [line.split(" ", 1)[0] for line in lines],
            [
                "00:00",
                "00:30",
                "01:00",
                "01:30",
                "02:30",
                "03:00",
                "04:00",
                "04:30",
            ][: len(lines)],
        )

    def test_timestamped_transcript_includes_every_segment_in_long_intervals(self):
        segments = [
            {"start": 0, "end": 4, "text": "Intro overview."},
            {"start": 30, "end": 34, "text": "Environment setup."},
            {"start": 60, "end": 66, "text": "Core concept."},
            {"start": 90, "end": 94, "text": "Folder structure."},
            {"start": 150, "end": 158, "text": "Cache example."},
            {"start": 180, "end": 184, "text": "Short bridge."},
            {"start": 240, "end": 248, "text": "Retry warning."},
            {"start": 270, "end": 274, "text": "Next screen."},
            {"start": 330, "end": 338, "text": "Practice query keys."},
            {"start": 360, "end": 364, "text": "Design notes."},
            {"start": 420, "end": 428, "text": "Final summary."},
        ]

        body = main.timestamped_transcript_body(segments)
        lines = body.splitlines()

        self.assertLess(len(lines), len(segments))
        self.assertEqual(
            [line.split(" ", 1)[0] for line in lines],
            ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"],
        )
        for segment in segments:
            self.assertIn(segment["text"], body)

    def test_youtube_summary_falls_back_to_timed_transcript_notes(self):
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = main.build_youtube_summary(
                {
                    "videoId": "fallback123",
                    "title": "Fallback lesson",
                    "channelName": "Study Channel",
                    "summary": "Short stored summary.",
                    "segments": [
                        {"start": 0, "end": 3, "text": "첫 번째 포인트입니다."},
                        {"start": 60, "end": 63, "text": "두 번째 포인트입니다."},
                    ],
                }
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "local-transcript-summary")
        self.assertGreaterEqual(len(response["sections"]), 3)
        self.assertIn("00:00", response["sections"][1]["body"])

    def test_youtube_summary_does_not_show_english_transcript_when_korean_is_unavailable(self):
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = main.build_youtube_summary(
                {
                    "videoId": "english-fallback",
                    "title": "Fallback lesson",
                    "channelName": "Study Channel",
                    "language": "en",
                    "summary": "",
                    "segments": [
                        {"start": 0, "end": 3, "text": "First point"},
                        {"start": 60, "end": 63, "text": "Second point"},
                    ],
                }
            )
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        joined_sections = "\n".join(
            f"{section['label']}\n{section['body']}"
            for section in response["sections"]
        )

        self.assertEqual(response["language"], "ko")
        self.assertNotIn("First point", joined_sections)
        self.assertNotIn("Second point", joined_sections)
        self.assertNotIn("전체 스크립트 전사문", joined_sections)

    def test_mcp_youtube_lookup_returns_json_rpc_result(self):
        response = handle_mcp_request(
            {
                "jsonrpc": "2.0",
                "id": "case-1",
                "method": "youtube.lookup",
                "params": {"query": "react hooks"},
            }
        )

        self.assertEqual(response["jsonrpc"], "2.0")
        self.assertEqual(response["id"], "case-1")
        self.assertIn("title", response["result"])
        self.assertIn("provider", response["result"])
        self.assertIn("videos", response["result"])

    def test_mcp_youtube_search_parses_real_page_metadata(self):
        class FakeResponse:
            text = """
            <script>
            var ytInitialData = {"contents":{"videoRenderer":{
              "videoId":"abc123",
              "title":{"runs":[{"text":"Real React Hooks Lesson"}]},
              "ownerText":{"runs":[{"text":"Real Channel"}]},
              "thumbnail":{"thumbnails":[{"url":"https://img.example/a.jpg"}]}
            }}};
            </script>
            """

            def raise_for_status(self):
                return None

        class FakeHttpx:
            @staticmethod
            def get(*_args, **_kwargs):
                return FakeResponse()

        original_httpx = youtube_search_module.httpx
        youtube_search_module.httpx = FakeHttpx

        try:
            response = handle_mcp_request(
                {
                    "jsonrpc": "2.0",
                    "id": "case-search",
                    "method": "youtube.lookup",
                    "params": {"query": "react hooks", "limit": 3},
                }
            )
        finally:
            youtube_search_module.httpx = original_httpx

        result = response["result"]
        self.assertEqual(result["provider"], "youtube-search-page")
        self.assertEqual(result["videos"][0]["videoId"], "abc123")
        self.assertEqual(result["videos"][0]["title"], "Real React Hooks Lesson")

    def test_youtube_captions_fetches_timed_segments_without_youtube_tlang_when_openai_ready(self):
        calls = []
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                            "languageCode": "en",
                            "name": {"simpleText": "English"},
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **kwargs):
                calls.append((url, kwargs))

                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 0,
                                "dDurationMs": 2200,
                                "segs": [{"utf8": "안녕하세요 "}, {"utf8": "리액트"}],
                            },
                            {
                                "tStartMs": 2200,
                                "dDurationMs": 1800,
                                "segs": [{"utf8": "훅을 배웁니다"}],
                            },
                        ]
                    }
                )

        original_httpx = main.httpx
        original_openai_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "fallback should not be used",
                }
            )
        finally:
            main.httpx = original_httpx
            if original_openai_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_openai_key

        self.assertEqual(response["provider"], "youtube-timedtext")
        self.assertEqual(response["language"], "ko")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertEqual(response["segments"][0]["text"], "안녕하세요 리액트")
        self.assertEqual(response["segments"][0]["start"], 0)
        self.assertEqual(response["segments"][0]["end"], 2.2)
        self.assertEqual(calls[0][1]["params"]["v"], "abc123")
        self.assertEqual(calls[0][1]["params"]["hl"], "en")
        self.assertNotIn("tlang=ko", calls[-1][0])
        self.assertIn("fmt=json3", calls[-1][0])

    def test_youtube_captions_reuses_cached_response_for_same_video_and_language(self):
        fetch_count = 0
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=cache123&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                nonlocal fetch_count

                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                fetch_count += 1
                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 0,
                                "dDurationMs": 1000,
                                "segs": [{"utf8": "Cached caption"}],
                            }
                        ]
                    }
                )

        original_httpx = main.httpx
        main.httpx = FakeHttpx
        main.CAPTION_RESPONSE_CACHE.clear()

        try:
            first = load_translated_captions(
                {"videoId": "cache123", "targetLanguage": "en"}
            )
            second = load_translated_captions(
                {"videoId": "cache123", "targetLanguage": "en"}
            )
        finally:
            main.httpx = original_httpx
            main.CAPTION_RESPONSE_CACHE.clear()

        self.assertEqual(fetch_count, 1)
        self.assertEqual(first, second)
        self.assertEqual(second["segments"][0]["text"], "Cached caption")

    def test_caption_cache_does_not_pin_source_response_when_translation_is_available(self):
        class FakeOpenAI:
            pass

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        cache_key = "source-cache"
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        main.CAPTION_RESPONSE_CACHE[cache_key] = (
            time.time(),
            {
                "provider": "youtube-source-captions",
                "translated": False,
                "segments": [{"start": 0, "end": 1, "text": "source"}],
            },
        )

        try:
            cached = main.read_caption_response_cache(cache_key)
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key
            main.CAPTION_RESPONSE_CACHE.clear()

        self.assertIsNone(cached)
        self.assertNotIn(cache_key, main.CAPTION_RESPONSE_CACHE)

    @unittest.skip("Stored summaries are no longer used as live translated captions.")
    def test_youtube_captions_fallback_chunks_saved_notes(self):
        original_httpx = main.httpx
        main.httpx = None

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": (
                        "첫 번째 문장입니다. 두 번째 문장입니다. "
                        "세 번째 문장도 자막으로 보여야 합니다."
                    ),
                }
            )
        finally:
            main.httpx = original_httpx

        self.assertEqual(response["provider"], "local-fallback")
        self.assertGreaterEqual(len(response["segments"]), 2)
        self.assertIn("첫 번째", response["segments"][0]["text"])

    @unittest.skip("Stored summaries are no longer used as live translated captions.")
    def test_youtube_captions_can_disable_local_fallback_segments(self):
        original_httpx = main.httpx
        main.httpx = None

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "Linus private note should not become live captions",
                    "allowFallback": False,
                }
            )
        finally:
            main.httpx = original_httpx

        self.assertEqual(response["provider"], "local-fallback")
        self.assertEqual(response["segments"], [])

    @unittest.skip("Stored summaries are no longer used as live translated captions.")
    def test_youtube_captions_translates_fallback_text_when_requested(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {"content": "런타임 계정 격리를 확인합니다."},
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = None
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "Runtime account isolation check.",
                    "allowFallback": True,
                    "translateFallback": True,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-fallback-translation")
        self.assertEqual(response["language"], "ko")
        self.assertEqual(response["sourceLanguage"], "local-note")
        self.assertTrue(response["translated"])
        self.assertIn("런타임", response["segments"][0]["text"])

    @unittest.skip("Stored summaries are no longer used as live translated captions.")
    def test_youtube_captions_translates_korean_fallback_text_to_english(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {"content": "Runtime account isolation is checked."},
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = None
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "en",
                    "fallbackText": "런타임 계정 격리를 확인합니다.",
                    "allowFallback": True,
                    "translateFallback": True,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-fallback-translation")
        self.assertEqual(response["language"], "en")
        self.assertTrue(response["translated"])
        self.assertIn("Runtime account", response["segments"][0]["text"])

    @unittest.skip("Stored summaries are no longer used as live translated captions.")
    def test_youtube_captions_spreads_translated_fallback_across_duration(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {
                                "content": (
                                    "React hooks manage component state. "
                                    "Effects synchronize external systems."
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = None
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "en",
                    "fallbackText": "React hooks study note.",
                    "allowFallback": True,
                    "translateFallback": True,
                    "durationSeconds": 120,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-fallback-translation")
        self.assertEqual(response["segments"][0]["start"], 0)
        self.assertEqual(response["segments"][-1]["end"], 120)
        self.assertGreaterEqual(len(response["segments"]), 2)

    def test_youtube_captions_do_not_use_summary_as_live_caption_fallback(self):
        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = None
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "This stored summary must not become captions.",
                    "allowFallback": True,
                    "translateFallback": True,
                    "durationSeconds": 120,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "caption-source-unavailable")
        self.assertEqual(response["sourceLanguage"], "unavailable")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"], [])

    def test_youtube_captions_use_native_fallback_when_track_list_is_empty(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        main.fetch_youtube_caption_tracks = lambda _video_id: []
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "",
            False,
            RuntimeError("yt-dlp-caption-track-unavailable"),
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "freecodecamp123",
                    "targetLanguage": "ko",
                    "allowFallback": False,
                }
            )
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "youtube-native-captions")
        self.assertEqual(response["sourceLanguage"], "youtube")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"], [])
        self.assertIn("youtube-caption-track-unavailable", response["message"])

    def test_youtube_captions_report_track_fetch_rate_limit_before_native_fallback(self):
        original_httpx = main.httpx
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        def fake_fetch_tracks(_video_id):
            raise RuntimeError("HTTP Error 429: Too Many Requests")

        main.httpx = object()
        main.fetch_youtube_caption_tracks = fake_fetch_tracks
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "",
            False,
            RuntimeError("yt-dlp-caption-track-unavailable"),
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "tracklimited123",
                    "targetLanguage": "ko",
                    "allowFallback": False,
                }
            )
        finally:
            main.httpx = original_httpx
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "youtube-caption-rate-limited")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"], [])
        self.assertIn("429", response["message"])

    def test_youtube_captions_do_not_align_summary_when_translation_fails(self):
        class FakeResponse:
            def __init__(self, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                if self._data is None:
                    raise ValueError("not json")
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                if "watch" in url:
                    return FakeResponse(
                        """
                        <script>
                        var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{
                          "baseUrl":"https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                          "languageCode":"en",
                          "isTranslatable":true
                        }]}}};
                        </script>
                        """
                    )

                if "tlang=ko" in url:
                    return FakeResponse("", {"events": []})

                return FakeResponse(
                    "",
                    {
                        "events": [
                            {
                                "tStartMs": 0,
                                "dDurationMs": 4000,
                                "segs": [{"utf8": "Server state changes often"}],
                            }
                        ]
                    },
                )

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "Stored summary must not be aligned to timing.",
                    "allowFallback": True,
                    "translateFallback": True,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "youtube-source-captions")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"][0]["text"], "Server state changes often")

    def test_youtube_captions_retries_simple_timedtext_url(self):
        calls = []
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **kwargs):
                calls.append(url)

                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                if "signed.example" in url:
                    raise RuntimeError("rate limited")

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 1000,
                                "dDurationMs": 1000,
                                "segs": [{"utf8": "대체 URL 성공"}],
                            }
                        ]
                    }
                )

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {"videoId": "retry123", "targetLanguage": "ko"}
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "youtube-source-captions")
        self.assertEqual(response["segments"][0]["text"], "대체 URL 성공")
        self.assertTrue(any("www.youtube.com/api/timedtext" in url for url in calls))

    def test_youtube_captions_reports_rate_limit_when_track_fetch_is_limited(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_fetch_urls = main.fetch_caption_segments_from_urls
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        main.fetch_youtube_caption_tracks = lambda _video_id: [
            {
                "baseUrl": "https://www.youtube.com/api/timedtext?v=limited123&lang=en",
                "languageCode": "en",
                "isTranslatable": True,
            }
        ]
        main.fetch_caption_segments_from_urls = lambda *_args: (
            [],
            RuntimeError("HTTP Error 429: Too Many Requests"),
        )
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "en",
            False,
            RuntimeError("HTTP Error 429: Too Many Requests"),
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "limited123",
                    "targetLanguage": "ko",
                    "allowFallback": False,
                }
            )
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_caption_segments_from_urls = original_fetch_urls
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "youtube-caption-rate-limited")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"], [])
        self.assertIn("429", response["message"])

    def test_caption_cache_does_not_pin_rate_limited_caption_response(self):
        original_httpx = main.httpx
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_fetch_urls = main.fetch_caption_segments_from_urls
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments
        fetch_count = 0

        def fake_fetch_tracks(_video_id):
            nonlocal fetch_count
            fetch_count += 1
            return [
                {
                    "baseUrl": "https://www.youtube.com/api/timedtext?v=cache-native&lang=en",
                    "languageCode": "en",
                    "isTranslatable": True,
                }
            ]

        main.httpx = object()
        main.fetch_youtube_caption_tracks = fake_fetch_tracks
        main.fetch_caption_segments_from_urls = lambda *_args: (
            [],
            RuntimeError("HTTP Error 429: Too Many Requests"),
        )
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "en",
            False,
            RuntimeError("HTTP Error 429: Too Many Requests"),
        )
        main.CAPTION_RESPONSE_CACHE.clear()

        try:
            payload = {
                "videoId": "cache-rate-limited",
                "targetLanguage": "ko",
                "allowFallback": False,
            }
            first = load_translated_captions(payload)
            second = load_translated_captions(payload)
        finally:
            main.httpx = original_httpx
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_caption_segments_from_urls = original_fetch_urls
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp
            main.CAPTION_RESPONSE_CACHE.clear()

        self.assertEqual(fetch_count, 2)
        self.assertEqual(second["provider"], "youtube-caption-rate-limited")
        self.assertEqual(second["segments"], [])

    def test_caption_cache_does_not_pin_empty_native_caption_fallback(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments
        fetch_count = 0

        def fake_fetch_tracks(_video_id):
            nonlocal fetch_count
            fetch_count += 1
            return []

        main.fetch_youtube_caption_tracks = fake_fetch_tracks
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "",
            False,
            RuntimeError("yt-dlp-caption-track-unavailable"),
        )
        main.CAPTION_RESPONSE_CACHE.clear()

        try:
            payload = {
                "videoId": "cache-native-empty",
                "targetLanguage": "ko",
                "allowFallback": False,
            }
            first = load_translated_captions(payload)
            second = load_translated_captions(payload)
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp
            main.CAPTION_RESPONSE_CACHE.clear()

        self.assertEqual(fetch_count, 2)
        self.assertEqual(first["provider"], "youtube-native-captions")
        self.assertEqual(second["provider"], "youtube-native-captions")
        self.assertEqual(second["segments"], [])

    def test_yt_dlp_metadata_ignores_missing_video_formats_for_caption_only_fetches(self):
        captured_commands = []

        class FakeCompletedProcess:
            returncode = 0
            stdout = json.dumps({"id": "caption-only", "automatic_captions": {}})
            stderr = ""

        def fake_run(command, **_kwargs):
            captured_commands.append(command)
            return FakeCompletedProcess()

        original_commands = main.yt_dlp_commands
        original_run = main.subprocess.run
        main.yt_dlp_commands = lambda: [["yt-dlp"]]
        main.subprocess.run = fake_run

        try:
            metadata, error = main.fetch_yt_dlp_metadata("caption-only")
        finally:
            main.yt_dlp_commands = original_commands
            main.subprocess.run = original_run

        self.assertIsNone(error)
        self.assertEqual(metadata["id"], "caption-only")
        yt_dlp_command = next(
            command
            for command in captured_commands
            if isinstance(command, list) and "--dump-json" in command
        )
        self.assertIn("--ignore-no-formats", yt_dlp_command)

    def test_youtube_captions_reports_rate_limit_from_yt_dlp_metadata(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        main.fetch_youtube_caption_tracks = lambda _video_id: []
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [],
            "en",
            False,
            RuntimeError("HTTP Error 429: Too Many Requests"),
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "metadata123",
                    "targetLanguage": "ko",
                    "allowFallback": False,
                }
            )
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "youtube-caption-rate-limited")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"], [])

    def test_youtube_captions_uses_yt_dlp_when_youtube_caption_apis_fail(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        main.fetch_youtube_caption_tracks = lambda _video_id: []
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [
                {"start": 0, "end": 2.5, "text": "Hello from yt-dlp"},
                {"start": 2.5, "end": 5, "text": "Caption fallback works"},
            ],
            "en",
            False,
            None,
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "en",
                    "allowFallback": False,
                }
            )
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "yt-dlp-captions")
        self.assertEqual(response["segments"][0]["text"], "Hello from yt-dlp")
        self.assertEqual(response["sourceLanguage"], "en")

    def test_youtube_captions_uses_yt_dlp_when_track_fetch_is_rate_limited(self):
        original_fetch_tracks = main.fetch_youtube_caption_tracks
        original_transcript = main.fetch_transcript_api_segments
        original_yt_dlp = main.fetch_yt_dlp_caption_segments

        def raise_rate_limit(_video_id):
            raise RuntimeError("HTTP 429 Too Many Requests from watch page")

        main.fetch_youtube_caption_tracks = raise_rate_limit
        main.fetch_transcript_api_segments = lambda *_args: ([], "", False)
        main.fetch_yt_dlp_caption_segments = lambda *_args: (
            [{"start": 0, "end": 2.5, "text": "Recovered by yt-dlp"}],
            "en",
            False,
            None,
        )

        try:
            response = load_translated_captions(
                {
                    "videoId": "rate-limited-watch",
                    "targetLanguage": "en",
                    "allowFallback": False,
                }
            )
        finally:
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp

        self.assertEqual(response["provider"], "yt-dlp-captions")
        self.assertEqual(response["segments"][0]["text"], "Recovered by yt-dlp")
        self.assertEqual(response["sourceLanguage"], "en")

    def test_yt_dlp_caption_segments_falls_back_to_subtitle_file_download(self):
        original_metadata = main.fetch_yt_dlp_metadata
        original_url_fetch = main.fetch_caption_segments_from_urls
        original_file_fetch = main.fetch_yt_dlp_caption_file_segments

        main.fetch_yt_dlp_metadata = lambda _video_id: (
            {
                "automatic_captions": {
                    "en": [
                        {
                            "ext": "json3",
                            "url": "https://example.test/timedtext",
                        }
                    ]
                },
                "subtitles": {},
            },
            None,
        )
        main.fetch_caption_segments_from_urls = lambda *_args: (
            [],
            RuntimeError("429 Too Many Requests"),
        )
        main.fetch_yt_dlp_caption_file_segments = lambda *_args: (
            [{"start": 1, "end": 3, "text": "Downloaded by yt-dlp"}],
            "en",
            False,
            None,
        )

        try:
            segments, language, translated, error = main.fetch_yt_dlp_caption_segments(
                "abc123",
                "en",
            )
        finally:
            main.fetch_yt_dlp_metadata = original_metadata
            main.fetch_caption_segments_from_urls = original_url_fetch
            main.fetch_yt_dlp_caption_file_segments = original_file_fetch

        self.assertIsNone(error)
        self.assertEqual(language, "en")
        self.assertFalse(translated)
        self.assertEqual(segments[0]["text"], "Downloaded by yt-dlp")

    def test_yt_dlp_recovery_args_use_explicit_youtube_settings(self):
        env_updates = {
            "YT_DLP_JS_RUNTIME": r"node:C:\Program Files\nodejs\node.exe",
            "YOUTUBE_PO_TOKEN": "web.subs+TEST_TOKEN",
            "YOUTUBE_VISITOR_DATA": "TEST_VISITOR",
            "YOUTUBE_COOKIES_FILE": r"C:\captions\cookies.txt",
            "YOUTUBE_COOKIES_FROM_BROWSER": "edge",
            "YOUTUBE_PROXY_URL": "http://127.0.0.1:8888",
            "YT_DLP_ALLOW_REMOTE_COMPONENTS": "true",
        }
        original_env = {key: os.environ.get(key) for key in env_updates}
        os.environ.update(env_updates)

        try:
            args = main.yt_dlp_recovery_args()
            sensitive_args = main.yt_dlp_sensitive_recovery_args()
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertIn("--js-runtimes", args)
        self.assertIn(r"node:C:\Program Files\nodejs\node.exe", args)
        self.assertIn("--remote-components", args)
        self.assertIn("ejs:github", args)
        self.assertIn("--cookies", args)
        self.assertIn(r"C:\captions\cookies.txt", args)
        self.assertIn("--cookies-from-browser", args)
        self.assertIn("edge", args)
        self.assertNotIn("TEST_TOKEN", " ".join(args))
        self.assertNotIn("TEST_VISITOR", " ".join(args))
        self.assertNotIn("http://127.0.0.1:8888", args)
        self.assertIn("--proxy", sensitive_args)
        self.assertIn("http://127.0.0.1:8888", sensitive_args)
        self.assertIn("--extractor-args", sensitive_args)
        youtube_extractor_args = [
            sensitive_args[index + 1]
            for index, arg in enumerate(sensitive_args[:-1])
            if arg == "--extractor-args"
            and sensitive_args[index + 1].startswith("youtube:")
        ]
        self.assertTrue(youtube_extractor_args)
        self.assertIn("po_token=web.subs+TEST_TOKEN", youtube_extractor_args[0])
        self.assertIn("visitor_data=TEST_VISITOR", youtube_extractor_args[0])

    def test_caption_url_with_recovery_params_adds_subtitle_po_token(self):
        original_token = os.environ.get("YOUTUBE_PO_TOKEN")
        os.environ["YOUTUBE_PO_TOKEN"] = "web.subs+TEST_TOKEN"

        try:
            url = main.caption_url_with_recovery_params(
                "https://www.youtube.com/api/timedtext?v=abc123&lang=en"
            )
        finally:
            if original_token is None:
                os.environ.pop("YOUTUBE_PO_TOKEN", None)
            else:
                os.environ["YOUTUBE_PO_TOKEN"] = original_token

        query = dict(parse_qsl(urlparse(url).query, keep_blank_values=True))
        self.assertEqual(query["pot"], "TEST_TOKEN")
        self.assertEqual(query["potc"], "1")
        self.assertEqual(query["c"], "WEB")

    def test_caption_url_with_recovery_params_generates_video_bound_po_token(self):
        original_token = os.environ.get("YOUTUBE_PO_TOKEN")
        original_auto = os.environ.get("YOUTUBE_AUTO_SUBTITLE_PO_TOKEN")
        original_generate = main.generate_bgutil_subtitle_po_token
        os.environ.pop("YOUTUBE_PO_TOKEN", None)
        os.environ["YOUTUBE_AUTO_SUBTITLE_PO_TOKEN"] = "true"
        main.YOUTUBE_SUBTITLE_PO_TOKEN_CACHE.clear()
        main.generate_bgutil_subtitle_po_token = lambda video_id: (
            "GENERATED_TOKEN" if video_id == "abc123" else ""
        )

        try:
            url = main.caption_url_with_recovery_params(
                "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                "abc123",
            )
        finally:
            main.generate_bgutil_subtitle_po_token = original_generate
            main.YOUTUBE_SUBTITLE_PO_TOKEN_CACHE.clear()
            if original_token is None:
                os.environ.pop("YOUTUBE_PO_TOKEN", None)
            else:
                os.environ["YOUTUBE_PO_TOKEN"] = original_token
            if original_auto is None:
                os.environ.pop("YOUTUBE_AUTO_SUBTITLE_PO_TOKEN", None)
            else:
                os.environ["YOUTUBE_AUTO_SUBTITLE_PO_TOKEN"] = original_auto

        query = dict(parse_qsl(urlparse(url).query, keep_blank_values=True))
        self.assertEqual(query["pot"], "GENERATED_TOKEN")
        self.assertEqual(query["potc"], "1")
        self.assertEqual(query["c"], "WEB")

    def test_sanitized_caption_exception_never_exposes_upstream_details(self):
        error = main.sanitized_caption_exception(
            RuntimeError(
                "yt-dlp --extractor-args youtube:po_token=SECRET;visitor_data=VISITOR "
                "--proxy http://user:password@proxy.example "
                "https://www.youtube.com/api/timedtext?v=abc&pot=QUERY_SECRET"
            )
        )

        self.assertEqual(str(error), "youtube-caption-upstream-failed")

    def test_yt_dlp_secrets_are_loaded_from_a_private_config_not_argv(self):
        captured: dict[str, object] = {}

        def fake_run(command, **_kwargs):
            captured["command"] = list(command)
            captured["environment"] = dict(_kwargs["env"])
            config_index = command.index("--config-locations")
            config_path = command[config_index + 1]
            captured["config_path"] = config_path
            with open(config_path, encoding="utf-8") as config_file:
                captured["config"] = config_file.read()
            return main.subprocess.CompletedProcess(
                command,
                0,
                stdout="{}",
                stderr="",
            )

        env_updates = {
            "YOUTUBE_PO_TOKEN": "web.subs+PO_SECRET",
            "YOUTUBE_VISITOR_DATA": "VISITOR_SECRET",
            "YOUTUBE_PROXY_URL": "http://user:PROXY_SECRET@proxy.example",
            "OPENAI_API_KEY": "OPENAI_SHOULD_NOT_REACH_YT_DLP",
        }
        with mock.patch.dict(os.environ, env_updates, clear=False):
            with mock.patch.object(main, "yt_dlp_commands", return_value=[["yt-dlp"]]):
                with mock.patch.object(main.subprocess, "run", side_effect=fake_run):
                    metadata, error = main.fetch_yt_dlp_metadata("abc123")

        self.assertEqual(metadata, {})
        self.assertIsNone(error)
        command_text = " ".join(captured["command"])
        self.assertNotIn("PO_SECRET", command_text)
        self.assertNotIn("VISITOR_SECRET", command_text)
        self.assertNotIn("PROXY_SECRET", command_text)
        self.assertIn("PO_SECRET", captured["config"])
        self.assertIn("VISITOR_SECRET", captured["config"])
        self.assertIn("PROXY_SECRET", captured["config"])
        self.assertNotIn("OPENAI_API_KEY", captured["environment"])
        self.assertFalse(os.path.exists(captured["config_path"]))

    def test_bgutil_proxy_credentials_are_passed_by_environment_not_argv(self):
        captured: dict[str, object] = {}

        def fake_run(command, **kwargs):
            captured["command"] = list(command)
            captured["env"] = dict(kwargs["env"])
            return main.subprocess.CompletedProcess(
                command,
                0,
                stdout='{"poToken":"GENERATED_TOKEN"}\n',
                stderr="",
            )

        with tempfile.TemporaryDirectory() as server_home:
            build_directory = os.path.join(server_home, "build")
            os.makedirs(build_directory)
            with open(
                os.path.join(build_directory, "generate_once.js"),
                "w",
                encoding="utf-8",
            ) as script_file:
                script_file.write("// fixture\n")

            proxy_url = "http://user:BGUTIL_SECRET@proxy.example"
            with mock.patch.dict(
                os.environ,
                {"YOUTUBE_PROXY_URL": proxy_url},
                clear=False,
            ):
                with mock.patch.object(
                    main,
                    "youtube_bgutil_server_home",
                    return_value=server_home,
                ):
                    with mock.patch.object(
                        main,
                        "youtube_node_runtime_path",
                        return_value="node",
                    ):
                        with mock.patch.object(
                            main.subprocess,
                            "run",
                            side_effect=fake_run,
                        ):
                            token = main.generate_bgutil_subtitle_po_token("abc123")

        self.assertEqual(token, "GENERATED_TOKEN")
        self.assertNotIn("BGUTIL_SECRET", " ".join(captured["command"]))
        self.assertEqual(captured["env"]["HTTPS_PROXY"], proxy_url)
        self.assertEqual(captured["env"]["HTTP_PROXY"], proxy_url)

    def test_bgutil_subprocess_can_initialize_its_managed_cache(self):
        node_path = shutil.which("node")
        self.assertIsNotNone(node_path)

        with tempfile.TemporaryDirectory() as cache_home:
            with mock.patch.dict(
                os.environ,
                {"HOME": cache_home, "XDG_CACHE_HOME": cache_home},
                clear=False,
            ):
                environment = main.youtube_subprocess_environment()

            cache_directory = os.path.join(
                cache_home,
                ".cache",
                "bgutil-ytdlp-pot-provider",
            )
            result = subprocess.run(
                [
                    node_path,
                    "-e",
                    (
                        "const fs = require('node:fs'); "
                        "const path = require('node:path'); "
                        "fs.mkdirSync(path.join(process.env.HOME, '.cache', "
                        "'bgutil-ytdlp-pot-provider'), { recursive: true });"
                    ),
                ],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(os.path.isdir(cache_directory))
            self.assertEqual(environment["XDG_CACHE_HOME"], cache_home)

    def test_fetch_caption_segments_uses_recovery_url_and_proxy(self):
        class FakeResponse:
            text = json.dumps(
                {
                    "events": [
                        {
                            "tStartMs": 0,
                            "dDurationMs": 1000,
                            "segs": [{"utf8": "Recovered caption"}],
                        }
                    ]
                }
            )

            @staticmethod
            def json():
                return json.loads(FakeResponse.text)

            @staticmethod
            def raise_for_status():
                return None

        class FakeHttpx:
            calls: list[tuple[str, dict[str, object]]] = []

            @staticmethod
            def get(url, **kwargs):
                FakeHttpx.calls.append((url, kwargs))
                return FakeResponse()

        env_updates = {
            "YOUTUBE_PO_TOKEN": "web.subs+TEST_TOKEN",
            "YOUTUBE_PROXY_URL": "http://127.0.0.1:8888",
        }
        original_env = {key: os.environ.get(key) for key in env_updates}
        original_httpx = main.httpx
        os.environ.update(env_updates)
        main.httpx = FakeHttpx

        try:
            segments, error = main.fetch_caption_segments_from_urls(
                ["https://www.youtube.com/api/timedtext?v=abc123&lang=en"],
                "abc123",
            )
        finally:
            main.httpx = original_httpx
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertIsNone(error)
        self.assertEqual(segments[0]["text"], "Recovered caption")
        called_url, kwargs = FakeHttpx.calls[0]
        query = dict(parse_qsl(urlparse(called_url).query, keep_blank_values=True))
        self.assertEqual(query["pot"], "TEST_TOKEN")
        self.assertEqual(query["potc"], "1")
        self.assertEqual(query["c"], "WEB")
        self.assertEqual(kwargs["proxy"], "http://127.0.0.1:8888")

    def test_yt_dlp_caption_candidate_prefers_source_url_when_openai_can_translate(self):
        metadata = {
            "automatic_captions": {
                "en": [
                    {
                        "ext": "json3",
                        "url": "https://www.youtube.com/api/timedtext?lang=ko&tlang=en",
                    }
                ],
                "ko": [
                    {
                        "ext": "json3",
                        "url": "https://www.youtube.com/api/timedtext?lang=ko",
                    }
                ],
            },
            "subtitles": {},
        }

        candidate = main.choose_yt_dlp_caption_candidate(
            metadata,
            "en",
            prefer_source_captions=True,
        )

        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["sourceLanguage"], "ko")
        self.assertFalse(candidate["translated"])
        self.assertNotIn("tlang=", candidate["url"])

    def test_yt_dlp_caption_candidate_prefers_non_target_source_language(self):
        metadata = {
            "automatic_captions": {
                "ko": [
                    {
                        "ext": "json3",
                        "url": "https://www.youtube.com/api/timedtext?lang=ko",
                    }
                ],
                "en": [
                    {
                        "ext": "json3",
                        "url": "https://www.youtube.com/api/timedtext?lang=en",
                    }
                ],
            },
            "subtitles": {},
        }

        candidate = main.choose_yt_dlp_caption_candidate(
            metadata,
            "ko",
            prefer_source_captions=True,
        )

        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["sourceLanguage"], "en")
        self.assertFalse(candidate["translated"])

    def test_caption_track_prefers_translatable_source_when_openai_can_translate(self):
        tracks = [
            {
                "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=ko",
                "languageCode": "ko",
                "isTranslatable": False,
            },
            {
                "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=en",
                "languageCode": "en",
                "isTranslatable": True,
            },
        ]

        track = main.choose_caption_track(
            tracks,
            "ko",
            prefer_source_captions=True,
        )

        self.assertEqual(track["languageCode"], "en")

    def test_parse_timedtext_response_accepts_webvtt_from_yt_dlp(self):
        class FakeResponse:
            text = """WEBVTT

00:00:01.000 --> 00:00:03.500
First subtitle line

00:00:03.500 --> 00:00:05.000
Second subtitle line
"""

            @staticmethod
            def json():
                raise ValueError("not json")

        segments = main.parse_timedtext_response(FakeResponse())

        self.assertEqual(
            segments,
            [
                {"start": 1.0, "end": 3.5, "text": "First subtitle line"},
                {"start": 3.5, "end": 5.0, "text": "Second subtitle line"},
            ],
        )

    def test_youtube_captions_translates_source_segments_without_youtube_tlang_when_openai_ready(self):
        calls = []
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=abc123&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **kwargs):
                calls.append(url)

                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                if "tlang=ko" in url:
                    raise RuntimeError("translated track rate limited")

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 0,
                                "dDurationMs": 1500,
                                "segs": [{"utf8": "Hello React learners"}],
                            },
                            {
                                "tStartMs": 1500,
                                "dDurationMs": 1500,
                                "segs": [{"utf8": "Server state changes often"}],
                            },
                        ]
                    }
                )

        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "translations": [
                                            "리액트 학습자 여러분 안녕하세요",
                                            "서버 상태는 자주 바뀝니다",
                                        ]
                                    },
                                    ensure_ascii=False,
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "fallback should not be used",
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-caption-translation")
        self.assertEqual(response["segments"][0]["text"], "리액트 학습자 여러분 안녕하세요")
        self.assertEqual(response["segments"][0]["start"], 0)
        self.assertEqual(response["segments"][1]["end"], 3.0)
        self.assertFalse(any("tlang=ko" in url for url in calls))

    def test_youtube_captions_translates_only_requested_caption_window(self):
        calls = []
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=window-video&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **kwargs):
                calls.append(url)

                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": index * 1000,
                                "dDurationMs": 1000,
                                "segs": [{"utf8": f"caption {index}"}],
                            }
                            for index in range(200)
                        ]
                    }
                )

        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**kwargs):
                        payload = json.loads(kwargs["messages"][1]["content"])
                        message = type(
                            "Message",
                            (),
                            {
                                "content": json.dumps(
                                    {
                                        "translations": [
                                            f"translated {index}"
                                            for index in range(payload["requiredCount"])
                                        ]
                                    }
                                )
                            },
                        )()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = FakeOpenAI
        main.CAPTION_RESPONSE_CACHE.clear()
        os.environ["OPENAI_API_KEY"] = "test-key"

        try:
            response = load_translated_captions(
                {
                    "videoId": "window-video",
                    "targetLanguage": "ko",
                    "startSeconds": 40,
                    "endSeconds": 50,
                    "fallbackText": "fallback should not be used",
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            main.CAPTION_RESPONSE_CACHE.clear()
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "openai-caption-translation")
        self.assertEqual(len(response["segments"]), 10)
        self.assertEqual(response["segments"][0]["start"], 40)
        self.assertEqual(response["segments"][-1]["end"], 50)
        self.assertEqual(response["segments"][0]["text"], "translated 0")
        self.assertFalse(any("tlang=ko" in url for url in calls))

    def test_youtube_captions_returns_source_segments_when_translation_unavailable(self):
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=abc123&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                if "tlang=ko" in url:
                    raise RuntimeError("translated track rate limited")

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 0,
                                "dDurationMs": 1500,
                                "segs": [{"utf8": "Hello React learners"}],
                            },
                            {
                                "tStartMs": 1500,
                                "dDurationMs": 1500,
                                "segs": [{"utf8": "Server state changes often"}],
                            },
                        ]
                    }
                )

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "allowFallback": False,
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is not None:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "youtube-source-captions")
        self.assertEqual(response["language"], "ko")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertFalse(response["translated"])
        self.assertEqual(len(response["segments"]), 2)
        self.assertEqual(response["segments"][0]["text"], "Hello React learners")
        self.assertEqual(response["segments"][1]["end"], 3.0)

    def test_youtube_captions_uses_transcript_api_when_timedtext_is_limited(self):
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=abc123&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            text = (
                "<script>var ytInitialPlayerResponse = "
                + json.dumps(player_response)
                + ";</script>"
            )

            def raise_for_status(self):
                return None

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                if "watch" in url:
                    return FakeResponse()

                raise RuntimeError("timedtext rate limited")

        class FakeTranscript:
            language_code = "en"

            def translate(self, language):
                self.language_code = language
                return self

            def fetch(self):
                return [
                    {
                        "text": "리액트 학습자 여러분 안녕하세요",
                        "start": 1.0,
                        "duration": 2.5,
                    }
                ]

        class FakeTranscriptList:
            @staticmethod
            def find_transcript(languages):
                if languages == ["ko"]:
                    raise RuntimeError("no Korean transcript")

                return FakeTranscript()

        class FakeTranscriptApi:
            @staticmethod
            def list_transcripts(video_id):
                self = FakeTranscriptApi()
                self.video_id = video_id
                return FakeTranscriptList()

        original_httpx = main.httpx
        original_transcript_api = main.YouTubeTranscriptApi
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.YouTubeTranscriptApi = FakeTranscriptApi
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "fallback should not be used",
                }
            )
        finally:
            main.httpx = original_httpx
            main.YouTubeTranscriptApi = original_transcript_api
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "youtube-transcript-api")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertTrue(response["translated"])
        self.assertEqual(response["segments"][0]["start"], 1.0)
        self.assertEqual(response["segments"][0]["end"], 3.5)
        self.assertEqual(response["segments"][0]["text"], "리액트 학습자 여러분 안녕하세요")

    def test_youtube_captions_supports_modern_transcript_api_instance(self):
        class FakeTranscript:
            language_code = "ko"

            @staticmethod
            def fetch():
                return [{"text": "이미 한국어 자막입니다", "start": 2, "duration": 1}]

        class FakeTranscriptList:
            @staticmethod
            def find_transcript(languages):
                self = FakeTranscriptList()
                self.languages = languages
                return FakeTranscript()

        class FakeTranscriptApi:
            def list(self, video_id):
                self.video_id = video_id
                return FakeTranscriptList()

        original_httpx = main.httpx
        original_transcript_api = main.YouTubeTranscriptApi
        main.httpx = None
        main.YouTubeTranscriptApi = FakeTranscriptApi

        try:
            response = load_translated_captions(
                {
                    "videoId": "modern123",
                    "targetLanguage": "ko",
                    "fallbackText": "fallback should not be used",
                }
            )
        finally:
            main.httpx = original_httpx
            main.YouTubeTranscriptApi = original_transcript_api

        self.assertEqual(response["provider"], "youtube-transcript-api")
        self.assertEqual(response["sourceLanguage"], "ko")
        self.assertFalse(response["translated"])
        self.assertEqual(response["segments"][0]["text"], "이미 한국어 자막입니다")

    @unittest.skip("Stored summaries are no longer aligned to source timing as captions.")
    def test_youtube_captions_uses_source_timing_for_saved_notes_without_openai_key(self):
        player_response = {
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "baseUrl": "https://signed.example/timedtext?v=abc123&lang=en",
                            "languageCode": "en",
                            "isTranslatable": True,
                        }
                    ]
                }
            }
        }

        class FakeResponse:
            def __init__(self, *, text="", data=None):
                self.text = text
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                if "watch" in url:
                    return FakeResponse(
                        text=(
                            "<script>var ytInitialPlayerResponse = "
                            + json.dumps(player_response)
                            + ";</script>"
                        )
                    )

                if "tlang=ko" in url:
                    raise RuntimeError("translated track rate limited")

                return FakeResponse(
                    data={
                        "events": [
                            {
                                "tStartMs": 5000,
                                "dDurationMs": 2000,
                                "segs": [{"utf8": "Hello React learners"}],
                            },
                            {
                                "tStartMs": 7000,
                                "dDurationMs": 3000,
                                "segs": [{"utf8": "Server state changes often"}],
                            },
                        ]
                    }
                )

        original_httpx = main.httpx
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.httpx = FakeHttpx
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)

        try:
            response = load_translated_captions(
                {
                    "videoId": "abc123",
                    "targetLanguage": "ko",
                    "fallbackText": "리액트 서버 상태를 학습합니다. 캐시와 무효화를 함께 봅니다.",
                }
            )
        finally:
            main.httpx = original_httpx
            main.OpenAI = original_openai
            if original_key is not None:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["provider"], "timed-local-fallback")
        self.assertEqual(response["sourceLanguage"], "en")
        self.assertEqual(response["segments"][0]["start"], 5.0)
        self.assertEqual(response["segments"][1]["end"], 10.0)
        self.assertIn("리액트", response["segments"][0]["text"])

    def test_embedding_response_uses_text_embedding_3_small_without_hash_fallback(self):
        original_openai = embeddings_module.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        captured = {}

        class FakeEmbeddings:
            def create(self, **kwargs):
                captured.update(kwargs)
                item = type("EmbeddingItem", (), {"embedding": [0.01] * 1536})()
                return type("EmbeddingResponse", (), {"data": [item]})()

        class FakeClient:
            embeddings = FakeEmbeddings()

        os.environ["OPENAI_API_KEY"] = "sk-test"
        embeddings_module.OpenAI = lambda **_kwargs: FakeClient()
        try:
            response = main.create_embedding_response(
                {"input": "PostgreSQL isolation"}
            )
        finally:
            embeddings_module.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(captured["model"], "text-embedding-3-small")
        self.assertEqual(captured["dimensions"], 1536)
        self.assertEqual(response["dimensions"], 1536)
        self.assertEqual(len(response["embedding"]), 1536)
        self.assertNotIn("hash", json.dumps(response).lower())

    def test_embedding_response_reuses_cached_vector_and_reports_cost(self):
        original_openai = embeddings_module.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        embeddings_module.EMBEDDING_RESPONSE_CACHE.clear()

        class FakeEmbeddings:
            calls = 0

            def create(self, **_kwargs):
                FakeEmbeddings.calls += 1
                item = type("EmbeddingItem", (), {"embedding": [0.01] * 1536})()
                usage = type("EmbeddingUsage", (), {"prompt_tokens": 25})()
                return type(
                    "EmbeddingResponse",
                    (),
                    {"data": [item], "usage": usage},
                )()

        class FakeClient:
            embeddings = FakeEmbeddings()

        os.environ["OPENAI_API_KEY"] = "sk-test"
        embeddings_module.OpenAI = lambda **_kwargs: FakeClient()
        try:
            cold = main.create_embedding_response({"input": "격리 수준"})
            warm = main.create_embedding_response({"input": "격리 수준"})
        finally:
            embeddings_module.OpenAI = original_openai
            embeddings_module.EMBEDDING_RESPONSE_CACHE.clear()
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(FakeEmbeddings.calls, 1)
        self.assertFalse(cold["cacheHit"])
        self.assertTrue(warm["cacheHit"])
        self.assertEqual(cold["inputTokens"], 25)
        self.assertEqual(warm["estimatedCostUsd"], 0)
        self.assertGreater(cold["estimatedCostUsd"], 0)

    def test_embedding_response_fails_explicitly_without_provider_credentials(self):
        original_key = os.environ.pop("OPENAI_API_KEY", None)
        try:
            with self.assertRaisesRegex(
                embeddings_module.EmbeddingProviderUnavailable,
                "Embedding provider is unavailable",
            ):
                main.create_embedding_response({"input": "no fallback"})
        finally:
            if original_key is not None:
                os.environ["OPENAI_API_KEY"] = original_key

    def test_agent_stops_with_playlist_and_trace(self):
        original_lookup = main.lookup_youtube
        main.lookup_youtube = lambda _payload: {
            "provider": "youtube-test",
            "summary": "테스트 영상",
            "videos": [
                {
                    "title": "React hooks",
                    "sourceUrl": "https://youtu.be/hooks",
                    "thumbnailUrl": "https://i.ytimg.com/vi/hooks/hqdefault.jpg",
                    "provider": "youtube-test",
                    "summary": "Hooks for beginners",
                }
            ],
        }
        try:
            response = build_study_plan(
                {
                    "goal": "React hooks를 공부하고 싶어",
                    "language": "ko",
                    "interests": ["frontend"],
                }
            )
        finally:
            main.lookup_youtube = original_lookup

        self.assertLessEqual(len(response["trace"]), 4)
        self.assertGreaterEqual(len(response["recommendations"]), 1)
        self.assertIn("playlistTitle", response)


if __name__ == "__main__":
    unittest.main()
