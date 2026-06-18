// JWT 토큰 안에 어떤 데이터를 넣을지 정하는 타입 파일

export interface JwtPaylaod {
  sub: string; // 토큰의 주인공이 누구인지 나타내는 표준 필드. 사용자 id를 넣음
  email: string; // 사용자 식별을 돕는 보조정보
}
