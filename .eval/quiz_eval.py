# 퀴즈 생성 평가: 실제 영상 자막으로 저장소의 퀴즈 생성 그래프를 돌려
# 형식 검사와 내용 검수에서 걸린 문제를 기록한다. 결과는 .eval/quiz-eval.json,
# 직접 확인용 목록은 .eval/quiz-review.md 에 남긴다.
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ai"))
EVAL = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env(ROOT / ".env")

from openai import OpenAI  # noqa: E402
from youtube_transcript_api import YouTubeTranscriptApi  # noqa: E402
import quiz_generation as qg  # noqa: E402
from quiz_generation_graph import run_quiz_generation_graph  # noqa: E402

VIDEO_IDS = [
    "LlvBzyy-558", "novnyCaa7To", "7t2alSnE2-I", "qw--VYLpxG4", "v7AYKMP6rOE",
    "f2O6mQkFiiw", "rfscVS0vtbw", "PkZNo7MFNFg", "iCvmsMzlF7o", "Ks-_Mh1QhMc",
    "qp0HIF3SfI4", "fqMOX6JJhGo", "RGOj5yH7evk", "HXV3zeQKqGY", "i_LwzRVP7bg",
    "5Zg-C8AAIGg", "d0yGdNEWdn0", "o_XVt5rdpFY", "arj7oStGLkU", "fLJsdqxnZb0",
    "eIho2S0ZahI", "X48VuDVv0do", "BwuLxPH8IDs", "wm5gMKuwSYk", "O-6f5wQXSu8",
    "gedoSfZvBgE", "xxpc-HPKN28",
]


def build_evidence(video_id: str, rows: list[dict], count: int = 5, max_chars: int = 3000):
    """api/src/learning/quiz-evidence-sampling.ts 의 buildQuizEvidencePassages 와 같은 규칙."""
    ordered = sorted(rows, key=lambda r: (r["start"], r["end"]))
    if len(ordered) < count:
        return []
    passages = []
    for index in range(count):
        start = (index * len(ordered)) // count
        end = ((index + 1) * len(ordered)) // count
        bucket = ordered[start:end]
        content = " ".join(r["text"].strip() for r in bucket if r["text"].strip())[:max_chars].strip()
        passages.append({
            "resourceId": f"eval:{video_id}:{index}",
            "content": content,
            "sourceUrl": f"https://www.youtube.com/watch?v={video_id}",
            "startSeconds": int(bucket[0]["start"]),
            "endSeconds": max(int(bucket[-1]["end"]), int(bucket[0]["start"]) + 1),
            "artifactId": "eval",
            "artifactGeneration": 1,
        })
    return qg.validate_provided_evidence(passages)


class RecordingClient:
    """OpenAI 호출을 그대로 보내고 내용 검수 응답을 기록한다."""

    def __init__(self, client):
        self._client = client
        self.verdict_log: list = []
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        response = self._client.chat.completions.create(**kwargs)
        if kwargs.get("response_format") is qg.QUIZ_GROUNDING_RESPONSE_FORMAT:
            try:
                parsed = json.loads(response.choices[0].message.content or "{}")
                self.verdict_log.append(parsed.get("verdicts"))
            except Exception:
                self.verdict_log.append(None)
        return response


def fetch_rows(api: YouTubeTranscriptApi, video_id: str):
    fetched = api.fetch(video_id, languages=["en", "en-US", "en-GB"])
    return [
        {"text": s.text, "start": float(s.start), "end": float(s.start) + float(s.duration)}
        for s in fetched
    ]


def main() -> None:
    client = RecordingClient(OpenAI(timeout=60.0, max_retries=2))
    api = YouTubeTranscriptApi()
    results = []
    for video_id in VIDEO_IDS:
        record = {"videoId": video_id, "attempts": []}
        try:
            rows = fetch_rows(api, video_id)
            evidence = build_evidence(video_id, rows)
            if not evidence:
                raise ValueError("자막 문장이 다섯 개보다 적음")
            record["durationSeconds"] = int(rows[-1]["end"])
            record["evidenceRanges"] = [[e["startSeconds"], e["endSeconds"]] for e in evidence]
        except Exception as exc:  # 자막을 못 가져온 영상은 평가에서 제외
            record["skipped"] = f"{type(exc).__name__}: {exc}"[:300]
            results.append(record)
            print(video_id, "skip", record["skipped"][:120], flush=True)
            continue

        def generate(items, feedback, _record=record):
            draft = qg.generate_quiz_draft(client, items, feedback)
            _record["attempts"].append({"feedback": feedback, "questions": draft["questions"]})
            return draft

        def validate(questions, items, _record=record):
            attempt = _record["attempts"][-1]
            format_error = qg.quiz_validation_error(questions, items)
            attempt["formatError"] = format_error
            if format_error:
                return {"error": format_error, "usage": {}}
            before = len(client.verdict_log)
            result = qg.verify_quiz_grounding(client, questions, items)
            attempt["groundingError"] = result["error"]
            attempt["verdicts"] = client.verdict_log[before] if len(client.verdict_log) > before else None
            return result

        try:
            state = run_quiz_generation_graph(evidence, generate_draft=generate, validate_draft=validate)
            record["saved"] = state["validation_error"] is None
            record["finalError"] = state["validation_error"]
        except Exception as exc:
            record["saved"] = False
            record["finalError"] = f"{type(exc).__name__}: {exc}"[:300]
        record["evidence"] = [e["content"][:3000] for e in evidence]
        results.append(record)
        first = record["attempts"][0] if record["attempts"] else {}
        print(video_id, "saved" if record["saved"] else "rejected",
              "| 1차:", first.get("formatError") or first.get("groundingError") or "통과",
              "| 시도", len(record["attempts"]), flush=True)
        time.sleep(1)

    (EVAL / "quiz-eval.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    write_summary(results)


def write_summary(results: list) -> None:
    evaluated = [r for r in results if "skipped" not in r]
    first = [r["attempts"][0] for r in evaluated if r["attempts"]]
    format_fail = [a for a in first if a.get("formatError")]
    grounding_checked = [a for a in first if not a.get("formatError")]
    grounding_fail = [a for a in grounding_checked if a.get("groundingError")]
    ungrounded_questions = 0
    checked_questions = 0
    for a in grounding_checked:
        verdicts = a.get("verdicts") or []
        checked_questions += 5
        ok = {v.get("questionPosition") for v in verdicts if isinstance(v, dict) and v.get("grounded") is True}
        ungrounded_questions += 5 - len(ok & {1, 2, 3, 4, 5})
    retried = [r for r in evaluated if len(r["attempts"]) > 1]
    saved = [r for r in evaluated if r.get("saved")]
    summary = {
        "videos": len(results),
        "evaluated": len(evaluated),
        "skipped": len(results) - len(evaluated),
        "firstAttemptPassed": len(first) - len(format_fail) - len(grounding_fail),
        "firstAttemptFormatFailed": len(format_fail),
        "firstAttemptGroundingFailed": len(grounding_fail),
        "firstAttemptQuestionsChecked": checked_questions,
        "firstAttemptQuestionsUngrounded": ungrounded_questions,
        "retried": len(retried),
        "savedAfterRetry": len([r for r in retried if r.get("saved")]),
        "saved": len(saved),
        "rejected": len(evaluated) - len(saved),
        "formatErrors": [a["formatError"] for a in format_fail],
    }
    (EVAL / "quiz-eval-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    lines = ["# 검수에 걸린 문제 직접 확인 목록", "",
             "각 문제의 근거 자막을 읽고 검수 판정이 맞는지 표시하세요.", ""]
    for r in evaluated:
        for n, a in enumerate(r["attempts"], 1):
            verdicts = a.get("verdicts") or []
            bad = [v.get("questionPosition") for v in verdicts if isinstance(v, dict) and v.get("grounded") is not True]
            if not bad:
                continue
            for pos in bad:
                if not isinstance(pos, int) or not 1 <= pos <= len(a["questions"]):
                    continue
                q = a["questions"][pos - 1]
                lines += [f"## {r['videoId']} {n}차 시도 {pos}번", "",
                          f"- 질문: {q.get('prompt')}",
                          f"- 정답: {q.get('choices', [''] * 4)[q.get('correctChoiceIndex', 0)] if isinstance(q.get('choices'), list) else ''}",
                          f"- 해설: {q.get('explanation')}",
                          f"- 근거 자막: {r['evidence'][pos - 1][:1200]}",
                          "- 내 판단: [ ] 검수가 맞음  [ ] 검수가 틀림", ""]
    (EVAL / "quiz-review.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
