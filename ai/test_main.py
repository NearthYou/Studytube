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

if __name__ == "__main__":
    unittest.main()
