import os

os.environ["DATABASE_URL"] = ""
os.environ["OPENAI_API_KEY"] = ""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rag.chunker import build_chunks_from_pdf
from app.rag.pdf_loader import load_pdf_pages
from app.rag.safety import classify_question_risk, scan_blocked_terms


client = TestClient(app)


def test_health():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_chat_echo():
    response = client.post("/chat", json={"message": " 산책 장소 추천 "})

    assert response.status_code == 200
    assert response.json()["answer"] == "서버가 받은 메시지: 산책 장소 추천"


@pytest.mark.slow
def test_pdf_ingestion_creates_chunks():
    pages = load_pdf_pages("../docs/pet_behavior_rag_sourcebook_50p.pdf")
    chunks = build_chunks_from_pdf("../docs/pet_behavior_rag_sourcebook_50p.pdf")

    assert len(pages) == 65
    assert len(chunks) > 0
    assert chunks[0].source_title
    assert chunks[0].species
    assert chunks[0].topic
    assert chunks[0].safety_level
    assert chunks[0].chunk_text


def test_safety_classifier_blocks_urgent_urinary_wording():
    risk_level, triggered_rules = classify_question_risk("고양이가 소변을 못 보고 피가 보여요")

    assert risk_level == "emergency"
    assert "urinary_block_or_blood" in triggered_rules


def test_safety_classifier_flags_aversive_training_request():
    risk_level, triggered_rules = classify_question_risk("목줄을 세게 당기면 되나요?")

    assert risk_level == "behavior_support"
    assert "aversive_training_request" in triggered_rules


@pytest.mark.parametrize("question", ["예약은 어떻게 하나요?", "약간 예민해졌어요"])
def test_safety_classifier_does_not_treat_common_words_as_medication(question):
    risk_level, triggered_rules = classify_question_risk(question)

    assert risk_level == "behavior_support"
    assert "diagnosis_or_medication" not in triggered_rules


@pytest.mark.parametrize(
    "question",
    ["약을 먹여도 되나요?", "몇 mg을 줘야 하나요?", "목줄을 확 당겨도 되나요?", "리드줄을 강하게 끌어당겨도 되나요?"],
)
def test_safety_classifier_flags_medication_and_aversive_variants(question):
    _risk_level, triggered_rules = classify_question_risk(question)

    assert triggered_rules


def test_safety_scan_allows_aversive_terms_when_rejected():
    answer = "혼내기, 목줄을 세게 당기기, 체벌은 피하고 거리를 확보하세요."

    assert scan_blocked_terms(answer) == []


def test_safety_scan_allows_unsafe_reassurance_when_rejected():
    answer = "괜찮다고 단정하지 말고 증상이 계속되면 병원에 연락하세요."

    assert scan_blocked_terms(answer) == []


def test_safety_scan_blocks_aversive_training_instructions():
    answer = "문제를 멈추려면 목줄을 확 당겨주세요. 계속 짖으면 혼내세요."

    blocked_terms = scan_blocked_terms(answer)

    assert "leash_correction" in blocked_terms
    assert "punishment_training" in blocked_terms


def test_safety_scan_blocks_unsafe_reassurance():
    answer = "괜찮아요. 병원 안 가도 됩니다."

    assert "unsafe_reassurance" in scan_blocked_terms(answer)


def test_safety_scan_blocks_lead_line_correction_variant():
    answer = "리드줄을 강하게 끌어당기세요."

    assert "leash_correction" in scan_blocked_terms(answer)


def test_pet_behavior_question_endpoint_without_live_api_key():
    response = client.post(
        "/pet-behavior/question",
        json={
            "question": "강아지가 산책 중 다른 개를 보면 짖어요",
            "species": "dog",
        },
    )

    body = response.json()

    assert response.status_code == 200
    assert body["riskLevel"] in {"behavior_support", "vet_consult"}
    assert body["answer"]
    assert body["answerProvider"] == "local_template"
    assert body["fallbackUsed"] is True
    assert body["observationChecklist"]
    assert body["retrievedChunkIds"]
