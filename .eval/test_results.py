import unittest

from publish_results import public_quiz_records, quiz_summary


class PublicResultsTest(unittest.TestCase):
    def test_caption_and_unknown_private_fields_are_not_published(self):
        raw = [{"videoId": "example", "evidence": ["full caption"], "secret": "private",
                "attempts": [{"questions": [{"prompt": "question", "supportingQuote": "caption", "secret": "private"}],
                              "verdicts": [{"questionPosition": 1, "grounded": False, "secret": "private"}]}]}]
        public = public_quiz_records(raw)
        self.assertNotIn("evidence", public["videos"][0])
        self.assertNotIn("secret", str(public["videos"]))
        self.assertNotIn("supportingQuote", str(public["videos"]))
        self.assertEqual(len(public["videos"][0]["evidenceSha256"][0]), 64)

    def test_duplicate_positive_verdicts_do_not_inflate_grounded_count(self):
        videos = [{"attempts": [{"verdicts": [{"questionPosition": 1, "grounded": True}] * 5}],
                   "validationPassed": False}]
        self.assertEqual(quiz_summary(videos)["firstAttemptQuestionsUngrounded"], 4)

    def test_invalid_final_attempt_cannot_be_counted_as_passed(self):
        videos = [{"attempts": [{"groundingError": "not grounded"}], "validationPassed": True}]
        with self.assertRaises(ValueError):
            quiz_summary(videos)


if __name__ == "__main__":
    unittest.main()
