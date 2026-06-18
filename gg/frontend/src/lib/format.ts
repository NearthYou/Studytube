export function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR');
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ko-KR');
}
