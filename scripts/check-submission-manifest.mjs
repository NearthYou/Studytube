import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const includeRoots = ['AI', 'backend', 'docs', 'frontend', 'scripts']
const includeFiles = ['.env.example', '.gitignore', 'README.md']
const requiredPaths = [
  '.env.example',
  'README.md',
  'docs/demo-runbook.md',
  'docs/2026.06.13-pm-audit.md',
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
  'scripts/test-live-smoke-upload.mjs',
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

const manifest = []

for (const filePath of includeFiles) {
  if (await exists(filePath)) {
    manifest.push(filePath)
  }
}

for (const directory of includeRoots) {
  await collectManifest(directory, manifest)
}

const missingRequiredPaths = []
const forbiddenManifestEntries = []

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

if (missingRequiredPaths.length > 0 || forbiddenManifestEntries.length > 0) {
  for (const missingPath of missingRequiredPaths) {
    console.error(`Missing required submission path: ${missingPath}`)
  }

  for (const forbiddenPath of forbiddenManifestEntries) {
    console.error(`Forbidden submission path included: ${forbiddenPath}`)
  }

  process.exitCode = 1
} else {
  console.log(`Submission manifest dry-run passed with ${manifest.length} files.`)
}

async function collectManifest(path, output) {
  if (isForbidden(path)) {
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
      continue
    }

    if (entry.isDirectory()) {
      await collectManifest(childPath, output)
    } else if (entry.isFile()) {
      output.push(childPath)
    }
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
