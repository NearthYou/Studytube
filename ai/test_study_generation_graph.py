import json
import unittest

import study_generation


class StudyGenerationGraphTest(unittest.TestCase):
    def test_routes_search_results_into_a_playlist_draft(self):
        response = study_generation.build_study_plan(
            {
                "goal": "React hooks",
                "language": "ko",
                "interests": ["frontend"],
            },
            lambda _payload: {
                "provider": "youtube-test",
                "summary": "테스트 영상",
                "videos": [
                    {
                        "title": "React hooks",
                        "sourceUrl": "https://youtu.be/hooks",
                        "thumbnailUrl": "https://i.ytimg.com/vi/hooks/hqdefault.jpg",
                        "provider": "youtube-test",
                        "summary": "Hooks for beginners",
                    }
                ],
            },
        )

        self.assertEqual(response["guardrails"]["orchestration"], "langgraph")
        self.assertEqual(
            [step["tool"] for step in response["trace"]],
            ["search_video", "create_playlist_draft"],
        )
        self.assertEqual(len(response["recommendations"]), 1)

    def test_stops_without_repeating_the_same_failed_video_search(self):
        calls = 0

        def fail_lookup(_payload):
            nonlocal calls
            calls += 1
            raise RuntimeError(
                "provider unavailable token=secret-canary https://private.example"
            )

        response = study_generation.build_study_plan(
            {"goal": "Docker", "maxIterations": 4},
            fail_lookup,
        )

        self.assertEqual(calls, 1)
        self.assertEqual(len(response["trace"]), 1)
        self.assertTrue(
            all(
                step["error"] == "video search unavailable"
                for step in response["trace"]
            )
        )
        self.assertNotIn("secret-canary", json.dumps(response))
        self.assertNotIn("private.example", json.dumps(response))
        self.assertEqual(response["recommendations"], [])
        self.assertTrue(response["guardrails"]["loopStopped"])

    def test_treats_the_real_unavailable_lookup_response_as_a_failure(self):
        calls = 0

        def unavailable_lookup(_payload):
            nonlocal calls
            calls += 1
            return {
                "provider": "youtube-search-unavailable",
                "summary": "provider token=secret-canary",
                "videos": [],
            }

        response = study_generation.build_study_plan(
            {"goal": "Docker", "maxIterations": 4},
            unavailable_lookup,
        )

        self.assertEqual(calls, 1)
        self.assertEqual(response["trace"][0]["error"], "video search unavailable")
        self.assertNotIn("secret-canary", json.dumps(response))
        self.assertEqual(response["recommendations"], [])

    def test_one_iteration_still_builds_from_the_successful_search(self):
        calls = 0

        def successful_lookup(_payload):
            nonlocal calls
            calls += 1
            return {
                "provider": "youtube-test",
                "summary": "테스트 영상",
                "videos": [
                    {
                        "title": "Docker basics",
                        "sourceUrl": "https://youtu.be/docker",
                        "thumbnailUrl": "https://i.ytimg.com/vi/docker/hqdefault.jpg",
                        "provider": "youtube-test",
                        "summary": "Docker for beginners",
                    }
                ],
            }

        response = study_generation.build_study_plan(
            {"goal": "Docker", "maxIterations": 1},
            successful_lookup,
        )

        self.assertEqual(calls, 1)
        self.assertEqual(
            [step["tool"] for step in response["trace"]],
            ["search_video"],
        )
        self.assertEqual(len(response["recommendations"]), 1)
        self.assertEqual(response["guardrails"]["maxIterations"], 1)

    def test_expands_a_short_cpp_goal_until_it_has_a_course(self):
        queries = []

        def lookup(payload):
            queries.append(payload["query"])
            video_id = f"cpp{len(queries)}"
            return {
                "provider": "youtube-test",
                "summary": "C++ lesson",
                "videos": [
                    {
                        "title": f"C++ lesson {len(queries)}",
                        "sourceUrl": f"https://youtu.be/{video_id}",
                        "thumbnailUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                        "provider": "youtube-test",
                        "summary": "C++ for beginners",
                    }
                ],
            }

        response = study_generation.build_study_plan(
            {
                "goal": (
                    "배울 내용: C++를 20분씩 기초부터 배우고 싶어\n"
                    "학습 목표: 기초부터"
                )
            },
            lookup,
        )

        self.assertEqual(queries[0], "C++")
        self.assertEqual(response["playlistTitle"], "C++ 학습 코스")
        self.assertIn("C++ 기초 강의", queries)
        self.assertGreaterEqual(len(response["recommendations"]), 2)
        self.assertLessEqual(len(response["recommendations"]), 4)

    def test_orders_beginner_lessons_before_advanced_lessons(self):
        response = study_generation.build_study_plan(
            {"goal": "C++", "maxIterations": 1},
            lambda _payload: {
                "provider": "youtube-test",
                "summary": "C++ lessons",
                "videos": [
                    {
                        "title": "Advanced C++ project",
                        "sourceUrl": "https://youtu.be/advanced001",
                        "thumbnailUrl": "advanced.jpg",
                        "provider": "youtube-test",
                        "summary": "advanced",
                    },
                    {
                        "title": "C++ basics for beginners",
                        "sourceUrl": "https://youtu.be/beginner001",
                        "thumbnailUrl": "beginner.jpg",
                        "provider": "youtube-test",
                        "summary": "beginner",
                    },
                ],
            },
        )

        self.assertEqual(
            [item["title"] for item in response["recommendations"]],
            ["C++ basics for beginners", "Advanced C++ project"],
        )

    def test_keeps_searching_for_beginner_results_after_four_generic_hits(self):
        queries = []

        def lookup(payload):
            queries.append(payload["query"])
            if len(queries) == 1:
                titles = [f"C++ Weekly advanced episode {index}" for index in range(4)]
            else:
                titles = ["C++ 기초 강의", "C++ beginner tutorial"]
            return {
                "provider": "youtube-test",
                "summary": "C++ lessons",
                "videos": [
                    {
                        "title": title,
                        "sourceUrl": f"https://youtu.be/course{len(queries)}{index}",
                        "thumbnailUrl": "thumb.jpg",
                        "provider": "youtube-test",
                        "summary": title,
                    }
                    for index, title in enumerate(titles)
                ],
            }

        response = study_generation.build_study_plan({"goal": "C++"}, lookup)

        self.assertEqual(len(queries), 3)
        self.assertEqual(
            [item["title"] for item in response["recommendations"][:2]],
            ["C++ 기초 강의", "C++ beginner tutorial"],
        )
        self.assertEqual(len(response["recommendations"]), 4)

    def test_uses_learner_context_and_keeps_explainable_recommendations(self):
        response = study_generation.build_study_plan(
            {
                "goal": "배울 내용: C++\n학습 속도: 하루 20분",
                "maxIterations": 1,
                "recommendationContext": {
                    "subject": "C++",
                    "pace": "하루 20분",
                    "learningGoal": "기초부터 이해하기",
                    "excludedVideoIds": ["already-seen"],
                    "recentVideos": [
                        {"title": "C++ 변수 기초", "channel": "지난 채널"}
                    ],
                },
            },
            lambda _payload: {
                "provider": "youtube-test",
                "summary": "C++ 학습 영상",
                "videos": [
                    {
                        "videoId": "already-seen",
                        "title": "C++ 입문 인기 강의",
                        "channel": "지난 채널",
                        "sourceUrl": "https://youtu.be/already-seen",
                        "thumbnailUrl": "seen.jpg",
                        "provider": "youtube-test",
                        "summary": "C++ 기초",
                        "durationSeconds": 1200,
                        "captionAvailable": True,
                        "viewCount": 900000,
                    },
                    {
                        "videoId": "cpp-intro-fit",
                        "title": "C++ 기초를 20분에 배우기",
                        "channel": "코딩 교실",
                        "sourceUrl": "https://youtu.be/cpp-intro-fit",
                        "thumbnailUrl": "intro.jpg",
                        "provider": "youtube-test",
                        "summary": "변수와 반복문",
                        "durationSeconds": 1180,
                        "captionAvailable": True,
                        "viewCount": 25000,
                    },
                    {
                        "videoId": "cpp-practice",
                        "title": "C++ 반복문 실습",
                        "channel": "실습 채널",
                        "sourceUrl": "https://youtu.be/cpp-practice",
                        "thumbnailUrl": "practice.jpg",
                        "provider": "youtube-test",
                        "summary": "C++ 예제를 따라 합니다.",
                        "durationSeconds": 1500,
                        "captionAvailable": True,
                        "viewCount": 12000,
                    },
                    {
                        "videoId": "running-video",
                        "title": "20분 러닝 운동",
                        "channel": "러닝 채널",
                        "sourceUrl": "https://youtu.be/running-video",
                        "thumbnailUrl": "running.jpg",
                        "provider": "youtube-test",
                        "summary": "초보 달리기",
                        "durationSeconds": 1200,
                        "captionAvailable": True,
                        "viewCount": 500000,
                    },
                ],
            },
        )

        self.assertEqual(
            [item["title"] for item in response["recommendations"]],
            ["C++ 기초를 20분에 배우기", "C++ 반복문 실습"],
        )
        first = response["recommendations"][0]
        self.assertEqual(first.get("channel"), "코딩 교실")
        self.assertIn("원문 자막 제공", first.get("recommendationReasons", []))
        self.assertGreater(first.get("recommendationScore", 0), 0)
        self.assertNotIn("already-seen", json.dumps(response))


if __name__ == "__main__":
    unittest.main()
