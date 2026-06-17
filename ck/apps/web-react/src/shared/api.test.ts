import { apiRequest } from "./api.ts"

type FetchCall = {
  url: string
  init: RequestInit
}

const calls: FetchCall[] = []

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} })

  return {
    ok: true,
    json: async () => ({ ok: true }),
  } as Response
}) as typeof fetch

await apiRequest("/auth/me", { method: "GET" })
await apiRequest("/auth/logout", { method: "POST" })

assertEqual(calls.length, 2)
assertEqual(calls[0].url, "http://localhost:3000/auth/me")
assertEqual(calls[0].init.credentials, "include")
assertDeepEqual(calls[0].init.headers, { "Content-Type": "application/json" })
assertEqual(calls[1].url, "http://localhost:3000/auth/logout")
assertEqual(calls[1].init.credentials, "include")

console.log("shared api tests passed.")
