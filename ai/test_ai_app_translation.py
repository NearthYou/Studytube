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

if __name__ == "__main__":
    unittest.main()
