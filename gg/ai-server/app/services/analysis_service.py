import json
import os
import urllib.error
import urllib.request
from typing import Optional, Tuple

from dotenv import load_dotenv

from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    ExerciseRecord,
    PostRecord,
    ReferencedPostRecord,
)

load_dotenv()


ALIASES = {
    "bench": "벤치프레스",
    "bench press": "벤치프레스",
    "벤치": "벤치프레스",
    "벤치프레스": "벤치프레스",
    "squat": "스쿼트",
    "스쿼트": "스쿼트",
    "deadlift": "데드리프트",
    "데드": "데드리프트",
    "데드리프트": "데드리프트",
    "lat pulldown": "랫풀다운",
    "랫풀": "랫풀다운",
    "랫풀다운": "랫풀다운",
    "ohp": "오버헤드프레스",
    "overhead press": "오버헤드프레스",
    "오버헤드프레스": "오버헤드프레스",
}


def _normalize_name(name: str) -> str:
    cleaned_name = name.strip()
    return ALIASES.get(cleaned_name.lower(), cleaned_name).lower()


def _format_sets(exercise: ExerciseRecord) -> str:
    reps = [str(set_record.reps) for set_record in exercise.sets]
    return "/".join(reps) if reps else "기록 없음"


def _total_reps(exercise: ExerciseRecord) -> int:
    return sum(set_record.reps for set_record in exercise.sets)


def _find_matching_exercise(
    current_exercise: ExerciseRecord,
    previous_post: PostRecord,
) -> Optional[ExerciseRecord]:
    current_name = _normalize_name(current_exercise.exerciseName)

    for previous_exercise in previous_post.exercises:
        if _normalize_name(previous_exercise.exerciseName) == current_name:
            return previous_exercise

    return None


def _find_first_comparable_pair(
    request: AnalysisRequest,
) -> Optional[Tuple[ExerciseRecord, PostRecord, ExerciseRecord]]:
    for current_exercise in request.currentPost.exercises:
        for previous_post in request.previousPosts:
            previous_exercise = _find_matching_exercise(current_exercise, previous_post)

            if previous_exercise:
                return current_exercise, previous_post, previous_exercise

    return None


def _build_referenced_posts(request: AnalysisRequest) -> list[ReferencedPostRecord]:
    referenced_posts: list[ReferencedPostRecord] = []

    for previous_post in request.previousPosts:
        matched_exercises: list[str] = []

        for current_exercise in request.currentPost.exercises:
            previous_exercise = _find_matching_exercise(current_exercise, previous_post)

            if previous_exercise:
                matched_exercises.append(previous_exercise.exerciseName)

        referenced_posts.append(
            ReferencedPostRecord(
                id=previous_post.id,
                title=previous_post.title,
                date=previous_post.date,
                matchedExercises=matched_exercises,
            )
        )

    return referenced_posts


def _build_rule_based_analysis(request: AnalysisRequest) -> AnalysisResponse:
    referenced_posts = _build_referenced_posts(request)
    comparable_pair = _find_first_comparable_pair(request)
    previous_count = len(request.previousPosts)

    if not request.currentPost.exercises:
        return AnalysisResponse(
            summary=f"{request.currentPost.title} 기록입니다. 아직 운동 항목이 부족합니다.",
            recommendation="운동명, 무게, 세트별 반복 수를 먼저 기록해야 이전 기록과 비교할 수 있습니다.",
            nextGoal="다음 기록에는 최소 1개 이상의 운동과 세트 기록을 남겨보세요.",
            referencedPostCount=previous_count,
            referencedPosts=referenced_posts,
            basis=["현재 게시글에 운동 항목이 없습니다."],
            analysisMode="rule-based",
        )

    if not comparable_pair:
        first_exercise = request.currentPost.exercises[0]
        current_sets = _format_sets(first_exercise)

        return AnalysisResponse(
            summary=f"{request.currentPost.title} 기록입니다. {first_exercise.exerciseName}는 {first_exercise.weightKg:g}kg으로 {current_sets}회를 수행했습니다.",
            recommendation="같은 운동명의 이전 기록이 부족합니다. 오늘 기록을 기준점으로 두고 다음 운동에서 같은 조건으로 한 번 더 기록해보세요.",
            nextGoal=f"다음 운동에서는 {first_exercise.exerciseName}를 {first_exercise.weightKg:g}kg으로 진행하면서 목표 반복 수를 안정적으로 채우는 것을 우선하세요.",
            referencedPostCount=previous_count,
            referencedPosts=referenced_posts,
            basis=[
                "같은 사용자 기록만 조회했습니다.",
                "현재 게시글보다 과거 날짜의 기록만 비교했습니다.",
                "같은 운동명 기록이 없어 현재 기록을 기준점으로 삼았습니다.",
            ],
            analysisMode="rule-based",
        )

    current_exercise, previous_post, previous_exercise = comparable_pair
    current_total = _total_reps(current_exercise)
    previous_total = _total_reps(previous_exercise)
    reps_delta = current_total - previous_total
    weight_delta = current_exercise.weightKg - previous_exercise.weightKg
    current_sets = _format_sets(current_exercise)
    previous_sets = _format_sets(previous_exercise)
    target_reps = current_exercise.targetReps
    target_reps_pattern = (
        "/".join(str(target_reps) for _ in current_exercise.sets)
        if target_reps and current_exercise.sets
        else None
    )
    hit_target = bool(
        target_reps
        and current_exercise.sets
        and all(set_record.reps >= target_reps for set_record in current_exercise.sets)
    )

    if weight_delta > 0:
        progress_sentence = f"지난 기록보다 무게가 {weight_delta:g}kg 증가했습니다."
    elif reps_delta > 0:
        progress_sentence = f"같은 무게 기준 총 반복 수가 {reps_delta}회 증가했습니다."
    elif reps_delta == 0:
        progress_sentence = "지난 기록과 비슷한 수준을 유지했습니다."
    else:
        progress_sentence = (
            f"지난 기록보다 총 반복 수가 {abs(reps_delta)}회 줄었습니다."
        )

    if hit_target:
        next_goal = f"다음 운동에서는 컨디션이 좋다면 {current_exercise.exerciseName}를 {current_exercise.weightKg + 2.5:g}kg으로 소폭 증량해보세요."
        recommendation = "목표 반복 수를 모두 채웠기 때문에 무게를 아주 조금 올려볼 수 있습니다. 단, 자세가 흔들리면 현재 무게를 유지하세요."
    elif reps_delta > 0:
        next_goal = (
            f"다음 운동에서는 {current_exercise.exerciseName}를 {current_exercise.weightKg:g}kg으로 유지하고 {target_reps_pattern}에 가까워지는 것을 목표로 해보세요."
            if target_reps_pattern
            else f"다음 운동에서는 {current_exercise.exerciseName}를 {current_exercise.weightKg:g}kg으로 유지하고 마지막 세트 반복 수를 1회 늘려보세요."
        )
        recommendation = "발전이 있으므로 바로 증량하기보다 현재 무게에서 반복 수를 먼저 채우는 것이 좋습니다."
    else:
        next_goal = f"다음 운동에서는 {current_exercise.exerciseName}를 {current_exercise.weightKg:g}kg으로 유지하고 첫 세트부터 안정적인 반복 수를 회복해보세요."
        recommendation = "이번 기록은 무리하게 증량하기보다 같은 무게로 안정성을 다시 확인하는 쪽이 좋습니다."

    return AnalysisResponse(
        summary=f"{current_exercise.exerciseName}는 이전 {previous_exercise.weightKg:g}kg {previous_sets}회에서 현재 {current_exercise.weightKg:g}kg {current_sets}회로 기록됐습니다. {progress_sentence}",
        recommendation=recommendation,
        nextGoal=next_goal,
        referencedPostCount=previous_count,
        referencedPosts=referenced_posts,
        basis=[
            "같은 사용자 기록만 조회했습니다.",
            "현재 게시글보다 과거 날짜의 기록만 비교했습니다.",
            "같은 운동명 기록을 우선 비교했습니다.",
            f"가장 가까운 비교 기록: {previous_post.date} / {previous_post.title}",
        ],
        analysisMode="rule-based",
    )


def _build_prompt(request: AnalysisRequest) -> str:
    current_lines = _format_post_for_prompt(request.currentPost)
    previous_lines = "\n\n".join(
        _format_post_for_prompt(previous_post)
        for previous_post in request.previousPosts
    )

    return f"""
너는 운동 초보자를 돕는 기록 분석 보조자다.
의학 조언, 부상 진단, 치료 조언은 하지 않는다.
점진적 과부하 관점에서 현재 기록과 이전 기록을 비교한다.

응답은 반드시 JSON으로만 작성한다.
필드는 summary, recommendation, nextGoal, basis 배열을 포함한다.

[현재 기록]
{current_lines}

[이전 기록]
{previous_lines if previous_lines else "같은 운동명의 이전 기록이 없습니다."}
""".strip()


def _format_post_for_prompt(post: PostRecord) -> str:
    exercise_lines = []

    for exercise in post.exercises:
        exercise_lines.append(
            f"- {exercise.exerciseName}: {exercise.weightKg:g}kg, 세트 {_format_sets(exercise)}, 목표 {exercise.targetReps or '없음'}"
        )

    return "\n".join(
        [
            f"게시글 ID: {post.id}",
            f"제목: {post.title}",
            f"날짜: {post.date}",
            f"운동 부위: {post.bodyPart}",
            f"메모: {post.memo or '없음'}",
            "운동 기록:",
            *exercise_lines,
        ]
    )


def _extract_output_text(response_body: dict) -> str:
    output_text = response_body.get("output_text")

    if isinstance(output_text, str):
        return output_text

    output_items = response_body.get("output", [])

    for item in output_items:
        for content in item.get("content", []):
            text = content.get("text")

            if isinstance(text, str):
                return text

    return ""


def _call_openai_analysis(request: AnalysisRequest) -> Optional[AnalysisResponse]:
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return None

    prompt = _build_prompt(request)
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    request_body = json.dumps(
        {
            "model": model,
            "input": prompt,
            "store": False,
            "max_output_tokens": 700,
        }
    ).encode("utf-8")

    http_request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=request_body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(http_request, timeout=20) as response:
            response_body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    output_text = _extract_output_text(response_body)

    try:
        parsed = json.loads(output_text)
    except json.JSONDecodeError:
        return None

    fallback = _build_rule_based_analysis(request)
    basis = parsed.get("basis") if isinstance(parsed, dict) else None

    if not isinstance(parsed, dict):
        return None

    if not isinstance(basis, list) or not all(isinstance(item, str) for item in basis):
        basis = fallback.basis

    return AnalysisResponse(
        summary=parsed.get("summary") or fallback.summary,
        recommendation=parsed.get("recommendation") or fallback.recommendation,
        nextGoal=parsed.get("nextGoal") or fallback.nextGoal,
        referencedPostCount=fallback.referencedPostCount,
        referencedPosts=fallback.referencedPosts,
        basis=basis,
        analysisMode="openai",
    )


def make_demo_analysis(request: AnalysisRequest) -> AnalysisResponse:
    openai_analysis = _call_openai_analysis(request)

    if openai_analysis:
        return openai_analysis

    return _build_rule_based_analysis(request)
