import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from './category.entity';

const CATEGORY_META_BY_NAME: Record<
  string,
  {
    value: string;
    mobileLabel: string;
    description: string;
    prompt: string;
    trustHint: string;
  }
> = {
  일상: {
    value: 'daily',
    mobileLabel: '일상',
    description:
      '창가, 낮잠, 장난감처럼 사소하지만 사랑스러운 순간을 나누는 방입니다.',
    prompt: '오늘 가장 기억에 남은 표정이나 행동을 적어보세요.',
    trustHint:
      '동물 친구의 이름, 상황, 기분을 함께 적으면 더 쉽게 공감할 수 있어요.',
  },
  산책: {
    value: 'walk',
    mobileLabel: '산책',
    description:
      '산책 코스, 만난 친구, 바깥에서 생긴 작은 사건을 공유하는 방입니다.',
    prompt: '산책 장소와 오늘 만난 장면을 함께 남겨보세요.',
    trustHint: '장소 공유 시 개인 주소나 민감한 동선은 제외해 주세요.',
  },
  돌봄: {
    value: 'care',
    mobileLabel: '케어',
    description: '식사, 놀이, 휴식, 건강 루틴처럼 돌봄 경험을 나누는 방입니다.',
    prompt: '도움이 된 루틴이나 조심했던 점을 구체적으로 적어보세요.',
    trustHint:
      '케어 글은 경험 공유입니다. 진료 판단이 필요하면 전문가와 상담해 주세요.',
  },
  질문: {
    value: 'question',
    mobileLabel: '질문',
    description: '궁금한 행동과 상황을 묻고, 비슷한 경험을 나누는 방입니다.',
    prompt: '상황, 시간대, 반복 여부를 함께 적으면 답변을 받기 쉬워요.',
    trustHint:
      '답변은 커뮤니티 경험입니다. 긴급하거나 의학적인 문제는 병원에 문의해 주세요.',
  },
};

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoriesRepository: Repository<CategoryEntity>,
  ) {}

  async findAll() {
    const categories = await this.categoriesRepository.find({
      order: {
        id: 'ASC',
      },
    });

    return {
      message: '카테고리 목록을 조회했습니다.',
      categories: categories.map((category) => this.toResponse(category)),
    };
  }

  async findOneOrThrow(categoryId: string) {
    const category = await this.categoriesRepository.findOneBy({
      id: categoryId,
    });

    if (!category) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }

    return category;
  }

  toResponse(category: CategoryEntity) {
    const meta = CATEGORY_META_BY_NAME[category.name];

    return {
      id: category.id,
      name: category.name,
      value: meta?.value ?? `category-${category.id}`,
      label: category.name,
      mobileLabel: meta?.mobileLabel ?? category.name,
      description: meta?.description ?? `${category.name} 게시글을 모아봅니다.`,
      prompt: meta?.prompt ?? `${category.name} 이야기를 남겨보세요.`,
      trustHint: meta?.trustHint ?? '서로의 경험을 존중하는 커뮤니티입니다.',
      href: `/?categoryId=${category.id}`,
      isWritable: true,
    };
  }
}
