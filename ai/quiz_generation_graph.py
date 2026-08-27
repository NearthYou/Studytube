from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TypedDict, cast

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime


class QuizGenerationGraphState(TypedDict):
    evidence: list[dict[str, Any]]
    questions: list[dict[str, Any]]
    attempt: int
    validation_error: str | None
    usage: dict[str, Any]


QuizDraftGenerator = Callable[
    [list[dict[str, Any]], str | None], dict[str, Any]
]
QuizValidator = Callable[
    [list[dict[str, Any]], list[dict[str, Any]]], dict[str, Any]
]


@dataclass(frozen=True)
class QuizGenerationGraphContext:
    generate_draft: QuizDraftGenerator
    validate_draft: QuizValidator


def create_quiz_generation_graph():
    workflow = StateGraph(
        QuizGenerationGraphState,
        context_schema=QuizGenerationGraphContext,
    )

    def generate_questions(
        state: QuizGenerationGraphState,
        runtime: Runtime[QuizGenerationGraphContext],
    ) -> dict[str, Any]:
        draft = runtime.context.generate_draft(
            state["evidence"], state["validation_error"]
        )
        return {
            "questions": draft.get("questions") or [],
            "attempt": state["attempt"] + 1,
            "usage": merge_usage(state["usage"], draft.get("usage") or {}),
        }

    def validate_questions(
        state: QuizGenerationGraphState,
        runtime: Runtime[QuizGenerationGraphContext],
    ) -> dict[str, Any]:
        result = runtime.context.validate_draft(
            state["questions"], state["evidence"]
        )
        return {
            "validation_error": result.get("error"),
            "usage": merge_usage(state["usage"], result.get("usage") or {}),
        }

    def route_after_validation(state: QuizGenerationGraphState) -> str:
        if state["validation_error"] is None:
            return "done"
        if state["attempt"] < 2:
            return "retry"
        return "done"

    workflow.add_node("generate_questions", generate_questions)
    workflow.add_node("validate_questions", validate_questions)
    workflow.add_edge(START, "generate_questions")
    workflow.add_edge("generate_questions", "validate_questions")
    workflow.add_conditional_edges(
        "validate_questions",
        route_after_validation,
        {"retry": "generate_questions", "done": END},
    )
    return workflow.compile(name="studytube-content-quiz")


QUIZ_GENERATION_GRAPH = create_quiz_generation_graph()


def merge_usage(current: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": incoming.get("model") or current.get("model"),
        "totalTokens": int(current.get("totalTokens") or 0)
        + int(incoming.get("totalTokens") or 0),
    }


def run_quiz_generation_graph(
    evidence: list[dict[str, Any]],
    *,
    generate_draft: QuizDraftGenerator,
    validate_draft: QuizValidator,
) -> QuizGenerationGraphState:
    initial: QuizGenerationGraphState = {
        "evidence": evidence,
        "questions": [],
        "attempt": 0,
        "validation_error": None,
        "usage": {},
    }
    return cast(
        QuizGenerationGraphState,
        QUIZ_GENERATION_GRAPH.invoke(
            initial,
            context=QuizGenerationGraphContext(
                generate_draft=generate_draft,
                validate_draft=validate_draft,
            ),
        ),
    )
