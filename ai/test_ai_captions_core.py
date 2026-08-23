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

if __name__ == "__main__":
    unittest.main()
