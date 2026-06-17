from __future__ import annotations

import os

from openai import OpenAI

from app.rag.schemas import PetBehaviorQuestionRequest, RetrievedChunk, RiskLevel


class OpenAIGateway:
    def __init__(
        self,
        api_key: str | None = None,
        embedding_model: str | None = None,
        chat_model: str | None = None,
    ):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.embedding_model = (
            embedding_model
            or os.getenv("OPENAI_EMBEDDING_MODEL")
            or "text-embedding-3-large"
        )
        self.chat_model = chat_model or os.getenv("OPENAI_CHAT_MODEL") or "gpt-5.5"
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def is_configured(self) -> bool:
        return self.client is not None

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not self.client:
            raise RuntimeError("OPENAI_API_KEY is required for embedding generation.")

        response = self.client.embeddings.create(
            model=self.embedding_model,
            input=texts,
        )
        return [item.embedding for item in response.data]

    def generate_answer(
        self,
        request: PetBehaviorQuestionRequest,
        risk_level: RiskLevel,
        chunks: list[RetrievedChunk],
    ) -> str | None:
        if not self.client:
            return None

        system_prompt = (
            "You are Tail Talk's pet behavior safety assistant. "
            "Answer in Korean. Use only the retrieved context. "
            "Do not diagnose, prescribe medication, recommend punishment, dominance theory, "
            "or leash corrections. If red flags are present, prioritize veterinary guidance."
        )
        context = "\n\n".join(
            f"[{index + 1}] {chunk.source_title} ({chunk.source_year or 'n.d.'})\n{chunk.chunk_text}"
            for index, chunk in enumerate(chunks[:5])
        )
        conversation = format_conversation_history(request.context)
        user_prompt = (
            f"risk_level: {risk_level}\n"
            f"species: {request.species or 'unknown'}\n"
            f"question: {request.question}\n\n"
            f"recent_conversation:\n{conversation}\n\n"
            f"retrieved_context:\n{context or 'No retrieved context.'}\n\n"
            "Write a concise answer with: situation summary, possible factors, observation checklist, "
            "vet/expert consultation criteria, and sources."
        )

        response = self.client.responses.create(
            model=self.chat_model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.output_text


def format_conversation_history(context: dict | None) -> str:
    if not context:
        return "No previous conversation."

    history = context.get("history")

    if not isinstance(history, list):
        return "No previous conversation."

    lines: list[str] = []

    for item in history[-8:]:
        if not isinstance(item, dict):
            continue

        role = item.get("role")
        content = item.get("content")

        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue

        lines.append(f"{role}: {content[:500]}")

    return "\n".join(lines) if lines else "No previous conversation."
