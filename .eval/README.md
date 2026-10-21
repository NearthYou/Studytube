# AI 기능 평가 기록

2026년 10월 18일 실행한 퀴즈 생성과 검색 평가 결과입니다. 두 평가는 데이터와 판정 기준이 다릅니다.

## 퀴즈 생성

공개 YouTube 강의 영상 27개의 자막을 다섯 구간으로 나누고 구간마다 한 문제씩 생성했습니다. 생성 결과는 형식 검사와 별도 모델의 자막 근거 검수를 거칩니다. 실패 이유를 반영해 한 번 재생성하고 다시 실패하면 결과를 채택하지 않습니다.

| 항목 | 기록 |
| --- | ---: |
| 평가 영상 | 27개 |
| 최초 생성 문제 | 135개 |
| 최초 형식 검사 실패 | 0개 영상 |
| 최초 근거 검수 실패 | 4개 영상, 7문제 |
| 재생성 후 통과 | 1개 영상 |
| 최종 검증 통과 | 24개 영상 |
| 최종 제외 | 3개 영상 |

[영상별 문제와 모델 판정](quiz-results.public.json), [원본 집계](quiz-eval-summary.json), [생성 평가 코드](quiz_eval.py)를 연결했습니다. 공개 기록에는 영상 URL과 자막 구간, 생성된 문제, 모델 판정과 자막 내용의 해시를 남겼습니다. 자막 원문 전체와 문제의 인용문은 로컬 원본에만 보관합니다.

이 수치는 모델이 판정한 검증 통과 여부입니다. 사람이 정답을 확정한 정확도 측정이 아닙니다. 평가 코드의 `saved`는 생성 그래프가 검사를 통과했다는 뜻이며 서비스 DB에 저장한 건수를 뜻하지 않습니다. 사람이 판정 결과를 재검수하는 작업은 별도입니다.

## 검색

[질문과 정답 자료 기준](../api/evaluation/retrieval-judgments.ko.json) 10개를 평가 전용 DB의 데모 게시글에 적용했습니다. `text-embedding-3-small`의 실제 임베딩을 사용하고 키워드, 벡터, 두 순위를 합친 검색을 같은 질문으로 비교했습니다.

| 방식 | Recall@3 | MRR | nDCG@5 |
| --- | ---: | ---: | ---: |
| 키워드 | 0.70 | 0.70 | 0.70 |
| 벡터 | 0.90 | 0.85 | 0.863093 |
| 결합 | 0.90 | 0.90 | 0.90 |

- 키워드는 입력한 단어로 찾고 벡터는 문장의 의미가 가까운 자료를 찾습니다. 결합 검색은 두 방식의 순위를 합칩니다.
- Recall@3은 미리 정한 정답 자료가 상위 3개 결과에 얼마나 포함됐는지를 나타냅니다. 질문마다 정답 자료가 1개 또는 2개 있습니다. 질문별로 정답 자료 중 찾은 비율을 계산한 뒤 평균을 냅니다.
- MRR은 정답이 검색 결과의 앞쪽에 나올수록 높아집니다. nDCG@5는 상위 5개 결과의 관련성과 순서를 함께 평가합니다.

[최종 결과](retrieval-evaluation.json)는 실제 사용자 전체의 검색 품질을 대표하지 않습니다. 이 실행의 시점 인용 충족률(`citationCoverage`)은 0이므로 영상 시점 검색의 정확도를 입증하는 자료로 사용하지 않습니다.

[진단 당시 결과](retrieval-evaluation.before.json)는 같은 질문에서 모든 검색이 빈 결과를 반환한 기록입니다. 이후 후보 필터 적용 위치와 거리 기준을 변경했으므로 이를 단일 변수의 성능 개선 실험으로 비교하지 않습니다. 실행 당시 Git HEAD와 설정값은 각 JSON에 남아 있습니다.

## 보관 결과 확인

아래 명령은 외부 API나 DB에 연결하지 않습니다. 영상별 모델 판정으로 퀴즈 집계를 다시 계산하고 질문별 검색 순위로 지표를 재계산합니다.

```bash
python .eval/publish_results.py --check
python -m unittest discover -s .eval -p test_results.py
```

## 새 평가 실행

퀴즈를 새로 생성하면 YouTube 자막 조회와 유료 OpenAI 호출이 발생합니다. 루트 `.env`의 `OPENAI_API_KEY`와 [AI 의존성](../ai/requirements.txt)을 준비한 뒤 실행합니다. 결과는 기존 로컬 평가 파일을 덮어쓰므로 필요하면 먼저 보관합니다.

```bash
python .eval/quiz_eval.py
python .eval/publish_results.py
```

검색 평가는 운영 DB 대신 전용 로컬 DB를 준비하고 [데모 시드 절차](../api/README.md)를 적용합니다. 색인과 진단 스크립트는 localhost의 이름이 `_eval`로 끝나는 DB만 허용하고 production 모드는 거부합니다. 예를 들어 `app_eval` DB의 `DATABASE_URL`을 설정한 상태에서 아래 명령을 사용합니다. 색인과 진단 스크립트도 OpenAI 임베딩을 호출합니다.

```bash
python .eval/embedding_server.py
# 다른 터미널에서 AI_SERVICE_URL=http://127.0.0.1:8000 설정 후
cd api
npx ts-node scripts/eval-index-retrieval.ts
RETRIEVAL_EVAL_OWNER_ID=1 npm run retrieval:evaluate
npx ts-node scripts/eval-diagnose.ts
```

로컬 `quiz-eval.json`과 로그, 가상환경, 임시 실행 파일은 Git에서 제외합니다. 새 결과를 공개할 때는 `publish_results.py`로 원문 자막을 제외한 기록을 생성합니다.
