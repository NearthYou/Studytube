import unittest

import main
from main import build_study_plan, handle_mcp_request, rag_recommend


class AiServiceTest(unittest.TestCase):
    def test_mcp_youtube_lookup_returns_json_rpc_result(self):
        response = handle_mcp_request(
            {
                "jsonrpc": "2.0",
                "id": "case-1",
                "method": "youtube.lookup",
                "params": {"query": "react hooks"},
            }
        )

        self.assertEqual(response["jsonrpc"], "2.0")
        self.assertEqual(response["id"], "case-1")
        self.assertIn("title", response["result"])
        self.assertIn("provider", response["result"])
        self.assertIn("videos", response["result"])

    def test_mcp_youtube_search_parses_real_page_metadata(self):
        class FakeResponse:
            text = """
            <script>
            var ytInitialData = {"contents":{"videoRenderer":{
              "videoId":"abc123",
              "title":{"runs":[{"text":"Real React Hooks Lesson"}]},
              "ownerText":{"runs":[{"text":"Real Channel"}]},
              "thumbnail":{"thumbnails":[{"url":"https://img.example/a.jpg"}]}
            }}};
            </script>
            """

            def raise_for_status(self):
                return None

        class FakeHttpx:
            @staticmethod
            def get(*_args, **_kwargs):
                return FakeResponse()

        original_httpx = main.httpx
        main.httpx = FakeHttpx

        try:
            response = handle_mcp_request(
                {
                    "jsonrpc": "2.0",
                    "id": "case-search",
                    "method": "youtube.lookup",
                    "params": {"query": "react hooks", "limit": 3},
                }
            )
        finally:
            main.httpx = original_httpx

        result = response["result"]
        self.assertEqual(result["provider"], "youtube-search-page")
        self.assertEqual(result["videos"][0]["videoId"], "abc123")
        self.assertEqual(result["videos"][0]["title"], "Real React Hooks Lesson")

    def test_rag_recommend_returns_related_posts_and_summary(self):
        response = rag_recommend({"query": "react hooks for beginners", "limit": 2})

        self.assertEqual(len(response["relatedPosts"]), 2)
        self.assertIn("react", response["answer"].lower())

    def test_rag_recommend_returns_empty_when_query_has_no_overlap(self):
        response = rag_recommend({"query": "zzzz-no-board-topic", "limit": 2})

        self.assertEqual(response["relatedPosts"], [])
        self.assertIn("찾지 못했", response["answer"])

    def test_agent_stops_with_playlist_and_trace(self):
        response = build_study_plan(
            {
                "goal": "React hooks를 공부하고 싶어",
                "language": "ko",
                "interests": ["frontend"],
            }
        )

        self.assertLessEqual(len(response["trace"]), 4)
        self.assertGreaterEqual(len(response["recommendations"]), 1)
        self.assertIn("playlistTitle", response)


if __name__ == "__main__":
    unittest.main()
