def make_answer(message: str) -> str:
    cleaned = message.strip()

    if not cleaned:
        return "메시지가 비어 있습니다."

    return f"서버가 받은 메시지: {cleaned}"