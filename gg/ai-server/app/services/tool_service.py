from app.schemas.analysis import ToolCallRecord


ALIASES = {
    "bench": "벤치프레스",
    "bench press": "벤치프레스",
    "벤치": "벤치프레스",
    "벤치프레스": "벤치프레스",
    "squat": "스쿼트",
    "스쿼트": "스쿼트",
    "deadlift": "데드리프트",
    "데드": "데드리프트",
    "데드리프트": "데드리프트",
    "lat pulldown": "랫풀다운",
    "랫풀": "랫풀다운",
    "랫풀다운": "랫풀다운",
    "ohp": "오버헤드프레스",
    "overhead press": "오버헤드프레스",
    "오버헤드프레스": "오버헤드프레스",
}


def normalize_exercise_name(name: str) -> tuple[str, ToolCallRecord]:
    cleaned_name = str(name or "").strip()
    normalized_name = ALIASES.get(cleaned_name.lower(), cleaned_name)

    return normalized_name, ToolCallRecord(
        toolName="normalize_exercise_name",
        input=cleaned_name,
        output=normalized_name,
        status="success",
        source="fastapi-internal-mcp-tool",
    )


def normalize_exercise_names(
    names: list[str],
) -> tuple[list[str], list[ToolCallRecord]]:
    normalized_names: list[str] = []
    tool_calls: list[ToolCallRecord] = []

    for name in names:
        normalized_name, tool_call = normalize_exercise_name(name)
        normalized_names.append(normalized_name)
        tool_calls.append(tool_call)

    return normalized_names, tool_calls
