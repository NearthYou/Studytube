from pathlib import Path
import unittest


class McpModuleBoundaryTest(unittest.TestCase):
    def test_mcp_server_is_a_small_compatibility_facade(self):
        ai_dir = Path(__file__).resolve().parents[1]
        facade = (ai_dir / "mcp_server.py").read_text(encoding="utf-8")
        gateway = (ai_dir / "mcp_gateway.py").read_text(encoding="utf-8")
        support = (ai_dir / "mcp_support.py").read_text(encoding="utf-8")

        self.assertIn("from mcp_gateway import", facade)
        self.assertIn("from mcp_support import", facade)
        self.assertIn("class MCPGateway", gateway)
        self.assertIn("class GatewaySettings", support)
        self.assertLessEqual(len(facade.splitlines()), 150)
        self.assertLessEqual(len(gateway.splitlines()), 900)
        self.assertLessEqual(len(support.splitlines()), 900)


if __name__ == "__main__":
    unittest.main()
