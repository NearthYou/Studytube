import { Injectable } from '@nestjs/common'; // NestJS가 AiService 객체를 관리할 수 있게 하는 표시를 가져온다.
import { ConfigService } from '@nestjs/config'; // .env 값을 읽기 위해 가져온다.
import type {
  AiHealthResponse,
  AnalyzePostRequest,
  AnalyzePostResponse,
  NormalizeExercisesResponse,
} from './types'; // FastAPI와 주고받을 데이터 타입을 가져온다.

@Injectable() // AiService를 다른 클래스에 주입해서 쓸 수 있게 NestJS 관리 대상으로 등록한다.
export class AiService {
  constructor(private readonly configService: ConfigService) {} // .env 값을 읽는 도구를 NestJS에게 받아온다.

  private getAiServerUrl() {
    return (
      this.configService.get<string>('AI_SERVER_URL') ?? 'http://localhost:8000'
    );
  }

  private getInternalToken() {
    return this.configService.get<string>('AI_INTERNAL_TOKEN') ?? 'change-me';
  }

  async checkHealth(): Promise<AiHealthResponse> {
    const aiServerUrl = this.getAiServerUrl();

    const response = await fetch(`${aiServerUrl}/internal/health`, {
      method: 'GET',
      headers: {
        'X-Internal-Token': this.getInternalToken(),
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'AI 서버 health check에 실패했습니다.');
    }

    return response.json() as Promise<AiHealthResponse>;
  }

  async analyzePost(payload: AnalyzePostRequest): Promise<AnalyzePostResponse> {
    // FastAPI에 분석 요청을 보내고 결과를 받아오는 함수다.
    const aiServerUrl = this.getAiServerUrl(); // .env에 주소가 없으면 로컬 AI 서버 주소를 사용한다.

    // NestJS 서버가 FastAPI 서버의 /analysis/demo 주소로 HTTP 요청을 보낸다.
    const response = await fetch(`${aiServerUrl}/analysis/demo`, {
      method: 'POST', // 분석 데이터를 보내야 하므로 POST 요청을 사용한다.
      headers: {
        'Content-Type': 'application/json', // 요청 body가 JSON이라는 뜻이다.
        'X-Internal-Token': this.getInternalToken(), // FastAPI가 NestJS에서 온 요청인지 확인할 수 있게 내부 토큰을 보낸다.
      },
      body: JSON.stringify(payload), // TypeScript 객체를 HTTP로 보낼 수 있는 JSON 문자열로 바꾼다.
    });

    if (!response.ok) {
      const message = await response.text(); // FastAPI가 보낸 에러 내용을 문자열로 읽는다.
      throw new Error(message || 'AI 서버 요청에 실패했습니다.'); // FastAPI 호출 실패를 NestJS 에러로 바꾼다.
    }

    return response.json() as Promise<AnalyzePostResponse>; // FastAPI 응답 JSON을 분석 결과 타입으로 돌려준다.
  }

  async normalizeExerciseNames(
    names: string[],
  ): Promise<NormalizeExercisesResponse> {
    const aiServerUrl = this.getAiServerUrl();

    const response = await fetch(`${aiServerUrl}/analysis/tools/normalize-exercises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': this.getInternalToken(),
      },
      body: JSON.stringify({ names }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || '운동명 정규화 tool 호출에 실패했습니다.');
    }

    return response.json() as Promise<NormalizeExercisesResponse>;
  }
}
