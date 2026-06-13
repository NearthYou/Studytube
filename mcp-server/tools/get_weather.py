from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx


FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

REGION_COORDS = {
    "busan": (35.1796, 129.0756, "Busan", "부산"),
    "jeju": (33.4996, 126.5312, "Jeju", "제주"),
    "gangneung": (37.7519, 128.8761, "Gangneung", "강릉"),
    "jeonju": (35.8242, 127.1480, "Jeonju", "전주"),
    "yeosu": (34.7604, 127.6622, "Yeosu", "여수"),
    "sokcho": (38.2070, 128.5918, "Sokcho", "속초"),
    "namhae": (34.8377, 127.8925, "Namhae", "남해"),
    "chuncheon": (37.8813, 127.7298, "Chuncheon", "춘천"),
    "pohang": (36.0190, 129.3435, "Pohang", "포항"),
    "gyeongju": (35.8562, 129.2247, "Gyeongju", "경주"),
    "tongyeong": (34.8544, 128.4332, "Tongyeong", "통영"),
    "gapyeong": (37.8315, 127.5093, "Gapyeong", "가평"),
}

REGION_ALIASES = {
    "부산": "busan",
    "제주": "jeju",
    "강릉": "gangneung",
    "전주": "jeonju",
    "여수": "yeosu",
    "속초": "sokcho",
    "남해": "namhae",
    "춘천": "chuncheon",
    "포항": "pohang",
    "경주": "gyeongju",
    "통영": "tongyeong",
    "가평": "gapyeong",
}


def _infer_season(travel_date: str) -> str:
    if not travel_date:
        return ""

    month = datetime.fromisoformat(travel_date).month
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "fall"
    return "winter"


def _normalize_region(region: str) -> tuple[str, str, str] | None:
    normalized = region.strip().lower()
    if not normalized:
        return None

    key = REGION_ALIASES.get(region.strip(), normalized)
    return REGION_COORDS.get(key)


def _seasonal_fallback(region: str, travel_date: str) -> dict[str, Any]:
    season = _infer_season(travel_date)
    region_name = _normalize_region(region)
    region_en = region_name[2] if region_name else (region or "the selected region")
    region_ko = region_name[3] if region_name else (region or "선택한 지역")

    if season == "summer":
        return {
            "headline": f"{region_en} may be hot with scattered rain in the afternoon.",
            "headline_ko": f"{region_ko}은(는) 한낮 더위와 오후 소나기를 함께 고려하는 편이 좋습니다.",
            "temperature": "Average 24-30C",
            "temperature_ko": "평균 24-30도",
            "travelVerdict": "Mix outdoor views with indoor rest stops for a steadier route.",
            "travelVerdict_ko": "야외 코스와 실내 휴식 지점을 섞으면 일정이 더 안정적입니다.",
            "caution": "Keep an indoor backup for late afternoon rain.",
            "caution_ko": "늦은 오후 비에 대비해 실내 대체 코스를 준비하세요.",
        }

    if season == "winter":
        return {
            "headline": f"{region_en} can feel colder than the measured temperature because of wind.",
            "headline_ko": f"{region_ko}은(는) 바람 때문에 실제 기온보다 더 춥게 느껴질 수 있습니다.",
            "temperature": "Average -2 to 8C",
            "temperature_ko": "평균 -2도~8도",
            "travelVerdict": "Short transfers and indoor stops usually work better in winter.",
            "travelVerdict_ko": "겨울에는 이동 거리를 짧게 하고 실내 코스를 섞는 편이 낫습니다.",
            "caution": "If you are near the coast, reduce long outdoor stays.",
            "caution_ko": "해안가 위주 일정이면 긴 야외 체류는 줄이세요.",
        }

    if season == "fall":
        return {
            "headline": f"{region_en} is usually suitable for walking routes in this season.",
            "headline_ko": f"{region_ko}은(는) 이 계절에 걷기 좋은 동선으로 짜기 좋습니다.",
            "temperature": "Average 12-22C",
            "temperature_ko": "평균 12-22도",
            "travelVerdict": "Photo spots, walks, and cafe routes combine well in fall.",
            "travelVerdict_ko": "가을에는 사진 스팟, 산책, 카페 동선을 묶기 좋습니다.",
            "caution": "Start early if the destination gets crowded on weekends.",
            "caution_ko": "주말 혼잡 지역이면 오전부터 움직이는 편이 좋습니다.",
        }

    return {
        "headline": f"{region_en} is a good fit for lighter outdoor routes.",
        "headline_ko": f"{region_ko}은(는) 가벼운 야외 동선으로 짜기 좋은 편입니다.",
        "temperature": "Average 10-20C",
        "temperature_ko": "평균 10-20도",
        "travelVerdict": "A mix of walking, brunch, and short transfers usually works well.",
        "travelVerdict_ko": "산책, 브런치, 짧은 이동을 섞은 일정이 잘 맞습니다.",
        "caution": "Bring an extra layer for the evening.",
        "caution_ko": "저녁 기온을 대비해 겉옷을 챙기세요.",
    }


def _describe_condition(weather_code: int, precipitation: float) -> tuple[str, str]:
    if precipitation >= 60:
        return "rainy", "비 가능성 높음"
    if weather_code in {0, 1}:
        return "clear", "맑음"
    if weather_code in {2, 3, 45, 48}:
        return "cloudy", "흐림"
    return "mixed", "변동 가능"


def _travel_message(condition: str) -> tuple[str, str]:
    if condition == "rainy":
        return (
            "Favor indoor stops or shorter outdoor blocks.",
            "실내 코스나 짧은 야외 구간 중심으로 짜는 편이 좋습니다.",
        )
    if condition == "clear":
        return (
            "Outdoor viewpoints and walking routes should work well.",
            "야외 전망 포인트와 산책 동선을 넣기 좋은 날씨입니다.",
        )
    if condition == "cloudy":
        return (
            "A balanced route with cafes and walks should be comfortable.",
            "카페와 산책을 섞은 균형형 일정이 무난합니다.",
        )
    return (
        "Keep the route flexible in case the conditions shift during the day.",
        "당일 컨디션 변화에 맞춰 유연하게 움직일 수 있게 짜는 편이 좋습니다.",
    )


async def _fetch_live_forecast(region: str, travel_date: str) -> dict[str, Any] | None:
    region_info = _normalize_region(region)
    if region_info is None:
        return None

    latitude, longitude, region_en, region_ko = region_info
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            FORECAST_URL,
            params={
                "latitude": latitude,
                "longitude": longitude,
                "daily": ",".join(
                    [
                        "weather_code",
                        "temperature_2m_max",
                        "temperature_2m_min",
                        "precipitation_probability_max",
                    ]
                ),
                "timezone": "Asia/Seoul",
                "forecast_days": 16,
            },
        )
        response.raise_for_status()
        data = response.json()

    daily = data.get("daily") or {}
    dates = daily.get("time") or []
    if not dates:
        return None

    target_date = travel_date or str(date.today())
    if target_date in dates:
        index = dates.index(target_date)
    else:
        index = 0

    weather_code = int((daily.get("weather_code") or [0])[index])
    high = round(float((daily.get("temperature_2m_max") or [0])[index]))
    low = round(float((daily.get("temperature_2m_min") or [0])[index]))
    precipitation = round(float((daily.get("precipitation_probability_max") or [0])[index]))
    condition, condition_ko = _describe_condition(weather_code, precipitation)
    verdict_en, verdict_ko = _travel_message(condition)

    caution_en = (
        f"Rain probability is around {precipitation}%."
        if precipitation >= 40
        else "Check the same-day forecast once more before departure."
    )
    caution_ko = (
        f"강수 확률이 약 {precipitation}% 정도라 우산 여부를 다시 확인하세요."
        if precipitation >= 40
        else "출발 전 당일 예보를 한 번 더 확인하세요."
    )

    return {
        "headline": f"{region_en} forecast looks {condition} for {target_date}.",
        "headline_ko": f"{region_ko}은(는) {target_date} 기준으로 {condition_ko} 쪽 예보입니다.",
        "temperature": f"{low}C to {high}C",
        "temperature_ko": f"{low}도~{high}도",
        "travelVerdict": verdict_en,
        "travelVerdict_ko": verdict_ko,
        "caution": caution_en,
        "caution_ko": caution_ko,
    }


async def get_weather(region: str = "", travel_date: str = "") -> dict[str, Any]:
    try:
        live_forecast = await _fetch_live_forecast(region, travel_date)
        if live_forecast is not None:
            return live_forecast
    except Exception:
        pass

    return _seasonal_fallback(region, travel_date)
