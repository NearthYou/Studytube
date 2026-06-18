import { apiRequest } from "../shared/api.ts"

type FetchCall = {
  url: string
  init: RequestInit
  body: unknown
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
  calls.push({
    url: String(url),
    init: init ?? {},
    body: init?.body ? JSON.parse(String(init.body)) : null,
  })

  return {
    ok: true,
    json: async () => ({ ok: true }),
  } as Response
}) as typeof fetch

await apiRequest("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
})
await apiRequest("/seat-reviews/7/reports", {
  method: "POST",
  body: JSON.stringify({ reason: "spoiler", detail: "Contains plot details." }),
})
await apiRequest("/comments/9/reports", {
  method: "POST",
  body: JSON.stringify({ reason: "abuse", detail: "Personal attack." }),
})
await apiRequest("/admin/reports", { method: "GET" })
await apiRequest("/admin/seat-reviews/7/hide", {
  method: "PATCH",
  body: JSON.stringify({ reason: "spoiler" }),
})
await apiRequest("/admin/comments/9/hide", {
  method: "PATCH",
  body: JSON.stringify({ reason: "abuse" }),
})

assertEqual(calls.length, 6)

for (const call of calls) {
  assertEqual(call.init.credentials, "include")
}

assertEqual(calls[0].url, "http://localhost:3000/auth/login")
assertDeepEqual(calls[0].body, { email: "admin@example.com", password: "password123" })

assertEqual(calls[1].url, "http://localhost:3000/seat-reviews/7/reports")
assertDeepEqual(calls[1].body, { reason: "spoiler", detail: "Contains plot details." })

assertEqual(calls[2].url, "http://localhost:3000/comments/9/reports")
assertDeepEqual(calls[2].body, { reason: "abuse", detail: "Personal attack." })

assertEqual(calls[3].url, "http://localhost:3000/admin/reports")
assertEqual(calls[4].url, "http://localhost:3000/admin/seat-reviews/7/hide")
assertEqual(calls[4].init.method, "PATCH")
assertEqual(calls[5].url, "http://localhost:3000/admin/comments/9/hide")
assertEqual(calls[5].init.method, "PATCH")

console.log("auth-report-admin flow smoke tests passed.")
