import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PetPlacesService } from '../pet-places/pet-places.service';
import { PostsService } from '../posts/posts.service';
import { ChatAgentDto } from './dto/chat-agent.dto';

type RiskLevel =
  | 'none'
  | 'behavior_support'
  | 'caution'
  | 'vet_consult'
  | 'emergency';

type AgentCard = {
  href: string;
  id: string;
  title: string;
  type: 'post' | 'place';
};

type AgentPlace = {
  address?: string;
  contentId: string;
  firstImage?: string;
  mapX?: string;
  mapY?: string;
  petInfo?: unknown;
  title: string;
};

type PetPlaceListResponse = Awaited<ReturnType<PetPlacesService['search']>>;

type AgentSource = {
  excerpt?: string;
  pmcid?: string | null;
  pmid?: string | null;
  sourceType?: string | null;
  title: string;
  url?: string | null;
  year?: number | null;
};

type RagSafety = {
  action?: string;
  blockedTerms?: string[];
  redFlagDetected?: boolean;
  riskLevel?: RiskLevel;
  triggeredRules?: string[];
};

type BehaviorRagResponse = {
  answer: string;
  answerProvider?: 'openai' | 'local_template' | 'unknown';
  fallbackUsed?: boolean;
  observationChecklist: string[];
  retrievedChunkIds: string[];
  riskLevel: RiskLevel;
  safety: RagSafety;
  sources: AgentSource[];
  vetConsultCriteria: string[];
};

const emergencyKeywords = [
  '응급',
  '호흡',
  '숨을',
  '발작',
  '경련',
  '피가',
  '출혈',
  '중독',
  '초콜릿',
  '포도',
  '양파',
  '쓰러',
  '소변을 못',
  '소변이 안',
  '혈뇨',
  '자해',
  '탈출',
];

const vetConsultKeywords = [
  '아파',
  '통증',
  '구토',
  '설사',
  '피부',
  '약',
  '처방',
  '진단',
  '병원',
  '공격',
  '불안',
  '분리불안',
  '배변',
  '배뇨',
  '소변',
  '이상행동',
  '으르렁',
  '입질',
  '노령',
  '밤마다',
];

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly postsService: PostsService,
    private readonly petPlacesService: PetPlacesService,
    private readonly configService: ConfigService,
  ) {}

  async chat(dto: ChatAgentDto, user?: AuthenticatedUser) {
    const message = dto.message.trim();
    let riskLevel = this.getRiskLevel(message);
    const usedTools: string[] = [];
    const cards: AgentCard[] = [];
    let places: AgentPlace[] = [];
    let ragResponse: BehaviorRagResponse | null = null;
    const isBehaviorQuestion = this.shouldUseBehaviorRag(message, dto.history);
    const shouldSearchPosts = this.shouldSearchPosts(message);
    const shouldSearchPlaces = this.shouldSearchPlaces(message);

    if (isBehaviorQuestion) {
      usedTools.push('search_behavior_rag');
      ragResponse = await this.askBehaviorRag(dto, user);

      if (ragResponse) {
        riskLevel = ragResponse.riskLevel;
      }
    }

    if (shouldSearchPosts) {
      const postCards = await this.searchPosts(message, user);
      cards.push(...postCards);
      usedTools.push('post_search');
    }

    if (shouldSearchPlaces) {
      const placeResult = await this.searchPlaces(message, dto);
      places = placeResult.places;
      cards.push(...placeResult.cards);
      usedTools.push('pet_place_search');
    }

    if (this.shouldDraftReply(message)) {
      usedTools.push('safe_reply_draft');
    }

    if (!usedTools.length) {
      usedTools.push('conversation_reply');
    }

    return {
      message: 'Assistant 응답을 생성했습니다.',
      answer: this.buildAnswer(
        message,
        riskLevel,
        cards,
        places,
        ragResponse,
        isBehaviorQuestion,
        shouldSearchPosts,
        shouldSearchPlaces,
        dto.history,
      ),
      riskLevel,
      usedTools,
      cards,
      places,
      sources: ragResponse?.sources ?? this.getSources(riskLevel),
      observationChecklist: ragResponse?.observationChecklist ?? [],
      vetConsultCriteria: ragResponse?.vetConsultCriteria ?? [],
      retrievedChunkIds: ragResponse?.retrievedChunkIds ?? [],
      safety: ragResponse?.safety ?? this.getLocalSafety(riskLevel),
      answerProvider: ragResponse?.answerProvider ?? 'local_template',
      fallbackUsed: ragResponse?.fallbackUsed ?? isBehaviorQuestion,
    };
  }

  private async searchPosts(
    message: string,
    user?: AuthenticatedUser,
  ): Promise<AgentCard[]> {
    try {
      const response = await this.postsService.search(
        {
          keyword: this.toKeyword(message),
          limit: 3,
          page: 1,
        },
        user,
      );

      return response.items.map((post: { id: string; title: string }) => ({
        href: `/posts/${post.id}`,
        id: post.id,
        title: post.title,
        type: 'post',
      }));
    } catch {
      return [];
    }
  }

  private async searchPlaces(
    message: string,
    dto: ChatAgentDto,
  ): Promise<{ cards: AgentCard[]; places: AgentPlace[] }> {
    try {
      const areaCode = this.toAreaCode(message);
      let response: PetPlaceListResponse;

      if (dto.location?.mapX && dto.location?.mapY) {
        response = await this.petPlacesService.findNearby({
          lat: String(dto.location.mapY),
          lng: String(dto.location.mapX),
          radius: dto.location.radius ?? 3000,
          limit: 3,
          page: 1,
        });
      } else if (areaCode) {
        response = await this.petPlacesService.findByArea({
          areaCode,
          limit: 3,
          page: 1,
        });
      } else {
        response = await this.petPlacesService.search({
          keyword: this.toKeyword(message),
          limit: 3,
          page: 1,
        });
      }

      const places = response.items.map((place) => ({
        address: place.address,
        contentId: place.contentId,
        firstImage: place.firstImage,
        mapX: place.mapX,
        mapY: place.mapY,
        title: place.title || '이름 없는 장소',
      }));
      const cards: AgentCard[] = places.map((place) => ({
        href: `/pet-places/${place.contentId}`,
        id: place.contentId,
        title: place.title || '이름 없는 장소',
        type: 'place',
      }));

      return { cards, places };
    } catch {
      return { cards: [], places: [] };
    }
  }

  private buildAnswer(
    message: string,
    riskLevel: RiskLevel,
    cards: AgentCard[],
    places: AgentPlace[],
    ragResponse: BehaviorRagResponse | null,
    isBehaviorQuestion: boolean,
    searchedPosts: boolean,
    searchedPlaces: boolean,
    history: ChatAgentDto['history'] = [],
  ) {
    if (ragResponse) {
      return ragResponse.answer;
    }

    if (riskLevel === 'emergency') {
      return '응급 가능성이 있는 표현이 포함되어 있어요. Tail Talk Assistant는 진단을 대신할 수 없으니, 호흡 곤란, 발작, 중독 의심, 심한 출혈처럼 긴급 신호가 있다면 즉시 동물병원에 연락해 주세요.';
    }

    if (riskLevel === 'vet_consult') {
      return '건강이나 행동 문제는 단정해서 답하지 않을게요. 증상이 시작된 시점, 반복 빈도, 식욕/활동성 변화, 배변 상태를 메모하고 필요하면 동물병원이나 전문가와 상담해 주세요.';
    }

    if (places.length > 0) {
      return `요청과 관련된 반려동물 동반 장소 ${places.length}개를 찾았어요. 아래 장소 카드에서 바로 확인해 보세요.`;
    }

    if (isBehaviorQuestion) {
      return '반려동물 행동 질문으로 이해했어요. 현재 근거 검색 응답이 지연되어 일반 안전 기준으로 먼저 안내할게요. 갑작스러운 변화, 통증, 식욕/활동량, 배뇨/배변 변화, 물림 위험을 기록하고, 강압이나 처벌보다는 안전 거리와 선택권을 우선해 주세요. 위험 신호가 있으면 동물병원이나 행동 전문가 상담을 먼저 권장합니다.';
    }

    if (searchedPlaces) {
      return '동반 장소를 찾아봤는데 지금 바로 보여줄 결과가 없어요. 지역명이나 “근처”, “카페”, “공원”, “숙소”처럼 장소 단서를 조금 더 넣어주면 다시 찾아볼게요.';
    }

    if (cards.length > 0) {
      return `요청과 관련된 Tail Talk 자료 ${cards.length}개를 찾았어요. 아래 카드에서 바로 확인해 보세요.`;
    }

    if (searchedPosts) {
      return '게시글을 찾아봤는데 지금 바로 보여줄 결과가 없어요. “산책”, “분리불안”, “고양이 화장실”처럼 키워드를 바꿔서 다시 검색해볼 수 있어요.';
    }

    if (this.shouldDraftReply(message)) {
      return '따뜻하고 짧게 답한다면 “공유해줘서 고마워요. 상황을 차분히 살펴보고 필요한 도움을 받으면 좋겠어요.”처럼 시작해 보세요.';
    }

    if (this.isGreeting(message)) {
      return '안녕하세요! Tail Talk Assistant예요. 반려동물 행동이나 건강 걱정, 산책 중 고민, 동반 장소, 게시글 검색까지 편하게 물어보세요.';
    }

    if (this.isThanks(message)) {
      return '천만에요. 이어서 궁금한 점이 있으면 그대로 물어보세요. 앞선 대화 맥락을 함께 보고 답할게요.';
    }

    if (this.isCapabilityQuestion(message)) {
      return '저는 Tail Talk 안에서 반려동물 행동 Q&A, 위험 신호 안내, 동반 장소 찾기, 게시글 검색, 댓글 답장 초안을 도와드릴 수 있어요. 예를 들면 “고양이가 화장실 밖에 소변을 봐요”처럼 자연스럽게 물어보면 됩니다.';
    }

    if (this.isClarificationQuestion(message)) {
      return '이렇게 알려주면 바로 이어서 볼 수 있어요: 반려동물 종류와 나이, 언제부터 그랬는지, 어떤 상황에서 반복되는지, 식욕·활동량·배변·배뇨 변화가 있는지요.';
    }

    if (this.isSmallTalk(message)) {
      return '저는 여기서 반려동물 이야기를 기다리고 있어요. 가볍게 수다처럼 말해도 괜찮아요. 예를 들면 “우리 강아지가 요즘 낑낑거려”처럼 시작해 주세요.';
    }

    if (this.hasRecentConversation(history)) {
      return '좋아요. 방금 이야기한 흐름에서 이어서 볼게요. 상황, 시간, 반복 빈도, 몸 상태 변화 중 하나만 더 알려주세요.';
    }

    return '좋아요. 지금 상황을 한 문장만 더 알려주세요. 예를 들면 “강아지가 낑낑 소리를 내요”, “고양이가 화장실 밖에 소변을 봐요”, “근처 조용한 동반 카페 찾아줘”처럼 말하면 바로 이어서 도와드릴게요.';
  }

  private getSources(riskLevel: RiskLevel) {
    if (riskLevel === 'none') {
      return [];
    }

    return [
      {
        title: 'Tail Talk 안전 안내',
        excerpt:
          '건강·행동 관련 답변은 경험 공유를 돕는 참고 정보이며, 진단·처방·응급 판단은 전문가 상담이 필요합니다.',
      },
    ];
  }

  private getRiskLevel(message: string): RiskLevel {
    if (emergencyKeywords.some((keyword) => message.includes(keyword))) {
      return 'emergency';
    }

    if (vetConsultKeywords.some((keyword) => message.includes(keyword))) {
      return 'vet_consult';
    }

    return 'none';
  }

  private getLocalSafety(riskLevel: RiskLevel): RagSafety {
    return {
      action:
        riskLevel === 'emergency'
          ? 'emergency_vet_first'
          : riskLevel === 'vet_consult'
            ? 'vet_consult_first'
            : 'allow',
      blockedTerms: [],
      redFlagDetected: ['emergency', 'vet_consult'].includes(riskLevel),
      riskLevel,
      triggeredRules: [],
    };
  }

  private async askBehaviorRag(
    dto: ChatAgentDto,
    user?: AuthenticatedUser,
  ): Promise<BehaviorRagResponse | null> {
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');

    if (!aiServiceUrl) {
      return null;
    }

    try {
      const response = await fetch(
        `${aiServiceUrl.replace(/\/$/, '')}/pet-behavior/question`,
        {
          body: JSON.stringify({
            context: {
              ...dto.context,
              history: dto.history?.slice(-8),
            },
            petAge: dto.petAge,
            question: dto.message.trim(),
            species: dto.species,
            userId: user?.id,
          }),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: AbortSignal.timeout(this.getAiServiceTimeoutMs()),
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `AI behavior RAG request failed with status ${response.status}. Falling back to local assistant response.`,
        );
        return null;
      }

      const payload = (await response.json()) as unknown;
      return this.toBehaviorRagResponse(payload);
    } catch (error) {
      this.logger.warn(
        `AI behavior RAG request failed. Falling back to local assistant response. ${this.toErrorMessage(error)}`,
      );
      return null;
    }
  }

  private toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private toBehaviorRagResponse(payload: unknown): BehaviorRagResponse | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    if (
      typeof payload.answer !== 'string' ||
      typeof payload.riskLevel !== 'string'
    ) {
      return null;
    }

    return {
      answer: payload.answer,
      answerProvider: this.toAnswerProvider(payload.answerProvider),
      fallbackUsed:
        typeof payload.fallbackUsed === 'boolean' ? payload.fallbackUsed : true,
      observationChecklist: this.toStringArray(payload.observationChecklist),
      retrievedChunkIds: this.toStringArray(payload.retrievedChunkIds),
      riskLevel: this.toRiskLevel(payload.riskLevel),
      safety: this.isRecord(payload.safety) ? payload.safety : {},
      sources: Array.isArray(payload.sources)
        ? payload.sources
            .filter((source): source is Record<string, unknown> =>
              this.isRecord(source),
            )
            .map((source) => ({
              pmcid: this.getNullableString(source.pmcid),
              pmid: this.getNullableString(source.pmid),
              sourceType: this.getNullableString(source.sourceType),
              title: this.getString(source.title) || 'RAG source',
              url: this.getNullableString(source.url),
              year:
                typeof source.year === 'number'
                  ? source.year
                  : Number(source.year) || null,
            }))
        : [],
      vetConsultCriteria: this.toStringArray(payload.vetConsultCriteria),
    };
  }

  private getAiServiceTimeoutMs() {
    const timeoutMs = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS'),
    );

    return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  }

  private shouldUseBehaviorRag(
    message: string,
    history: ChatAgentDto['history'] = [],
  ) {
    if (this.hasBehaviorKeyword(message)) {
      return true;
    }

    const hasRecentBehaviorContext = history
      .slice(-8)
      .some((entry) => this.hasBehaviorKeyword(entry.content));

    return hasRecentBehaviorContext && this.isFollowUpQuestion(message);
  }

  private hasBehaviorKeyword(message: string) {
    return [
      '짖',
      '물',
      '공격',
      '화장실',
      '배변',
      '배뇨',
      '소변',
      '분리불안',
      '불안',
      '그루밍',
      '핥',
      '먹',
      '노령',
      '밤마다',
      '으르렁',
      '낑낑',
      '끙끙',
      '깨갱',
      '하울링',
      '울',
      '울음',
      '소리',
      '신음',
      '통증',
      '아파',
      '훈련',
      '목줄',
      '자원',
      '밥그릇',
      '장난감',
    ].some((keyword) => message.includes(keyword));
  }

  private isFollowUpQuestion(message: string) {
    return [
      '그럼',
      '그러면',
      '어떻게',
      '왜',
      '대처',
      '방법',
      '반응',
      '보호자',
      '해도',
      '하면',
      '계속',
      '다음',
      '그때',
      '이럴 때',
    ].some((keyword) => message.includes(keyword));
  }

  private shouldSearchPosts(message: string) {
    return [
      '게시글',
      '글',
      '사진',
      '태그',
      '일상',
      '산책',
      '케어',
      '질문',
    ].some((keyword) => message.includes(keyword));
  }

  private shouldSearchPlaces(message: string) {
    return ['장소', '카페', '식당', '숙소', '근처', '동반'].some((keyword) =>
      message.includes(keyword),
    );
  }

  private shouldDraftReply(message: string) {
    return ['댓글', '답장', '제목', '태그', '문구'].some((keyword) =>
      message.includes(keyword),
    );
  }

  private isGreeting(message: string) {
    const normalized = message.replace(/[!?.~\s]/g, '');

    return ['안녕', '안녕하세요', '하이', 'hello', 'hi', '헬로', '반가워'].some(
      (keyword) => normalized.toLowerCase().includes(keyword),
    );
  }

  private isThanks(message: string) {
    return ['고마워', '감사', '땡큐', 'thanks', 'thankyou'].some((keyword) =>
      message.toLowerCase().includes(keyword),
    );
  }

  private isCapabilityQuestion(message: string) {
    return ['뭐 할 수', '뭘 할 수', '무엇을 할 수', '기능', '도와줄 수'].some(
      (keyword) => message.includes(keyword),
    );
  }

  private isClarificationQuestion(message: string) {
    return [
      '어떻게 구체',
      '뭘 더',
      '뭐 더',
      '어떤 정보',
      '구체적으로',
      '무슨 말',
    ].some((keyword) => message.includes(keyword));
  }

  private isSmallTalk(message: string) {
    const normalized = message.replace(/[!?.~\s]/g, '').toLowerCase();

    return [
      '뭐해',
      '심심해',
      '좋아',
      '오케이',
      'ㅋㅋ',
      'ㅎㅎ',
      '그래',
      '응',
      '음',
    ].some((keyword) => normalized.includes(keyword));
  }

  private hasRecentConversation(history: ChatAgentDto['history'] = []) {
    return history.length > 0;
  }

  private toKeyword(message: string) {
    return (
      message
        .replace(
          /게시글|장소|검색|찾아줘|찾아봐줘|추천|보여줘|알려줘|말해줘|동반|근처/g,
          ' ',
        )
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(' ') || '반려동물'
    );
  }

  private toAreaCode(message: string) {
    const areaCodes: Array<[string[], string]> = [
      [['서울', '서울시', '서울특별시'], '1'],
      [['인천', '인천시', '인천광역시'], '2'],
      [['대전', '대전시', '대전광역시'], '3'],
      [['대구', '대구시', '대구광역시'], '4'],
      [['광주', '광주시', '광주광역시'], '5'],
      [['부산', '부산시', '부산광역시'], '6'],
      [['울산', '울산시', '울산광역시'], '7'],
      [['세종', '세종시', '세종특별자치시'], '8'],
      [['경기', '경기도'], '31'],
      [['강원', '강원도'], '32'],
      [['충북', '충청북도'], '33'],
      [['충남', '충청남도'], '34'],
      [['경북', '경상북도'], '35'],
      [['경남', '경상남도'], '36'],
      [['전북', '전라북도'], '37'],
      [['전남', '전라남도'], '38'],
      [['제주', '제주도', '제주특별자치도'], '39'],
    ];

    return (
      areaCodes.find(([aliases]) =>
        aliases.some((alias) => message.includes(alias)),
      )?.[1] ?? null
    );
  }

  private toStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private toRiskLevel(value: string): RiskLevel {
    if (
      [
        'none',
        'behavior_support',
        'caution',
        'vet_consult',
        'emergency',
      ].includes(value)
    ) {
      return value as RiskLevel;
    }

    return 'none';
  }

  private toAnswerProvider(value: unknown) {
    if (value === 'openai' || value === 'local_template') {
      return value;
    }

    return 'unknown';
  }

  private getString(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    return '';
  }

  private getNullableString(value: unknown): string | null {
    const stringValue = this.getString(value);
    return stringValue || null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
