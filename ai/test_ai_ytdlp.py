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
        original_generate = ytdlp_captions_module.generate_bgutil_subtitle_po_token
        os.environ.pop("YOUTUBE_PO_TOKEN", None)
        os.environ["YOUTUBE_AUTO_SUBTITLE_PO_TOKEN"] = "true"
        main.YOUTUBE_SUBTITLE_PO_TOKEN_CACHE.clear()
        ytdlp_captions_module.generate_bgutil_subtitle_po_token = lambda video_id: (
            "GENERATED_TOKEN" if video_id == "abc123" else ""
        )

        try:
            url = main.caption_url_with_recovery_params(
                "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
                "abc123",
            )
        finally:
            ytdlp_captions_module.generate_bgutil_subtitle_po_token = original_generate
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
                    ytdlp_captions_module,
                    "youtube_bgutil_server_home",
                    return_value=server_home,
                ):
                    with mock.patch.object(
                        ytdlp_captions_module,
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

if __name__ == "__main__":
    unittest.main()
