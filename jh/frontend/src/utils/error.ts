const defaultErrorMessage = '요청 처리 중 오류가 발생했습니다.'

const knownErrorTranslations = [
  {
    pattern: /유효하지 않은 로그인 토큰/,
    message: '로그인이 만료되었습니다. 다시 로그인해주세요.',
  },
  {
    pattern: /failed to fetch|networkerror|network request failed|load failed|err_connection_refused|fetch failed/i,
    message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
  },
  {
    pattern: /unauthorized|401/i,
    message: '로그인이 필요하거나 만료되었습니다. 다시 로그인해주세요.',
  },
  {
    pattern: /forbidden|403/i,
    message: '이 작업을 수행할 권한이 없습니다.',
  },
  {
    pattern: /not found|404/i,
    message: '요청한 정보를 찾을 수 없습니다.',
  },
  {
    pattern: /bad request|400/i,
    message: '입력한 내용을 다시 확인해주세요.',
  },
  {
    pattern: /internal server error|500/i,
    message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  },
  {
    pattern: /cors origin is not allowed/i,
    message: '현재 접속 주소에서 서버 요청이 허용되지 않았습니다.',
  },
  {
    pattern: /\blat\b.*latitude/i,
    message: '위도는 올바른 숫자로 입력해주세요.',
  },
  {
    pattern: /\blng\b.*longitude/i,
    message: '경도는 올바른 숫자로 입력해주세요.',
  },
  {
    pattern: /email must be an email/i,
    message: '올바른 이메일 주소를 입력해주세요.',
  },
  {
    pattern: /code must match/i,
    message: '인증번호는 6자리 숫자로 입력해주세요.',
  },
  {
    pattern: /password must be longer than or equal to/i,
    message: '비밀번호는 8자 이상 입력해주세요.',
  },
  {
    pattern: /password must match/i,
    message: '비밀번호에는 특수문자를 포함해주세요.',
  },
  {
    pattern: /nickname must be longer than or equal to|nickname must be shorter than or equal to/i,
    message: '닉네임은 2자 이상 20자 이하로 입력해주세요.',
  },
  {
    pattern: /nickname must match/i,
    message: '닉네임은 한글, 영문, 숫자, 밑줄만 사용할 수 있습니다.',
  },
  {
    pattern: /title must be longer than or equal to|title must be shorter than or equal to/i,
    message: '제목은 1자 이상 100자 이하로 입력해주세요.',
  },
  {
    pattern: /content must be longer than or equal to|content must be shorter than or equal to/i,
    message: '본문은 1자 이상 5000자 이하로 입력해주세요.',
  },
  {
    pattern: /body must be longer than or equal to|body must be shorter than or equal to/i,
    message: '댓글은 1자 이상 1000자 이하로 입력해주세요.',
  },
  {
    pattern: /sort must be one of/i,
    message: '정렬 조건이 올바르지 않습니다.',
  },
  {
    pattern: /must be an integer number|must not be greater than|must not be less than/i,
    message: '숫자 입력값을 다시 확인해주세요.',
  },
  {
    pattern: /must be a string/i,
    message: '입력한 문자 값을 다시 확인해주세요.',
  },
  {
    pattern: /must be an array/i,
    message: '선택 항목 형식이 올바르지 않습니다.',
  },
  {
    pattern: /must be a boolean value/i,
    message: '동의 여부를 다시 확인해주세요.',
  },
  {
    pattern: /required|should not be empty/i,
    message: '필수 입력값을 확인해주세요.',
  },
]

export function getErrorMessage(error: unknown, fallbackMessage = defaultErrorMessage) {
  if (error instanceof Error) {
    return normalizeErrorMessage(error.message, fallbackMessage)
  }

  if (typeof error === 'string') {
    return normalizeErrorMessage(error, fallbackMessage)
  }

  return fallbackMessage
}

export function normalizeErrorMessage(message: string, fallbackMessage = defaultErrorMessage) {
  const trimmedMessage = message.trim()

  if (!trimmedMessage) {
    return fallbackMessage
  }

  const translatedMessage = knownErrorTranslations.find(({ pattern }) => pattern.test(trimmedMessage))?.message

  if (translatedMessage) {
    return translatedMessage
  }

  return hasKorean(trimmedMessage) ? trimmedMessage : fallbackMessage
}

export function normalizeErrorMessages(message: unknown, fallbackMessage = defaultErrorMessage) {
  if (Array.isArray(message)) {
    const normalizedMessages = message
      .map((item) => (typeof item === 'string' ? normalizeErrorMessage(item, fallbackMessage) : fallbackMessage))
      .filter(Boolean)

    return [...new Set(normalizedMessages)].join('\n')
  }

  if (typeof message === 'string') {
    return normalizeErrorMessage(message, fallbackMessage)
  }

  return fallbackMessage
}

function hasKorean(value: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value)
}
