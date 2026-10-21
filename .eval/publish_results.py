"""Publish evaluation records without full captions or machine-local logs."""

import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
QUESTION_FIELDS = ("prompt", "choices", "correctChoiceIndex", "explanation", "evidencePosition")


def public_quiz_records(records: list[dict]) -> dict:
    videos = []
    for record in records:
        video_id = record["videoId"]
        video = {
            "videoId": video_id,
            "sourceUrl": f"https://www.youtube.com/watch?v={video_id}",
            "durationSeconds": record.get("durationSeconds"),
            "evidenceRanges": record.get("evidenceRanges", []),
            "evidenceSha256": [hashlib.sha256(text.encode("utf-8")).hexdigest()
                               for text in record.get("evidence", [])],
            "validationPassed": record.get("saved", False),
            "finalError": record.get("finalError"),
            "attempts": [],
        }
        if "skipped" in record:
            video["skipped"] = record["skipped"]
        for attempt in record.get("attempts", []):
            video["attempts"].append({
                "questions": [{key: question[key] for key in QUESTION_FIELDS if key in question}
                              for question in attempt.get("questions", [])],
                "formatError": attempt.get("formatError"),
                "groundingError": attempt.get("groundingError"),
                "verdicts": [{key: verdict[key] for key in ("questionPosition", "grounded", "reason")
                              if key in verdict} for verdict in attempt.get("verdicts") or []],
            })
        videos.append(video)
    return {
        "schemaVersion": 1,
        "recordedOn": "2026-10-18",
        "meaning": "Model grounding checks, not human-labeled accuracy or database writes.",
        "omitted": ["Full captions", "supportingQuote", "local logs", "credentials"],
        "videos": videos,
    }


def quiz_summary(videos: list[dict]) -> dict:
    evaluated = [video for video in videos if "skipped" not in video]
    first = [video["attempts"][0] for video in evaluated if video["attempts"]]
    checked = [attempt for attempt in first if not attempt.get("formatError")]
    retried = [video for video in evaluated if len(video["attempts"]) > 1]
    ungrounded = sum(5 - len({verdict.get("questionPosition")
                             for verdict in attempt.get("verdicts") or []
                             if verdict.get("grounded") is True
                             and verdict.get("questionPosition") in (1, 2, 3, 4, 5)})
                     for attempt in checked)
    passed = sum(video.get("validationPassed", False) for video in evaluated)
    for video in evaluated:
        if video.get("validationPassed"):
            if not video["attempts"] or video.get("finalError"):
                raise ValueError("A passing video needs an attempt and no final error")
            last = video["attempts"][-1]
            if last.get("formatError") or last.get("groundingError"):
                raise ValueError("A passing video cannot have a final validation error")
    return {
        "videos": len(videos), "evaluated": len(evaluated),
        "skipped": len(videos) - len(evaluated),
        "firstAttemptPassed": sum(not a.get("formatError") and not a.get("groundingError") for a in first),
        "firstAttemptFormatFailed": sum(bool(a.get("formatError")) for a in first),
        "firstAttemptGroundingFailed": sum(bool(a.get("groundingError")) for a in checked),
        "firstAttemptQuestionsChecked": len(checked) * 5,
        "firstAttemptQuestionsUngrounded": ungrounded,
        "retried": len(retried),
        "savedAfterRetry": sum(video.get("validationPassed", False) for video in retried),
        "saved": passed, "rejected": len(evaluated) - passed,
        "formatErrors": [a["formatError"] for a in first if a.get("formatError")],
    }


def verify_retrieval(report: dict) -> None:
    queries = report["queries"]
    if len(queries) != report["queryCount"] or not queries:
        raise ValueError("Retrieval query count mismatch")
    for mode in ("lexical", "vector", "hybrid"):
        recall, reciprocal, ndcg, coverage, timings = [], [], [], [], []
        for query in queries:
            relevant = {item["sourceKey"]: item for item in query["relevant"]}
            hits = query["modes"][mode]["hits"]
            recall.append(len({h["sourceKey"] for h in hits[:3] if h["sourceKey"] in relevant}) / len(relevant))
            first = next((i for i, h in enumerate(hits) if h["sourceKey"] in relevant), None)
            reciprocal.append(0 if first is None else 1 / (first + 1))
            dcg = sum(1 / math.log2(i + 2) for i, h in enumerate(hits[:5]) if h["sourceKey"] in relevant)
            ideal = sum(1 / math.log2(i + 2) for i in range(min(5, len(relevant))))
            ndcg.append(dcg / ideal)
            cited = 0
            for key, judgment in relevant.items():
                hit = next((h for h in hits[:5] if h["sourceKey"] == key), None)
                citation = hit.get("citation", {}) if hit else {}
                stamp = citation.get("timestampSeconds")
                if citation.get("sourceUrl", "").strip() and stamp is not None:
                    cited += judgment.get("minTimestampSeconds", 0) <= stamp <= judgment.get("maxTimestampSeconds", math.inf)
            coverage.append(cited / len(relevant))
            timings.append(query["modes"][mode]["latencyMs"])
        computed = {"recallAt3": round(sum(recall) / len(queries), 6),
                    "mrr": round(sum(reciprocal) / len(queries), 6),
                    "ndcgAt5": round(sum(ndcg) / len(queries), 6),
                    "citationCoverage": round(sum(coverage) / len(queries), 6),
                    "retrievalP95Ms": round(sorted(timings)[math.ceil(len(timings) * .95) - 1], 3)}
        if computed != report["quality"][mode]:
            raise ValueError(f"Retrieval metrics mismatch: {mode}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check committed results without API or DB calls")
    args = parser.parse_args()
    public_path = ROOT / "quiz-results.public.json"
    if not args.check:
        raw = json.loads((ROOT / "quiz-eval.json").read_text(encoding="utf-8"))
        public_path.write_text(json.dumps(public_quiz_records(raw), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    public = json.loads(public_path.read_text(encoding="utf-8"))
    expected = json.loads((ROOT / "quiz-eval-summary.json").read_text(encoding="utf-8"))
    if quiz_summary(public["videos"]) != expected:
        raise ValueError("Quiz summary mismatch")
    for name in ("retrieval-evaluation.json", "retrieval-evaluation.before.json"):
        verify_retrieval(json.loads((ROOT / name).read_text(encoding="utf-8")))
    forbidden = ("supportingQuote", "evidence", "apiKey", "password", "token")
    def check_keys(value):
        if isinstance(value, dict):
            if any(key in forbidden for key in value):
                raise ValueError("Private raw field in public quiz records")
            for child in value.values():
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(public)
    print("Evaluation records verified: 27 videos, 135 initial questions, 10 retrieval queries.")


if __name__ == "__main__":
    main()
