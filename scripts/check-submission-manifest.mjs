import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const includeRoots = ['AI', 'backend', 'docs', 'frontend', 'scripts']
const includeFiles = ['.env.example', '.gitignore', 'README.md']
const liveSmokeDefaultTargets =
  'frontend,frontend-api,backend,auth,agent,crud,upload,tourapi,kakao-map,ai,openai'
const requiredPaths = [
  '.env.example',
  'README.md',
  'docs/demo-runbook.md',
  'docs/2026.06.13-pm-audit.md',
  'docs/release-evidence-checklist.md',
  'docs/submission-policy.md',
  'frontend/package-lock.json',
  'frontend/package.json',
  'frontend/scripts/browser-regression.mjs',
  'backend/package-lock.json',
  'backend/package.json',
  'backend/src/database/ensure-smoke-user.ts',
  'backend/src/database/run-sql-migrations.ts',
  'AI/pytest.ini',
  'AI/requirements.txt',
  'scripts/live-smoke.mjs',
  'scripts/test-submission-manifest.mjs',
  'scripts/test-live-smoke-upload.mjs',
  'scripts/verify-local-gates.mjs',
]
const forbiddenSegments = new Set([
  '.git',
  '.playwright-cli',
  '.pytest_cache',
  '.venv',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'tmp',
  'uploads',
])
const forbiddenFileNames = new Set(['.DS_Store'])
const forbiddenFilePattern = /\.(?:db|key|log|p12|pem|pfx|sqlite|sqlite3)$/i
const secretAssignmentPattern =
  /\b([A-Z0-9_]*(?:API_KEY|APP_KEY|APPKEY|CLIENT_SECRET|JWT_SECRET|PASSWORD|SECRET|SERVICE_KEY|TOKEN)[A-Z0-9_]*)\s*[:=]\s*["']?([^"'\s,#}]+)/g
const highConfidenceSecretPatterns = [
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g],
]

const manifest = []
const missingRequiredPaths = []
const forbiddenCandidateEntries = []
const forbiddenManifestEntries = []
const policyFindings = []
const secretFindings = []

for (const filePath of includeFiles) {
  if (await exists(filePath)) {
    manifest.push(filePath)
  }
}

for (const directory of includeRoots) {
  await collectManifest(directory, manifest)
}

for (const requiredPath of requiredPaths) {
  if (!manifest.includes(requiredPath)) {
    missingRequiredPaths.push(requiredPath)
  }
}

for (const manifestPath of manifest) {
  if (isForbidden(manifestPath)) {
    forbiddenManifestEntries.push(manifestPath)
  }
}

policyFindings.push(...(await findPolicyFindings()))

for (const manifestPath of manifest) {
  secretFindings.push(...(await findSecretFindings(manifestPath)))
}

if (
  missingRequiredPaths.length > 0 ||
  forbiddenCandidateEntries.length > 0 ||
  forbiddenManifestEntries.length > 0 ||
  policyFindings.length > 0 ||
  secretFindings.length > 0
) {
  for (const missingPath of missingRequiredPaths) {
    console.error(`Missing required submission path: ${missingPath}`)
  }

  for (const forbiddenPath of forbiddenManifestEntries) {
    console.error(`Forbidden submission path included: ${forbiddenPath}`)
  }

  for (const forbiddenPath of forbiddenCandidateEntries) {
    console.error(`Forbidden submission candidate present: ${forbiddenPath}`)
  }

  for (const finding of policyFindings) {
    console.error(finding)
  }

  for (const finding of secretFindings) {
    console.error(
      `Potential committed secret: ${finding.path}:${finding.line} (${finding.kind})`,
    )
  }

  process.exitCode = 1
} else {
  console.log(
    `Submission manifest dry-run passed with ${manifest.length} files; secret scan passed.`,
  )
}

async function collectManifest(path, output) {
  if (isForbidden(path)) {
    recordForbiddenCandidate(path)
    return
  }

  const absolutePath = join(root, path)
  const pathStat = await stat(absolutePath).catch(() => null)

  if (!pathStat) {
    return
  }

  if (pathStat.isFile()) {
    output.push(normalizePath(path))
    return
  }

  if (!pathStat.isDirectory()) {
    return
  }

  const entries = await readdir(absolutePath, { withFileTypes: true })

  for (const entry of entries) {
    const childPath = normalizePath(join(path, entry.name))

    if (isForbidden(childPath)) {
      recordForbiddenCandidate(childPath)
      continue
    }

    if (entry.isDirectory()) {
      await collectManifest(childPath, output)
    } else if (entry.isFile()) {
      output.push(childPath)
    }
  }
}

function recordForbiddenCandidate(path) {
  const normalizedPath = normalizePath(path)
  const fileName = normalizedPath.split('/').at(-1) ?? ''

  if (
    forbiddenFileNames.has(fileName) ||
    forbiddenFilePattern.test(fileName)
  ) {
    forbiddenCandidateEntries.push(normalizedPath)
  }
}

async function exists(path) {
  return Boolean(await stat(join(root, path)).catch(() => null))
}

function isForbidden(path) {
  const normalizedPath = normalizePath(path)
  const segments = normalizedPath.split('/')
  const fileName = segments.at(-1) ?? ''

  if (forbiddenFileNames.has(fileName)) {
    return true
  }

  if (forbiddenFilePattern.test(fileName)) {
    return true
  }

  if (segments.includes('.env') || normalizedPath.endsWith('/.env')) {
    return true
  }

  if (/\.env\.(?!example$)/.test(fileName)) {
    return true
  }

  return segments.some((segment) => forbiddenSegments.has(segment))
}

function normalizePath(path) {
  return relative(root, join(root, path)).replaceAll('\\', '/')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function findPolicyFindings() {
  const findings = []
  const requiredTargetLine = `LIVE_SMOKE_TARGETS=${liveSmokeDefaultTargets}`
  const envExample = await readFile(join(root, '.env.example'), 'utf8').catch(
    () => '',
  )
  const demoRunbook = await readFile(
    join(root, 'docs/demo-runbook.md'),
    'utf8',
  ).catch(() => '')
  const readme = await readFile(join(root, 'README.md'), 'utf8').catch(() => '')
  const liveSmoke = await readFile(join(root, 'scripts/live-smoke.mjs'), 'utf8')
    .catch(() => '')

  if (!envExample.includes(requiredTargetLine)) {
    findings.push(
      `.env.example LIVE_SMOKE_TARGETS must match ${liveSmokeDefaultTargets}`,
    )
  }

  if (!demoRunbook.includes(liveSmokeDefaultTargets)) {
    findings.push(
      `docs/demo-runbook.md must document live-smoke targets ${liveSmokeDefaultTargets}`,
    )
  }

  if (!readme.includes('frontend-api')) {
    findings.push('README.md must mention the frontend-api live-smoke target')
  }

  for (const target of liveSmokeDefaultTargets.split(',')) {
    if (!new RegExp(`['"]${escapeRegExp(target)}['"]`).test(liveSmoke)) {
      findings.push(`scripts/live-smoke.mjs is missing target ${target}`)
    }
  }

  return findings
}

async function findSecretFindings(path) {
  if (isLikelyBinaryPath(path)) {
    return []
  }

  const content = await readFile(join(root, path), 'utf8').catch(() => '')

  if (!content) {
    return []
  }

  const findings = []
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    for (const [kind, pattern] of highConfidenceSecretPatterns) {
      pattern.lastIndex = 0

      if (pattern.test(line)) {
        findings.push({
          kind,
          line: index + 1,
          path,
        })
      }
    }

    secretAssignmentPattern.lastIndex = 0

    for (const match of line.matchAll(secretAssignmentPattern)) {
      const key = match[1]
      const value = match[2]

      if (
        isAllowedExampleSecretValue(value) ||
        !looksLikeCommittedSecretValue(key, value)
      ) {
        continue
      }

      findings.push({
        kind: `${key} assignment`,
        line: index + 1,
        path,
      })
    }
  }

  return findings
}

function isLikelyBinaryPath(path) {
  return /\.(?:avif|gif|ico|jpe?g|pdf|png|webp)$/i.test(path)
}

function isAllowedExampleSecretValue(value) {
  const normalized = value.trim().replace(/^["']|["']$/g, '')

  if (!normalized) {
    return true
  }

  if (
    normalized === 'true' ||
    normalized === 'false' ||
    normalized === '[redacted]' ||
    normalized === '[REDACTED]' ||
    normalized === 'undefined' ||
    normalized === 'null'
  ) {
    return true
  }

  if (/^\$\{?[A-Z0-9_]+\}?$/i.test(normalized)) {
    return true
  }

  if (/^[A-Za-z_$][\w$]*$/.test(normalized)) {
    return true
  }

  if (
    /^(replace-|your-|dummy|example|test-|changeme|placeholder|mock-)/i.test(
      normalized,
    )
  ) {
    return true
  }

  if (/^<[^>]+>$/.test(normalized)) {
    return true
  }

  return false
}

function looksLikeCommittedSecretValue(key, value) {
  const normalized = value.trim().replace(/^["']|["']$/g, '')

  if (/^[a-f0-9]{32,}$/i.test(normalized)) {
    return true
  }

  if (/(?:API_KEY|APP_KEY|APPKEY|SERVICE_KEY)/.test(key)) {
    return normalized.length >= 20
  }

  if (/JWT_SECRET/.test(key)) {
    return normalized.length >= 32
  }

  if (/(?:CLIENT_SECRET|PASSWORD|SECRET|TOKEN)/.test(key)) {
    return normalized.length >= 24 && /[0-9]/.test(normalized)
  }

  return false
}
