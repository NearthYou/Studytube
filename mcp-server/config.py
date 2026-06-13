from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / "ai-back" / ".env", override=False)
load_dotenv(ROOT_DIR / "back" / ".env", override=False)

BACK_API_BASE_URL = os.getenv("BACK_API_BASE_URL", "http://127.0.0.1:3000/api")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:1234@localhost:5433/travel_app")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY") or os.getenv("GPT_API_KEY", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
