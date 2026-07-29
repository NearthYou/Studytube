import test from 'node:test'
import assert from 'node:assert/strict'

import { validatePortfolioFacts } from '../verify-portfolio-facts.mjs'

const validDocument = {
  schemaVersion: 1,
  evidenceSubjectSha: 'a'.repeat(40),
  documentationSha: null,
  generatedAt: '2026-07-29T00:00:00.000Z',
  facts: [{
    id: 'production.status',
    value: 'pending',
    status: 'pending',
    observedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-08-06T00:00:00.000Z',
    evidenceSubjectSha: 'a'.repeat(40),
    workflowRun: null,
    publicEvidence: null,
    evidenceHash: null
  }]
}

test('accepts a pending fact with no fabricated evidence', () => {
  assert.deepEqual(validatePortfolioFacts(validDocument), [])
})

test('rejects operational identifiers and secret-shaped values', () => {
  const unsafeValues = [
    '123456789012',
    'i-0123456789abcdef0',
    'AKIA1234567890ABCDEF',
    '-----BEGIN PRIVATE KEY-----',
    'token=do-not-publish'
  ]

  for (const value of unsafeValues) {
    const unsafe = structuredClone(validDocument)
    unsafe.facts[0].value = value
    assert.match(
      validatePortfolioFacts(unsafe).join('\n'),
      /operational identifier/,
      `expected ${value} to be rejected`
    )
  }
})

test('requires verified facts to have traceable evidence', () => {
  for (const status of ['ci_verified', 'production_verified']) {
    const untraceable = structuredClone(validDocument)
    untraceable.facts[0].status = status
    assert.match(
      validatePortfolioFacts(untraceable).join('\n'),
      /publicEvidence or evidenceHash/
    )
  }
})

test('requires every fact value to be a safe scalar', () => {
  for (const value of [undefined, '', Number.NaN, Number.POSITIVE_INFINITY, [], {}]) {
    const invalid = structuredClone(validDocument)
    if (value === undefined) {
      delete invalid.facts[0].value
    } else {
      invalid.facts[0].value = value
    }
    assert.match(validatePortfolioFacts(invalid).join('\n'), /value/)
  }

  const pendingNull = structuredClone(validDocument)
  pendingNull.facts[0].value = null
  assert.deepEqual(validatePortfolioFacts(pendingNull), [])

  const verifiedNull = structuredClone(validDocument)
  verifiedNull.facts[0].status = 'ci_verified'
  verifiedNull.facts[0].value = null
  verifiedNull.facts[0].publicEvidence = 'docs/evidence/ci/api.md'
  assert.match(validatePortfolioFacts(verifiedNull).join('\n'), /value.*verified/i)
})

test('preserves sensitive parent keys while checking array entries', () => {
  const unsafe = structuredClone(validDocument)
  unsafe.untrustedMetadata = {
    token: ['diagnostic-canary']
  }
  assert.match(
    validatePortfolioFacts(unsafe).join('\n'),
    /operational identifier/
  )
})

test('preserves sensitive ancestor keys through nested objects', () => {
  for (const value of [
    { token: { value: 'diagnostic-canary' } },
    { token: [{ metadata: { value: 'diagnostic-canary' } }] }
  ]) {
    const unsafe = structuredClone(validDocument)
    unsafe.untrustedMetadata = value
    assert.match(
      validatePortfolioFacts(unsafe).join('\n'),
      /operational identifier/
    )
  }
})

test('accepts only the exact fact status enum', () => {
  const invalid = structuredClone(validDocument)
  invalid.facts[0].status = 'verified'
  assert.match(validatePortfolioFacts(invalid).join('\n'), /status/)
})

test('requires lowercase 40-character commit SHAs', () => {
  const invalidSubject = structuredClone(validDocument)
  invalidSubject.evidenceSubjectSha = 'A'.repeat(40)
  assert.match(validatePortfolioFacts(invalidSubject).join('\n'), /evidenceSubjectSha/)

  const invalidDocumentation = structuredClone(validDocument)
  invalidDocumentation.documentationSha = 'b'.repeat(39)
  assert.match(validatePortfolioFacts(invalidDocumentation).join('\n'), /documentationSha/)
})

test('requires every fact to describe the document evidence subject', () => {
  const mismatched = structuredClone(validDocument)
  mismatched.facts[0].evidenceSubjectSha = 'b'.repeat(40)
  assert.match(
    validatePortfolioFacts(mismatched).join('\n'),
    /must match document evidenceSubjectSha/
  )
})

test('rejects duplicate fact IDs', () => {
  const duplicate = structuredClone(validDocument)
  duplicate.facts.push(structuredClone(duplicate.facts[0]))
  assert.match(validatePortfolioFacts(duplicate).join('\n'), /duplicate fact id/)
})

test('requires valid chronological UTC timestamps', () => {
  const invalidTimestamp = structuredClone(validDocument)
  invalidTimestamp.generatedAt = '2026-07-30'
  assert.match(validatePortfolioFacts(invalidTimestamp).join('\n'), /generatedAt/)

  const reversed = structuredClone(validDocument)
  reversed.facts[0].expiresAt = '2026-07-29T00:00:00.000Z'
  assert.match(validatePortfolioFacts(reversed).join('\n'), /after observedAt/)
})

test('rejects future document and observation timestamps', () => {
  const futureDocument = structuredClone(validDocument)
  futureDocument.generatedAt = '2099-01-01T00:00:00.000Z'
  assert.match(validatePortfolioFacts(futureDocument).join('\n'), /future/)

  const futureObservation = structuredClone(validDocument)
  futureObservation.generatedAt = '2026-07-29T00:00:00.000Z'
  futureObservation.facts[0].observedAt = '2099-01-01T00:00:00.000Z'
  futureObservation.facts[0].expiresAt = '2099-01-02T00:00:00.000Z'
  assert.match(validatePortfolioFacts(futureObservation).join('\n'), /future/)
})

test('accepts ISO UTC timestamps with optional fractional seconds', () => {
  const alternatePrecision = structuredClone(validDocument)
  alternatePrecision.generatedAt = '2026-07-29T00:00:01Z'
  alternatePrecision.facts[0].observedAt = '2026-07-29T00:00:00.1234567Z'
  alternatePrecision.facts[0].expiresAt = '2026-08-06T00:00:00Z'
  assert.deepEqual(validatePortfolioFacts(alternatePrecision), [])
})

test('rejects expired facts', () => {
  const stale = structuredClone(validDocument)
  stale.facts[0].observedAt = '2020-01-01T00:00:00.000Z'
  stale.facts[0].expiresAt = '2020-01-02T00:00:00.000Z'
  assert.match(validatePortfolioFacts(stale).join('\n'), /expired/)
})

test('accepts only HTTPS workflow run URLs', () => {
  const insecure = structuredClone(validDocument)
  insecure.facts[0].workflowRun = 'http://github.com/NearthYou/studytube/actions/runs/1'
  assert.match(validatePortfolioFacts(insecure).join('\n'), /HTTPS/)

  const malformed = structuredClone(validDocument)
  malformed.facts[0].workflowRun = 'not a URL'
  assert.match(validatePortfolioFacts(malformed).join('\n'), /HTTPS/)
})

test('validates SHA-256 evidence hashes when present', () => {
  const invalid = structuredClone(validDocument)
  invalid.facts[0].evidenceHash = 'ABC123'
  assert.match(validatePortfolioFacts(invalid).join('\n'), /evidenceHash/)
})

test('requires the supported document shape', () => {
  const wrongVersion = structuredClone(validDocument)
  wrongVersion.schemaVersion = 2
  assert.match(validatePortfolioFacts(wrongVersion).join('\n'), /schemaVersion/)

  const missingFacts = structuredClone(validDocument)
  delete missingFacts.facts
  assert.match(validatePortfolioFacts(missingFacts).join('\n'), /facts/)
})
