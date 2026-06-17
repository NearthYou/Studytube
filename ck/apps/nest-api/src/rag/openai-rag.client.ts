import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { RagQuestionFilters, RagSource } from './rag.types';

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

type ResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

@Injectable()
export class OpenAiRagClient {
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly embeddingModel =
    process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  private readonly chatModel = process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.5';

  async createEmbedding(input: string) {
    this.assertApiKey();

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException('Failed to create embedding');
    }

    const data = (await response.json()) as EmbeddingResponse;
    const embedding = data.data?.[0]?.embedding;

    if (!embedding?.length) {
      throw new InternalServerErrorException('Embedding response is empty');
    }

    return embedding;
  }

  async createAnswer(input: {
    question: string;
    filters: RagQuestionFilters;
    sources: RagSource[];
  }) {
    this.assertApiKey();

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.chatModel,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'developer',
            content: [
              '너는 뮤지컬 좌석 후기 기반 좌석 상담 도우미다.',
              '반드시 제공된 관련 후기 안에서만 답한다.',
              '사용자가 시야, 음향, 편안함을 물으면 추천이 아니라 해당 좌석/범위의 체감을 답한다.',
              '사용자가 추천해 달라고 명시한 경우에만 추천한다.',
              '정확한 열 후기가 적어도 앞뒤 열이나 같은 층 후기가 제공되면 그 범위를 종합해서 답한다.',
              '정확한 후기 개수, 검색 범위를 넓힌 사실, "앞뒤 열까지 봤다" 같은 내부 검색 과정은 말하지 않는다.',
              '관련 후기가 제공되어 있으면 "후기가 충분하지 않다"는 문장을 붙이지 않는다.',
              '근거, 출처, bullet 목록, 후기 ID는 노출하지 않는다.',
              '답변은 한국어로 작성한다.',
              '친절하지만 과장하지 말고, ChatGPT처럼 자연스러운 줄글 1~3문단으로 답한다.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: this.buildPrompt(
              input.question,
              input.filters,
              input.sources,
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException('Failed to create RAG answer');
    }

    const data = (await response.json()) as ResponsesApiResponse;
    const outputText =
      data.output_text ??
      data.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text)
        .filter(Boolean)
        .join('\n');

    if (!outputText) {
      throw new InternalServerErrorException('RAG answer response is empty');
    }

    return outputText;
  }

  private buildPrompt(
    question: string,
    filters: RagQuestionFilters,
    sources: RagSource[],
  ) {
    const sourceText = sources
      .map((source, index) =>
        [
          `[근거 ${index + 1}]`,
          `후기 ID: ${source.id}`,
          `극장: ${source.theater.name}`,
          `작품: ${source.musical.title}`,
          `공연 시즌: ${source.performance?.seasonLabel ?? '없음'}`,
          `좌석: ${source.seat.floor} ${source.seat.section ?? ''} ${source.seat.row}열 ${source.seat.number}번`,
          `평점: 시야 ${source.ratings.view}, 음향 ${source.ratings.sound}, 편안함 ${source.ratings.comfort}, 표정 ${source.ratings.expression}, 전체무대 ${source.ratings.stageVisibility}`,
          `태그: ${source.tags.join(', ') || '없음'}`,
          `후기: ${source.content}`,
        ].join('\n'),
      )
      .join('\n\n');

    return [
      `사용자 질문: ${question}`,
      `추출된 조건: ${JSON.stringify(filters)}`,
      '',
      '관련 후기:',
      sourceText || '관련 후기가 없음',
      '',
      '답변 형식:',
      '- 자연스러운 줄글로만 답한다.',
      '- 근거 목록, 출처 목록, 후기 ID, bullet은 쓰지 않는다.',
      '- 질문이 "어때?"이면 해당 조건의 체감을 말하고 다른 구역 추천으로 시작하지 않는다.',
      '- 정확히 몇 개의 후기를 봤는지, 주변 열까지 같이 봤는지 같은 검색 과정은 답변에 쓰지 않는다.',
      '- 질문이 "시야방해가 몇 열까지야?"처럼 범위를 묻는다면, 제공된 후기에서 확인되는 층/열 범위를 요약한다.',
    ].join('\n');
  }

  private assertApiKey() {
    if (!this.apiKey) {
      throw new InternalServerErrorException('OPENAI_API_KEY is not set');
    }
  }
}
