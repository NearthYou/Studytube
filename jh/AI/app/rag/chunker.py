from __future__ import annotations

import hashlib
import re
from pathlib import Path

from app.rag.pdf_loader import load_pdf_pages
from app.rag.schemas import PdfPage, RagChunk, RiskLevel, Species


DEFAULT_SOURCE_TITLE = "반려동물 행동 Q&A RAG 자료집"

TOPIC_RULES: list[tuple[str, Species, list[str]]] = [
    (
        "cat.house_soiling.urination",
        "cat",
        ["화장실", "소변", "배뇨", "오줌", "house soiling", "urine", "litter"],
    ),
    (
        "cat.house_soiling.defecation",
        "cat",
        ["배변", "대변", "변", "defecation", "elimination"],
    ),
    (
        "cat.house_soiling.marking",
        "cat",
        ["마킹", "spraying", "marking", "territorial"],
    ),
    (
        "cat.aggression.petting_induced",
        "cat",
        ["쓰다듬", "만지", "petting", "갑자기 물", "접촉"],
    ),
    (
        "cat.aggression.play",
        "cat",
        ["손발", "사냥", "놀이", "play aggression"],
    ),
    (
        "cat.aggression.redirected",
        "cat",
        ["창밖", "redirected", "외부 자극", "재지향"],
    ),
    (
        "cat.intercat_tension.resource_blocking",
        "cat",
        ["다묘", "합사", "둘째", "intercat", "resource blocking", "통로 차단"],
    ),
    (
        "cat.pica.foreign_body",
        "cat",
        ["pica", "이물", "실", "끈", "비닐", "먹"],
    ),
    (
        "cat.grooming.overgrooming",
        "cat",
        ["그루밍", "털이 빠", "overgrooming", "핥"],
    ),
    (
        "cat.cognitive.night_vocalization",
        "cat",
        ["밤마다", "야간", "울", "인지", "cognitive", "노령묘"],
    ),
    (
        "dog.anxiety.separation",
        "dog",
        ["분리불안", "혼자", "부재", "separation"],
    ),
    (
        "dog.anxiety.noise_fear",
        "dog",
        ["천둥", "소음", "noise", "불꽃", "공포"],
    ),
    (
        "dog.reactivity.leash",
        "dog",
        ["산책", "목줄", "다른 개", "짖", "달려", "leash", "reactivity"],
    ),
    (
        "dog.aggression.resource_guarding",
        "dog",
        ["밥그릇", "장난감", "자원", "지키", "resource guarding"],
    ),
    (
        "dog.aggression.fear_human",
        "dog",
        ["낯선 사람", "으르렁", "입질", "물림", "aggression", "fear"],
    ),
    (
        "dog.behavior.compulsive",
        "dog",
        ["꼬리", "반복", "강박", "compulsive", "계속 핥"],
    ),
    (
        "dog.socialization.puppy",
        "dog",
        ["퍼피", "사회화", "puppy", "socialisation", "socialization"],
    ),
    (
        "dog.cognitive.dishaa",
        "dog",
        ["노령견", "DISHAA", "방향", "헤매", "인지"],
    ),
    (
        "common.training.humane_reward_based",
        "both",
        ["훈련", "보상", "처벌", "서열", "알파", "목줄 교정", "AVSAB"],
    ),
    (
        "common.pain_behavior",
        "both",
        ["통증", "아파", "접촉 회피", "pain", "갑작스러운 공격"],
    ),
    (
        "common.medical_behavior",
        "both",
        ["질환", "의학", "병원", "진료", "medical", "수의사"],
    ),
    (
        "common.safety.emergency_triage",
        "both",
        ["응급", "호흡", "발작", "혈뇨", "소변이 나오지", "자해", "탈출"],
    ),
]

SOURCE_TYPE_PRIORITIES = {
    "official_guideline": 1.0,
    "guideline": 1.0,
    "review_or_consensus": 0.85,
    "review": 0.85,
    "open_access_study": 0.7,
    "sourcebook": 0.7,
    "older_or_limited_access": 0.55,
}


def build_chunks_from_pdf(pdf_path: str | Path) -> list[RagChunk]:
    return build_chunks(load_pdf_pages(pdf_path), source_path=str(pdf_path))


def build_chunks(pages: list[PdfPage], source_path: str) -> list[RagChunk]:
    chunks: list[RagChunk] = []

    for page in pages:
        page_metadata = extract_page_metadata(page.text)
        segments = split_text(page.text)

        for segment_index, segment in enumerate(segments):
            metadata = {
                **page_metadata,
                **classify_segment(segment, page_metadata),
            }
            chunk_index = len(chunks)
            chunk_id = make_chunk_id(metadata["topic"], page.page, segment_index, segment)
            token_count = max(1, len(segment.split()))

            chunks.append(
                RagChunk(
                    chunk_id=chunk_id,
                    source_title=metadata["source_title"],
                    source_path=source_path,
                    page=page.page,
                    chunk_index=chunk_index,
                    species=metadata["species"],
                    topic=metadata["topic"],
                    subtopic=metadata.get("subtopic"),
                    safety_level=metadata["safety_level"],
                    source_year=metadata.get("source_year"),
                    pmid=metadata.get("pmid"),
                    pmcid=metadata.get("pmcid"),
                    doi=metadata.get("doi"),
                    url=metadata.get("url"),
                    source_type=metadata["source_type"],
                    source_priority=metadata["source_priority"],
                    token_count=token_count,
                    chunk_text=segment,
                )
            )

    return chunks


def split_text(text: str, max_chars: int = 1200, overlap_chars: int = 160) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()

    if not normalized:
        return []

    segments: list[str] = []
    words = normalized.split()
    current_words: list[str] = []
    current_length = 0

    for word in words:
        next_length = current_length + len(word) + 1

        if current_words and next_length > max_chars:
            current = " ".join(current_words)
            segments.append(current.strip())
            overlap_words: list[str] = []
            overlap_length = 0

            for overlap_word in reversed(current_words):
                overlap_length += len(overlap_word) + 1

                if overlap_length > overlap_chars:
                    break

                overlap_words.insert(0, overlap_word)

            current_words = [*overlap_words, word]
            current_length = sum(len(item) + 1 for item in current_words)
        else:
            current_words.append(word)
            current_length = next_length

    if current_words:
        segments.append(" ".join(current_words).strip())

    return [segment for segment in segments if len(segment) >= 80]


def extract_page_metadata(text: str) -> dict[str, object]:
    source_title = extract_source_title(text)
    source_year = extract_year(text)
    source_type = classify_source_type(text)

    return {
        "source_title": source_title,
        "source_year": source_year,
        "pmid": extract_prefixed_value(text, "PMID"),
        "pmcid": extract_prefixed_value(text, "PMCID"),
        "doi": extract_prefixed_value(text, "DOI"),
        "url": extract_url(text),
        "source_type": source_type,
        "source_priority": SOURCE_TYPE_PRIORITIES.get(source_type, 0.7),
    }


def classify_segment(
    text: str, page_metadata: dict[str, object]
) -> dict[str, object]:
    topic, topic_species = classify_topic(text)
    species = topic_species if topic_species != "unknown" else classify_species(text)
    risk_level = classify_chunk_safety(text, topic)

    if species == "unknown":
        species = classify_species(str(page_metadata.get("source_title") or ""))

    return {
        "species": species,
        "topic": topic,
        "subtopic": None,
        "safety_level": risk_level,
    }


def classify_topic(text: str) -> tuple[str, Species]:
    lowered = text.lower()
    best_topic = "common.medical_behavior"
    best_species: Species = "both"
    best_score = 0

    for topic, species, keywords in TOPIC_RULES:
        score = sum(1 for keyword in keywords if keyword.lower() in lowered)

        if score > best_score:
            best_topic = topic
            best_species = species
            best_score = score

    return best_topic, best_species


def classify_species(text: str) -> Species:
    lowered = text.lower()
    cat_score = sum(
        1
        for keyword in ["고양이", "묘", "feline", "cat", "kitty"]
        if keyword in lowered
    )
    dog_score = sum(
        1
        for keyword in ["강아지", "개", "견", "canine", "dog", "puppy"]
        if keyword in lowered
    )

    if cat_score and dog_score:
        return "both"
    if cat_score:
        return "cat"
    if dog_score:
        return "dog"
    if "공통" in lowered or "common" in lowered:
        return "both"
    return "unknown"


def classify_chunk_safety(text: str, topic: str) -> RiskLevel:
    lowered = text.lower()

    emergency_terms = [
        "응급",
        "호흡",
        "숨을 못",
        "발작",
        "경련",
        "소변이 나오지",
        "소변을 못",
        "혈뇨",
        "출혈",
        "자해",
        "탈출",
        "이물",
        "실을 먹",
        "끈을 먹",
    ]
    vet_terms = [
        "수의사",
        "병원",
        "진료",
        "통증",
        "갑작스러운",
        "물림",
        "공격",
        "구토",
        "설사",
        "식욕 저하",
        "노령",
        "진단",
        "처방",
    ]

    if topic == "common.safety.emergency_triage" or any(
        term in lowered for term in emergency_terms
    ):
        return "emergency"

    if any(term in lowered for term in vet_terms):
        return "vet_consult"

    return "behavior_support"


def extract_source_title(text: str) -> str:
    match = re.search(r"(?:^|\s)(\d{1,2})\.\s+(.{8,160}?)(?:\s+종:|\s+PMID:|\n)", text)

    if match:
        return " ".join(match.group(2).split())

    if "AVSAB" in text:
        return "AVSAB Position Statements"
    if "Topic Taxonomy" in text:
        return "Tail Talk Topic Taxonomy v2"
    if "DB Schema" in text:
        return "Tail Talk RAG DB Schema v2"
    if "Retrieval Scoring" in text:
        return "Tail Talk Retrieval Scoring v2"

    return DEFAULT_SOURCE_TITLE


def extract_year(text: str) -> int | None:
    match = re.search(r"(?:연도:|\()?\s*(20\d{2}|19\d{2})\)?", text)
    return int(match.group(1)) if match else None


def extract_prefixed_value(text: str, prefix: str) -> str | None:
    match = re.search(rf"{prefix}:\s*([A-Za-z0-9._/-]+)", text)

    if not match:
        return None

    value = match.group(1).strip()
    return None if value in {"-", "없음"} else value


def extract_url(text: str) -> str | None:
    match = re.search(r"https?://\S+", text)
    return match.group(0).rstrip(".,)") if match else None


def classify_source_type(text: str) -> str:
    lowered = text.lower()

    if "official" in lowered or "guideline" in lowered or "가이드라인" in text:
        return "official_guideline"
    if "review" in lowered or "리뷰" in text or "consensus" in lowered:
        return "review_or_consensus"
    if "study" in lowered or "연구" in text:
        return "open_access_study"

    return "sourcebook"


def make_chunk_id(topic: str, page: int, segment_index: int, text: str) -> str:
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    safe_topic = topic.replace(".", "-").replace("_", "-")
    return f"{safe_topic}-p{page:03d}-{segment_index:02d}-{digest}"
