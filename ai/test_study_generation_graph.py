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


if __name__ == "__main__":
    unittest.main()
