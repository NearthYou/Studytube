const maxTagCount = 5
const maxTagLength = 20

export function createNextPostTags(currentTags: string[], value: string) {
  const candidates = value.split(',').map(normalizePostTag).filter(Boolean)

  if (!candidates.length) {
    return {
      hasCandidates: false,
      nextTags: currentTags,
      status: '',
    }
  }

  const nextTags = [...currentTags]
  let status = ''

  for (const tagName of candidates) {
    if (tagName.length > maxTagLength) {
      status = `태그는 ${maxTagLength}자 이하로 입력해주세요.`
      continue
    }

    if (nextTags.includes(tagName)) {
      continue
    }

    if (nextTags.length >= maxTagCount) {
      status = `태그는 최대 ${maxTagCount}개까지 입력할 수 있습니다.`
      break
    }

    nextTags.push(tagName)
  }

  return {
    hasCandidates: true,
    nextTags,
    status,
  }
}

function normalizePostTag(value: string) {
  return value.trim().replace(/^#+/, '').trim().toLowerCase()
}
