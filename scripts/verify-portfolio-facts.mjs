import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const allowedStatuses = new Set([
  'ci_verified',
  'production_verified',
  'pending'
])

const lowercaseShaPattern = /^[0-9a-f]{40}$/u
const evidenceHashPattern = /^[0-9a-f]{64}$/u
const utcTimestampPattern =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?Z$/u

const forbiddenPatterns = [
  /\b\d{12}\b/u,
  /\bi-[0-9a-f]{8,17}\b/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:password|secret|token|private[_-]?key)\s*[:=]\s*[^\s,}]+/iu
]

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseUtcTimestamp(value) {
  if (typeof value !== 'string') {
    return null
  }

  const match = utcTimestampPattern.exec(value)
  if (match?.groups === undefined) {
    return null
  }

  const parsed = new Date(value)
  const fractionalMilliseconds = Number(
    (match.groups.fraction ?? '').padEnd(3, '0').slice(0, 3)
  )
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match.groups.year) ||
    parsed.getUTCMonth() + 1 !== Number(match.groups.month) ||
    parsed.getUTCDate() !== Number(match.groups.day) ||
    parsed.getUTCHours() !== Number(match.groups.hour) ||
    parsed.getUTCMinutes() !== Number(match.groups.minute) ||
    parsed.getUTCSeconds() !== Number(match.groups.second) ||
    parsed.getUTCMilliseconds() !== fractionalMilliseconds
  ) {
    return null
  }

  return parsed
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function containsForbiddenValue(value, key = null) {
  const candidates = [String(value)]
  if (key !== null) {
    candidates.push(`${key}=${String(value)}`)
  }

  return candidates.some(candidate =>
    forbiddenPatterns.some(pattern => pattern.test(candidate))
  )
}

function collectUnsafeValues(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectUnsafeValues(entry, `${path}[${index}]`, errors)
    })
    return
  }

  if (!isRecord(value)) {
    if (value !== null && containsForbiddenValue(value)) {
      errors.push(`${path} contains a forbidden operational identifier or secret-shaped value`)
    }
    return
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path === '' ? key : `${path}.${key}`
    if (entry !== null && typeof entry !== 'object' && containsForbiddenValue(entry, key)) {
      errors.push(`${entryPath} contains a forbidden operational identifier or secret-shaped value`)
      continue
    }
    collectUnsafeValues(entry, entryPath, errors)
  }
}

function validateFact(fact, index, document, generatedAt, now, seenIds, errors) {
  const prefix = `facts[${index}]`
  if (!isRecord(fact)) {
    errors.push(`${prefix} must be an object`)
    return
  }

  if (typeof fact.id !== 'string' || fact.id.trim() === '') {
    errors.push(`${prefix}.id must be a non-empty string`)
  } else if (seenIds.has(fact.id)) {
    errors.push(`${prefix}.id is a duplicate fact id`)
  } else {
    seenIds.add(fact.id)
  }

  if (!allowedStatuses.has(fact.status)) {
    errors.push(`${prefix}.status must be ci_verified, production_verified, or pending`)
  }

  if (!lowercaseShaPattern.test(fact.evidenceSubjectSha ?? '')) {
    errors.push(`${prefix}.evidenceSubjectSha must be a 40-character lowercase hexadecimal SHA`)
  } else if (fact.evidenceSubjectSha !== document.evidenceSubjectSha) {
    errors.push(`${prefix}.evidenceSubjectSha must match document evidenceSubjectSha`)
  }

  const observedAt = parseUtcTimestamp(fact.observedAt)
  const expiresAt = parseUtcTimestamp(fact.expiresAt)

  if (observedAt === null) {
    errors.push(`${prefix}.observedAt must be an ISO UTC timestamp`)
  }
  if (expiresAt === null) {
    errors.push(`${prefix}.expiresAt must be an ISO UTC timestamp`)
  }

  if (observedAt !== null && expiresAt !== null && expiresAt <= observedAt) {
    errors.push(`${prefix}.expiresAt must be after observedAt`)
  }
  if (observedAt !== null && generatedAt !== null && observedAt > generatedAt) {
    errors.push(`${prefix}.observedAt must not be after document generatedAt`)
  }
  if (expiresAt !== null && generatedAt !== null && expiresAt <= generatedAt) {
    errors.push(`${prefix}.expiresAt must be after document generatedAt`)
  }
  if (expiresAt !== null && expiresAt <= now) {
    errors.push(`${prefix} expired at ${fact.expiresAt}`)
  }

  if (fact.workflowRun !== null && !isHttpsUrl(fact.workflowRun)) {
    errors.push(`${prefix}.workflowRun must be an HTTPS URL without credentials or null`)
  }

  if (
    fact.publicEvidence !== null &&
    (typeof fact.publicEvidence !== 'string' || fact.publicEvidence.trim() === '')
  ) {
    errors.push(`${prefix}.publicEvidence must be a non-empty string or null`)
  }

  if (fact.evidenceHash !== null && !evidenceHashPattern.test(fact.evidenceHash ?? '')) {
    errors.push(`${prefix}.evidenceHash must be a lowercase SHA-256 digest or null`)
  }

  const hasPublicEvidence =
    typeof fact.publicEvidence === 'string' && fact.publicEvidence.trim() !== ''
  const hasEvidenceHash = evidenceHashPattern.test(fact.evidenceHash ?? '')
  if (fact.status !== 'pending' && !hasPublicEvidence && !hasEvidenceHash) {
    errors.push(`${prefix} with verified status requires publicEvidence or evidenceHash`)
  }
}

export function validatePortfolioFacts(document) {
  const errors = []
  if (!isRecord(document)) {
    return ['document must be an object']
  }

  if (document.schemaVersion !== 1) {
    errors.push('schemaVersion must equal 1')
  }

  if (!lowercaseShaPattern.test(document.evidenceSubjectSha ?? '')) {
    errors.push('evidenceSubjectSha must be a 40-character lowercase hexadecimal SHA')
  }

  if (
    document.documentationSha !== null &&
    !lowercaseShaPattern.test(document.documentationSha ?? '')
  ) {
    errors.push('documentationSha must be null or a 40-character lowercase hexadecimal SHA')
  }

  const generatedAt = parseUtcTimestamp(document.generatedAt)
  if (generatedAt === null) {
    errors.push('generatedAt must be an ISO UTC timestamp')
  }

  if (!Array.isArray(document.facts) || document.facts.length === 0) {
    errors.push('facts must be a non-empty array')
  } else {
    const now = new Date()
    const seenIds = new Set()
    document.facts.forEach((fact, index) => {
      validateFact(fact, index, document, generatedAt, now, seenIds, errors)
    })
  }

  collectUnsafeValues(document, '', errors)
  return errors
}

async function runCli() {
  const factsUrl = new URL('../docs/evidence/portfolio/facts.json', import.meta.url)

  try {
    const document = JSON.parse(await readFile(factsUrl, 'utf8'))
    const errors = validatePortfolioFacts(document)
    if (errors.length > 0) {
      errors.forEach(error => console.error(error))
      process.exitCode = 1
      return
    }

    console.log('Portfolio facts verified.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  await runCli()
}
