import os
import unittest

import youtube_search

try:
    import video_recommendation
except ModuleNotFoundError:
    video_recommendation = None

rank_video_candidates = getattr(video_recommendation, "rank_video_candidates", None)
select_course_sequence = getattr(video_recommendation, "select_course_sequence", None)


class VideoRecommendationTest(unittest.TestCase):
    def test_understands_a_natural_korean_learning_request_as_the_subject(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "cpp-natural",
                    "title": "C++ 기초 강의",
                    "channel": "코딩 교실",
                    "sourceUrl": "https://youtu.be/cpp-natural",
                    "summary": "초보자를 위한 C++ 문법",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                }
            ],
            {
                "subject": "C++를 20분씩 기초부터 배우고 싶어",
                "pace": "하루 20분",
                "learningGoal": "기초부터",
            },
        )

        self.assertEqual([video["videoId"] for video in ranked], ["cpp-natural"])

    def test_rejects_a_two_hour_video_for_a_twenty_minute_learning_pace(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "cpp-two-hours",
                    "title": "C++ 기초 두 시간 완성",
                    "channel": "코딩 교실",
                    "sourceUrl": "https://youtu.be/cpp-two-hours",
                    "summary": "C++ 입문",
                    "durationSeconds": 7200,
                    "captionAvailable": True,
                    "viewCount": 1000000,
                }
            ],
            {
                "subject": "C++",
                "pace": "하루 20분",
                "learningGoal": "퇴근 후 짧게 학습",
            },
        )

        self.assertEqual(ranked, [])

    def test_uses_the_duration_written_in_the_request_when_profile_pace_is_empty(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "cpp-seventeen-minutes",
                    "title": "C++ 기초 17분",
                    "channel": "코딩 교실",
                    "sourceUrl": "https://youtu.be/cpp-seventeen-minutes",
                    "summary": "C++ 입문",
                    "durationSeconds": 1_020,
                    "captionAvailable": True,
                },
                {
                    "videoId": "cpp-eighty-three-minutes",
                    "title": "C++ 초보자 전체 강의",
                    "channel": "긴 강의",
                    "sourceUrl": "https://youtu.be/cpp-eighty-three-minutes",
                    "summary": "C++ 입문",
                    "durationSeconds": 4_980,
                    "captionAvailable": True,
                },
            ],
            {
                "subject": "C++를 20분씩 기초부터 배우고 싶어",
                "pace": "",
                "learningGoal": "기초부터",
            },
        )

        self.assertEqual(
            [video["videoId"] for video in ranked],
            ["cpp-seventeen-minutes"],
        )

    def test_keeps_recent_learning_and_duration_visible_in_the_reason(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "cpp-continuation",
                    "title": "C++ 변수와 반복문 기초 실습",
                    "channel": "코딩 교실",
                    "sourceUrl": "https://youtu.be/cpp-continuation",
                    "summary": "C++ 예제",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                }
            ],
            {
                "subject": "C++",
                "pace": "하루 20분",
                "learningGoal": "기초부터",
                "recentVideos": [
                    {"title": "C++ 변수와 반복문 기초", "channel": "지난 채널"}
                ],
            },
        )

        self.assertIn(
            "최근 학습과 이어짐",
            ranked[0]["recommendationReasons"],
        )
        self.assertIn("약 20분", ranked[0]["recommendationReasons"])

    def test_prefers_captioned_duration_fit_over_raw_popularity(self):
        self.assertIsNotNone(
            rank_video_candidates,
            "사용자 중심 영상 추천 점수 모듈이 필요합니다.",
        )
        if rank_video_candidates is None:
            return

        candidates = [
            {
                "videoId": "seen-video-1",
                "title": "C++ 입문 강의",
                "channel": "코딩 교실",
                "sourceUrl": "https://www.youtube.com/watch?v=seen-video-1",
                "summary": "C++ 기초",
                "durationSeconds": 1200,
                "captionAvailable": True,
                "viewCount": 100000,
            },
            {
                "videoId": "caption-fit",
                "title": "C++ 기초를 20분에 배우기",
                "channel": "코딩 교실",
                "sourceUrl": "https://www.youtube.com/watch?v=caption-fit",
                "summary": "변수와 반복문을 처음부터 설명합니다.",
                "durationSeconds": 1180,
                "captionAvailable": True,
                "viewCount": 25000,
            },
            {
                "videoId": "popular-no-caption",
                "title": "C++ 기초 15분 완성",
                "channel": "인기 개발 채널",
                "sourceUrl": "https://www.youtube.com/watch?v=popular-no-caption",
                "summary": "초보자를 위한 C++ 문법",
                "durationSeconds": 900,
                "captionAvailable": False,
                "viewCount": 5000000,
            },
            {
                "videoId": "unrelated-running",
                "title": "20분 러닝 운동",
                "channel": "러닝 채널",
                "sourceUrl": "https://www.youtube.com/watch?v=unrelated-running",
                "summary": "초보 러닝",
                "durationSeconds": 1200,
                "captionAvailable": True,
                "viewCount": 900000,
            },
            {
                "videoId": "too-short-cpp",
                "title": "C++ 30초 요약",
                "channel": "짧은 코딩",
                "sourceUrl": "https://www.youtube.com/watch?v=too-short-cpp",
                "summary": "C++ 요약",
                "durationSeconds": 30,
                "captionAvailable": True,
                "viewCount": 3000000,
            },
            {
                "videoId": "caption-fit",
                "title": "C++ 기초를 20분에 배우기 복제본",
                "channel": "코딩 교실",
                "sourceUrl": "https://www.youtube.com/watch?v=caption-fit",
                "summary": "중복 결과",
                "durationSeconds": 1180,
                "captionAvailable": True,
                "viewCount": 26000,
            },
            {
                "videoId": "",
                "title": "C++ 기초 외부 링크",
                "channel": "외부 사이트",
                "sourceUrl": "https://example.com/cpp-course",
                "summary": "C++ 기초",
                "durationSeconds": 1200,
                "captionAvailable": True,
                "viewCount": 200000,
            },
        ]

        ranked = rank_video_candidates(
            candidates,
            {
                "subject": "C++",
                "pace": "하루 20분",
                "learningGoal": "기초부터 이해하기",
                "interests": ["프로그래밍"],
                "excludedVideoIds": ["seen-video-1"],
                "recentVideos": [],
            },
        )

        self.assertEqual(
            [video["videoId"] for video in ranked],
            ["caption-fit", "popular-no-caption"],
        )
        self.assertIn("원문 자막 제공", ranked[0]["recommendationReasons"])
        self.assertIn("약 20분", ranked[0]["recommendationReasons"])
        self.assertIn(
            "재생 후 학습 자막 준비",
            ranked[1]["recommendationReasons"],
        )
        self.assertGreater(
            ranked[0]["recommendationScore"],
            ranked[1]["recommendationScore"],
        )

    def test_prefers_hands_on_videos_for_a_practice_goal(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "react-concept",
                    "title": "React 핵심 개념 정리",
                    "channel": "인기 개발 채널",
                    "sourceUrl": "https://youtu.be/react-concept",
                    "summary": "React 상태와 컴포넌트 설명",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                    "viewCount": 1_000_000,
                },
                {
                    "videoId": "react-practice",
                    "title": "React Todo 프로젝트 따라 만들기",
                    "channel": "실습 채널",
                    "sourceUrl": "https://youtu.be/react-practice",
                    "summary": "작은 앱을 직접 만드는 실습",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                    "viewCount": 500,
                },
            ],
            {
                "subject": "React",
                "pace": "한 번에 20분",
                "learningGoal": "작은 프로젝트를 따라 만들고 싶어",
            },
        )

        self.assertEqual(ranked[0]["videoId"], "react-practice")
        self.assertIn(
            "직접 따라 하기 좋음",
            ranked[0]["recommendationReasons"],
        )

    def test_prefers_summary_videos_for_a_review_goal(self):
        self.assertIsNotNone(rank_video_candidates)
        if rank_video_candidates is None:
            return

        ranked = rank_video_candidates(
            [
                {
                    "videoId": "react-overview",
                    "title": "React 완전 정리",
                    "channel": "인기 개발 채널",
                    "sourceUrl": "https://youtu.be/react-overview",
                    "summary": "React 전반 설명",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                    "viewCount": 1_000_000,
                },
                {
                    "videoId": "react-review",
                    "title": "React 핵심 복습 요약",
                    "channel": "복습 채널",
                    "sourceUrl": "https://youtu.be/react-review",
                    "summary": "React 핵심을 짧게 복습",
                    "durationSeconds": 1200,
                    "captionAvailable": True,
                    "viewCount": 500,
                },
            ],
            {
                "subject": "React",
                "pace": "한 번에 20분",
                "learningGoal": "핵심만 복습하고 싶어",
            },
        )

        self.assertEqual(ranked[0]["videoId"], "react-review")
        self.assertIn(
            "복습하기 좋은 구성",
            ranked[0]["recommendationReasons"],
        )

    def test_builds_a_diverse_learning_sequence_instead_of_one_channel_dump(self):
        self.assertIsNotNone(
            select_course_sequence,
            "추천 후보를 학습 순서로 묶는 함수가 필요합니다.",
        )
        if select_course_sequence is None:
            return

        ranked = [
            {
                "videoId": "intro-a",
                "title": "C++ 입문",
                "channel": "채널 A",
                "courseRole": "introduction",
                "recommendationScore": 95,
            },
            {
                "videoId": "concept-a",
                "title": "C++ 핵심 개념",
                "channel": "채널 A",
                "courseRole": "concept",
                "recommendationScore": 90,
            },
            {
                "videoId": "practice-a",
                "title": "C++ 따라 하기",
                "channel": "채널 A",
                "courseRole": "practice",
                "recommendationScore": 88,
            },
            {
                "videoId": "practice-b",
                "title": "C++ 실습 문제",
                "channel": "채널 B",
                "courseRole": "practice",
                "recommendationScore": 82,
            },
            {
                "videoId": "application-c",
                "title": "C++ 미니 프로젝트",
                "channel": "채널 C",
                "courseRole": "application",
                "recommendationScore": 75,
            },
        ]

        selected = select_course_sequence(ranked, limit=4)

        self.assertEqual(
            [video["videoId"] for video in selected],
            ["intro-a", "concept-a", "practice-b", "application-c"],
        )
        self.assertEqual(
            [video["courseRole"] for video in selected],
            ["introduction", "concept", "practice", "application"],
        )

    def test_youtube_api_results_include_learning_quality_metadata(self):
        requests = []

        class FakeResponse:
            def __init__(self, data):
                self._data = data

            def raise_for_status(self):
                return None

            def json(self):
                return self._data

        class FakeHttpx:
            @staticmethod
            def get(url, **kwargs):
                requests.append((url, kwargs.get("params", {})))
                if url.endswith("/search"):
                    return FakeResponse(
                        {
                            "items": [
                                {
                                    "id": {"videoId": "quality001"},
                                    "snippet": {
                                        "title": "C++ 입문 20분",
                                        "channelTitle": "코딩 교실",
                                        "description": "변수와 반복문",
                                        "publishedAt": "2025-04-01T00:00:00Z",
                                        "thumbnails": {},
                                    },
                                }
                            ]
                        }
                    )
                return FakeResponse(
                    {
                        "items": [
                            {
                                "id": "quality001",
                                "snippet": {
                                    "defaultAudioLanguage": "en",
                                    "publishedAt": "2025-04-01T00:00:00Z",
                                },
                                "contentDetails": {
                                    "duration": "PT19M40S",
                                    "caption": "true",
                                },
                                "statistics": {"viewCount": "125000"},
                            }
                        ]
                    }
                )

        original_httpx = youtube_search.httpx
        original_key = os.environ.get("YOUTUBE_API_KEY")
        youtube_search.httpx = FakeHttpx
        os.environ["YOUTUBE_API_KEY"] = "youtube-test-key"
        try:
            videos = youtube_search.search_youtube_data_api("C++", 5)
        finally:
            youtube_search.httpx = original_httpx
            if original_key is None:
                os.environ.pop("YOUTUBE_API_KEY", None)
            else:
                os.environ["YOUTUBE_API_KEY"] = original_key

        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].get("durationSeconds"), 1180)
        self.assertEqual(videos[0].get("viewCount"), 125000)
        self.assertTrue(videos[0].get("captionAvailable"))
        self.assertEqual(videos[0].get("sourceLanguage"), "en")
        self.assertEqual(videos[0].get("publishedAt"), "2025-04-01T00:00:00Z")
        self.assertEqual(requests[0][1]["videoCaption"], "closedCaption")
        self.assertEqual(requests[0][1]["safeSearch"], "moderate")
        self.assertGreaterEqual(len(requests), 2)
        if len(requests) >= 2:
            self.assertEqual(
                requests[1][1]["part"],
                "contentDetails,statistics,snippet",
            )

    def test_youtube_page_fallback_keeps_caption_duration_and_view_signals(self):
        class FakeResponse:
            text = """
            <script>
            var ytInitialData = {"contents":[{"videoRenderer":{
              "videoId":"fallback001",
              "title":{"simpleText":"C++ 입문 18분"},
              "ownerText":{"simpleText":"코딩 교실"},
              "descriptionSnippet":{"simpleText":"변수와 반복문"},
              "badges":[{"metadataBadgeRenderer":{"label":"CC"}}],
              "lengthText":{"simpleText":"18:30"},
              "viewCountText":{"simpleText":"조회수 12만회"},
              "publishedTimeText":{"simpleText":"1년 전"},
              "thumbnail":{"thumbnails":[]}
            }}]};
            </script>
            """

            def raise_for_status(self):
                return None

        class FakeHttpx:
            @staticmethod
            def get(*_args, **_kwargs):
                return FakeResponse()

        original_httpx = youtube_search.httpx
        youtube_search.httpx = FakeHttpx
        try:
            videos = youtube_search.search_youtube_page("C++", 5)
        finally:
            youtube_search.httpx = original_httpx

        self.assertEqual(len(videos), 1)
        self.assertTrue(videos[0].get("captionAvailable"))
        self.assertEqual(videos[0].get("durationSeconds"), 1110)
        self.assertEqual(videos[0].get("viewCount"), 120000)
        self.assertEqual(videos[0].get("publishedLabel"), "1년 전")


if __name__ == "__main__":
    unittest.main()
