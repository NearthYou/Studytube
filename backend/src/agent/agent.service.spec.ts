import { AgentService } from './agent.service';
import type { ConfigService } from '@nestjs/config';
import type { PetPlacesService } from '../pet-places/pet-places.service';
import type { PostsService } from '../posts/posts.service';

describe('AgentService', () => {
  let configService: { get: jest.Mock };
  let postsService: { search: jest.Mock };
  let petPlacesService: {
    findByArea: jest.Mock;
    findNearby: jest.Mock;
    search: jest.Mock;
  };
  let service: AgentService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'AI_SERVICE_URL') {
          return 'http://ai.test';
        }

        if (key === 'AI_SERVICE_TIMEOUT_MS') {
          return '1';
        }

        return undefined;
      }),
    };
    postsService = {
      search: jest.fn().mockResolvedValue({
        items: [{ id: '1', title: '산책이 즐거운 강아지' }],
      }),
    };
    petPlacesService = {
      findByArea: jest.fn().mockResolvedValue({
        items: [{ contentId: '102', title: '광주 반려동물 동반 산책지' }],
      }),
      findNearby: jest.fn().mockResolvedValue({
        items: [{ contentId: '101', title: '조용한 반려견 공원' }],
      }),
      search: jest.fn().mockResolvedValue({
        items: [{ contentId: '100', title: '반려견 동반 카페' }],
      }),
    };
    service = new AgentService(
      postsService as unknown as PostsService,
      petPlacesService as unknown as PetPlacesService,
      configService as unknown as ConfigService,
    );
    global.fetch = jest.fn().mockRejectedValue(new Error('AI service offline'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes emergency health wording to emergency guidance', async () => {
    const response = await service.chat({
      message: '강아지가 초콜릿을 먹고 호흡이 이상해요',
    });

    expect(response.riskLevel).toBe('emergency');
    expect(response.answer).toContain('즉시 동물병원');
    expect(response.sources).toHaveLength(1);
  });

  it('routes diagnosis or medication wording to vet consult guidance', async () => {
    const response = await service.chat({
      message: '피부 진단이랑 약 처방을 알려줘',
    });

    expect(response.riskLevel).toBe('vet_consult');
    expect(response.answer).toContain('단정해서 답하지 않을게요');
  });

  it('gives constipation triage guidance instead of broad repeated clarification', async () => {
    const response = await service.chat({
      message: '강아지가 똥을 안싸',
      species: 'dog',
    });

    expect(response.riskLevel).toBe('vet_consult');
    expect(response.usedTools).toContain('search_behavior_rag');
    expect(response.answer).toContain('48시간 이상');
    expect(response.answer).toContain('힘을 주는데도 안 나오는지');
    expect(response.answer).not.toContain('상황, 시간, 반복 빈도');
  });

  it('handles unknown follow-up answers without repeating the same prompt', async () => {
    const response = await service.chat({
      history: [
        {
          content: '강아지가 똥을 안싸',
          role: 'user',
        },
        {
          content: '마지막 대변이 언제였는지 알려주세요.',
          role: 'assistant',
        },
      ],
      message: '몰라',
      species: 'dog',
    });

    expect(response.answer).toContain('몰라도 괜찮아요');
    expect(response.answer).toContain('48시간');
    expect(response.answer).not.toContain('상황, 시간, 반복 빈도');
  });

  it('returns cards from allowed search tools', async () => {
    const response = await service.chat({
      message: '근처 동반 장소랑 산책 게시글 찾아줘',
    });

    expect(response.usedTools).toEqual(
      expect.arrayContaining(['post_search', 'pet_place_search']),
    );
    expect(response.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: '/posts/1', type: 'post' }),
        expect.objectContaining({ href: '/pet-places/100', type: 'place' }),
      ]),
    );
    expect(response.places).toEqual(
      expect.arrayContaining([expect.objectContaining({ contentId: '100' })]),
    );
  });

  it('uses area-based pet place search for region place requests', async () => {
    const response = await service.chat({
      message: '광주 동반 장소 알려줘',
    });

    expect(response.usedTools).toContain('pet_place_search');
    expect(response.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/pet-places/102',
          type: 'place',
        }),
      ]),
    );
    expect(petPlacesService.findByArea).toHaveBeenCalledWith(
      expect.objectContaining({
        areaCode: '5',
      }),
    );
    expect(petPlacesService.search).not.toHaveBeenCalled();
  });

  it('responds to greetings as a chat bot instead of the old fallback', async () => {
    const response = await service.chat({
      message: '안녕',
    });

    expect(response.answer).toContain('안녕하세요');
    expect(response.usedTools).toContain('conversation_reply');
    expect(response.answer).not.toContain('아직은 게시글 검색');
  });

  it('handles casual small talk without the old fallback', async () => {
    const response = await service.chat({
      message: '음 오늘은 뭘 하면 좋을까',
    });

    expect(response.answer).toContain('가볍게 수다처럼');
    expect(response.usedTools).toContain('conversation_reply');
    expect(response.answer).not.toContain('아직은 게시글 검색');
  });

  it('routes whining or vocalization wording to behavior RAG', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          answer: '낑낑거림은 상황과 몸 상태 변화를 함께 살펴보세요.',
          observationChecklist: ['소리가 나는 시간과 상황 기록'],
          retrievedChunkIds: ['dog-vocalization-1'],
          riskLevel: 'behavior_support',
          safety: {
            action: 'allow',
            blockedTerms: [],
            redFlagDetected: false,
            riskLevel: 'behavior_support',
            triggeredRules: [],
          },
          sources: [{ sourceType: 'rag_source', title: '강아지 발성' }],
          vetConsultCriteria: ['통증 반응이 있으면 병원 상담'],
        }),
      ok: true,
    });

    const response = await service.chat({
      message: '강아지가 낑낑 소리를 내는데',
      species: 'dog',
    });

    expect(response.answer).toContain('낑낑거림');
    expect(response.usedTools).toContain('search_behavior_rag');
  });

  it('explains empty post search results instead of asking broad clarification', async () => {
    postsService.search.mockResolvedValueOnce({ items: [] });

    const response = await service.chat({
      message: '오늘 산책 글 찾아줘',
    });

    expect(response.answer).toContain('게시글을 찾아봤는데');
    expect(response.usedTools).toContain('post_search');
    expect(response.answer).not.toContain('반려동물 행동 상담, 건강 위험 신호');
  });

  it('answers clarification follow-ups with concrete fields to provide', async () => {
    const response = await service.chat({
      history: [
        {
          content: '좋아요. 지금 상황을 한 문장만 더 알려주세요.',
          role: 'assistant',
        },
      ],
      message: '어떻게 구체적으로?',
    });

    expect(response.answer).toContain('반려동물 종류와 나이');
    expect(response.usedTools).toContain('conversation_reply');
  });

  it('combines behavior RAG and nearby pet place search', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          answer:
            '산책 중 반응성은 거리 확보와 긍정적 노출을 우선해 살펴보세요.',
          answerProvider: 'openai',
          fallbackUsed: false,
          observationChecklist: ['트리거 거리 기록'],
          retrievedChunkIds: ['dog-reactivity-1'],
          riskLevel: 'behavior_support',
          safety: {
            action: 'allow',
            blockedTerms: [],
            redFlagDetected: false,
            riskLevel: 'behavior_support',
            triggeredRules: [],
          },
          sources: [
            {
              sourceType: 'rag_source',
              title: 'AVSAB Humane Dog Training Position Statement',
              year: 2021,
            },
          ],
          vetConsultCriteria: ['물림 위험이 있으면 전문가 상담'],
        }),
      ok: true,
    });

    const response = await service.chat({
      location: { mapX: 126.978, mapY: 37.5665 },
      message:
        '강아지가 산책 중 다른 강아지를 보면 짖어요. 근처 조용한 동반 장소도 알려줘',
      species: 'dog',
    });

    expect(response.answer).toContain('산책 중 반응성');
    expect(response.answerProvider).toBe('openai');
    expect(response.fallbackUsed).toBe(false);
    expect(response.usedTools).toEqual(
      expect.arrayContaining(['search_behavior_rag', 'pet_place_search']),
    );
    expect(response.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'AVSAB Humane Dog Training Position Statement',
        }),
      ]),
    );
    expect(response.places).toEqual(
      expect.arrayContaining([expect.objectContaining({ contentId: '101' })]),
    );
    expect(petPlacesService.findNearby).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: '37.5665',
        lng: '126.978',
      }),
    );
  });

  it('continues behavior RAG for follow-up questions using chat history', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          answer: '보호자는 거리를 확보하고 조용한 보상을 준비해 주세요.',
          observationChecklist: ['반응이 시작되는 거리 기록'],
          retrievedChunkIds: ['dog-reactivity-follow-up'],
          riskLevel: 'behavior_support',
          safety: {
            action: 'allow',
            blockedTerms: [],
            redFlagDetected: false,
            riskLevel: 'behavior_support',
            triggeredRules: [],
          },
          sources: [{ sourceType: 'rag_source', title: '반응성 산책' }],
          vetConsultCriteria: ['물림 위험이 있으면 전문가 상담'],
        }),
      ok: true,
    });

    const response = await service.chat({
      history: [
        {
          content: '강아지가 산책 중 다른 강아지를 보면 짖어요',
          role: 'user',
        },
        {
          content: '산책 중 반응성은 거리 확보를 우선해 보세요.',
          role: 'assistant',
        },
      ],
      message: '그럼 보호자는 어떻게 반응하면 돼?',
      species: 'dog',
    });

    expect(response.answer).toContain('거리를 확보');
    expect(response.usedTools).toContain('search_behavior_rag');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai.test/pet-behavior/question',
      expect.any(Object),
    );
  });
});
