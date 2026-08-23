from pathlib import Path
import unittest


class EmbeddingsBoundaryTest(unittest.TestCase):
    def test_embeddings_own_provider_and_cache_behavior(self):
        ai_dir = Path(__file__).resolve().parents[1]
        module = (ai_dir / "embeddings.py").read_text(encoding="utf-8")
        main = (ai_dir / "main.py").read_text(encoding="utf-8")

        self.assertIn("def create_embedding_response", module)
        self.assertIn("class EmbeddingProviderUnavailable", module)
        self.assertIn("import embeddings as embeddings_module", main)
        self.assertNotIn("def create_embedding_response", main)


if __name__ == "__main__":
    unittest.main()
