import type { Category, WritableCategoryValue } from '../types/category'
import { getCategoryPath } from '../utils/paths'

export const categories: Category[] = [
  {
    value: 'all',
    label: '오늘의 꼬리톡',
    mobileLabel: '홈',
    description: '지금 올라온 반려동물 일상과 질문을 한눈에 둘러보세요.',
    prompt: '오늘의 순간을 사진과 짧은 이야기로 남겨보세요.',
    trustHint: '서로의 경험을 존중하는 따뜻한 반려동물 커뮤니티입니다.',
    href: getCategoryPath('all'),
    isWritable: false,
  },
  {
    value: 'daily',
    label: '일상',
    mobileLabel: '일상',
    description: '창가, 낮잠, 장난감처럼 사소하지만 사랑스러운 순간을 나누는 방입니다.',
    prompt: '오늘 가장 기억에 남은 표정이나 행동을 적어보세요.',
    trustHint: '동물 친구의 이름, 상황, 기분을 함께 적으면 더 쉽게 공감할 수 있어요.',
    href: getCategoryPath('daily'),
    isWritable: true,
  },
  {
    value: 'walk',
    label: '산책',
    mobileLabel: '산책',
    description: '산책 코스, 만난 친구, 바깥에서 생긴 작은 사건을 공유하는 방입니다.',
    prompt: '산책 장소와 오늘 만난 장면을 함께 남겨보세요.',
    trustHint: '장소 공유 시 개인 주소나 민감한 동선은 제외해 주세요.',
    href: getCategoryPath('walk'),
    isWritable: true,
  },
  {
    value: 'care',
    label: '케어',
    mobileLabel: '케어',
    description: '식사, 놀이, 휴식, 건강 루틴처럼 돌봄 경험을 나누는 방입니다.',
    prompt: '도움이 된 루틴이나 조심했던 점을 구체적으로 적어보세요.',
    trustHint: '케어 글은 경험 공유입니다. 진료 판단이 필요하면 전문가와 상담해 주세요.',
    href: getCategoryPath('care'),
    isWritable: true,
  },
  {
    value: 'question',
    label: '질문',
    mobileLabel: '질문',
    description: '궁금한 행동과 상황을 묻고, 비슷한 경험을 나누는 방입니다.',
    prompt: '상황, 시간대, 반복 여부를 함께 적으면 답변을 받기 쉬워요.',
    trustHint: '답변은 커뮤니티 경험입니다. 긴급하거나 의학적인 문제는 병원에 문의해 주세요.',
    href: getCategoryPath('question'),
    isWritable: true,
  },
]

export const writableCategories = categories.filter(
  (category): category is Category & { value: WritableCategoryValue } => category.isWritable,
)

export function getActiveCategory(value: string | null) {
  return categories.find((category) => category.value === value) ?? categories[0]
}
