from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
SERVER_ROOT = SCRIPT_DIR.parent
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from services.rag_sync_service import sync_all_documents


async def main() -> None:
    result = await sync_all_documents()
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    asyncio.run(main())
