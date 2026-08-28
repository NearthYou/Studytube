from __future__ import annotations

import json
import unittest

import quiz_generation as quiz_generation_module
from quiz_generation import (
    QuizGenerationRuntime,
    build_quiz_response,
    configure_quiz_generation_runtime,
)


class FakeOpenAI:
    def __init__(
        self,
        questions: list[dict],
        *,
        grounded: bool = True,
        question_batches: list[list[dict]] | None = None,
    ):
        self.questions = questions
        self.grounded = grounded
        self.question_batches = question_batches or [questions]
        self.generation_calls = 0
        self.response_formats: list[dict] = []
        self.chat = self.Chat(self)

    class Chat:
        def __init__(self, owner):
            self.completions = self.Completions(owner)

        class Completions:
            def __init__(self, owner):
                self.owner = owner

            def create(self, **kwargs):
                self.owner.response_formats.append(kwargs["response_format"])
                system = kwargs["messages"][0]["content"]
                if "검수자" in system:
                    payload = {
                        "verdicts": [
                            {
                                "questionPosition": index + 1,
                                "grounded": self.owner.grounded,
                            }
                            for index in range(5)
                        ]
                    }
                else:
                    batch_index = min(
                        self.owner.generation_calls,
                        len(self.owner.question_batches) - 1,
                    )
                    payload = {
                        "questions": self.owner.question_batches[batch_index]
                    }
                    self.owner.generation_calls += 1
                message = type(
                    "Message",
                    (),
                    {"content": json.dumps(payload, ensure_ascii=False)},
                )()
                choice = type("Choice", (), {"message": message})()
                return type("Response", (), {"choices": [choice]})()


def evidence():
    contents = [
        "C++는 C 언어에 객체 지향 기능을 더해 큰 프로그램을 구조화하기 쉽게 만든 언어입니다.",
        "클래스는 데이터와 그 데이터를 다루는 함수를 하나의 단위로 묶습니다.",
        "캡슐화를 사용하면 객체 내부 구현을 숨기고 필요한 기능만 외부에 공개할 수 있습니다.",
        "상속은 기존 클래스의 동작을 물려받아 중복 코드를 줄이는 데 사용합니다.",
        "다형성은 같은 인터페이스로 서로 다른 객체의 동작을 호출할 수 있게 합니다.",
    ]
    return [
        {
            "resourceId": f"caption-{index + 1}",
            "content": content,
            "sourceUrl": "https://www.youtube.com/watch?v=example",
            "startSeconds": index * 10,
            "endSeconds": index * 10 + 8,
            "artifactId": "42",
            "artifactGeneration": 3,
        }
        for index, content in enumerate(contents)
    ]


def semantic_questions():
    prompts = [
        "C++에 객체 지향 기능이 더해진 주된 이유는 무엇인가요?",
        "클래스가 데이터와 함수를 함께 묶는 이유는 무엇인가요?",
        "캡슐화를 사용했을 때 얻는 이점은 무엇인가요?",
        "상속이 코드 구성에 도움이 되는 방식은 무엇인가요?",
        "다형성을 가장 잘 설명한 것은 무엇인가요?",
    ]
    return [
        {
            "prompt": prompt,
            "choices": [
                "영상에서 설명한 핵심 내용",
                "설명과 관계없는 첫 번째 선택지",
                "설명과 관계없는 두 번째 선택지",
                "설명과 관계없는 세 번째 선택지",
            ],
            "correctChoiceIndex": 0,
            "explanation": "영상에서는 이 개념의 역할과 사용하는 이유를 함께 설명합니다.",
            "evidencePosition": index + 1,
            "supportingQuote": evidence()[index]["content"],
        }
        for index, prompt in enumerate(prompts)
    ]


def payload():
    return {
        "studyContextId": "8",
        "watchedRange": {"start": 0, "end": 60},
        "evidence": evidence(),
    }


class QuizGenerationGraphTest(unittest.TestCase):
    def setUp(self):
        self.original_runtime = quiz_generation_module._runtime

    def tearDown(self):
        quiz_generation_module._runtime = self.original_runtime

    def configure(self, client: FakeOpenAI):
        configure_quiz_generation_runtime(
            QuizGenerationRuntime(
                caption_loader=lambda _payload: {"segments": []},
                openai_client=lambda: client,
            )
        )

    def test_generates_content_questions_and_keeps_time_only_in_citations(self):
        client = FakeOpenAI(semantic_questions())
        self.configure(client)

        response = build_quiz_response(payload())

        self.assertEqual(response["generatorVersion"], "content-quiz-langgraph-v1")
        self.assertEqual(response["orchestration"], "langgraph")
        self.assertEqual(len(response["questions"]), 5)
        for index, question in enumerate(response["questions"]):
            self.assertNotRegex(question["prompt"], r"\d+\s*초")
            self.assertNotIn("근처", question["prompt"])
            self.assertEqual(question["citation"]["resourceId"], f"caption-{index + 1}")
            self.assertEqual(question["citation"]["startSeconds"], index * 10)
        self.assertEqual(
            [item["type"] for item in client.response_formats],
            ["json_schema", "json_schema"],
        )
        self.assertTrue(all(
            item["json_schema"]["strict"] for item in client.response_formats
        ))

    def test_server_pins_generated_questions_to_their_passage_order(self):
        questions = semantic_questions()
        for question in questions:
            question["evidencePosition"] = 1
            question["supportingQuote"] = "모델이 바꿔 쓴 문장"
        self.configure(FakeOpenAI(questions))

        response = build_quiz_response(payload())

        self.assertEqual(
            [question["citation"]["resourceId"] for question in response["questions"]],
            [f"caption-{index + 1}" for index in range(5)],
        )

    def test_rejects_generated_questions_that_test_timestamp_memory(self):
        questions = semantic_questions()
        questions[0]["prompt"] = "0초 근처에서 설명한 내용은 무엇인가요?"
        self.configure(FakeOpenAI(questions))

        with self.assertRaisesRegex(ValueError, "content-based"):
            build_quiz_response(payload())

    def test_rejects_a_blank_word_question_that_does_not_test_understanding(self):
        questions = semantic_questions()
        questions[0]["prompt"] = (
            '다음 문장의 빈칸에 들어갈 표현으로 알맞은 것은 무엇인가요? '
            '"한 시간 동안 ______ 강의예요."'
        )
        self.configure(FakeOpenAI(questions))

        with self.assertRaisesRegex(ValueError, "content-based"):
            build_quiz_response(payload())

    def test_rejects_non_text_choices_instead_of_stringifying_them(self):
        questions = semantic_questions()
        questions[0]["choices"][1] = {"unexpected": "object"}
        self.configure(FakeOpenAI(questions))

        with self.assertRaisesRegex(ValueError, "content-based"):
            build_quiz_response(payload())

    def test_replaces_model_quote_with_the_pinned_passage(self):
        questions = semantic_questions()
        questions[0]["supportingQuote"] = "영상에 전혀 없는 문장"
        self.configure(FakeOpenAI(questions))

        response = build_quiz_response(payload())

        self.assertEqual(response["questions"][0]["citation"]["resourceId"], "caption-1")

    def test_rejects_an_unrelated_question_even_with_a_real_quote(self):
        questions = semantic_questions()
        questions[0]["prompt"] = "화성 탐사선의 통신 방식으로 알맞은 것은 무엇인가요?"
        self.configure(FakeOpenAI(questions, grounded=False))

        with self.assertRaisesRegex(ValueError, "content-based"):
            build_quiz_response(payload())

    def test_allows_a_content_question_about_a_real_duration(self):
        questions = semantic_questions()
        questions[0]["prompt"] = "반죽을 10분 동안 쉬게 하는 이유는 무엇인가요?"
        questions[0]["explanation"] = (
            "10분 동안 기다리면 반죽의 수분이 고르게 퍼지기 때문입니다."
        )
        self.configure(FakeOpenAI(questions))

        response = build_quiz_response(payload())

        self.assertEqual(len(response["questions"]), 5)

    def test_rewrites_one_invalid_draft_before_accepting_the_second(self):
        invalid = semantic_questions()
        invalid[0]["prompt"] = "0초 근처에서 설명한 내용은 무엇인가요?"
        client = FakeOpenAI(
            semantic_questions(),
            question_batches=[invalid, semantic_questions()],
        )
        self.configure(client)

        response = build_quiz_response(payload())

        self.assertEqual(client.generation_calls, 2)
        self.assertEqual(len(response["questions"]), 5)


if __name__ == "__main__":
    unittest.main()
