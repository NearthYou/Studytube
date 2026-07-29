from pathlib import Path
import unittest

from runtime_environment import load_runtime_environment


class RuntimeEnvironmentTest(unittest.TestCase):
    def test_process_environment_keeps_priority_over_both_dotenv_files(self):
        calls: list[tuple[Path, bool]] = []

        def record(path: Path, *, override: bool = False) -> None:
            calls.append((path, override))

        load_runtime_environment(
            record,
            ai_dir=Path("/srv/studytube/ai"),
            root_dir=Path("/srv/studytube"),
        )

        self.assertEqual(
            calls,
            [
                (Path("/srv/studytube/ai/.env"), False),
                (Path("/srv/studytube/.env"), False),
            ],
        )


if __name__ == "__main__":
    unittest.main()
