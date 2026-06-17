// 로그인 한(JWT 검증이 끝난) 뒤 현재 사용자에 대해서 주고받는 정보 형태

export interface AuthenticatedUser {
  id: string; // BigInt는 외부로 보낼 때 문자열로 바꿔야 하기 때문에 string형으로 선언함
  email: string;
}
