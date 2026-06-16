import { getStoredAccessToken } from '../utils/authStorage'

type ApiHeaderOptions = {
  auth?: boolean
  json?: boolean
}

export function createApiHeaders({ auth = false, json = false }: ApiHeaderOptions = {}) {
  const headers = new Headers()

  if (json) {
    headers.set('Content-Type', 'application/json')
  }

  if (auth) {
    const token = getStoredAccessToken()

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  return headers
}
