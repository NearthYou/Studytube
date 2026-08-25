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
    def test_learning_overview_returns_only_validated_summary_content(self):
        class FakeOpenAI:
            def __init__(self):
                self.chat = self.Chat()

            class Chat:
                def __init__(self):
                    self.completions = self.Completions()

                class Completions:
                    @staticmethod
                    def create(**_kwargs):
                        content = {
                            "overview": "영상은 학습 습관을 만들 때 작은 반복을 먼저 설계해야 하는 이유를 설명합니다. 무리한 목표보다 다시 시작하기 쉬운 환경이 중요하다는 흐름으로 이어집니다.",
                            "chapters": [
                                {"startSeconds": 0, "endSeconds": 20, "title": "작게 시작하기", "body": "첫 구간은 부담을 낮추는 방법을 설명합니다."},
                                {"startSeconds": 20, "endSeconds": 40, "title": "반복 만들기", "body": "두 번째 구간은 반복 가능한 기준을 다룹니다."},
                                {"startSeconds": 40, "endSeconds": 60, "title": "다시 이어가기", "body": "마지막 구간은 중단 뒤 복귀하는 방법을 설명합니다."},
                            ],
                            "takeaways": ["작게 시작한다", "반복 가능한 기준을 정한다"],
                        }
                        message = type("Message", (), {"content": json.dumps(content, ensure_ascii=False)})()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = FakeOpenAI
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            response = main.build_youtube_summary({
                "responseShape": "learning-overview",
                "videoId": "study123",
                "coverage": {"scope": "study_range", "startSeconds": 0, "endSeconds": 60},
                "segments": [
                    {"start": 0, "end": 20, "text": "Start with a small habit."},
                    {"start": 20, "end": 40, "text": "Make repetition easy."},
                    {"start": 40, "end": 60, "text": "Return after a missed day."},
                ],
            })
        finally:
            main.OpenAI = original_openai
            if original_key is None:
                os.environ.pop("OPENAI_API_KEY", None)
            else:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response["status"], "ready")
        self.assertEqual(len(response["summary"]["chapters"]), 3)
        self.assertNotIn("sections", response)

    def test_segment_explanation_never_falls_back_to_generic_copy(self):
        original_openai = main.OpenAI
        original_key = os.environ.get("OPENAI_API_KEY")
        main.OpenAI = None
        os.environ.pop("OPENAI_API_KEY", None)
        try:
            response = main.build_youtube_summary({
                "responseShape": "segment-explanation",
                "source": "Take it one step at a time.",
                "korean": "한 번에 한 단계씩 해보세요.",
                "startSeconds": 10,
                "endSeconds": 14,
            })
        finally:
            main.OpenAI = original_openai
            if original_key is not None:
                os.environ["OPENAI_API_KEY"] = original_key

        self.assertEqual(response, {"status": "failed", "errorCode": "EXPLANATION_UNAVAILABLE"})

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
              "badges":[{"metadataBadgeRenderer":{"label":"CC"}}],
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

    def test_youtube_page_search_uses_videos_without_caption_badges_as_fallback(self):
        class FakeResponse:
            text = """
            <script>
            var ytInitialData = {"contents":{"videoRenderer":{
              "videoId":"noCaption1",
              "title":{"runs":[{"text":"No caption lesson"}]},
              "ownerText":{"runs":[{"text":"Channel"}]},
              "thumbnail":{"thumbnails":[]}
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
            videos = youtube_search_module.search_youtube_page("lesson", 5)
        finally:
            youtube_search_module.httpx = original_httpx

        self.assertEqual([video["videoId"] for video in videos], ["noCaption1"])

    def test_youtube_page_search_keeps_captioned_videos_first(self):
        class FakeResponse:
            text = """
            <script>
            var ytInitialData = {"contents":[
              {"videoRenderer":{
                "videoId":"noCaption1",
                "title":{"runs":[{"text":"No caption lesson"}]},
                "ownerText":{"runs":[{"text":"Channel"}]},
                "thumbnail":{"thumbnails":[]}
              }},
              {"videoRenderer":{
                "videoId":"captioned1",
                "title":{"runs":[{"text":"Captioned lesson"}]},
                "ownerText":{"runs":[{"text":"Channel"}]},
                "badges":[{"metadataBadgeRenderer":{"label":"CC"}}],
                "thumbnail":{"thumbnails":[]}
              }}
            ]};
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
            videos = youtube_search_module.search_youtube_page("lesson", 5)
        finally:
            youtube_search_module.httpx = original_httpx

        self.assertEqual(
            [video["videoId"] for video in videos],
            ["captioned1", "noCaption1"],
        )

    def test_youtube_url_lookup_uses_public_description_when_captions_are_missing(self):
        class FakeResponse:
            def __init__(self, *, data=None, text=""):
                self._data = data
                self.text = text

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **_kwargs):
                if "oembed" in url:
                    return FakeResponse(
                        data={
                            "title": "중국어 인사 표현",
                            "author_name": "언어 교실",
                            "thumbnail_url": "https://img.example/lesson.jpg",
                        }
                    )
                return FakeResponse(
                    text='var ytInitialPlayerResponse = {"videoDetails":{"shortDescription":"아침과 저녁 인사 표현을 예문으로 배웁니다.","lengthSeconds":"125"}};'
                )

        original_httpx = youtube_search_module.httpx
        youtube_search_module.httpx = FakeHttpx
        try:
            result = youtube_search_module.lookup_youtube(
                {"url": "https://www.youtube.com/watch?v=abc123def45"}
            )
        finally:
            youtube_search_module.httpx = original_httpx

        self.assertEqual(
            result["videos"][0]["summary"],
            "아침과 저녁 인사 표현을 예문으로 배웁니다.",
        )
        self.assertEqual(result["videos"][0]["durationLabel"], "2:05")

if __name__ == "__main__":
    unittest.main()
