require("dotenv").config();

const bcrypt = require("bcrypt");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before running append-sample-data.js.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const prisma = createPrismaClient();

const additionalUsers = [
  { email: "orpheus.note@example.com", nickname: "오르페우스노트" },
  { email: "eurydice.view@example.com", nickname: "에우리디케뷰" },
  { email: "stageleft.kim@example.com", nickname: "좌블선호" },
  { email: "center.block@example.com", nickname: "중블지킴이" },
  { email: "balcony.bee@example.com", nickname: "발코니비" },
  { email: "matinee.memo@example.com", nickname: "마티네메모" },
  { email: "weekend.seat@example.com", nickname: "주말관극러" },
  { email: "red.curtain@example.com", nickname: "붉은커튼" },
  { email: "frontrow.care@example.com", nickname: "앞열주의자" },
  { email: "sound.focus@example.com", nickname: "사운드우선" },
  { email: "ticket.diary@example.com", nickname: "티켓다이어리" },
  { email: "musical.map@example.com", nickname: "뮤지컬맵" },
  { email: "aisle.runner@example.com", nickname: "통로탐색자" },
  { email: "double.cast@example.com", nickname: "더블캐슷러" },
  { email: "encore.note@example.com", nickname: "앵콜기록자" },
  { email: "bbch.memory@example.com", nickname: "비비씨치메모" },
  { email: "yes24.row@example.com", nickname: "예사열기록" },
  { email: "ifthen.route@example.com", nickname: "이프덴루트" },
];

const tagCatalog = {
  표정잘보임: "seat_feature",
  전체무대잘보임: "seat_feature",
  시야방해: "seat_feature",
  음향좋음: "seat_feature",
  사이드시야: "seat_feature",
  첫관람추천: "viewing_purpose",
  재관람추천: "viewing_purpose",
  가성비: "viewing_purpose",
};

const reviewSpecs = [
  {
    authorIndex: 0,
    theaterName: "샤롯데씨어터",
    musicalTitle: "하데스타운",
    seasonLabel: "24시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "F",
    seatNumber: "14",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음", "재관람추천"],
    content:
      "샤롯데 1층 B구역 F열은 하데스타운 24시즌의 표정과 동선이 아주 선명하게 들어온다. 무대 깊이도 크게 놓치지 않고, 넘버가 커질 때 객석으로 밀려오는 소리의 균형도 좋아서 재관람 자리로도 만족도가 높았다.",
  },
  {
    authorIndex: 1,
    theaterName: "샤롯데씨어터",
    musicalTitle: "하데스타운",
    seasonLabel: "24시즌",
    seatFloor: "1층",
    seatSection: "A",
    seatRow: "L",
    seatNumber: "6",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "음향좋음"],
    content:
      "1층 A구역 L열은 정중앙은 아니지만 배우 시선 방향을 따라가기 좋았다. 하데스타운 특유의 조명과 군무가 한쪽으로 치우쳐 보일 때도 크게 답답하지 않았고, 음향은 안정적으로 들렸다.",
  },
  {
    authorIndex: 2,
    theaterName: "샤롯데씨어터",
    musicalTitle: "하데스타운",
    seasonLabel: "24시즌",
    seatFloor: "2층",
    seatSection: "B",
    seatRow: "B",
    seatNumber: "19",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 B구역 B열은 하데스타운 24시즌의 무대 구조를 한눈에 보기 좋다. 배우 표정은 조금 멀지만 조명, 턴테이블, 단체 장면의 그림이 잘 보여서 처음 보는 사람에게도 흐름 잡기 좋은 자리다.",
  },
  {
    authorIndex: 3,
    theaterName: "샤롯데씨어터",
    musicalTitle: "하데스타운",
    seasonLabel: "24시즌",
    seatFloor: "2층",
    seatSection: "C",
    seatRow: "A",
    seatNumber: "8",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "가성비"],
    content:
      "2층 C구역 A열은 사이드 감이 있지만 시야가 막히지는 않았다. 하데스타운은 전체 무드와 조명 흐름이 중요한 작품이라, 가까운 표정보다 전체 그림을 보고 싶은 날에는 충분히 괜찮은 선택이었다.",
  },
  {
    authorIndex: 4,
    theaterName: "샤롯데씨어터",
    musicalTitle: "하데스타운",
    seasonLabel: "24시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "R",
    seatNumber: "18",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "음향좋음"],
    content:
      "1층 B구역 R열은 앞열처럼 압도적인 근접감은 없지만 전체 밸런스가 좋다. 하데스타운 24시즌의 앙상블 동선과 무대 깊이가 안정적으로 보여서 부담 없이 추천할 만한 자리였다.",
  },
  {
    authorIndex: 5,
    theaterName: "샤롯데씨어터",
    musicalTitle: "드라큘라",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "D",
    seatNumber: "16",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음", "재관람추천"],
    content:
      "드라큘라는 가까이서 봐야 강한 장면이 많은데 1층 B구역 D열은 배우 표정과 숨이 같이 들어온다. 사운드도 몰려서 뭉개지지 않고 넘버의 힘이 잘 살아서 만족도가 높았다.",
  },
  {
    authorIndex: 6,
    theaterName: "샤롯데씨어터",
    musicalTitle: "드라큘라",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "C",
    seatRow: "K",
    seatNumber: "7",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "표정잘보임"],
    content:
      "1층 C구역 K열은 사이드지만 무대가 답답하게 잘리지는 않았다. 드라큘라처럼 큰 장면과 인물 감정이 번갈아 오는 작품에서는 배우 동선을 따라가는 재미가 있었다.",
  },
  {
    authorIndex: 7,
    theaterName: "샤롯데씨어터",
    musicalTitle: "드라큘라",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatSection: "B",
    seatRow: "C",
    seatNumber: "21",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 B구역 C열은 드라큘라의 무대 장치와 조명 변화를 보기 좋다. 표정 디테일은 멀지만 큰 그림을 놓치지 않아서 초회 관람이나 전체 연출 확인용으로 좋았다.",
  },
  {
    authorIndex: 8,
    theaterName: "샤롯데씨어터",
    musicalTitle: "드라큘라",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatSection: "A",
    seatRow: "A",
    seatNumber: "4",
    viewRating: 3,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "가성비"],
    content:
      "2층 A구역 A열은 사이드라 정중앙 그림은 아니지만 가격을 생각하면 무난하다. 큰 넘버와 조명 장면은 충분히 따라갈 수 있었고, 음향도 크게 거슬리지 않았다.",
  },
  {
    authorIndex: 9,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "C",
    seatNumber: "11",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음", "재관람추천"],
    content:
      "두산 1층 B구역 C열은 어쩌면 해피엔딩 25시즌의 섬세한 표정이 아주 잘 보인다. 작은 침묵과 눈빛이 중요한 작품이라 가까운 중앙 구역의 장점이 크게 느껴졌다.",
  },
  {
    authorIndex: 10,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "A",
    seatRow: "H",
    seatNumber: "5",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "음향좋음"],
    content:
      "1층 A구역 H열은 약간 비껴 보는 느낌이 있지만 배우 거리감이 가까워 감정선을 따라가기 좋다. 어쩌면 해피엔딩 25시즌의 조용한 넘버도 또렷하게 들렸다.",
  },
  {
    authorIndex: 11,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatSection: "E",
    seatRow: "A",
    seatNumber: "9",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 E구역 A열은 무대 구조와 장면 전환이 한 번에 들어온다. 표정은 멀어도 작품의 정서와 공간감을 읽기 좋아서 초회 관람에도 생각보다 안정적인 자리였다.",
  },
  {
    authorIndex: 12,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "C",
    seatRow: "M",
    seatNumber: "14",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "가성비"],
    content:
      "1층 C구역 M열은 사이드지만 무대가 작아 크게 멀게 느껴지지 않았다. 장면 일부가 살짝 각도감 있게 보이지만 감정 흐름을 따라가는 데 문제는 없었다.",
  },
  {
    authorIndex: 13,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatSection: "D",
    seatRow: "B",
    seatNumber: "3",
    viewRating: 3,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["가성비"],
    content:
      "2층 D구역 B열은 사이드와 거리감이 같이 있어 표정 위주는 아니었다. 그래도 어쩌면 해피엔딩의 전체 무대와 조명 흐름을 보는 데는 무난했다.",
  },
  {
    authorIndex: 14,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "R",
    seatNumber: "18",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "음향좋음"],
    content:
      "1층 B구역 R열은 가까운 맛보다는 전체 밸런스가 좋다. 무대와 객석 거리가 과하게 멀지 않아 조용한 장면에서도 집중이 잘 유지됐다.",
  },
  {
    authorIndex: 0,
    theaterName: "두산아트센터",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "C",
    seatRow: "E",
    seatNumber: "2",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["표정잘보임", "음향좋음"],
    content:
      "1층 C구역 E열은 배우가 가까이 올 때 감정이 확 들어온다. 정중앙은 아니지만 어쩌면 해피엔딩 25시즌의 작은 표정과 호흡을 즐기기에는 충분히 좋은 자리였다.",
  },
  {
    authorIndex: 1,
    theaterName: "두산아트센터",
    musicalTitle: "베어더뮤지컬",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "G",
    seatNumber: "12",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음", "재관람추천"],
    content:
      "베어더뮤지컬 25시즌은 감정이 부딪히는 장면을 가까이서 봐야 힘이 산다. 1층 B구역 G열은 표정과 합창 에너지가 같이 밀려와서 넘버 하나하나 체감이 컸다.",
  },
  {
    authorIndex: 2,
    theaterName: "두산아트센터",
    musicalTitle: "베어더뮤지컬",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatSection: "A",
    seatRow: "J",
    seatNumber: "4",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "음향좋음"],
    content:
      "1층 A구역 J열은 몇 장면에서 몸을 살짝 틀게 되지만 불편할 정도는 아니다. 베어더뮤지컬 25시즌의 인물 감정선이 강해서 사이드에서도 몰입이 잘 됐다.",
  },
  {
    authorIndex: 3,
    theaterName: "두산아트센터",
    musicalTitle: "베어더뮤지컬",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatSection: "E",
    seatRow: "A",
    seatNumber: "6",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 E구역 A열은 베어더뮤지컬 25시즌의 전체 무대 쓰임이 한 번에 보인다. 표정 디테일은 조금 멀어도 단체 장면과 조명 합은 오히려 여기서 더 잘 보였다.",
  },
  {
    authorIndex: 4,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "24-25시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "H",
    seatNumber: "15",
    viewRating: 5,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "음향좋음", "재관람추천"],
    content:
      "홍익대 1층 B구역 H열은 이프덴 24-25시즌의 무대 동선이 안정적으로 들어왔다. 장면 전환이 많은 작품이라 전체 밸런스가 중요한데, 이 자리는 과하게 가깝지도 멀지도 않았다.",
  },
  {
    authorIndex: 5,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "24-25시즌",
    seatFloor: "1층",
    seatSection: "C",
    seatRow: "N",
    seatNumber: "8",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "가성비"],
    content:
      "1층 C구역 N열은 사이드지만 생각보다 답답하지 않았다. 이프덴 24-25시즌은 장면이 빠르게 갈라지는 작품이라 정중앙이 아니어도 흐름을 따라가는 데 무리가 없었다.",
  },
  {
    authorIndex: 6,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "24-25시즌",
    seatFloor: "2층",
    seatSection: "B",
    seatRow: "A",
    seatNumber: "11",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 B구역 A열은 이프덴 24-25시즌의 무대 구조를 보기에 좋다. 표정은 멀지만 장면이 나뉘고 겹치는 흐름이 잘 보여서 작품 이해에는 오히려 도움이 됐다.",
  },
  {
    authorIndex: 7,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "24-25시즌",
    seatFloor: "2층",
    seatSection: "A",
    seatRow: "C",
    seatNumber: "5",
    viewRating: 3,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "가성비"],
    content:
      "2층 A구역 C열은 정면감이 조금 약하지만 가격과 전체 시야를 생각하면 무난했다. 이프덴 24-25시즌의 큰 장면 흐름을 가볍게 따라가기 좋은 자리다.",
  },
  {
    authorIndex: 8,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "23시즌",
    seatFloor: "1층",
    seatSection: "B",
    seatRow: "E",
    seatNumber: "13",
    viewRating: 5,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "재관람추천"],
    content:
      "이프덴 23시즌 1층 B구역 E열은 배우 표정과 감정 전환이 선명했다. 선택의 갈림길을 보여주는 장면들이 가까이서 보이니 인물의 흔들림이 더 크게 느껴졌다.",
  },
  {
    authorIndex: 9,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "23시즌",
    seatFloor: "1층",
    seatSection: "A",
    seatRow: "K",
    seatNumber: "6",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["사이드시야", "음향좋음"],
    content:
      "1층 A구역 K열은 사이드지만 이프덴 23시즌의 동선이 크게 잘리지는 않았다. 무대 왼쪽에서 시작되는 장면은 특히 가까운 느낌이 살아서 꽤 괜찮았다.",
  },
  {
    authorIndex: 10,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "23시즌",
    seatFloor: "2층",
    seatSection: "B",
    seatRow: "B",
    seatNumber: "10",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "첫관람추천"],
    content:
      "2층 B구역 B열은 이프덴 23시즌의 평행한 이야기 구조를 보기 좋았다. 세밀한 표정은 멀지만 무대 전체가 잘 들어와서 첫 관람 때 길을 잃지 않게 해준다.",
  },
  {
    authorIndex: 11,
    theaterName: "홍익대 대학로 아트센터",
    musicalTitle: "이프덴",
    seasonLabel: "23시즌",
    seatFloor: "2층",
    seatSection: "C",
    seatRow: "D",
    seatNumber: "7",
    viewRating: 3,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 4,
    tags: ["가성비"],
    content:
      "2층 C구역 D열은 거리감은 있지만 이프덴 23시즌의 무대 전환과 군무 흐름은 충분히 보였다. 가볍게 전체 이야기를 따라가려는 관람에는 괜찮은 자리다.",
  },
  {
    authorIndex: 12,
    theaterName: "광림아트센터 BBCH홀",
    musicalTitle: "매디슨 카운티의 다리",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatRow: "G",
    seatNumber: "18",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음", "재관람추천"],
    content:
      "광림아트센터 BBCH홀 1층 G열은 매디슨 카운티의 다리 25시즌의 감정선을 가까이서 따라가기 좋았다. 대사가 작게 내려앉는 장면도 잘 들리고, 배우 표정이 충분히 살아서 몰입감이 컸다.",
  },
  {
    authorIndex: 13,
    theaterName: "광림아트센터 BBCH홀",
    musicalTitle: "매디슨 카운티의 다리",
    seasonLabel: "25시즌",
    seatFloor: "1층",
    seatRow: "M",
    seatNumber: "9",
    viewRating: 4,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 4,
    stageVisibilityRating: 4,
    tags: ["음향좋음", "전체무대잘보임"],
    content:
      "1층 M열은 너무 가깝지도 멀지도 않아 매디슨 카운티의 다리 25시즌을 차분하게 보기 좋았다. 무대 전체와 배우 감정이 적당히 같이 잡히고, 음악도 안정적으로 들렸다.",
  },
  {
    authorIndex: 14,
    theaterName: "광림아트센터 BBCH홀",
    musicalTitle: "매디슨 카운티의 다리",
    seasonLabel: "25시즌",
    seatFloor: "2층",
    seatRow: "B",
    seatNumber: "21",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["첫관람추천"],
    content:
      "2층 B열은 매디슨 카운티의 다리 25시즌의 전체 무대 그림을 보기 좋았다. 표정은 조금 멀지만 조명과 공간감이 잘 들어와서 이야기의 분위기를 차분히 따라갈 수 있었다.",
  },
  {
    authorIndex: 15,
    theaterName: "예스24스테이지 1관",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "21시즌",
    seatFloor: "1층",
    seatRow: "F",
    seatNumber: "10",
    viewRating: 5,
    soundRating: 5,
    comfortRating: 4,
    expressionRating: 5,
    stageVisibilityRating: 5,
    tags: ["표정잘보임", "음향좋음"],
    content:
      "예스24스테이지 1관 1층 F열은 어쩌면 해피엔딩 21시즌의 섬세한 표정이 잘 보였다. 공식 구역명은 없지만 복도 기준으로는 중앙에 가까운 느낌이라 시야가 안정적이었다.",
  },
  {
    authorIndex: 16,
    theaterName: "예스24스테이지 1관",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "21시즌",
    seatFloor: "1층",
    seatRow: "N",
    seatNumber: "19",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["전체무대잘보임", "가성비"],
    content:
      "1층 N열은 가까운 표정맛보다는 전체 흐름을 보기 좋은 자리였다. 어쩌면 해피엔딩 21시즌의 장면 전환과 조명 분위기가 잘 들어와서 편하게 보기 좋았다.",
  },
  {
    authorIndex: 17,
    theaterName: "예스24스테이지 1관",
    musicalTitle: "어쩌면 해피엔딩",
    seasonLabel: "21시즌",
    seatFloor: "2층",
    seatRow: "O",
    seatNumber: "12",
    viewRating: 4,
    soundRating: 4,
    comfortRating: 4,
    expressionRating: 3,
    stageVisibilityRating: 5,
    tags: ["첫관람추천"],
    content:
      "2층 O열은 예스24스테이지 1관의 무대가 한눈에 들어온다. 어쩌면 해피엔딩 21시즌을 처음 보는 관객이라면 배우 표정보다는 전체 동선과 무드를 잡기 좋은 자리다.",
  },
];

async function ensureAuthorPool() {
  const existingUsers = await prisma.user.findMany({
    orderBy: { id: "asc" },
  });

  const passwordHash = await bcrypt.hash("password1234", 10);
  const authorPool = [...existingUsers];

  for (const user of additionalUsers) {
    if (authorPool.length >= additionalUsers.length) {
      break;
    }

    const existing =
      authorPool.find((candidate) => candidate.email === user.email) ??
      (await prisma.user.findUnique({ where: { email: user.email } }));

    if (existing) {
      if (!authorPool.find((candidate) => candidate.id === existing.id)) {
        authorPool.push(existing);
      }
      continue;
    }

    const created = await prisma.user.create({
      data: {
        email: user.email,
        nickname: user.nickname,
        passwordHash,
      },
    });

    authorPool.push(created);
  }

  if (authorPool.length < additionalUsers.length) {
    throw new Error(`Need at least ${additionalUsers.length} users, but only found ${authorPool.length}.`);
  }

  return authorPool;
}

async function ensureTheater(name) {
  const existing = await prisma.theater.findUnique({
    where: { name },
  });

  if (existing) {
    return existing;
  }

  return prisma.theater.create({
    data: { name },
  });
}

async function ensureMusical(title) {
  const existing = await prisma.musical.findFirst({
    where: { title },
  });

  if (existing) {
    return existing;
  }

  return prisma.musical.create({
    data: { title },
  });
}

async function ensurePerformance(musicalId, theaterId, seasonLabel = null) {
  const existing = await prisma.performance.findFirst({
    where: {
      musicalId,
      theaterId,
      seasonLabel,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.performance.create({
    data: {
      musicalId,
      theaterId,
      seasonLabel,
    },
  });
}

async function ensureTag(name, type) {
  const existing = await prisma.tag.findFirst({
    where: { name, type },
  });

  if (existing) {
    return existing;
  }

  return prisma.tag.create({
    data: { name, type },
  });
}

async function syncReview(spec, author, theater, musical, performance, tagsByName) {
  const existing = await prisma.seatReview.findFirst({
    where: {
      authorId: author.id,
      theaterId: theater.id,
      musicalId: musical.id,
      seatFloor: spec.seatFloor,
      seatSection: spec.seatSection ?? null,
      seatRow: spec.seatRow,
      seatNumber: spec.seatNumber,
    },
  });

  const reviewData = {
    authorId: author.id,
    theaterId: theater.id,
    musicalId: musical.id,
    performanceId: performance.id,
    seatFloor: spec.seatFloor,
    seatSection: spec.seatSection ?? null,
    seatRow: spec.seatRow,
    seatNumber: spec.seatNumber,
    viewRating: spec.viewRating,
    soundRating: spec.soundRating,
    comfortRating: spec.comfortRating,
    expressionRating: spec.expressionRating,
    stageVisibilityRating: spec.stageVisibilityRating,
    content: spec.content,
  };

  const review = existing
    ? await prisma.seatReview.update({
        where: { id: existing.id },
        data: reviewData,
      })
    : await prisma.seatReview.create({
        data: reviewData,
      });

  const tagIds = spec.tags.map((tagName) => {
    const tag = tagsByName.get(tagName);

    if (!tag) {
      throw new Error(`Unknown tag requested: ${tagName}`);
    }

    return tag.id;
  });

  if (tagIds.length > 0) {
    await prisma.seatReviewTag.createMany({
      data: tagIds.map((tagId) => ({
        seatReviewId: review.id,
        tagId,
      })),
      skipDuplicates: true,
    });
  }

  return { review, existed: Boolean(existing) };
}

async function removeEmptyPerformances() {
  const emptyPerformances = await prisma.performance.findMany({
    where: {
      seatReviews: { none: {} },
    },
    include: {
      _count: { select: { seatReviews: true } }
    },
  });

  let deleted = 0;

  for (const performance of emptyPerformances) {
    await prisma.performance.delete({
      where: { id: performance.id },
    });
    deleted += 1;
  }

  return deleted;
}

function makeReviewKey(review) {
  return [
    review.authorId.toString(),
    review.theaterId.toString(),
    review.musicalId.toString(),
    review.performanceId?.toString() ?? "",
    review.seatFloor,
    review.seatSection ?? "",
    review.seatRow,
    review.seatNumber,
  ].join("::");
}

async function removeOutdatedSampleReviews(authors, desiredReviews) {
  const authorIds = authors.map((author) => author.id);
  const desiredKeys = new Set(desiredReviews.map(makeReviewKey));
  const comboKeys = new Set(
    desiredReviews.map((review) =>
      [review.theaterId.toString(), review.musicalId.toString()].join("::"),
    ),
  );

  const existing = await prisma.seatReview.findMany({
    where: {
      authorId: { in: authorIds },
    },
  });

  let deleted = 0;

  for (const review of existing) {
    const comboKey = [
      review.theaterId.toString(),
      review.musicalId.toString(),
    ].join("::");

    if (!comboKeys.has(comboKey) || desiredKeys.has(makeReviewKey(review))) {
      continue;
    }

    await prisma.seatReviewTag.deleteMany({
      where: { seatReviewId: review.id },
    });
    await prisma.comment.deleteMany({
      where: { seatReviewId: review.id },
    });
    await prisma.seatReview.delete({
      where: { id: review.id },
    });
    deleted += 1;
  }

  return deleted;
}

async function main() {
  const authors = await ensureAuthorPool();

  const tagsByName = new Map();
  for (const [name, type] of Object.entries(tagCatalog)) {
    const tag = await ensureTag(name, type);
    tagsByName.set(name, tag);
  }

  const comboCache = new Map();
  const desiredReviews = [];
  let insertedReviews = 0;
  let updatedReviews = 0;

  for (const spec of reviewSpecs) {
    const seasonLabel = spec.seasonLabel ?? null;
    const comboKey = `${spec.theaterName}::${spec.musicalTitle}::${seasonLabel ?? ""}`;
    let combo = comboCache.get(comboKey);

    if (!combo) {
      const theater = await ensureTheater(spec.theaterName);
      const musical = await ensureMusical(spec.musicalTitle);
      const performance = await ensurePerformance(musical.id, theater.id, seasonLabel);
      combo = { theater, musical, performance };
      comboCache.set(comboKey, combo);
    }

    const { review, existed } = await syncReview(
      spec,
      authors[spec.authorIndex],
      combo.theater,
      combo.musical,
      combo.performance,
      tagsByName,
    );

    desiredReviews.push(review);

    if (existed) {
      updatedReviews += 1;
    } else {
      insertedReviews += 1;
    }
  }

  const deletedOutdatedReviews = await removeOutdatedSampleReviews(authors, desiredReviews);
  const deletedEmptyPerformances = await removeEmptyPerformances();
  const summary = {};

  for (const [comboKey, combo] of comboCache.entries()) {
    summary[comboKey] = await prisma.seatReview.count({
      where: {
        theaterId: combo.theater.id,
        musicalId: combo.musical.id,
        performanceId: combo.performance.id,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        authorsUsed: authors.length,
        insertedReviews,
        updatedReviews,
        deletedOutdatedReviews,
        deletedEmptyPerformances,
        summary,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("append-sample-data failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
