BEGIN;

WITH region_seed AS (
  SELECT *
  FROM (
    VALUES
      (1, 'gangneung', '강릉', 'traveler03', ARRAY['경포호', '안목해변', '초당순두부마을', '오죽헌', '정동진'], '커피 거리와 바다 산책을 함께 묶기 좋은 동해 여행지', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80'),
      (2, 'jeju', '제주', 'traveler02', ARRAY['성산일출봉', '협재해변', '사려니숲길', '동문시장', '카멜리아힐'], '해안 드라이브와 숲길, 시장 동선이 모두 가능한 섬 여행지', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80'),
      (3, 'busan', '부산', 'traveler01', ARRAY['광안리해변', '흰여울문화마을', '해운대시장', '감천문화마을', '송도케이블카'], '바다 야경과 골목 산책, 먹거리를 한 번에 묶기 좋은 도시', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80'),
      (4, 'jeonju', '전주', 'traveler08', ARRAY['전주한옥마을', '남부시장', '덕진공원', '경기전', '객리단길'], '한옥 골목과 시장 먹거리가 강한 당일치기 여행지', 'https://images.unsplash.com/photo-1493538108018-4a50e38ad7ca?auto=format&fit=crop&w=900&q=80'),
      (5, 'yeosu', '여수', 'traveler10', ARRAY['오동도', '낭만포차거리', '해상케이블카', '향일암', '돌산공원'], '밤바다와 케이블카, 해산물 코스가 잘 맞는 남해 여행지', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80'),
      (6, 'sokcho', '속초', 'traveler04', ARRAY['속초중앙시장', '영금정', '외옹치해변', '설악산', '아바이마을'], '산과 바다, 시장 음식을 짧은 동선으로 연결하기 좋은 지역', 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80'),
      (7, 'namhae', '남해', 'traveler06', ARRAY['독일마을', '다랭이마을', '상주은모래비치', '보리암', '섬이정원'], '조용한 바다 마을과 전망 좋은 산책 코스가 많은 여행지', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80'),
      (8, 'chuncheon', '춘천', 'traveler11', ARRAY['소양강스카이워크', '남이섬', '공지천', '강촌레일바이크', '명동닭갈비골목'], '호수 산책과 닭갈비, 짧은 근교 여행이 잘 맞는 지역', 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=80'),
      (9, 'pohang', '포항', 'traveler09', ARRAY['스페이스워크', '영일대해수욕장', '호미곶', '죽도시장', '구룡포'], '동해 일출과 해산물 시장, 드라이브가 어울리는 항구 도시', 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=900&q=80'),
      (10, 'gyeongju', '경주', 'traveler05', ARRAY['첨성대', '동궁과월지', '황리단길', '불국사', '보문호수'], '역사 유적과 산책, 카페 골목을 함께 즐기기 좋은 여행지', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80'),
      (11, 'tongyeong', '통영', 'traveler07', ARRAY['동피랑벽화마을', '통영케이블카', '서피랑', '중앙시장', '이순신공원'], '섬 전망과 벽화마을, 시장 먹거리가 가까운 남해 도시', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80'),
      (12, 'gapyeong', '가평', 'traveler12', ARRAY['아침고요수목원', '자라섬', '쁘띠프랑스', '청평호', '남이섬'], '수목원과 호수, 펜션 숙박이 잘 맞는 수도권 근교 여행지', 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80')
  ) AS seed(region_order, region_code, region_name, login_id, spots, note, image_url)
),
theme_seed AS (
  SELECT *
  FROM (
    VALUES
      (1, 'healing', '힐링', '쉬는 시간을 넉넉히 두고 카페나 산책로를 중심으로 움직였습니다.'),
      (2, 'family', '가족', '유모차와 부모님 동선을 고려해 걷는 구간을 짧게 잡았습니다.'),
      (3, 'couple', '커플', '사진 찍기 좋은 시간대와 조용한 저녁 코스를 함께 정리했습니다.'),
      (4, 'solo_trip', '혼행', '혼자 식사하기 편한 곳과 대중교통 이동을 우선으로 골랐습니다.'),
      (5, 'gourmet', '미식', '시장, 로컬 식당, 간식 포인트를 끊기지 않게 연결했습니다.'),
      (6, 'drive', '드라이브', '주차가 쉬운 지점과 해안 또는 호수 전망 도로를 중심으로 잡았습니다.'),
      (7, 'date', '데이트', '걷기 좋은 코스와 예약이 필요한 저녁 장소를 함께 묶었습니다.')
  ) AS seed(theme_order, theme_code, theme_name, theme_note)
),
budget_seed AS (
  SELECT *
  FROM (
    VALUES
      (1, 'under_100k', '10만원 이하', '대중교통과 가벼운 식사 위주로 비용을 낮췄습니다.'),
      (2, 'from_100k_to_200k', '10-20만원', '식사와 카페, 입장료를 균형 있게 넣었습니다.'),
      (3, 'from_200k_to_300k', '20-30만원', '숙소나 체험 하나를 포함해 만족도를 높였습니다.'),
      (4, 'over_300k', '30만원 이상', '숙소, 체험, 저녁 식사를 여유 있게 잡았습니다.')
  ) AS seed(budget_order, budget_code, budget_label, budget_note)
),
season_seed AS (
  SELECT *
  FROM (
    VALUES
      (1, '봄', '꽃길과 야외 산책 시간이 좋아 오전 출발을 추천했습니다.'),
      (2, '여름', '더운 시간대를 피하고 실내 쉼터와 바다 시간을 나눴습니다.'),
      (3, '가을', '노을과 단풍 시간대를 맞추기 위해 오후 동선을 길게 잡았습니다.'),
      (4, '겨울', '짧은 낮 시간을 고려해 실내와 따뜻한 식사 장소를 먼저 배치했습니다.')
  ) AS seed(season_order, season, season_note)
),
companion_seed AS (
  SELECT *
  FROM (
    VALUES
      (1, '혼자', '혼자 이동해도 부담 없는 동선으로 정리했습니다.'),
      (2, '친구', '친구와 사진, 간식, 산책을 번갈아 즐기기 좋았습니다.'),
      (3, '연인', '조용한 카페와 야경 포인트를 마지막에 배치했습니다.'),
      (4, '가족', '화장실, 주차, 휴식 지점을 중간마다 확인했습니다.')
  ) AS seed(companion_order, companion, companion_note)
),
generated AS (
  SELECT
    r.login_id,
    FORMAT(
      'RAG 확장 %s %s 코스 %s',
      r.region_name,
      t.theme_name,
      LPAD((r.region_order * 100 + gs.n)::text, 3, '0')
    ) AS title,
    FORMAT(
      '%s의 %s, %s, %s을 연결한 %s %s 여행 기록입니다.',
      r.region_name,
      r.spots[1 + ((gs.n - 1) % array_length(r.spots, 1))],
      r.spots[1 + (gs.n % array_length(r.spots, 1))],
      r.spots[1 + ((gs.n + 1) % array_length(r.spots, 1))],
      b.budget_label,
      t.theme_name
    ) AS summary,
    CONCAT_WS(
      E'\n',
      FORMAT('%s %s 여행을 위해 실제로 이동하기 쉬운 순서로 정리했습니다.', r.region_name, t.theme_name),
      FORMAT('핵심 동선은 %s에서 시작해 %s을 거쳐 %s까지 이어집니다.',
        r.spots[1 + ((gs.n - 1) % array_length(r.spots, 1))],
        r.spots[1 + (gs.n % array_length(r.spots, 1))],
        r.spots[1 + ((gs.n + 1) % array_length(r.spots, 1))]
      ),
      r.note,
      t.theme_note,
      b.budget_note,
      s.season_note,
      c.companion_note,
      'RAG 검색에서 장소명, 예산, 계절, 동행 유형이 함께 걸리도록 숙소, 식사, 이동 팁을 구체적으로 남겼습니다.'
    ) AS content,
    CASE WHEN gs.n % 4 = 0 THEN NULL::text ELSE r.image_url END AS image_url,
    r.region_code,
    b.budget_code,
    t.theme_code,
    s.season,
    c.companion,
    (DATE '2026-03-01' + ((r.region_order * 17 + gs.n * 9) % 260))::text AS travel_date,
    ARRAY[
      '#' || r.region_name,
      '#' || t.theme_name,
      '#' || b.budget_label,
      '#' || c.companion,
      '#' || r.spots[1 + ((gs.n - 1) % array_length(r.spots, 1))]
    ] AS tags,
    80 + r.region_order * 23 + gs.n * 11 AS view_count,
    (TIMESTAMPTZ '2026-06-16 09:00:00+09' - ((r.region_order * 15 + gs.n) || ' hours')::interval) AS created_at,
    (TIMESTAMPTZ '2026-06-16 09:00:00+09' - ((r.region_order * 15 + gs.n) || ' hours')::interval) AS updated_at
  FROM region_seed r
  CROSS JOIN generate_series(1, 15) AS gs(n)
  JOIN theme_seed t
    ON t.theme_order = 1 + ((gs.n - 1) % 7)
  JOIN budget_seed b
    ON b.budget_order = 1 + ((gs.n - 1) % 4)
  JOIN season_seed s
    ON s.season_order = 1 + ((gs.n - 1) % 4)
  JOIN companion_seed c
    ON c.companion_order = 1 + ((gs.n - 1) % 4)
)
INSERT INTO posts (
  author_id,
  title,
  summary,
  content,
  image_url,
  region_id,
  budget_range_id,
  theme_id,
  season,
  companion,
  travel_date,
  tags,
  view_count,
  created_at,
  updated_at
)
SELECT
  u.id,
  generated.title,
  generated.summary,
  generated.content,
  generated.image_url,
  r.id,
  b.id,
  t.id,
  generated.season::season_enum,
  generated.companion::companion_enum,
  generated.travel_date::date,
  generated.tags,
  generated.view_count,
  generated.created_at,
  generated.updated_at
FROM generated
JOIN users u
  ON LOWER(u.login_id) = LOWER(generated.login_id)
JOIN regions r
  ON r.code = generated.region_code
JOIN budget_ranges b
  ON b.code = generated.budget_code
JOIN themes t
  ON t.code = generated.theme_code
WHERE NOT EXISTS (
  SELECT 1
  FROM posts p
  WHERE p.author_id = u.id
    AND p.title = generated.title
);

COMMIT;
