import type { LookupOption } from '../types/community'
import type { Language } from './language'

type LookupKind = 'region' | 'theme' | 'budget' | 'season' | 'companion'

type LocalizedEntry = {
  ko: string
  en: string
}

const LOOKUP_DICTIONARIES: Record<LookupKind, Record<string, LocalizedEntry>> = {
  region: {
    gangneung: { ko: '강릉', en: 'Gangneung' },
    jeju: { ko: '제주', en: 'Jeju' },
    busan: { ko: '부산', en: 'Busan' },
    jeonju: { ko: '전주', en: 'Jeonju' },
    yeosu: { ko: '여수', en: 'Yeosu' },
    sokcho: { ko: '속초', en: 'Sokcho' },
    namhae: { ko: '남해', en: 'Namhae' },
    chuncheon: { ko: '춘천', en: 'Chuncheon' },
    pohang: { ko: '포항', en: 'Pohang' },
    gyeongju: { ko: '경주', en: 'Gyeongju' },
    tongyeong: { ko: '통영', en: 'Tongyeong' },
    gapyeong: { ko: '가평', en: 'Gapyeong' },
  },
  theme: {
    healing: { ko: '힐링', en: 'Healing' },
    family: { ko: '가족', en: 'Family' },
    couple: { ko: '커플', en: 'Couple' },
    solo_trip: { ko: '혼행', en: 'Solo Trip' },
    gourmet: { ko: '미식', en: 'Gourmet' },
    drive: { ko: '드라이브', en: 'Drive' },
    date: { ko: '데이트', en: 'Date' },
  },
  budget: {
    under_100k: { ko: '10만원 이하', en: 'Under 100k KRW' },
    from_100k_to_200k: { ko: '10-20만원', en: '100k to 200k KRW' },
    from_200k_to_300k: { ko: '20-30만원', en: '200k to 300k KRW' },
    over_300k: { ko: '30만원 이상', en: 'Over 300k KRW' },
  },
  season: {
    spring: { ko: '봄', en: 'Spring' },
    summer: { ko: '여름', en: 'Summer' },
    fall: { ko: '가을', en: 'Fall' },
    winter: { ko: '겨울', en: 'Winter' },
  },
  companion: {
    solo: { ko: '혼자', en: 'Solo' },
    friend: { ko: '친구', en: 'Friend' },
    couple: { ko: '연인', en: 'Couple' },
    family: { ko: '가족', en: 'Family' },
  },
}

const LABEL_ALIASES: Record<LookupKind, Record<string, string>> = {
  region: {
    강릉: 'gangneung',
    제주: 'jeju',
    부산: 'busan',
    전주: 'jeonju',
    여수: 'yeosu',
    속초: 'sokcho',
    남해: 'namhae',
    춘천: 'chuncheon',
    포항: 'pohang',
    경주: 'gyeongju',
    통영: 'tongyeong',
    가평: 'gapyeong',
  },
  theme: {
    힐링: 'healing',
    가족: 'family',
    커플: 'couple',
    혼행: 'solo_trip',
    미식: 'gourmet',
    드라이브: 'drive',
    데이트: 'date',
  },
  budget: {
    '10만원 이하': 'under_100k',
    '10-20만원': 'from_100k_to_200k',
    '20-30만원': 'from_200k_to_300k',
    '30만원 이상': 'over_300k',
  },
  season: {
    봄: 'spring',
    spring: 'spring',
    여름: 'summer',
    summer: 'summer',
    가을: 'fall',
    autumn: 'fall',
    fall: 'fall',
    겨울: 'winter',
    winter: 'winter',
  },
  companion: {
    혼자: 'solo',
    solo: 'solo',
    친구: 'friend',
    friend: 'friend',
    연인: 'couple',
    couple: 'couple',
    가족: 'family',
    family: 'family',
  },
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function resolveLookupKey(kind: LookupKind, value?: string | null) {
  if (!value) {
    return null
  }

  const directKey = normalize(value)
  if (directKey in LOOKUP_DICTIONARIES[kind]) {
    return directKey
  }

  return LABEL_ALIASES[kind][value] ?? LABEL_ALIASES[kind][directKey] ?? null
}

export function localizeLookupValue(
  kind: LookupKind,
  value: string,
  language: Language,
  code?: string | null,
) {
  const key = resolveLookupKey(kind, code) ?? resolveLookupKey(kind, value)

  if (!key) {
    return value
  }

  return LOOKUP_DICTIONARIES[kind][key][language]
}

export function localizeLookupOptions(
  kind: LookupKind,
  options: LookupOption[],
  language: Language,
) {
  return options.map((option) => ({
    ...option,
    label: localizeLookupValue(kind, option.label, language, option.value),
  }))
}
