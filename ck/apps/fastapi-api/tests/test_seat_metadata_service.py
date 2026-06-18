import unittest

from app.services.seat_metadata_service import get_seat_layout, refresh_cache


class SeatMetadataServiceTest(unittest.TestCase):
    def setUp(self):
        refresh_cache()

    def test_returns_known_theater_layout(self):
        layout = get_seat_layout("블루스퀘어 신한카드홀")

        self.assertEqual(layout.status, "ok")
        self.assertEqual(layout.canonical_theater_name, "블루스퀘어 신한카드홀")
        self.assertIn("2층", layout.sections_by_floor)
        self.assertEqual(len(layout.sections_by_floor["2층"]), 3)

    def test_returns_fallback_layout_when_external_lookup_fails(self):
        layout = get_seat_layout("블루스퀘어 신한카드홀", simulate_failure=True)

        self.assertEqual(layout.status, "fallback")
        self.assertTrue(layout.is_fallback)
        self.assertEqual(layout.canonical_theater_name, "기본 좌석 메타데이터")

    def test_marks_cached_response(self):
        first = get_seat_layout("TOM 1관")
        second = get_seat_layout("TOM 1관")

        self.assertFalse(first.cached)
        self.assertTrue(second.cached)


if __name__ == "__main__":
    unittest.main()
