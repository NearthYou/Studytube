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
            {"goal": "배울 내용: C++ 배우고 싶어\n학습 목표: 기초부터"},
            lookup,
        )

        self.assertEqual(queries[0], "C++")
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


if __name__ == "__main__":
    unittest.main()
