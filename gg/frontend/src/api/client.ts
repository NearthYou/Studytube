const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'; // 백엔드 API 서버 주소를 정한다. 환경변수가 없으면 로컬 NestJS 서버를 사용한다.

type RequestOptions = {
  method?: string; // GET, POST 같은 HTTP 요청 방식을 받을 수 있게 한다.
  body?: unknown; // 서버로 보낼 요청 데이터를 받을 수 있게 한다.
  token?: string | null; // 로그인한 사용자의 accessToken을 받을 수 있게 한다.
};

// React에서 백엔드 API를 호출할 때 공통으로 사용하는 함수다.
export async function apiRequest<T>(
  path: string, // /posts, /auth/login 같은 백엔드 API 주소의 뒷부분이다.
  options: RequestOptions = {}, // method, body, token을 선택적으로 받을 수 있게 기본값을 빈 객체로 둔다.
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', // 서버에게 요청 body가 JSON 형식이라고 알려준다.
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`; // 로그인한 사용자임을 증명하기 위해 Authorization 헤더에 토큰을 넣는다.
  }

  // 백엔드 서버에 실제 HTTP 요청을 보낸다.
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET', // method를 따로 안 주면 기본으로 GET 요청을 보낸다.
    headers, // 위에서 만든 Content-Type, Authorization 정보를 요청에 넣는다.
    body: options.body ? JSON.stringify(options.body) : undefined, // body가 있으면 JSON 문자열로 바꿔서 보내고, 없으면 보내지 않는다.
  });

  if (!response.ok) {
    const message = await response.text(); // 서버가 보내준 에러 메시지를 문자열로 읽는다.
    throw new Error(message || 'API 요청에 실패했습니다.'); // 요청이 실패하면 화면 쪽에서 catch할 수 있도록 에러를 던진다.
  }

  return response.json() as Promise<T>; // 서버가 준 JSON 응답을 TypeScript에서 기대하는 타입으로 돌려준다.
}

export function getStoredToken() {
  return localStorage.getItem('accessToken'); // 브라우저에 저장해둔 accessToken을 꺼낸다.
}

export function storeToken(accessToken: string) {
  localStorage.setItem('accessToken', accessToken); // 로그인 성공 후 받은 accessToken을 브라우저에 저장한다.
}

export function clearToken() {
  localStorage.removeItem('accessToken'); // 로그아웃할 때 브라우저에 저장된 accessToken을 지운다.
}
