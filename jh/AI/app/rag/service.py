from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

from app.rag.chunker import build_chunks_from_pdf, classify_species, classify_topic
from app.rag.openai_gateway import OpenAIGateway
from app.rag.safety import build_safety_result, classify_question_risk
from app.rag.schemas import (
    AnswerProvider,
    PetBehaviorQuestionRequest,
    PetBehaviorQuestionResponse,
    RagChunk,
    RagSource,
    RetrievedChunk,
    RiskLevel,
    Species,
)
from app.rag.store import LocalKeywordStore, PgVectorStore, load_chunks_from_json

logger = logging.getLogger(__name__)


class PetBehaviorRagService:
    def __init__(
        self,
        openai_gateway: OpenAIGateway | None = None,
        pg_store: PgVectorStore | None = None,
    ):
        self.openai_gateway = openai_gateway or OpenAIGateway()
        self.pg_store = pg_store or PgVectorStore()

    def answer_question(
        self, request: PetBehaviorQuestionRequest
    ) -> PetBehaviorQuestionResponse:
        question = " ".join(request.question.split())
        risk_level, triggered_rules = classify_question_risk(question)
        topic, topic_species = classify_topic(question)
        species = normalize_species(request.species) or topic_species

        if species == "unknown":
            species = classify_species(question)

        retrieved_chunks = self.retrieve(question, species, topic, risk_level)
        answer, answer_provider, fallback_used = self.generate_answer(
            request, risk_level, retrieved_chunks
        )
        safety = build_safety_result(risk_level, triggered_rules, answer)

        if safety.blockedTerms:
            answer = self.safe_template_answer(question, risk_level, retrieved_chunks)
            answer_provider = "local_template"
            fallback_used = True
            safety = build_safety_result(risk_level, triggered_rules, answer)

        return PetBehaviorQuestionResponse(
            riskLevel=risk_level,
            answer=answer,
            answerProvider=answer_provider,
            fallbackUsed=fallback_used,
            observationChecklist=build_observation_checklist(species, topic, risk_level),
            vetConsultCriteria=build_vet_consult_criteria(risk_level, topic),
            sources=dedupe_sources(retrieved_chunks),
            retrievedChunkIds=[chunk.chunk_id for chunk in retrieved_chunks],
            safety=safety,
        )

    def retrieve(
        self,
        question: str,
        species: Species,
        topic: str,
        risk_level: RiskLevel,
    ) -> list[RetrievedChunk]:
        if self.pg_store.is_configured() and self.openai_gateway.is_configured():
            try:
                query_embedding = self.openai_gateway.embed_texts([question])[0]
                results = self.pg_store.search(
                    query_embedding=query_embedding,
                    query=question,
                    species=species,
                    topic="common.safety.emergency_triage"
                    if risk_level == "emergency"
                    else topic,
                    limit=6,
                )

                if results:
                    return results
            except Exception:
                logger.warning(
                    "pgvector retrieval failed; falling back to local keyword search",
                    exc_info=True,
                )

        return LocalKeywordStore(load_local_chunks()).search(
            query=question,
            species=species,
            topic="common.safety.emergency_triage" if risk_level == "emergency" else topic,
            limit=6,
        )

    def generate_answer(
        self,
        request: PetBehaviorQuestionRequest,
        risk_level: RiskLevel,
        chunks: list[RetrievedChunk],
    ) -> tuple[str, AnswerProvider, bool]:
        try:
            generated = self.openai_gateway.generate_answer(request, risk_level, chunks)
        except Exception:
            logger.warning(
                "OpenAI answer generation failed; falling back to local template",
                exc_info=True,
            )
            generated = None

        if generated:
            return generated, "openai", False

        return (
            self.safe_template_answer(request.question, risk_level, chunks),
            "local_template",
            True,
        )

    def safe_template_answer(
        self, question: str, risk_level: RiskLevel, chunks: list[RetrievedChunk]
    ) -> str:
        if risk_level == "emergency":
            return (
                "말씀하신 상황에는 응급 또는 빠른 진료가 필요한 신호가 포함될 수 있습니다. "
                "온라인 답변만으로 안전 여부를 확정할 수 없으니, 배뇨 곤란, 피, 호흡 문제, "
                "발작, 심한 통증, 자해나 탈출 위험이 있다면 즉시 동물병원에 연락해 주세요. "
                "가능하면 증상이 시작된 시점, 먹거나 삼킨 물질, 배뇨/배변 변화, 영상이나 사진을 함께 기록해 두세요."
            )

        if risk_level == "vet_consult":
            return (
                "행동 문제처럼 보여도 통증, 질환, 스트레스 변화가 함께 있을 수 있습니다. "
                "진단이나 약물 여부는 수의사가 상태를 보고 판단해야 하므로 단정하지 않겠습니다. "
                "최근 변화 시점, 식욕과 활동량, 배뇨/배변, 특정 트리거, 물림 위험을 기록하고 "
                "필요하면 동물병원이나 행동 전문가와 상담해 주세요."
            )

        source_hint = ""

        if chunks:
            source_hint = f" 참고 근거로는 {chunks[0].source_title}를 우선 확인했습니다."

        return (
            "현재 질문은 환경과 행동 맥락을 함께 살펴보는 것이 좋습니다. "
            "최근 변화, 행동이 나타나는 시간과 장소, 보호자의 반응, 동물의 회피나 긴장 신호를 기록해 보세요. "
            "강압이나 처벌보다는 안전 거리, 선택권, 보상 기반 접근을 우선 권장합니다."
            + source_hint
        )


@lru_cache(maxsize=1)
def load_local_chunks() -> list[RagChunk]:
    ai_root = Path(__file__).resolve().parents[2]
    repo_root = ai_root.parent
    json_path = ai_root / "data" / "generated" / "rag_chunks.json"
    pdf_path = repo_root / "docs" / "pet_behavior_rag_sourcebook_50p.pdf"
    chunks = load_chunks_from_json(json_path)

    if chunks:
        return chunks

    if pdf_path.exists():
        return build_chunks_from_pdf(pdf_path)

    return []


def normalize_species(species: Species | None) -> Species | None:
    if not species:
        return None
    return species


def dedupe_sources(chunks: list[RetrievedChunk]) -> list[RagSource]:
    seen: set[tuple[str, int | None]] = set()
    sources: list[RagSource] = []

    for chunk in chunks:
        key = (chunk.source_title, chunk.source_year)

        if key in seen:
            continue

        seen.add(key)
        sources.append(
            RagSource(
                title=chunk.source_title,
                year=chunk.source_year,
                pmid=chunk.pmid,
                pmcid=chunk.pmcid,
                url=chunk.url,
                sourceType="rag_source",
            )
        )

    return sources[:5]


def build_observation_checklist(
    species: Species, topic: str, risk_level: RiskLevel
) -> list[str]:
    common = [
        "언제 시작됐는지와 갑작스러운 변화인지 기록하기",
        "식욕, 활동량, 배뇨/배변, 수면 변화 확인하기",
        "행동이 나타나는 장소, 사람, 소리, 거리 같은 트리거 적기",
    ]

    if species == "cat":
        common.extend(
            [
                "화장실 위치, 크기, 모래 종류, 청소 빈도 확인하기",
                "은신 시간, 그루밍 변화, 특정 부위 접촉 회피 확인하기",
            ]
        )
    elif species == "dog":
        common.extend(
            [
                "산책 중 트리거와 거리, 회복 시간을 기록하기",
                "혼자 있을 때 행동은 가능하면 영상으로 확인하기",
            ]
        )

    if "resource_guarding" in topic:
        common.append("지키는 대상과 접근자를 기록하고 강제로 빼앗지 않기")

    if risk_level == "emergency":
        common.insert(0, "응급 신호가 있으면 기록보다 병원 연락을 우선하기")

    return common[:6]


def build_vet_consult_criteria(risk_level: RiskLevel, topic: str) -> list[str]:
    criteria = [
        "배뇨 곤란, 혈뇨, 반복 구토/설사, 호흡 문제, 발작이 있는 경우",
        "갑작스러운 공격성, 심한 통증 반응, 보행 이상이 있는 경우",
        "자해, 탈출 시도, 사람이나 다른 동물에게 즉각적인 위해 가능성이 있는 경우",
    ]

    if risk_level == "vet_consult":
        criteria.append("식욕 저하, 무기력, 노령 동물의 방향감 상실이나 야간 울음이 동반되는 경우")

    if "pica" in topic:
        criteria.insert(0, "실, 끈, 비닐 등 이물 섭취가 의심되는 경우")

    return criteria[:5]
