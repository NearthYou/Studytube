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
