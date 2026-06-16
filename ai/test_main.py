import json
import os
import time
import unittest
from urllib.parse import parse_qsl, urlparse

import main
from main import (
    build_study_plan,
    handle_mcp_request,
    load_translated_captions,
    rag_recommend,
)


class AiServiceTest(unittest.TestCase):
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
        original_batch_size = main.CAPTION_TRANSLATION_BATCH_SIZE
        original_translate_batch = main.translate_caption_batch

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
        main.CAPTION_TRANSLATION_BATCH_SIZE = 2
        main.translate_caption_batch = fake_translate_batch

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
            main.CAPTION_TRANSLATION_BATCH_SIZE = original_batch_size
            main.translate_caption_batch = original_translate_batch
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
        self.assertIn("00:00 첫 번째 설명입니다.", transcript_section["body"])
        self.assertIn("00:04 두 번째 예제입니다.", transcript_section["body"])

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

        original_httpx = main.httpx
        main.httpx = FakeHttpx

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
            main.httpx = original_httpx

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
        main.httpx = FakeHttpx

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

    def test_caption_cache_keeps_rate_limited_caption_response(self):
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
            main.fetch_youtube_caption_tracks = original_fetch_tracks
            main.fetch_caption_segments_from_urls = original_fetch_urls
            main.fetch_transcript_api_segments = original_transcript
            main.fetch_yt_dlp_caption_segments = original_yt_dlp
            main.CAPTION_RESPONSE_CACHE.clear()

        self.assertEqual(fetch_count, 1)
        self.assertEqual(first, second)
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
        self.assertIn("--ignore-no-formats", captured_commands[0])

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
        self.assertIn("--proxy", args)
        self.assertIn("http://127.0.0.1:8888", args)
        self.assertIn("--extractor-args", args)
        youtube_extractor_args = [
            args[index + 1]
            for index, arg in enumerate(args[:-1])
            if arg == "--extractor-args" and args[index + 1].startswith("youtube:")
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

    def test_sanitized_caption_exception_redacts_po_token_query_values(self):
        error = main.sanitized_caption_exception(
            RuntimeError(
                "HTTP 429 for https://www.youtube.com/api/timedtext?v=abc&pot=SECRET&potc=1"
            )
        )

        self.assertNotIn("SECRET", str(error))
        self.assertIn("pot=[REDACTED]", str(error))

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

    def test_rag_recommend_returns_related_posts_and_summary(self):
        original_load_board_posts = main.load_board_posts
        main.load_board_posts = lambda: main.DEMO_POSTS

        try:
            response = rag_recommend({"query": "react hooks for beginners", "limit": 2})
        finally:
            main.load_board_posts = original_load_board_posts

        self.assertEqual(len(response["relatedPosts"]), 2)
        self.assertIn("react", response["answer"].lower())
        self.assertEqual(
            response["relatedPosts"][0]["evidenceSource"],
            "video_analysis",
        )
        self.assertTrue(response["relatedPosts"][0]["evidenceSnippet"])

    def test_rag_recommend_returns_empty_when_query_has_no_overlap(self):
        original_load_board_posts = main.load_board_posts
        main.load_board_posts = lambda: main.DEMO_POSTS

        try:
            response = rag_recommend({"query": "zzzz-no-board-topic", "limit": 2})
        finally:
            main.load_board_posts = original_load_board_posts

        self.assertEqual(response["relatedPosts"], [])
        self.assertIn("찾지 못했", response["answer"])

    def test_agent_stops_with_playlist_and_trace(self):
        response = build_study_plan(
            {
                "goal": "React hooks를 공부하고 싶어",
                "language": "ko",
                "interests": ["frontend"],
            }
        )

        self.assertLessEqual(len(response["trace"]), 4)
        self.assertGreaterEqual(len(response["recommendations"]), 1)
        self.assertIn("playlistTitle", response)


if __name__ == "__main__":
    unittest.main()
