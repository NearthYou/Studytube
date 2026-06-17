from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

from app.rag.schemas import PdfPage


HEADER_PATTERN = re.compile(
    r"Tail Talk pet behavior RAG sourcebook(?: - [a-z ]+| v2 extension)?\s+\d+",
    re.IGNORECASE,
)


def clean_pdf_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = HEADER_PATTERN.sub(" ", text)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def load_pdf_pages(pdf_path: str | Path) -> list[PdfPage]:
    path = Path(pdf_path)

    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {path}")

    reader = PdfReader(str(path))
    pages: list[PdfPage] = []

    for index, page in enumerate(reader.pages, start=1):
        text = clean_pdf_text(page.extract_text() or "")

        if text:
            pages.append(PdfPage(page=index, text=text))

    return pages
