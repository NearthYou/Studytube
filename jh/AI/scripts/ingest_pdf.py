from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

from app.rag.chunker import build_chunks_from_pdf  # noqa: E402
from app.rag.openai_gateway import OpenAIGateway  # noqa: E402
from app.rag.store import PgVectorStore  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest pet behavior RAG PDF.")
    parser.add_argument(
        "--pdf",
        default=str(REPO_ROOT / "docs" / "pet_behavior_rag_sourcebook_50p.pdf"),
    )
    parser.add_argument(
        "--out",
        default=str(ROOT / "data" / "generated" / "rag_chunks.json"),
    )
    parser.add_argument("--write-db", action="store_true")
    parser.add_argument("--batch-size", type=int, default=64)
    return parser.parse_args()


def main() -> None:
    load_dotenv(ROOT / ".env")
    args = parse_args()
    chunks = build_chunks_from_pdf(args.pdf)
    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps([chunk.model_dump() for chunk in chunks], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {len(chunks)} chunks to {output_path}")

    if not args.write_db:
        return

    gateway = OpenAIGateway()
    store = PgVectorStore()

    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is required for --write-db.")

    if not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is required for --write-db.")

    for start in range(0, len(chunks), args.batch_size):
        batch = chunks[start : start + args.batch_size]
        embeddings = gateway.embed_texts([chunk.chunk_text for chunk in batch])
        store.upsert_chunks(batch, embeddings)
        print(f"inserted chunks {start + 1}-{start + len(batch)}")


if __name__ == "__main__":
    main()
