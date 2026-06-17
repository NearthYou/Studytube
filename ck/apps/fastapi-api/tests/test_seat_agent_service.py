import unittest
import re
from unittest.mock import patch

from app.schemas.agent import SeatRecommendationRequest
from app.services.seat_agent_service import _to_evidence, recommend_seat


class FakeNestClient:
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "블루스퀘어 신한카드홀"}]

        if path == "/musicals":
            return [{"id": "1", "title": "팬텀"}]

        if path == "/seat-reviews/search":
            return {
                "items": [
                    {
                        "id": "10",
                        "theater": {"name": "블루스퀘어 신한카드홀"},
                        "musical": {"title": "팬텀"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "2층",
                            "section": "B",
                            "row": "3",
                            "number": "12",
                        },
                        "ratings": {
                            "view": 5,
                            "sound": 4,
                            "comfort": 5,
                            "expression": 4,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "시야좋음"}],
                        "content": "중앙에 가까워 시야가 안정적이고 오래 앉기에도 괜찮았습니다.",
                    }
                ]
            }

        return []

    def post_json(self, path, body):
        return {
            "answer": "블루스퀘어 2층 3열 시야는 무난한 편이에요. 무대 전체는 따라가기 괜찮지만 표정은 오글이 있는 쪽이 안전합니다."
        }


class RowAwareFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path in {"/theaters", "/musicals"}:
            return super().get_json(path, params)

        if path == "/seat-reviews/search":
            if params and params.get("seatRow") == "3":
                return {
                    "items": [
                        {
                            "id": "20",
                            "theater": {"name": "블루스퀘어 신한카드홀"},
                            "musical": {"title": "지킬 앤 하이드"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "2층",
                                "section": "A",
                                "row": "3",
                                "number": "1",
                            },
                            "ratings": {
                                "view": 3,
                                "sound": 4,
                                "comfort": 5,
                                "expression": 3,
                                "stageVisibility": 4,
                            },
                            "tags": [{"name": "사이드시야"}],
                            "content": "무대 바닥과 대형은 보이지만 배우 얼굴은 오글이 필요했습니다.",
                        }
                    ]
                }

            return {
                "items": [
                    {
                        "id": "21",
                        "theater": {"name": "블루스퀘어 신한카드홀"},
                        "musical": {"title": "지킬 앤 하이드"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "2층",
                            "section": "C",
                            "row": "2",
                            "number": "35",
                        },
                        "ratings": {
                            "view": 4,
                            "sound": 5,
                            "comfort": 3,
                            "expression": 3,
                            "stageVisibility": 5,
                        },
                        "tags": [{"name": "사이드시야"}],
                        "content": "전체 무대는 잘 들어오지만 표정은 오글이 필요했습니다.",
                    },
                    {
                        "id": "22",
                        "theater": {"name": "블루스퀘어 신한카드홀"},
                        "musical": {"title": "지킬 앤 하이드"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "2층",
                            "section": "A",
                            "row": "3",
                            "number": "1",
                        },
                        "ratings": {
                            "view": 3,
                            "sound": 4,
                            "comfort": 5,
                            "expression": 3,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "사이드시야"}],
                        "content": "무대 바닥과 대형은 보이지만 배우 얼굴은 오글이 필요했습니다.",
                    },
                    {
                        "id": "23",
                        "theater": {"name": "블루스퀘어 신한카드홀"},
                        "musical": {"title": "지킬 앤 하이드"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "2층",
                            "section": "B",
                            "row": "4",
                            "number": "20",
                        },
                        "ratings": {
                            "view": 4,
                            "sound": 4,
                            "comfort": 4,
                            "expression": 3,
                            "stageVisibility": 4,
                        },
                        "tags": [],
                        "content": "시야는 무난했고 무대 전체를 따라가기 좋았습니다.",
                    },
                ]
            }

        return []


class ObstructionRangeFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "50", "name": "세종문화회관 대극장"}]

        if path == "/musicals":
            return []

        if path == "/seat-reviews/search":
            self.last_params = params
            return {
                "items": [
                    {
                        "id": "101",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2022"},
                        "seat": {
                            "floor": "1층",
                            "section": "A",
                            "row": "1",
                            "number": "3",
                        },
                        "ratings": {
                            "view": 2,
                            "sound": 4,
                            "comfort": 3,
                            "expression": 3,
                            "stageVisibility": 3,
                        },
                        "tags": [{"name": "시야방해"}],
                        "content": "난간 때문에 시야방해가 있었습니다.",
                    },
                    {
                        "id": "102",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2022"},
                        "seat": {
                            "floor": "1층",
                            "section": "D",
                            "row": "18",
                            "number": "9",
                        },
                        "ratings": {
                            "view": 3,
                            "sound": 4,
                            "comfort": 3,
                            "expression": 3,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "시야방해"}],
                        "content": "앞사람 영향으로 가리는 순간이 있었습니다.",
                    },
                    {
                        "id": "103",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2022"},
                        "seat": {
                            "floor": "2층",
                            "section": "G",
                            "row": "19",
                            "number": "12",
                        },
                        "ratings": {
                            "view": 3,
                            "sound": 4,
                            "comfort": 3,
                            "expression": 2,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "시야방해"}],
                        "content": "난간 때문에 장면 일부가 가렸습니다.",
                    },
                ],
                "hasNext": False,
            }

        return []

    def post_json(self, path, body):
        return {
            "answer": "세종문화회관 대극장 2층 몇열 시야는 좋은 편이에요. 정확히 맞는 후기가 적어서 2층 전체 후기까지 넓혀 봤습니다."
        }


class TheaterAliasFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [
                {"id": "15", "name": "TOM 1관"},
                {"id": "16", "name": "TOM 2관"},
                {"id": "45", "name": "블루스퀘어 신한카드홀"},
                {"id": "50", "name": "세종문화회관 대극장"},
            ]

        if path == "/musicals":
            return []

        if path == "/seat-reviews/search":
            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {}


class CandidateComparisonFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "두산아트센터 연강홀"}]

        if path == "/musicals":
            return [{"id": "1", "title": "랭보"}]

        if path == "/seat-reviews/search":
            row = params.get("seatRow") if params else None

            if row == "4":
                return {
                    "items": [
                        {
                            "id": "301",
                            "theater": {"name": "두산아트센터 연강홀"},
                            "musical": {"title": "랭보"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "C",
                                "row": "4",
                                "number": "10",
                            },
                            "ratings": {
                                "view": 4,
                                "sound": 4,
                                "comfort": 3,
                                "expression": 4,
                                "stageVisibility": 4,
                            },
                            "tags": [{"name": "사이드시야"}],
                            "content": "앞열이라 표정은 잘 보이지만 우블이라 자막과 무대를 번갈아 보기에는 시선 이동이 있습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            if row == "10":
                return {
                    "items": [
                        {
                            "id": "302",
                            "theater": {"name": "두산아트센터 연강홀"},
                            "musical": {"title": "랭보"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "E",
                                "row": "10",
                                "number": "20",
                            },
                            "ratings": {
                                "view": 5,
                                "sound": 4,
                                "comfort": 4,
                                "expression": 4,
                                "stageVisibility": 5,
                            },
                            "tags": [{"name": "시야좋음"}],
                            "content": "중블이라 무대와 자막을 같이 보기 편했고 자첫이어도 흐름 따라가기 좋았습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {"answer": "E구역 중앙블록 위주로 보는 편이 좋습니다."}


class OpSeatFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "광림아트센터 BBCH홀"}]

        if path == "/musicals":
            return [{"id": "1", "title": "지킬앤하이드"}]

        if path == "/seat-reviews/search":
            row = params.get("seatRow") if params else None

            if row == "OP":
                return {
                    "items": [
                        {
                            "id": "401",
                            "theater": {"name": "광림아트센터 BBCH홀"},
                            "musical": {"title": "지킬앤하이드"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "OP",
                                "row": "OP",
                                "number": "8",
                            },
                            "ratings": {
                                "view": 2,
                                "sound": 4,
                                "comfort": 2,
                                "expression": 5,
                                "stageVisibility": 2,
                            },
                            "tags": [{"name": "시야방해"}],
                            "content": "가까워서 표정은 잘 보이지만 무대 하단과 동선이 많이 가려져 자첫이면 추천하기 어렵습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {"answer": "E구역 중앙블록 위주로 보는 편이 좋습니다."}


class RowBlockComparisonFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "광림아트센터 BBCH홀"}]

        if path == "/musicals":
            return [{"id": "1", "title": "지킬앤하이드"}]

        if path == "/seat-reviews/search":
            row = params.get("seatRow") if params else None

            if row == "2":
                return {
                    "items": [
                        {
                            "id": "451",
                            "theater": {"name": "광림아트센터 BBCH홀"},
                            "musical": {"title": "지킬앤하이드"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "C",
                                "row": "2",
                                "number": "1",
                            },
                            "ratings": {
                                "view": 3,
                                "sound": 4,
                                "comfort": 3,
                                "expression": 5,
                                "stageVisibility": 2,
                            },
                            "tags": [{"name": "사이드시야"}, {"name": "통로석"}],
                            "content": "2열 사블통은 표정은 가까우나 사이드라 무대 하단과 반대편 동선이 덜 보였습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            if row == "8":
                return {
                    "items": [
                        {
                            "id": "452",
                            "theater": {"name": "광림아트센터 BBCH홀"},
                            "musical": {"title": "지킬앤하이드"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "E",
                                "row": "8",
                                "number": "18",
                            },
                            "ratings": {
                                "view": 5,
                                "sound": 5,
                                "comfort": 4,
                                "expression": 4,
                                "stageVisibility": 5,
                            },
                            "tags": [{"name": "시야좋음"}],
                            "content": "8열 중블은 무대 전체와 동선을 정면에서 보기 좋고 음향도 안정적이었습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {"answer": "D구역 중앙블록 위주로 보는 편이 좋습니다."}


class ExtremeSideComparisonFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "세종문화회관 대극장"}]

        if path == "/musicals":
            return []

        if path == "/seat-reviews/search":
            row = params.get("seatRow") if params else None

            if row == "2":
                return {
                    "items": [
                        {
                            "id": "471",
                            "theater": {"name": "세종문화회관 대극장"},
                            "musical": {"title": "엘리자벳"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "D",
                                "row": "2",
                                "number": "7",
                            },
                            "ratings": {
                                "view": 5,
                                "sound": 4,
                                "comfort": 3,
                                "expression": 4,
                                "stageVisibility": 5,
                            },
                            "tags": [{"name": "시야좋음"}],
                            "content": "D블록 2열은 가깝지만 극싸보다 무대 전체와 반대편 동선을 따라가기 좋았습니다.",
                        }
                    ],
                    "hasNext": False,
                }

            if row == "1":
                return {
                    "items": [
                        {
                            "id": "472",
                            "theater": {"name": "세종문화회관 대극장"},
                            "musical": {"title": "엘리자벳"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "A",
                                "row": "1",
                                "number": "1",
                            },
                            "ratings": {
                                "view": 2,
                                "sound": 3,
                                "comfort": 3,
                                "expression": 5,
                                "stageVisibility": 2,
                            },
                            "tags": [{"name": "사이드시야"}, {"name": "시야방해"}],
                            "content": "1열 극싸는 표정은 매우 가깝지만 세종처럼 무대가 넓으면 반대편 동선이 많이 빠집니다.",
                        }
                    ],
                    "hasNext": False,
                }

            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {"answer": "D구역 왼쪽블록 위주로 보는 편이 좋습니다."}


class SideComparisonFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "TOM 1관"}]

        if path == "/musicals":
            return [{"id": "1", "title": "랭보"}]

        if path == "/seat-reviews/search":
            return {
                "items": [
                    {
                        "id": "501",
                        "theater": {"name": "TOM 1관"},
                        "musical": {"title": "랭보"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "1층",
                            "section": "D",
                            "row": "6",
                            "number": "12",
                        },
                        "ratings": {
                            "view": 5,
                            "sound": 4,
                            "comfort": 4,
                            "expression": 5,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "시야좋음"}],
                        "content": "들라에 동선과 표정을 보기 좋고 왼쪽 블록 만족도가 높았습니다.",
                    },
                    {
                        "id": "502",
                        "theater": {"name": "TOM 1관"},
                        "musical": {"title": "랭보"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "1층",
                            "section": "C",
                            "row": "6",
                            "number": "18",
                        },
                        "ratings": {
                            "view": 3,
                            "sound": 4,
                            "comfort": 4,
                            "expression": 3,
                            "stageVisibility": 3,
                        },
                        "tags": [{"name": "사이드시야"}],
                        "content": "우블은 일부 장면에서 시선이 치우친다는 후기가 있었습니다.",
                    },
                ],
                "hasNext": False,
            }

        return []

    def post_json(self, path, body):
        return {"answer": "D구역 왼쪽블록 위주로 보는 편이 좋습니다."}


class FloorComparisonFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "블루스퀘어 신한카드홀"}]

        if path == "/musicals":
            return [{"id": "1", "title": "팬텀"}]

        if path == "/seat-reviews/search":
            floor = params.get("seatFloor") if params else None

            if floor == "1층":
                return {
                    "items": [
                        {
                            "id": "601",
                            "theater": {"name": "블루스퀘어 신한카드홀"},
                            "musical": {"title": "팬텀"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "1층",
                                "section": "B",
                                "row": "18",
                                "number": "21",
                            },
                            "ratings": {
                                "view": 4,
                                "sound": 5,
                                "comfort": 4,
                                "expression": 3,
                                "stageVisibility": 5,
                            },
                            "tags": [{"name": "시야좋음"}],
                            "content": "1층 뒷열은 무대 전체가 안정적으로 보이고 음향도 꽉 차게 들립니다.",
                        }
                    ],
                    "hasNext": False,
                }

            if floor == "3층":
                return {
                    "items": [
                        {
                            "id": "602",
                            "theater": {"name": "블루스퀘어 신한카드홀"},
                            "musical": {"title": "팬텀"},
                            "performance": {"seasonLabel": "2025"},
                            "seat": {
                                "floor": "3층",
                                "section": "B",
                                "row": "3",
                                "number": "14",
                            },
                            "ratings": {
                                "view": 3,
                                "sound": 3,
                                "comfort": 3,
                                "expression": 2,
                                "stageVisibility": 4,
                            },
                            "tags": [{"name": "멀리보임"}],
                            "content": "3층 3열은 전체 구도는 보이지만 거리감이 있고 음향이 조금 멀게 느껴집니다.",
                        }
                    ],
                    "hasNext": False,
                }

            return {"items": [], "hasNext": False}

        return []

    def post_json(self, path, body):
        return {"answer": "C구역 오른쪽블록 위주로 보는 편이 좋습니다."}


class FocusRoleRecommendationFakeNestClient(FakeNestClient):
    def get_json(self, path, params=None):
        if path == "/theaters":
            return [{"id": "1", "name": "세종문화회관 대극장"}]

        if path == "/musicals":
            return [{"id": "1", "title": "웃는 남자"}]

        if path == "/seat-reviews/search":
            return {
                "items": [
                    {
                        "id": "701",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "1층",
                            "section": "D",
                            "row": "6",
                            "number": "8",
                        },
                        "ratings": {
                            "view": 4,
                            "sound": 4,
                            "comfort": 4,
                            "expression": 5,
                            "stageVisibility": 5,
                        },
                        "tags": [{"name": "시야좋음"}],
                        "content": "데아 동선이 왼쪽에 자주 붙어서 D구역 왼블은 표정과 동선 보기 좋았습니다.",
                    },
                    {
                        "id": "702",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "1층",
                            "section": "E",
                            "row": "8",
                            "number": "18",
                        },
                        "ratings": {
                            "view": 5,
                            "sound": 4,
                            "comfort": 4,
                            "expression": 3,
                            "stageVisibility": 4,
                        },
                        "tags": [{"name": "시야좋음"}],
                        "content": "중앙이라 전체 시야는 좋지만 데아 동선 체감은 왼블보다 덜했습니다.",
                    },
                    {
                        "id": "703",
                        "theater": {"name": "세종문화회관 대극장"},
                        "musical": {"title": "웃는 남자"},
                        "performance": {"seasonLabel": "2025"},
                        "seat": {
                            "floor": "1층",
                            "section": "F",
                            "row": "1",
                            "number": "28",
                        },
                        "ratings": {
                            "view": 2,
                            "sound": 4,
                            "comfort": 3,
                            "expression": 4,
                            "stageVisibility": 2,
                        },
                        "tags": [{"name": "시야방해"}, {"name": "사이드시야"}],
                        "content": "우블 앞쪽은 난간과 스피커 가림 때문에 데아가 오른쪽에 와도 놓치는 장면이 있었습니다.",
                    },
                ],
                "hasNext": False,
            }

        return []

    def post_json(self, path, body):
        return {"answer": "E구역 중앙블록 위주로 보는 편이 좋습니다."}


class SeatAgentServiceTest(unittest.TestCase):
    def test_to_evidence_tolerates_null_nested_objects(self):
        evidence = _to_evidence(
            {
                "id": "nullish",
                "theater": None,
                "musical": None,
                "performance": None,
                "seat": None,
                "ratings": None,
                "tags": None,
                "content": None,
            }
        )

        self.assertEqual(evidence.id, "nullish")
        self.assertEqual(evidence.theater_name, "")
        self.assertEqual(evidence.musical_title, "")
        self.assertEqual(evidence.seat, "")
        self.assertEqual(evidence.ratings, {})
        self.assertEqual(evidence.tags, [])
        self.assertEqual(evidence.content, "")

    @patch("app.services.seat_agent_service.NestClient", return_value=FakeNestClient())
    def test_recommends_with_evidence_and_mcp_status(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="블루스퀘어 팬텀 2층 시야 좋고 편한 자리 추천해줘",
                theaterName="블루스퀘어 신한카드홀",
                limit=3,
            )
        )

        self.assertEqual(result.official_section, "B")
        self.assertEqual(result.direction, "중앙블록")
        self.assertEqual(result.mcp_status, "ok")
        self.assertEqual(len(result.evidence_reviews), 1)

    @patch("app.services.seat_agent_service.NestClient", return_value=FakeNestClient())
    def test_resolves_theater_alias_from_question(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="블퀘 2층 3열 괜찮아?",
                limit=3,
            )
        )

        self.assertEqual(result.filters.theater_name, "블루스퀘어 신한카드홀")
        self.assertEqual(result.mcp_status, "ok")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=TheaterAliasFakeNestClient(),
    )
    def test_resolves_more_theater_aliases_from_question(self, _):
        cases = [
            ("신카홀 2층 시야 어때?", "블루스퀘어 신한카드홀"),
            ("세종 1층 시야방해 몇열까지야?", "세종문화회관 대극장"),
            ("티오엠 2관 1층 시야 어때?", "TOM 2관"),
        ]

        for question, theater_name in cases:
            with self.subTest(question=question):
                result = recommend_seat(SeatRecommendationRequest(question=question, limit=3))
                self.assertEqual(result.filters.theater_name, theater_name)

    @patch("app.services.seat_agent_service.NestClient", return_value=RowAwareFakeNestClient())
    def test_assesses_view_question_with_nearby_rows_instead_of_recommending(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="블루스퀘어 2층 3열 시야 어때?",
                limit=5,
            )
        )

        self.assertEqual(result.filters.theater_name, "블루스퀘어 신한카드홀")
        self.assertEqual(result.filters.seat_floor, "2층")
        self.assertEqual(result.filters.seat_row, "3")
        self.assertIn("시야는", result.recommendation)
        self.assertNotIn("2~4열", result.recommendation)
        self.assertNotIn("정확히", result.recommendation)
        self.assertNotIn("후기까지 같이", result.recommendation)
        self.assertNotIn("추천 범위", result.recommendation)

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=ObstructionRangeFakeNestClient(),
    )
    def test_answers_obstruction_range_by_floor(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="세종문화회관 2층에서 난간 시야 방해 있는 게 몇열까지야?",
                limit=5,
            )
        )

        self.assertEqual(result.filters.theater_name, "세종문화회관 대극장")
        self.assertEqual(result.filters.seat_floor, "2층")
        self.assertIsNone(result.filters.seat_row)
        self.assertIn("2층은 시야방해 태그가 19열까지", result.recommendation)
        self.assertNotIn("현재 확인한", result.recommendation)
        self.assertIsNone(re.search(r"후기\s*\d+개", result.recommendation))
        self.assertNotIn("시야는 좋은 편", result.recommendation)
        self.assertNotIn("정확히 맞는 후기가 적어서", result.recommendation)

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=CandidateComparisonFakeNestClient(),
    )
    def test_compares_explicit_seat_candidates_instead_of_generic_block_answer(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question=(
                    "지앤하 루시가 본진이고 자첫자막할텐데 뒷열이어도 중블이 나을까? "
                    "1층 우블 4열, 1층 중블 10열 중에서 고민중이야"
                ),
                theaterName="두산아트센터 연강홀",
                musicalTitle="랭보",
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("둘 중", result.recommendation)
        self.assertIn("1층 중블 10열", result.recommendation)
        self.assertIn("1층 우블 4열", result.recommendation)
        self.assertIn("한 번", result.recommendation)
        self.assertIn("루시", result.recommendation)
        self.assertNotIn("자막", result.recommendation)
        self.assertIsNone(re.search(r"\d+점", result.recommendation))
        self.assertNotEqual(result.recommendation, "E구역 중앙블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.official_section, "E")
        self.assertEqual(result.direction, "중앙블록")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=CandidateComparisonFakeNestClient(),
    )
    def test_mentions_focus_subject_for_favorite_aliases_and_combined_cast_role(self, _):
        cases = [
            (
                "지앤하 민영루시 최애라서 1층 우블 4열, 1층 중블 10열 중에서 고민중이야",
                "민영루시",
            ),
            (
                "애배 홍광호지킬이면 1층 우블 4열, 1층 중블 10열 중 어디가 나아?",
                "홍광호지킬",
            ),
            (
                "쿄윈 보러 가는데 1층 우블 4열, 1층 중블 10열 중 어디가 나아?",
                "쿄윈",
            ),
            (
                "쿄윈 보러가는데 1층 우블 4열, 1층 중블 10열 중 어디가 나아?",
                "쿄윈",
            ),
            (
                "쿄윈보러가는데 1층 우블 4열, 1층 중블 10열 중 어디가 나아?",
                "쿄윈",
            ),
            (
                "졔르윈 위주로 볼 건데 1층 우블 4열, 1층 중블 10열 중 어디가 나아?",
                "졔르윈",
            ),
        ]

        for question, expected_focus in cases:
            with self.subTest(question=question):
                result = recommend_seat(
                    SeatRecommendationRequest(
                        question=question,
                        theaterName="두산아트센터 연강홀",
                        musicalTitle="랭보",
                        useRag=True,
                        limit=5,
                    )
                )

                self.assertIn(expected_focus, result.recommendation)
                self.assertIn("중심", result.recommendation)
                self.assertIn("둘 중", result.recommendation)

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=OpSeatFakeNestClient(),
    )
    def test_assesses_op_seat_risk_instead_of_generic_block_answer(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="지앤하 보러 가는데 오피가 나을까? 가리는거 많다고 해서 걱정이네",
                theaterName="광림아트센터 BBCH홀",
                musicalTitle="지킬앤하이드",
                useRag=True,
                limit=5,
            )
        )

        self.assertEqual(result.filters.seat_row, "OP")
        self.assertIn("OP석", result.recommendation)
        self.assertIn("가림", result.recommendation)
        self.assertIn("추천하기 어렵", result.recommendation)
        self.assertNotEqual(result.recommendation, "E구역 중앙블록 위주로 보는 편이 좋습니다.")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=RowBlockComparisonFakeNestClient(),
    )
    def test_compares_row_block_candidates_with_side_aisle_alias(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="지앤하 자첫자막할건데, 2열 사블통이 나을까? 아니면 8열 중블이 나을까?",
                theaterName="광림아트센터 BBCH홀",
                musicalTitle="지킬앤하이드",
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("둘 중", result.recommendation)
        self.assertIn("8열 중블", result.recommendation)
        self.assertIn("2열 사블통", result.recommendation)
        self.assertIn("장점", result.recommendation)
        self.assertIn("단점", result.recommendation)
        self.assertIn("사이드", result.recommendation)
        self.assertNotIn("참고한 근거 후기", result.recommendation)
        self.assertNotIn("자막", result.recommendation)
        self.assertNotEqual(result.recommendation, "D구역 중앙블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.filters.seat_row, "8")
        self.assertEqual(result.direction, "중앙블록")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=ExtremeSideComparisonFakeNestClient(),
    )
    def test_compares_extreme_side_alias_against_named_block(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question=(
                    "세종에서 지금 고민중인데, 2열 d블록, 1열 극싸 중에서 고민중이야. "
                    "세종은 무대가 양옆으로 너무 넓은데 어디를 가는게 좋을까?"
                ),
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("둘 중", result.recommendation)
        self.assertIn("2열 D구역", result.recommendation)
        self.assertIn("1열 극싸", result.recommendation)
        self.assertIn("장점", result.recommendation)
        self.assertIn("단점", result.recommendation)
        self.assertIn("무대가 넓", result.recommendation)
        self.assertIn("1열 극싸는", result.recommendation)
        self.assertNotIn("극싸은", result.recommendation)
        self.assertNotIn("점.", result.recommendation)
        self.assertNotEqual(result.recommendation, "D구역 왼쪽블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.filters.theater_name, "세종문화회관 대극장")
        self.assertEqual(result.filters.seat_row, "2")
        self.assertEqual(result.direction, "왼쪽블록")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=SideComparisonFakeNestClient(),
    )
    def test_compares_side_candidates_without_row_or_floor(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="랭보 들라에 보려면 우블이 나아, 왼블이 나아?",
                theaterName="TOM 1관",
                musicalTitle="랭보",
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("둘 중", result.recommendation)
        self.assertIn("왼블", result.recommendation)
        self.assertIn("우블", result.recommendation)
        self.assertNotEqual(result.recommendation, "D구역 왼쪽블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.direction, "왼쪽블록")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=FloorComparisonFakeNestClient(),
    )
    def test_compares_floor_candidates_with_view_seat_and_sound_details(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="블퀘 1층 뒷열이 나을까, 3층 3열이 나을까?",
                theaterName="블루스퀘어 신한카드홀",
                musicalTitle="팬텀",
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("둘 중", result.recommendation)
        self.assertIn("1층 뒷열", result.recommendation)
        self.assertIn("3층 3열", result.recommendation)
        self.assertIn("시야", result.recommendation)
        self.assertIn("자리", result.recommendation)
        self.assertIn("음향", result.recommendation)
        self.assertNotIn("참고한 근거 후기", result.recommendation)
        self.assertNotEqual(result.recommendation, "C구역 오른쪽블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.filters.seat_floor, "1층")

    @patch(
        "app.services.seat_agent_service.NestClient",
        return_value=FocusRoleRecommendationFakeNestClient(),
    )
    def test_focus_role_recommendation_uses_movement_reviews_and_obstruction_warning(self, _):
        result = recommend_seat(
            SeatRecommendationRequest(
                question="웃남 데아보러 가는데 어떤 자리가 좋을까?",
                theaterName="세종문화회관 대극장",
                musicalTitle="웃는 남자",
                useRag=True,
                limit=5,
            )
        )

        self.assertIn("데아", result.recommendation)
        self.assertIn("왼쪽", result.recommendation)
        self.assertIn("D구역", result.recommendation)
        self.assertIn("시야방해", result.recommendation)
        self.assertIn("피하는", result.recommendation)
        self.assertNotEqual(result.recommendation, "E구역 중앙블록 위주로 보는 편이 좋습니다.")
        self.assertEqual(result.direction, "왼쪽블록")


if __name__ == "__main__":
    unittest.main()
