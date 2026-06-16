from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


AnswerProvider = Literal["openai", "local_template"]
Species = Literal["cat", "dog", "both", "unknown"]
RiskLevel = Literal["none", "behavior_support", "vet_consult", "emergency"]


class PdfPage(BaseModel):
    page: int
    text: str


class RagChunk(BaseModel):
    chunk_id: str
    source_title: str
    source_path: str
    page: int
    chunk_index: int
    species: Species
    topic: str
    subtopic: str | None = None
    safety_level: RiskLevel
    source_year: int | None = None
    pmid: str | None = None
    pmcid: str | None = None
    doi: str | None = None
    url: str | None = None
    source_type: str = "sourcebook"
    source_priority: float = 0.7
    token_count: int
    chunk_text: str


class RetrievedChunk(BaseModel):
    chunk_id: str
    chunk_text: str
    score: float
    vector_similarity: float | None = None
    keyword_score: float | None = None
    species: Species
    topic: str
    safety_level: RiskLevel
    source_title: str
    source_year: int | None = None
    pmid: str | None = None
    pmcid: str | None = None
    url: str | None = None


class RagSource(BaseModel):
    title: str
    year: int | None = None
    pmid: str | None = None
    pmcid: str | None = None
    url: str | None = None
    sourceType: str | None = None


class SafetyResult(BaseModel):
    redFlagDetected: bool
    riskLevel: RiskLevel
    triggeredRules: list[str] = Field(default_factory=list)
    blockedTerms: list[str] = Field(default_factory=list)
    action: str


class PetBehaviorQuestionRequest(BaseModel):
    userId: str | int | None = None
    species: Species | None = None
    question: str = Field(min_length=1, max_length=2000)
    petAge: int | None = None
    context: dict[str, Any] | None = None


class PetBehaviorQuestionResponse(BaseModel):
    riskLevel: RiskLevel
    answer: str
    answerProvider: AnswerProvider
    fallbackUsed: bool
    observationChecklist: list[str]
    vetConsultCriteria: list[str]
    sources: list[RagSource]
    retrievedChunkIds: list[str]
    safety: SafetyResult
