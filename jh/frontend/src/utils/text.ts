export function htmlToPlainText(value: string) {
  const normalizedHtml = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')

  if (typeof DOMParser === 'undefined') {
    return normalizePlainText(normalizedHtml.replace(/<[^>]*>/g, ' '))
  }

  const document = new DOMParser().parseFromString(normalizedHtml, 'text/html')

  return normalizePlainText(document.body.textContent ?? '')
}

function normalizePlainText(value: string) {
  return value
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
