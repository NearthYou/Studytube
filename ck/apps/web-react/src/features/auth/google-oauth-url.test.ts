import { getGoogleLoginUrl } from "./api.ts"

function assertEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`)
  }
}

const url = new URL(getGoogleLoginUrl("/theaters/50"))

assertEqual(url.origin, "http://localhost:3000")
assertEqual(url.pathname, "/auth/google")
assertEqual(url.searchParams.get("redirectTo"), "/theaters/50")

console.log("google oauth url tests passed.")
