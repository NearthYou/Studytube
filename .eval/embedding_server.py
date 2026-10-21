# 평가용 최소 서버: 저장소의 ai/embeddings.py를 그대로 불러 /embeddings만 제공한다.
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ai"))


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env(ROOT / ".env")
import embeddings  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/embeddings":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        try:
            result = embeddings.create_embedding_response(body)
            status = 200
        except ValueError as exc:
            result, status = {"detail": str(exc)}, 422
        except embeddings.EmbeddingProviderUnavailable as exc:
            result, status = {"detail": str(exc), "cause": repr(exc.__cause__)}, 503
        data = json.dumps(result).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.getenv("EVAL_AI_PORT", "8000"))), Handler).serve_forever()
