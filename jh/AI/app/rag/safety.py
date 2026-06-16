from __future__ import annotations

import re
from typing import Pattern

from app.rag.schemas import RiskLevel, SafetyResult

RulePattern = str | Pattern[str]


EMERGENCY_RULES: list[tuple[str, list[RulePattern]]] = [
    ("urinary_block_or_blood", ["소변을 못", "소변이 안", "소변이 나오지", "혈뇨", "피가 보여", "피가 나"]),
    ("breathing_or_seizure", ["호흡", "숨을 못", "청색증", "발작", "경련", "쓰러"]),
    ("toxin_or_foreign_body", ["초콜릿", "포도", "양파", "실을 먹", "끈을 먹", "비닐을 먹", "이물"]),
    ("self_harm_or_escape", ["자해", "탈출", "창문으로", "뛰어내"]),
]

VET_CONSULT_RULES: list[tuple[str, list[RulePattern]]] = [
    (
        "diagnosis_or_medication",
        [
            "진단",
            "처방",
            "용량",
            "약물",
            "투약",
            "복용",
            "몇 mg",
            re.compile(r"\d+\s?mg", flags=re.IGNORECASE),
            re.compile(
                r"(?<![가-힣A-Za-z0-9])약\s*(을|이|은|도|부터|까지|처방|먹|먹여|복용|투약)"
            ),
        ],
    ),
    ("pain_or_sudden_change", ["통증", "아파", "갑자기", "만지면 물", "보행 이상"]),
    ("digestive_or_appetite", ["구토", "설사", "식욕 저하", "무기력"]),
    ("aggression_or_bite", ["공격", "입질", "물림", "으르렁"]),
    ("senior_change", ["노령", "밤마다", "방향을 못", "헤매"]),
]

SAFE_TRAINING_RULES: list[tuple[str, list[RulePattern]]] = [
    (
        "aversive_training_request",
        [
            "혼내",
            "때리",
            "서열",
            "알파",
            "지배",
            re.compile(r"(목줄|리드줄|줄)을?\s*(세게|강하게|확)\s*(잡아당기|끌어당기|끌어당겨|당기|당겨|제지)"),
            re.compile(r"(세게|강하게|확)\s*(잡아당기|끌어당기|끌어당겨|당기|당겨)"),
        ],
    ),
]

BLOCKED_PATTERNS: list[tuple[str, str]] = [
    ("diagnosis_certainty", r"진단됩니다|확실합니다|틀림없습니다"),
    ("medication_dose", r"\d+\s?mg|며칠 먹이|이 약|용량"),
    (
        "punishment_training",
        r"혼내(세요|주세요|야|면 됩니다|는 게|는 것이|도록)|때리(세요|면|는 게|는 것이|십시오)|소리\s*지르(세요|면|는 게|는 것이)|체벌(하세요|이 필요|하면|을 해야)",
    ),
    (
        "dominance_theory",
        r"서열.*(잡|정리|확립)|알파.*(되|행동해야|역할)|지배.*(해야|하세요|필요)",
    ),
    (
        "leash_correction",
        r"(목줄|리드줄|줄)을?\s*(세게|강하게|확)\s*(잡아당기|끌어당기|당기|제지)(세요|십시오|면|는 게|는 것이|해야|하십시오|는 방법)|"
        r"(목줄|리드줄|줄)을?\s*(세게|강하게|확)\s*(당겨|끌어당겨)(주세요|야|도|서)|"
        r"(세게|강하게|확)\s*(잡아당기|끌어당기|당기)(세요|면|는 게|는 것이)|교정하세요|"
        r"(목줄|리드줄|줄).*강하게.*(제지|당기).*(하세요|해야|좋)",
    ),
    (
        "unsafe_reassurance",
        r"괜찮(습니다|아요)(?!라고|다고)|문제 없(습니다|어요)(?!라고|다고)|병원(에)?\s*안\s*가도\s*(됩니다|돼요|괜찮)|병원.*(필요\s*없|갈\s*필요\s*없)",
    ),
]


def classify_question_risk(question: str) -> tuple[RiskLevel, list[str]]:
    normalized = " ".join(question.lower().split())
    triggered: list[str] = []

    for rule_name, terms in EMERGENCY_RULES:
        if matches_any(normalized, terms):
            triggered.append(rule_name)

    if triggered:
        return "emergency", triggered

    for rule_name, terms in VET_CONSULT_RULES:
        if matches_any(normalized, terms):
            triggered.append(rule_name)

    if triggered:
        return "vet_consult", triggered

    for rule_name, terms in SAFE_TRAINING_RULES:
        if matches_any(normalized, terms):
            triggered.append(rule_name)

    if triggered:
        return "behavior_support", triggered

    return "behavior_support", []


def matches_any(value: str, patterns: list[RulePattern]) -> bool:
    for pattern in patterns:
        if isinstance(pattern, str):
            if pattern.lower() in value:
                return True
            continue

        if pattern.search(value):
            return True

    return False


def scan_blocked_terms(answer: str) -> list[str]:
    blocked: list[str] = []

    for name, pattern in BLOCKED_PATTERNS:
        if re.search(pattern, answer, flags=re.IGNORECASE):
            blocked.append(name)

    return blocked


def build_safety_result(
    risk_level: RiskLevel, triggered_rules: list[str], answer: str
) -> SafetyResult:
    blocked_terms = scan_blocked_terms(answer)
    action = "allow"

    if risk_level == "emergency":
        action = "emergency_vet_first"
    elif risk_level == "vet_consult":
        action = "vet_consult_first"
    elif triggered_rules:
        action = "safe_training_guidance"

    if blocked_terms:
        action = "rewrite_required"

    return SafetyResult(
        redFlagDetected=risk_level in {"emergency", "vet_consult"},
        riskLevel=risk_level,
        triggeredRules=triggered_rules,
        blockedTerms=blocked_terms,
        action=action,
    )
