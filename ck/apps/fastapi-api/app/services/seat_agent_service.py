from __future__ import annotations

import re
import time
from collections import Counter
from dataclasses import dataclass

from app.schemas.agent import (
    AgentFilters,
    EvidenceReview,
    SeatRecommendationRequest,
    SeatRecommendationResponse,
)
from app.services.nest_client import NestClient, NestClientError
from app.services.seat_metadata_service import get_seat_layout, list_supported_theaters


PRIORITY_KEYWORDS = {
    "view": ("시야", "잘 보여", "잘보여", "가림", "난간", "시방"),
    "sound": ("음향", "소리", "넘버", "오케", "대사"),
    "comfort": ("편한", "편해", "편안", "다리", "허리", "오래 앉아"),
    "expression": ("표정", "얼굴", "배우", "배역", "가까이"),
    "stageVisibility": ("전체", "무대", "군무", "연출", "동선"),
    "lowObstruction": ("시야 방해", "시야방해", "가림 적", "안 가려"),
}
SIDE_KEYWORDS = {
    "left": ("왼쪽", "좌측", "왼블", "좌블"),
    "center": ("중앙", "가운데", "센터", "중블"),
    "right": ("오른쪽", "우측", "오블", "우블"),
    "side": ("사블", "사이드블록", "사이드 통로", "극싸", "극사이드", "완전 사이드"),
}
RATING_KEYS = {
    "view": "view",
    "sound": "sound",
    "comfort": "comfort",
    "expression": "expression",
    "stageVisibility": "stageVisibility",
}
METADATA_CACHE_TTL_SECONDS = 300
OBSTRUCTION_RANGE_MAX_PAGES = 6
_metadata_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}
THEATER_ALIASES = {
    "세종": "세종문화회관 대극장",
    "세종대극장": "세종문화회관 대극장",
    "세종 대극장": "세종문화회관 대극장",
    "세종문화회관": "세종문화회관 대극장",
    "세문": "세종문화회관 대극장",
    "세문회": "세종문화회관 대극장",
    "세종문회": "세종문화회관 대극장",
    "세종 m씨어터": "세종문화회관 M씨어터",
    "세종 m": "세종문화회관 M씨어터",
    "세종 엠씨어터": "세종문화회관 M씨어터",
    "m씨어터": "세종문화회관 M씨어터",
    "엠씨어터": "세종문화회관 M씨어터",
    "세종 s씨어터": "세종문화회관 S씨어터",
    "세종 s": "세종문화회관 S씨어터",
    "세종 에스씨어터": "세종문화회관 S씨어터",
    "s씨어터": "세종문화회관 S씨어터",
    "에스씨어터": "세종문화회관 S씨어터",
    "블루스퀘어": "블루스퀘어 신한카드홀",
    "블루 스퀘어": "블루스퀘어 신한카드홀",
    "블퀘": "블루스퀘어 신한카드홀",
    "블스": "블루스퀘어 신한카드홀",
    "블루스퀘어 신카홀": "블루스퀘어 신한카드홀",
    "신카홀": "블루스퀘어 신한카드홀",
    "신한카드홀": "블루스퀘어 신한카드홀",
    "tom": "TOM 1관",
    "tom 1관": "TOM 1관",
    "티오엠": "TOM 1관",
    "티오엠 1관": "TOM 1관",
    "톰": "TOM 1관",
    "톰 1관": "TOM 1관",
    "대학로 tom": "TOM 1관",
    "대학로 티오엠": "TOM 1관",
    "tom 2관": "TOM 2관",
    "티오엠 2관": "TOM 2관",
    "톰 2관": "TOM 2관",
}


@dataclass
class CandidateScore:
    review: dict
    score: float


@dataclass
class ReviewSearchScope:
    reviews: list[dict]
    label: str
    exact_count: int


@dataclass
class SeatCandidate:
    label: str
    floor: str | None
    section: str | None
    row: str | None
    side: str | None


@dataclass
class CandidateEvaluation:
    candidate: SeatCandidate
    filters: AgentFilters
    search_scope: ReviewSearchScope
    scored: list[CandidateScore]
    evidence: list[EvidenceReview]
    score: float


def recommend_seat(request: SeatRecommendationRequest) -> SeatRecommendationResponse:
    client = NestClient()
    filters = _extract_filters(request, client)
    intent = _detect_intent(request.question)
    focus_subject = _extract_focus_subject(request.question)
    mcp_status = "not_requested"
    rag_status = "skipped"
    rag_answer = None

    if filters.theater_name:
        mcp = get_seat_layout(filters.theater_name)
        mcp_status = mcp.status

    seat_candidates = _extract_seat_candidates(request.question)
    if len(seat_candidates) >= 2:
        return _compare_seat_candidates(
            client,
            request,
            filters,
            intent,
            mcp_status,
            seat_candidates,
        )

    search_scope = _load_review_scope(client, filters, request.limit, intent)
    reviews = search_scope.reviews

    if request.use_rag:
        try:
            rag = client.post_json(
                "/rag/questions",
                {"question": request.question, "limit": 10},
            )
            rag_answer = rag.get("answer") if isinstance(rag, dict) else None
            rag_status = "ok" if rag_answer else "empty"
        except NestClientError:
            rag_status = "fallback"

    scored = sorted(
        (_score_review(review, filters, focus_subject) for review in reviews),
        key=lambda item: item.score,
        reverse=True,
    )
    evidence = [_to_evidence(item.review) for item in scored[: request.limit]]
    best = scored[0].review if scored else None
    official_section = _select_official_section(reviews, best)
    descriptive_block = _select_descriptive_block(filters, official_section, best)

    reasons = _build_reasons(filters, evidence, official_section, descriptive_block, rag_answer)
    cautions = _build_cautions(evidence, official_section)
    local_answer = _build_answer(
        intent,
        filters,
        evidence,
        official_section,
        descriptive_block,
        search_scope,
        request.question,
    )
    recommendation = (
        local_answer
        if intent in {"obstruction_range", "op_assessment"} or focus_subject
        else rag_answer or local_answer
    )

    return SeatRecommendationResponse(
        recommendation=recommendation,
        officialSection=official_section,
        descriptiveBlock=descriptive_block,
        direction=_direction_label(descriptive_block),
        reasons=reasons,
        cautions=cautions,
        evidenceReviews=evidence,
        filters=filters,
        mcpStatus=mcp_status,
        ragStatus=rag_status,
        ragAnswer=rag_answer,
    )


def _extract_filters(request: SeatRecommendationRequest, client: NestClient) -> AgentFilters:
    question = request.question
    theaters = _safe_get(client, "/theaters")
    musicals = _safe_get(client, "/musicals")

    theater_name = request.theater_name or _find_name(question, theaters, "name")
    musical_title = request.musical_title or _find_name(question, musicals, "title")
    season_label = request.season_label or _extract_season(question)
    priorities = list(dict.fromkeys([*request.priorities, *_extract_priorities(question)]))

    if _has_focus_context(question):
        priorities = list(dict.fromkeys([*priorities, "expression", "stageVisibility"]))

    if not priorities:
        priorities = ["view"]

    seat_row = _extract_regex(question, r"(\d+|[A-Z가-힣]+)\s*(열|row)", lambda match: match.group(1).upper())

    if _asks_op_seat_question(question):
        seat_row = "OP"
        priorities = list(dict.fromkeys([*priorities, "lowObstruction", "stageVisibility"]))

    if _asks_range(question) and seat_row and _parse_int(seat_row) is None:
        seat_row = None

    return AgentFilters(
        theaterName=theater_name,
        musicalTitle=musical_title,
        seasonLabel=season_label,
        seatFloor=_extract_regex(question, r"(\d+)\s*(층|F)", lambda match: f"{match.group(1)}{_floor_unit(match.group(2))}"),
        seatSection=_extract_regex(question, r"([A-Z가-힣0-9]+)\s*(구역|블록|블럭)", lambda match: match.group(1).upper()),
        seatRow=seat_row,
        seatNumber=_extract_regex(question, r"(\d+)\s*(번|number)", lambda match: match.group(1)),
        side=_extract_side(question),
        priorities=priorities,
        budget=request.budget or _extract_budget(question),
    )


def _extract_seat_candidates(question: str) -> list[SeatCandidate]:
    candidates: list[SeatCandidate] = []
    pattern = re.compile(
        r"(?P<floor>\d+)\s*(?P<floor_unit>층|F)\s*"
        r"(?P<block>좌블|중블|우블|좌측|중앙|오른쪽|왼쪽|[A-Z]\s*(?:구역|블록|블럭))\s*"
        r"(?P<row>\d+)\s*열",
        flags=re.IGNORECASE,
    )

    for match in pattern.finditer(question):
        block = re.sub(r"\s+", "", match.group("block"))
        section = _candidate_section(block)
        side = _candidate_side(block) or _section_to_side(section)
        floor = f"{match.group('floor')}{_floor_unit(match.group('floor_unit'))}"
        row = match.group("row")
        candidates.append(
            SeatCandidate(
                label=f"{floor} {_candidate_block_label(block)} {row}열",
                floor=floor,
                section=section,
                row=row,
                side=side,
            )
        )

    row_block_pattern = re.compile(
        r"(?P<row>\d+)\s*열\s*"
        r"(?P<block>사이드\s*블록\s*통로석|사이드\s*블록|사이드\s*통로|극\s*사이드|완전\s*사이드|극싸|사블통|사블|좌블통|중블통|우블통|좌블|중블|우블|좌측|중앙|오른쪽|왼쪽|[A-Z]\s*(?:구역|블록|블럭))",
        flags=re.IGNORECASE,
    )

    for match in row_block_pattern.finditer(question):
        block = re.sub(r"\s+", "", match.group("block"))
        section = _candidate_section(block)
        side = _candidate_side(block) or _section_to_side(section)
        row = match.group("row")
        candidates.append(
            SeatCandidate(
                label=f"{row}열 {_candidate_block_label(block)}",
                floor=None,
                section=section,
                row=row,
                side=side,
            )
        )

    return candidates or _extract_floor_only_candidates(question) or _extract_side_only_candidates(question)


def _extract_floor_only_candidates(question: str) -> list[SeatCandidate]:
    if not _asks_floor_comparison(question):
        return []

    candidates: list[SeatCandidate] = []
    pattern = re.compile(
        r"(?P<floor>\d+)\s*(?P<floor_unit>층|F)\s*"
        r"(?P<row>(?:\d+\s*열)|앞열|중열|뒷열|후열)?",
        flags=re.IGNORECASE,
    )

    for match in pattern.finditer(question):
        floor = f"{match.group('floor')}{_floor_unit(match.group('floor_unit'))}"
        row_text = (match.group("row") or "").replace(" ", "")
        row = row_text.removesuffix("열") if row_text and row_text[0].isdigit() else None
        label = f"{floor} {row_text}".strip()

        candidates.append(
            SeatCandidate(
                label=label,
                floor=floor,
                section=None,
                row=row,
                side=None,
            )
        )

    return candidates if len(candidates) >= 2 else []


def _asks_floor_comparison(question: str) -> bool:
    return _asks_side_comparison(question) and len(re.findall(r"\d+\s*(?:층|F)", question, flags=re.IGNORECASE)) >= 2


def _extract_side_only_candidates(question: str) -> list[SeatCandidate]:
    if not _asks_side_comparison(question):
        return []

    candidates: list[SeatCandidate] = []
    for label, side in (
        ("왼블", "left"),
        ("중블", "center"),
        ("우블", "right"),
    ):
        if _mentions_side_candidate(question, label, side):
            candidates.append(
                SeatCandidate(
                    label=label,
                    floor=None,
                    section=None,
                    row=None,
                    side=side,
                )
            )

    return candidates


def _asks_side_comparison(question: str) -> bool:
    return any(keyword in question for keyword in ("나아", "나을까", "골라", "중에서", "vs", "VS"))


def _mentions_side_candidate(question: str, label: str, side: str) -> bool:
    aliases = {
        "left": ("왼블", "좌블", "왼쪽", "좌측"),
        "center": ("중블", "중앙"),
        "right": ("우블", "오블", "오른쪽", "우측"),
        "side": ("사블", "사블통", "사이드블록", "사이드통로", "극싸", "극사이드", "완전사이드"),
    }
    return label in question or any(alias in question for alias in aliases[side])


def _candidate_section(block: str) -> str | None:
    match = re.match(r"([A-Z])(?:구역|블록|블럭)", block, flags=re.IGNORECASE)
    return match.group(1).upper() if match else None


def _candidate_side(block: str) -> str | None:
    if block in {"좌블", "좌블통", "좌측", "왼쪽"}:
        return "left"
    if block in {"중블", "중블통", "중앙"}:
        return "center"
    if block in {"우블", "우블통", "오른쪽"}:
        return "right"
    if block in {"사블", "사블통", "사이드블록", "사이드블록통로석", "사이드통로", "극싸", "극사이드", "완전사이드"}:
        return "side"
    return None


def _candidate_block_label(block: str) -> str:
    if block in {"좌블", "좌블통"}:
        return "좌블"
    if block in {"중블", "중블통"}:
        return "중블"
    if block in {"우블", "우블통"}:
        return "우블"
    if block in {"사블", "사블통", "사이드블록", "사이드블록통로석", "사이드통로"}:
        return "사블통" if "통" in block else "사블"
    if block in {"극싸", "극사이드", "완전사이드"}:
        return "극싸"
    section = _candidate_section(block)
    if section:
        return f"{section}구역"
    return block


def _compare_seat_candidates(
    client: NestClient,
    request: SeatRecommendationRequest,
    base_filters: AgentFilters,
    intent: str,
    mcp_status: str,
    candidates: list[SeatCandidate],
) -> SeatRecommendationResponse:
    evaluations = [
        _evaluate_seat_candidate(client, request, base_filters, intent, candidate)
        for candidate in candidates[:3]
    ]
    winner = max(evaluations, key=lambda evaluation: evaluation.score)
    best = winner.scored[0].review if winner.scored else None
    official_section = _select_official_section(winner.search_scope.reviews, best)
    descriptive_block = winner.candidate.side or _select_descriptive_block(
        winner.filters,
        official_section,
        best,
    )
    evidence = _merge_candidate_evidence(evaluations, request.limit)

    return SeatRecommendationResponse(
        recommendation=_build_floor_comparison_answer(evaluations, winner)
        if _is_floor_candidate_comparison(evaluations)
        else _build_candidate_comparison_answer(
            request.question,
            evaluations,
            winner,
        ),
        officialSection=official_section,
        descriptiveBlock=descriptive_block,
        direction=_direction_label(descriptive_block),
        reasons=_build_candidate_comparison_reasons(evaluations, winner),
        cautions=_build_cautions(evidence, official_section),
        evidenceReviews=evidence,
        filters=winner.filters,
        mcpStatus=mcp_status,
        ragStatus="skipped",
        ragAnswer=None,
    )


def _is_floor_candidate_comparison(evaluations: list[CandidateEvaluation]) -> bool:
    return len(evaluations) >= 2 and all(
        evaluation.candidate.floor and not evaluation.candidate.side and not evaluation.candidate.section
        for evaluation in evaluations
    )


def _evaluate_seat_candidate(
    client: NestClient,
    request: SeatRecommendationRequest,
    base_filters: AgentFilters,
    intent: str,
    candidate: SeatCandidate,
) -> CandidateEvaluation:
    candidate_filters = base_filters.model_copy(
        update={
            "seat_floor": candidate.floor or base_filters.seat_floor,
            "seat_section": candidate.section,
            "seat_row": candidate.row,
            "seat_number": None,
            "side": candidate.side or base_filters.side,
        }
    )
    search_scope = _load_review_scope(client, candidate_filters, request.limit, intent)
    scored = sorted(
        (
            _score_review(review, candidate_filters, _extract_focus_subject(request.question))
            for review in search_scope.reviews
        ),
        key=lambda item: item.score,
        reverse=True,
    )
    evidence = [_to_evidence(item.review) for item in scored[: request.limit]]
    if _is_floor_only_candidate(candidate):
        score = _score_floor_candidate(evidence)
    else:
        score = (scored[0].score if scored else 0) + _candidate_context_bonus(
            request.question,
            candidate,
        )

    return CandidateEvaluation(
        candidate=candidate,
        filters=candidate_filters,
        search_scope=search_scope,
        scored=scored,
        evidence=evidence,
        score=score,
    )


def _is_floor_only_candidate(candidate: SeatCandidate) -> bool:
    return bool(candidate.floor and not candidate.section and not candidate.side)


def _score_floor_candidate(evidence: list[EvidenceReview]) -> float:
    if not evidence:
        return 0.0

    view = _average_rating(evidence, "view")
    stage = _average_rating(evidence, "stageVisibility")
    sound = _average_rating(evidence, "sound")
    comfort = _average_rating(evidence, "comfort")
    expression = _average_rating(evidence, "expression")

    return (view * 2) + (stage * 1.5) + (sound * 1.5) + (comfort * 0.8) + (expression * 0.5)


def _candidate_context_bonus(question: str, candidate: SeatCandidate) -> float:
    score = 0.0
    row = _parse_int(candidate.row)
    wants_center_context = _asks_one_watch_question(question) or _has_focus_context(question)
    is_floor_only_candidate = candidate.floor and not candidate.section and not candidate.side

    if candidate.side == "center":
        score += 1.0
        if wants_center_context:
            score += 3.0
    elif wants_center_context:
        score -= 1.0

    if row is not None and not is_floor_only_candidate:
        if row <= 5:
            score += 2.0
        elif row <= 10:
            score += 1.2
        else:
            score += 0.4

    return score


def _merge_candidate_evidence(
    evaluations: list[CandidateEvaluation],
    limit: int,
) -> list[EvidenceReview]:
    evidence: list[EvidenceReview] = []
    seen: set[str] = set()

    for evaluation in sorted(evaluations, key=lambda item: item.score, reverse=True):
        for review in evaluation.evidence:
            if review.id in seen:
                continue
            seen.add(review.id)
            evidence.append(review)
            if len(evidence) >= limit:
                return evidence

    return evidence


def _detect_intent(question: str) -> str:
    if _asks_op_seat_question(question):
        return "op_assessment"
    if _asks_obstruction_range(question):
        return "obstruction_range"
    if any(keyword in question for keyword in ("추천", "골라", "어디", "좋은 자리", "좋을까")):
        return "recommendation"
    if any(keyword in question for keyword in ("어때", "어떰", "괜찮", "보여", "가려", "시야", "음향", "편해")):
        return "assessment"
    return "recommendation"


def _asks_range(question: str) -> bool:
    return bool(re.search(r"몇\s*열까지|어느\s*열까지|어디까지|범위|까지야|까지니", question))


def _asks_obstruction_range(question: str) -> bool:
    return _asks_range(question) and any(
        keyword in question for keyword in ("시야방해", "시야 방해", "시방", "가림", "난간")
    )


def _asks_op_seat_question(question: str) -> bool:
    compact_question = _compact(question)
    return "오피" in compact_question or re.search(r"\bop\s*석?\b", question, flags=re.IGNORECASE) is not None


def _asks_one_watch_question(question: str) -> bool:
    compact_question = _compact(question)
    return any(keyword in compact_question for keyword in ("자첫자막", "자첫", "한번만", "한번만볼"))


def _has_focus_context(question: str) -> bool:
    return _extract_focus_subject(question) is not None or any(
        keyword in question
        for keyword in (
            "본진",
            "최애",
            "최애배역",
            "최애배우",
            "최애캐",
            "애배",
            "차애",
        )
    )


def _extract_focus_subject(question: str) -> str | None:
    focus_marker = r"(?:본진|최애배역|최애배우|최애캐|최애|애배|차애)"
    suffix = r"(?:라서|라|이라서|이라|이면|이라면|이고|인데|이라면요|이면요)?"

    before_match = re.search(
        rf"(?:^|[\s,])(?P<subject>[가-힣A-Za-z0-9]+?)(?:이|가|은|는)?\s*{focus_marker}{suffix}",
        question,
    )
    if before_match:
        return before_match.group("subject")

    after_match = re.search(
        rf"(?:^|[\s,]){focus_marker}(?:은|는|이|가)?\s+(?P<subject>[가-힣A-Za-z0-9]+?)(?=\s|이면|이라면|이고|인데|,|\.|\?|$)",
        question,
    )
    if after_match:
        return after_match.group("subject")

    action_match = re.search(
        r"(?:^|[\s,])(?P<subject>[가-힣A-Za-z0-9]{2,12})(?:을|를|이|가|은|는)?\s*(?:보러|위주로|중심으로|잡고)",
        question,
    )
    return action_match.group("subject") if action_match else None


def _safe_get(client: NestClient, path: str) -> list[dict]:
    cache_key = (client.__class__.__name__, path)
    cached = _metadata_cache.get(cache_key)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]

    try:
        value = client.get_json(path)
        items = value if isinstance(value, list) else []
        _metadata_cache[cache_key] = (now + METADATA_CACHE_TTL_SECONDS, items)
        return items
    except NestClientError:
        return []


def _find_name(question: str, items: list[dict], key: str) -> str | None:
    lowered = question.lower()
    compact_question = _compact(question)
    for item in items:
        value = item.get(key)
        if isinstance(value, str) and (
            value.lower() in lowered or _compact(value) in compact_question
        ):
            return value

    if key == "name":
        alias_match = _find_theater_alias(lowered)
        if alias_match:
            return alias_match

    for theater in list_supported_theaters():
        if theater.lower() in lowered:
            return theater

    return None


def _find_theater_alias(lowered_question: str) -> str | None:
    supported = {theater.lower(): theater for theater in list_supported_theaters()}
    compact_question = _compact(lowered_question)

    for alias, theater in sorted(THEATER_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        if alias.lower() not in lowered_question and _compact(alias) not in compact_question:
            continue

        canonical = supported.get(theater.lower())
        if canonical:
            return canonical

    return None


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.lower())


def _extract_priorities(question: str) -> list[str]:
    return [
        priority
        for priority, keywords in PRIORITY_KEYWORDS.items()
        if any(keyword in question for keyword in keywords)
    ]


def _extract_side(question: str):
    for side, keywords in SIDE_KEYWORDS.items():
        if side not in {"left", "center", "right"}:
            continue
        if any(keyword in question for keyword in keywords):
            return side
    return None


def _extract_season(question: str) -> str | None:
    match = re.search(r"(\d{2,4}(?:-\d{2,4})?\s*시즌)", question)
    return match.group(1).replace(" ", "") if match else None


def _extract_budget(question: str) -> int | None:
    match = re.search(r"(\d+)\s*(만원|원)", question)
    if not match:
        return None

    value = int(match.group(1))
    return value * 10000 if match.group(2) == "만원" else value


def _extract_regex(question: str, pattern: str, transform):
    match = re.search(pattern, question, flags=re.IGNORECASE)
    return transform(match) if match else None


def _floor_unit(value: str) -> str:
    return "F" if value.upper() == "F" else "층"


def _to_search_params(
    filters: AgentFilters,
    limit: int,
    intent: str = "",
    page: int = 1,
) -> dict[str, object | None]:
    primary_priority = filters.priorities[0] if filters.priorities else "view"
    sort = RATING_KEYS.get(primary_priority, "view")
    return {
        "theater": filters.theater_name,
        "musical": filters.musical_title,
        "seasonLabel": filters.season_label,
        "seatFloor": filters.seat_floor,
        "seatSection": filters.seat_section,
        "seatRow": filters.seat_row,
        "seatNumber": filters.seat_number,
        "tag": "시야방해" if intent in {"obstruction_range", "op_assessment"} else None,
        "hasObstruction": True
        if intent in {"obstruction_range", "op_assessment"}
        else False
        if "lowObstruction" in filters.priorities
        else None,
        "sort": sort,
        "page": page,
        "limit": max(limit, 10),
    }


def _load_review_scope(
    client: NestClient,
    filters: AgentFilters,
    limit: int,
    intent: str,
) -> ReviewSearchScope:
    if intent == "obstruction_range":
        reviews = _search_obstruction_range_reviews(client, filters)
        return ReviewSearchScope(
            reviews=reviews,
            label="obstruction_range",
            exact_count=len(reviews),
        )

    exact_reviews = _search_reviews(client, filters, limit)

    if len(exact_reviews) >= min(3, limit) or not filters.seat_row:
        return ReviewSearchScope(reviews=exact_reviews, label="exact", exact_count=len(exact_reviews))

    broad_filters = filters.model_copy(update={"seat_row": None, "seat_number": None})
    broad_reviews = _search_reviews(client, broad_filters, 50)

    if not broad_reviews:
        return ReviewSearchScope(
            reviews=exact_reviews,
            label="exact",
            exact_count=len(exact_reviews),
        )

    nearby_reviews = _nearby_row_reviews(broad_reviews, filters.seat_row)

    if nearby_reviews:
        return ReviewSearchScope(
            reviews=nearby_reviews[: max(limit, 10)],
            label="nearby_row",
            exact_count=len(exact_reviews),
        )

    return ReviewSearchScope(
        reviews=broad_reviews[: max(limit, 10)],
        label="same_scope",
        exact_count=len(exact_reviews),
    )


def _search_reviews(client: NestClient, filters: AgentFilters, limit: int) -> list[dict]:
    try:
        search_result = client.get_json("/seat-reviews/search", _to_search_params(filters, limit))
        return search_result.get("items", []) if isinstance(search_result, dict) else []
    except NestClientError:
        return []


def _search_obstruction_range_reviews(client: NestClient, filters: AgentFilters) -> list[dict]:
    reviews: list[dict] = []
    range_filters = filters.model_copy(update={"seat_row": None, "seat_number": None})

    for page in range(1, OBSTRUCTION_RANGE_MAX_PAGES + 1):
        try:
            search_result = client.get_json(
                "/seat-reviews/search",
                _to_search_params(range_filters, 50, intent="obstruction_range", page=page),
            )
        except NestClientError:
            break

        if not isinstance(search_result, dict):
            break

        items = search_result.get("items", [])
        if isinstance(items, list):
            reviews.extend(items)

        if not search_result.get("hasNext"):
            break

    return reviews


def _nearby_row_reviews(reviews: list[dict], target_row: str) -> list[dict]:
    target_number = _parse_int(target_row)
    if target_number is None:
        return reviews

    nearby = [
        review
        for review in reviews
        if (row_number := _parse_int(review.get("seat", {}).get("row"))) is not None
        and abs(row_number - target_number) <= 1
    ]
    return nearby


def _score_review(
    review: dict,
    filters: AgentFilters,
    focus_subject: str | None = None,
) -> CandidateScore:
    ratings = review.get("ratings", {})
    score = 0.0
    for priority in filters.priorities:
        rating_key = RATING_KEYS.get(priority)
        if rating_key:
            score += float(ratings.get(rating_key, 0)) * 2

    tags = [tag.get("name", "") for tag in review.get("tags", [])]
    content = str(review.get("content") or "")
    searchable_text = _compact(" ".join([content, *tags]))

    if focus_subject:
        compact_focus = _compact(focus_subject)
        if compact_focus and compact_focus in searchable_text:
            score += 4
        if any(keyword in content for keyword in ("동선", "등장", "표정", "붙", "자주")):
            score += 1.5
        if _has_obstruction_text(content, tags):
            score -= 3

    if "lowObstruction" in filters.priorities and any("시야방해" in tag or "사이드" in tag for tag in tags):
        score -= 4
    if filters.side:
        review_side = _section_to_side(review.get("seat", {}).get("section"))
        if filters.side == "side" and review_side in {"left", "right"}:
            score += 2
        elif review_side == filters.side:
            score += 2
    if filters.seat_row:
        target_row = _parse_int(filters.seat_row)
        review_row = _parse_int(review.get("seat", {}).get("row"))
        if target_row is not None and review_row is not None:
            distance = abs(target_row - review_row)
            if distance == 0:
                score += 3
            elif distance == 1:
                score += 2
            elif distance == 2:
                score += 1

    return CandidateScore(review=review, score=score)


def _parse_int(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    return int(text) if text.isdigit() else None


def _select_official_section(reviews: list[dict], best: dict | None) -> str | None:
    if best:
        section = best.get("seat", {}).get("section")
        if section:
            return section

    sections = [
        review.get("seat", {}).get("section")
        for review in reviews
        if review.get("seat", {}).get("section")
    ]
    return Counter(sections).most_common(1)[0][0] if sections else None


def _select_descriptive_block(filters: AgentFilters, official_section: str | None, best: dict | None) -> str | None:
    if filters.side:
        return filters.side
    if best:
        return _section_to_side(best.get("seat", {}).get("section"))
    return _section_to_side(official_section)


def _section_to_side(section: str | None) -> str | None:
    if not section:
        return None
    first = section[0].upper()
    if first in {"A", "D", "G"}:
        return "left"
    if first in {"B", "E", "H"}:
        return "center"
    if first in {"C", "F"}:
        return "right"
    return None


def _direction_label(block: str | None) -> str:
    return {
        "left": "왼쪽블록",
        "center": "중앙블록",
        "right": "오른쪽블록",
        "side": "사이드블록",
    }.get(block or "", "근거 후기 중심")


def _has_obstruction_text(content: str, tags: list[str]) -> bool:
    return any("시야방해" in tag or "가림" in tag for tag in tags) or any(
        keyword in content for keyword in ("시야방해", "시야 방해", "가림", "난간", "스피커")
    )


def _evidence_section(review: EvidenceReview | None) -> str | None:
    if review is None:
        return None
    match = re.search(r"\b([A-Z])구역\b", review.seat)
    return match.group(1) if match else None


def _evidence_side(review: EvidenceReview | None) -> str | None:
    if review is None:
        return None

    text = " ".join([review.content, review.seat, *review.tags])
    if any(keyword in text for keyword in ("왼쪽", "좌측", "왼블", "좌블")):
        return "left"
    if any(keyword in text for keyword in ("오른쪽", "우측", "우블", "오블")):
        return "right"
    if any(keyword in text for keyword in ("중앙", "중블", "센터")):
        return "center"
    return _section_to_side(_evidence_section(review))


def _best_focus_evidence(evidence: list[EvidenceReview]) -> EvidenceReview | None:
    for review in evidence:
        if not _has_obstruction_text(review.content, review.tags):
            return review
    return evidence[0] if evidence else None


def _obstructed_evidence(evidence: list[EvidenceReview]) -> EvidenceReview | None:
    return next(
        (
            review
            for review in evidence
            if _has_obstruction_text(review.content, review.tags)
        ),
        None,
    )


def _movement_side_phrase(side: str | None) -> str | None:
    return {
        "left": "왼쪽",
        "center": "중앙",
        "right": "오른쪽",
    }.get(side or "")


def _build_answer(
    intent: str,
    filters: AgentFilters,
    evidence: list[EvidenceReview],
    official_section: str | None,
    block: str | None,
    search_scope: ReviewSearchScope,
    question: str,
) -> str:
    if intent == "obstruction_range":
        return _build_obstruction_range(filters, search_scope.reviews)
    if intent == "op_assessment":
        return _build_op_seat_assessment(evidence)
    if intent == "assessment":
        return _build_assessment(filters, evidence, search_scope)
    return _build_recommendation(
        official_section,
        block,
        evidence,
        _extract_focus_subject(question),
    )


def _build_obstruction_range(filters: AgentFilters, reviews: list[dict]) -> str:
    ranges: dict[str, tuple[int, int, int]] = {}

    for review in reviews:
        seat = review.get("seat", {})
        floor = seat.get("floor")
        row = _parse_int(seat.get("row"))

        if not floor or row is None:
            continue

        current = ranges.get(floor)
        if current is None:
            ranges[floor] = (row, row, 1)
        else:
            ranges[floor] = (
                min(current[0], row),
                max(current[1], row),
                current[2] + 1,
            )

    if not ranges:
        target = " ".join(value for value in [filters.theater_name, filters.seat_floor] if value)
        return f"{target or '해당 조건'}에서는 시야방해가 몇 열까지 있는지 확인할 만한 후기를 찾지 못했습니다."

    theater = filters.theater_name or "해당 극장"

    if filters.seat_floor and filters.seat_floor in ranges:
        _, max_row, _ = ranges[filters.seat_floor]
        return f"{theater} {filters.seat_floor}은 시야방해 태그가 {max_row}열까지 확인됩니다. 이건 {filters.seat_floor} 전체가 다 방해된다는 뜻이 아니라, 후기에서 난간이나 가림 같은 방해 요소가 기록된 좌석이 {max_row}열까지 있었다는 의미예요."

    floor_text = ", ".join(
        f"{floor}은 {min_row}열부터 {max_row}열까지"
        for floor, (min_row, max_row, _) in sorted(ranges.items(), key=lambda item: _parse_int(item[0]) or 0)
    )
    return f"{theater}은 시야방해 태그가 {floor_text} 확인됩니다. 전체 좌석이 다 방해된다는 뜻은 아니고, 방해 요소가 기록된 후기가 그 범위까지 있다는 의미예요."


def _build_op_seat_assessment(evidence: list[EvidenceReview]) -> str:
    if not evidence:
        return "OP석은 무대와 너무 가까운 만큼 가림 변수가 큰 자리라, 정확한 후기가 없으면 추천하기 어렵습니다. 표정 가까움보다 무대 전체와 동선을 안정적으로 보고 싶다면 일반 1층 중앙 쪽을 먼저 보세요."

    view_average = _average_rating(evidence, "view")
    stage_average = _average_rating(evidence, "stageVisibility")
    obstruction_count = sum(1 for review in evidence if any("시야방해" in tag or "가림" in tag for tag in review.tags))

    if obstruction_count or view_average < 3.5 or stage_average < 3.5:
        return (
            "OP석은 이번 조건에서는 추천하기 어렵습니다. 가까워서 표정은 잘 보일 수 있지만, "
            "가림이나 무대 하단/동선 누락 리스크가 커 보여요. 특히 지앤하처럼 무대 전체와 동선을 같이 봐야 하는 극이면 "
            "OP보다 일반 1층 중앙 쪽이 더 안전합니다."
        )

    return (
        "OP석도 선택지는 될 수 있지만, 표정 가까움을 최우선으로 볼 때만 추천합니다. "
        "가림이 걱정된다면 OP보다 일반 1층 중앙 쪽이 더 안정적입니다."
    )


def _build_assessment(
    filters: AgentFilters,
    evidence: list[EvidenceReview],
    search_scope: ReviewSearchScope,
) -> str:
    seat_label = _target_seat_label(filters)

    if not evidence:
        return f"{seat_label}는 아직 참고할 만한 후기가 부족합니다. 층이나 구역 정도로 조금 넓게 물어보면 더 안정적으로 볼 수 있어요."

    view_average = _average_rating(evidence, "view")
    expression_average = _average_rating(evidence, "expression")
    stage_average = _average_rating(evidence, "stageVisibility")
    obstruction_count = sum(1 for review in evidence if any("시야방해" in tag for tag in review.tags))
    side_count = sum(1 for review in evidence if any("사이드" in tag for tag in review.tags))

    parts = [
        f"{seat_label} 시야는 {_rating_phrase(view_average)}.",
    ]

    if expression_average < 4:
        parts.append("배우 표정까지 선명하게 보려면 오글은 챙기는 쪽이 안전합니다.")
    if stage_average >= 4:
        parts.append("대신 무대 전체나 장면 전환을 따라가는 쪽은 괜찮게 볼 가능성이 큽니다.")
    if obstruction_count:
        parts.append("시야방해 언급이 일부 있어서 난간이나 앞사람 영향은 좌석표로 한 번 더 확인하는 게 좋아요.")
    elif side_count:
        parts.append("사이드 시야 언급이 있어서 중앙이 아니라면 시선이 한쪽으로 살짝 쏠릴 수 있습니다.")

    return " ".join(parts)


def _target_seat_label(filters: AgentFilters) -> str:
    values = [
        filters.theater_name,
        filters.seat_floor,
        f"{filters.seat_section}구역" if filters.seat_section else None,
        f"{filters.seat_row}열" if filters.seat_row else None,
        f"{filters.seat_number}번" if filters.seat_number else None,
    ]
    return " ".join(value for value in values if value) or "해당 좌석"


def _average_rating(evidence: list[EvidenceReview], key: str) -> float:
    values = [review.ratings.get(key, 0) for review in evidence]
    return sum(values) / len(values) if values else 0


def _rating_phrase(value: float) -> str:
    if value >= 4.5:
        return "좋은 편이에요"
    if value >= 3.8:
        return "괜찮은 편이에요"
    if value >= 3:
        return "무난하지만 아주 탁 트인 느낌까지는 아닐 수 있어요"
    return "아쉬울 가능성이 있어요"


def _build_recommendation(
    official_section: str | None,
    block: str | None,
    evidence: list[EvidenceReview],
    focus_subject: str | None = None,
) -> str:
    if focus_subject:
        if not evidence:
            return (
                f"{focus_subject} 기준으로 좌우 동선이나 시야방해를 판단할 만한 후기가 부족합니다. "
                "배역 동선 질문은 전체 시야 좋은 구역보다 해당 배역이 언급된 후기가 쌓인 좌석을 먼저 확인하는 편이 안전합니다."
            )

        best_focus = _best_focus_evidence(evidence)
        focus_section = _evidence_section(best_focus) or official_section
        focus_side = _evidence_side(best_focus) or block
        side_phrase = _movement_side_phrase(focus_side)
        target = " ".join(
            value
            for value in [
                f"{focus_section}구역" if focus_section else None,
                _direction_label(focus_side) if focus_side else None,
            ]
            if value
        )
        obstructed = _obstructed_evidence(evidence)
        parts = [
            f"{focus_subject} 기준이면 {target or '근거 후기가 좋은 좌석'} 쪽을 먼저 보세요.",
        ]

        if side_phrase:
            parts.append(
                f"근거 후기에서 {focus_subject} 동선이 {side_phrase}에 자주 붙거나 표정 보기 좋다는 언급이 있어, 전체 중앙값보다 배역 동선을 우선해 잡는 편이 낫습니다."
            )
        else:
            parts.append(
                f"근거 후기에서 {focus_subject} 동선과 표정 체감이 직접 언급된 좌석을 우선했습니다."
            )

        if obstructed:
            parts.append(
                f"다만 {obstructed.seat}은 시야방해나 가림 언급이 있어 같은 방향 매물이어도 피하는 편이 좋습니다."
            )

        return " ".join(parts)

    if official_section:
        return f"{official_section}구역 {_direction_label(block)} 위주로 보는 편이 좋습니다."
    if block:
        return f"공식 구역 대신 {_direction_label(block)} 범위로 잡는 편이 안전합니다."
    if evidence:
        return "근거 후기의 평점이 높은 좌석 범위부터 확인하는 편이 좋습니다."
    return "조건에 맞는 후기가 부족해 특정 구역보다 검색 범위를 넓히는 편이 좋습니다."


def _build_candidate_comparison_answer(
    question: str,
    evaluations: list[CandidateEvaluation],
    winner: CandidateEvaluation,
) -> str:
    others = [
        evaluation
        for evaluation in evaluations
        if evaluation.candidate.label != winner.candidate.label
    ]
    intro = f"둘 중에서는 {winner.candidate.label}을 추천합니다."
    focus_subject = _extract_focus_subject(question)
    has_focus_context = _has_focus_context(question)

    if winner.candidate.side == "center" and (_asks_one_watch_question(question) or has_focus_context):
        if focus_subject and _asks_one_watch_question(question):
            reason = f"한 번만 볼 예정이고 {focus_subject}를 중심으로 본다면, 앞열감보다 정면에서 전체 동선과 등장 장면을 놓치지 않는 쪽이 낫습니다."
        elif focus_subject:
            reason = f"{focus_subject}를 중심으로 본다면, 가까운 사이드 앞열보다 정면에서 전체 동선과 등장 장면을 안정적으로 보는 쪽이 낫습니다."
        elif _asks_one_watch_question(question):
            reason = "한 번만 볼 예정이면 앞열감보다 정면에서 무대 전체와 동선을 안정적으로 보는 쪽이 낫습니다."
        else:
            reason = "본진이나 최애를 중심으로 보더라도 사이드 앞열보다 정면에서 전체 동선과 시야 균형을 잡는 쪽이 더 안정적입니다."
    elif winner.candidate.row and any(other.candidate.row for other in others):
        reason = "후기 점수와 좌석 위치를 같이 보면 이 후보 쪽의 균형이 더 좋습니다."
    elif winner.candidate.side and any(other.candidate.side for other in others):
        reason = "양쪽 블록 후기를 따로 비교하면 이쪽이 시야와 동선 면에서 더 안정적입니다."
    else:
        reason = "근거 후기의 평점과 좌석 방향 조건을 비교했을 때 이 후보가 더 안정적입니다."

    tradeoffs = " ".join(
        _candidate_tradeoff_summary(evaluation)
        for evaluation in [winner, *others]
    )

    return f"{intro} {reason} {tradeoffs}".strip()


def _build_floor_comparison_answer(
    evaluations: list[CandidateEvaluation],
    winner: CandidateEvaluation,
) -> str:
    others = [
        evaluation
        for evaluation in evaluations
        if evaluation.candidate.label != winner.candidate.label
    ]
    other = others[0] if others else None

    parts = [
        f"둘 중에서는 {winner.candidate.label}을 추천합니다.",
        f"시야는 {_floor_view_phrase(winner)}.",
        f"자리는 {_floor_seat_phrase(winner)}.",
        f"음향은 {_floor_sound_phrase(winner)}.",
    ]

    if other:
        parts.append(f"{other.candidate.label}은 {_floor_tradeoff_phrase(other)}.")

    return " ".join(parts)


def _floor_view_phrase(evaluation: CandidateEvaluation) -> str:
    view_average = _average_rating(evaluation.evidence, "view")
    stage_average = _average_rating(evaluation.evidence, "stageVisibility")
    row_text = evaluation.candidate.label

    if "뒷열" in row_text or (view_average >= 3.8 and stage_average >= 4):
        return "무대 전체와 동선을 안정적으로 보기 좋은 편입니다"
    if view_average >= 3.8:
        return "시야 자체는 무난한 편입니다"
    return "거리감이나 각도 때문에 세부 표정은 덜 또렷할 수 있습니다"


def _floor_seat_phrase(evaluation: CandidateEvaluation) -> str:
    comfort_average = _average_rating(evaluation.evidence, "comfort")
    row = _parse_int(evaluation.candidate.row)

    if row is not None and row <= 3 and evaluation.candidate.floor not in {"1층", "1F"}:
        return "앞쪽이어도 층이 높아 무대와의 거리감은 남는 자리입니다"
    if "뒷열" in evaluation.candidate.label:
        return "앞열감은 덜하지만 한눈에 보기 편한 자리입니다"
    if comfort_average >= 4:
        return "시야와 착석감의 균형이 괜찮은 편입니다"
    return "가까움보다는 전체 관람 안정성 기준으로 봐야 하는 자리입니다"


def _floor_sound_phrase(evaluation: CandidateEvaluation) -> str:
    sound_average = _average_rating(evaluation.evidence, "sound")

    if sound_average >= 4.5:
        return "소리가 객석 안에서 꽉 차게 들릴 가능성이 큽니다"
    if sound_average >= 3.8:
        return "크게 불리하지 않은 편입니다"
    return "조금 멀게 느껴질 수 있습니다"


def _floor_tradeoff_phrase(evaluation: CandidateEvaluation) -> str:
    view_average = _average_rating(evaluation.evidence, "view")
    sound_average = _average_rating(evaluation.evidence, "sound")

    if evaluation.candidate.floor and evaluation.candidate.floor not in {"1층", "1F"}:
        return "전체 구도는 보이지만 층이 높아 거리감이 더 있고 음향도 멀게 느껴질 수 있습니다"
    if view_average < 3.5 or sound_average < 3.5:
        return "조건에 따라 시야나 음향에서 아쉬움이 생길 수 있습니다"
    return "장점은 있지만 이번 비교에서는 우선순위가 조금 낮습니다"


def _candidate_tradeoff_summary(evaluation: CandidateEvaluation) -> str:
    return (
        f"{evaluation.candidate.label}{_topic_particle(evaluation.candidate.label)} "
        f"장점은 {_candidate_advantage_phrase(evaluation)}. "
        f"단점은 {_candidate_downside_phrase(evaluation)}."
    )


def _topic_particle(value: str) -> str:
    last = next((char for char in reversed(value.strip()) if char.strip()), "")
    code = ord(last) - ord("가")
    if 0 <= code <= ord("힣") - ord("가"):
        return "은" if code % 28 else "는"
    return "은"


def _candidate_advantage_phrase(evaluation: CandidateEvaluation) -> str:
    row = _parse_int(evaluation.candidate.row)

    if evaluation.candidate.side == "center":
        return "정면 시야라 무대 전체와 동선을 안정적으로 보기 좋습니다"
    if "극싸" in evaluation.candidate.label:
        return "가장 앞쪽이라 표정과 디테일을 아주 가까이 볼 수 있습니다"
    if evaluation.candidate.side == "side":
        if row is not None and row <= 3:
            return "앞열이라 표정이 가깝고 통로석이면 드나들기 편합니다"
        return "사이드블록 특유의 가까운 각도와 통로 접근성이 있습니다"
    if evaluation.candidate.side in {"left", "right"}:
        if row is not None and row <= 5:
            return "앞열감이 있고 배우 표정을 가까이 볼 수 있습니다"
        return "특정 동선이나 배우를 가까운 각도로 볼 수 있습니다"
    if row is not None and row <= 5:
        return "무대와 배우를 가까이 볼 수 있습니다"
    return "후기 기준 시야 균형이 괜찮습니다"


def _candidate_downside_phrase(evaluation: CandidateEvaluation) -> str:
    row = _parse_int(evaluation.candidate.row)

    if evaluation.candidate.side == "center":
        if row is not None and row >= 8:
            return "앞열보다 표정 집중감은 덜합니다"
        return "좌석에 따라 가격 대비 가까움은 덜할 수 있습니다"
    if "극싸" in evaluation.candidate.label:
        return "무대가 넓은 극장에서는 반대편 동선과 전체 구도가 많이 빠질 수 있습니다"
    if evaluation.candidate.side == "side":
        return "사이드라 반대편 동선이나 무대 하단이 일부 빠질 수 있습니다"
    if evaluation.candidate.side in {"left", "right"}:
        return "한쪽으로 치우쳐 반대편 장면을 따라가기 불편할 수 있습니다"
    if row is not None and row <= 3:
        return "가까운 대신 무대 전체가 한눈에 덜 들어올 수 있습니다"
    return "정확한 위치에 따라 체감 차이가 날 수 있습니다"


def _build_candidate_comparison_reasons(
    evaluations: list[CandidateEvaluation],
    winner: CandidateEvaluation,
) -> list[str]:
    reasons = [
        f"후보 좌석 {len(evaluations)}개를 각각 검색해서 비교했습니다.",
        f"{winner.candidate.label}의 점수가 가장 높았습니다.",
    ]

    for evaluation in evaluations:
        if evaluation.search_scope.exact_count:
            reasons.append(
                f"{evaluation.candidate.label}은 정확히 맞는 후기 {evaluation.search_scope.exact_count}개를 우선 반영했습니다."
            )
        elif evaluation.evidence:
            reasons.append(
                f"{evaluation.candidate.label}은 주변 좌석 후기를 보조 근거로 반영했습니다."
            )

    return reasons


def _build_reasons(
    filters: AgentFilters,
    evidence: list[EvidenceReview],
    official_section: str | None,
    block: str | None,
    rag_answer: str | None,
) -> list[str]:
    reasons = []
    if filters.theater_name:
        reasons.append(f"{filters.theater_name} 후기를 우선 검색했습니다.")
    if filters.musical_title:
        reasons.append(f"{filters.musical_title} 후기를 우선 검색했습니다.")
    if filters.priorities:
        reasons.append(f"{', '.join(filters.priorities)} 조건을 평점과 태그 정렬에 반영했습니다.")
    if official_section:
        reasons.append(f"공식 구역 {official_section}를 추천 범위로 사용할 수 있습니다.")
    elif block:
        reasons.append(f"공식 구역이 부족해 설명용 { _direction_label(block) } 기준으로 안내했습니다.")
    if rag_answer:
        reasons.append("RAG 답변을 참고 근거로 보강했습니다.")
    reasons.append(f"근거 후기 {len(evidence)}개를 함께 반환했습니다.")
    return reasons


def _build_cautions(evidence: list[EvidenceReview], official_section: str | None) -> list[str]:
    cautions = []
    if len(evidence) < 3:
        cautions.append("근거 후기가 적어 추천 확신도가 높지 않습니다.")
    if official_section is None:
        cautions.append("공식 구역이 없거나 부족해 설명용 블록으로만 안내합니다.")
    if any(any("시야방해" in tag or "사이드" in tag for tag in review.tags) for review in evidence):
        cautions.append("일부 근거에 시야방해나 사이드 시야 태그가 있어 예매 전 좌석표를 확인하세요.")
    return cautions or ["공연별 무대 연출에 따라 체감이 달라질 수 있습니다."]


def _to_evidence(review: dict) -> EvidenceReview:
    seat = review.get("seat") or {}
    tags = [
        tag.get("name", "")
        for tag in (review.get("tags") or [])
        if tag and tag.get("name")
    ]
    performance = review.get("performance") or {}
    return EvidenceReview(
        id=review.get("id", ""),
        theaterName=(review.get("theater") or {}).get("name", ""),
        musicalTitle=(review.get("musical") or {}).get("title", ""),
        seasonLabel=performance.get("seasonLabel"),
        seat=" ".join(
            value
            for value in [
                seat.get("floor"),
                f"{seat.get('section')}구역" if seat.get("section") else None,
                f"{seat.get('row')}열" if seat.get("row") else None,
                f"{seat.get('number')}번" if seat.get("number") else None,
            ]
            if value
        ),
        ratings=review.get("ratings") or {},
        tags=tags,
        content=(review.get("content") or "")[:220],
    )
