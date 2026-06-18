export type TheaterSeatMapOption = {
  id: string
  label: string
}

const theaterSeatMapLabels = [
  "CJ아지트",
  "GS아트센터",
  "JTN 아트홀 1관",
  "KT&G 상상마당 대치아트홀",
  "LG아트센터",
  "LG아트센터 서울 LG Signature 홀",
  "LG아트센터 서울 U+ 스테이지",
  "NOL 서경스퀘어 스콘 1관",
  "NOL 서경스퀘어 스콘 2관",
  "NOL 씨어터 대학로 우리카드홀",
  "NOL 씨어터 대학로 우리투자증권홀",
  "NOL 유니플렉스 1관",
  "NOL 유니플렉스 2관",
  "NOL 유니플렉스 3관",
  "TOM 1관",
  "TOM 2관",
  "et theatre 1",
  "계명아트센터",
  "고양아람누리 아람극장",
  "광림아트센터 BBCH홀",
  "국립정동극장",
  "국립중앙박물관 극장 용",
  "극장 온(구 CJ아지트)",
  "대학로 SH아트홀",
  "대학로 자유극장",
  "대학로예술극장 대극장",
  "대학로예술극장 소극장",
  "더굿씨어터",
  "동덕여자대학교 공연예술센터 코튼홀(2024.12 이전)",
  "동덕여자대학교 공연예술센터 코튼홀(2024.12 이후)",
  "두산아트센터 연강홀",
  "드림씨어터",
  "디큐브아트센터",
  "링크더스페이스 1관",
  "링크더스페이스 2관",
  "링크아트센터 벅스홀",
  "링크아트센터 페이코홀",
  "링크아트센터드림 드림1관",
  "링크아트센터드림 드림2관",
  "링크아트센터드림 드림3관",
  "링크아트센터드림 드림4관",
  "명동예술극장",
  "백암아트홀",
  "브릭스씨어터",
  "블루스퀘어 신한카드홀",
  "샤롯데씨어터",
  "성남아트센터 오페라하우스",
  "세종문화회관 M씨어터",
  "세종문화회관 S씨어터",
  "세종문화회관 대극장",
  "소향씨어터 신한카드홀",
  "아르코예술극장 대극장",
  "아르코예술극장 소극장",
  "예그린씨어터",
  "예술의전당 CJ토월극장",
  "예술의전당 오페라극장",
  "예술의전당 자유소극장",
  "예스24스테이지 1관",
  "예스24스테이지 2관",
  "예스24스테이지 3관",
  "예스24아트원 1관",
  "예스24아트원 2관",
  "예스24아트원 3관(2024.03 이전)",
  "예스24아트원 3관(2024.03 이후)",
  "유니버설아트센터",
  "이해랑 예술극장",
  "충무아트센터 대극장(2025.06 이전)",
  "충무아트센터 대극장(2025.06 이후)",
  "충무아트센터 블랙(2025.06 이전)",
  "충무아트센터 블랙(2025.06 이후)",
  "코엑스 신한카드 아티움(2022.04 이전)",
  "코엑스 신한카드 아티움(2022.04 이후)",
  "플러스씨어터(2021.11 이전)",
  "플러스씨어터(2021.11 이후)",
  "한전아트센터",
  "홍익대아트센터 대극장",
]

export const theaterSeatMapOptions: TheaterSeatMapOption[] = theaterSeatMapLabels.map((label) => ({
  id: `seat-map:${label}`,
  label,
}))

const theaterSeatMapAliases = [
  "Blue Square",
  "Charlotte Theater",
  "두산아트센터",
  "블루스퀘어",
  "홍익대 대학로 아트센터",
]

export const theaterSeatMapNames = new Set([...theaterSeatMapLabels, ...theaterSeatMapAliases])

const canonicalTheaterNames: Record<string, string> = {
  두산아트센터: "두산아트센터 연강홀",
}

export function getCanonicalTheaterName(name: string) {
  return canonicalTheaterNames[name] ?? name
}
