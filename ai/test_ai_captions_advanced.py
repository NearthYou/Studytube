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

if __name__ == "__main__":
    unittest.main()
