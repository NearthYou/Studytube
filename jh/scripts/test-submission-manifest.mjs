#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = process.cwd()
const liveSmokeTargets =
  'frontend,frontend-api,backend,auth,agent,crud,upload,tourapi,kakao-map,ai,openai'

await runScenario('baseline fixture passes', async (fixture) => {
  const result = runManifest(fixture)

  assertExit(result, 0)
  assertIncludes(result.stdout, 'secret scan passed')
})

await runScenario('forbidden private key file fails', async (fixture) => {
  await writeFile(join(fixture, 'backend/private.key'), 'not-a-real-key\n')

  const result = runManifest(fixture)

  assertExit(result, 1)
  assertIncludes(result.stderr, 'Forbidden submission candidate present: backend/private.key')
})

await runScenario('committed token-like value fails without leaking it', async (fixture) => {
  const token = ['sk', '-proj-', 'A'.repeat(32)].join('')
  await writeFile(
    join(fixture, 'README.md'),
    [`frontend-api`, `sample token ${token}`].join('\n'),
  )

  const result = runManifest(fixture)

  assertExit(result, 1)
  assertIncludes(result.stderr, 'Potential committed secret: README.md:2 (OpenAI API key)')

  if (result.stderr.includes(token)) {
    throw new Error('Secret scan output leaked the matched token value.')
  }
})

await runScenario('live-smoke target drift fails', async (fixture) => {
  await writeFile(
    join(fixture, '.env.example'),
    [
      'JWT_SECRET=replace-with-a-long-random-secret',
      'OPENAI_API_KEY=',
      `LIVE_SMOKE_TARGETS=${liveSmokeTargets.replace(',frontend-api', '')}`,
    ].join('\n'),
  )

  const result = runManifest(fixture)

  assertExit(result, 1)
  assertIncludes(result.stderr, '.env.example LIVE_SMOKE_TARGETS must match')
})

console.log('Submission manifest mock regression passed.')

async function runScenario(name, test) {
  const fixture = await createFixture()

  try {
    await test(fixture)
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : error}`)
  } finally {
    await rm(fixture, { force: true, recursive: true })
  }
}

async function createFixture() {
  const fixture = await mkdtemp(join(tmpdir(), 'tailtalk-manifest-'))
  const directories = [
    'AI',
    'backend/src/database',
    'docs',
    'frontend/scripts',
    'scripts',
  ]

  for (const directory of directories) {
    await mkdir(join(fixture, directory), { recursive: true })
  }

  await cp(
    join(root, 'scripts/check-submission-manifest.mjs'),
    join(fixture, 'scripts/check-submission-manifest.mjs'),
  )

  await writeFiles(fixture, {
    '.env.example': [
      'JWT_SECRET=replace-with-a-long-random-secret',
      'OPENAI_API_KEY=',
      `LIVE_SMOKE_TARGETS=${liveSmokeTargets}`,
    ].join('\n'),
    '.gitignore': 'node_modules\n.env\n',
    'AI/pytest.ini': '[pytest]\n',
    'AI/requirements.txt': 'pytest\n',
    'README.md': 'frontend-api live smoke target\n',
    'backend/package-lock.json': '{}\n',
    'backend/package.json': '{}\n',
    'backend/src/database/ensure-smoke-user.ts': 'export {}\n',
    'backend/src/database/run-sql-migrations.ts': 'export {}\n',
    'docs/2026.06.13-pm-audit.md': 'audit\n',
    'docs/demo-runbook.md': liveSmokeTargets,
    'docs/release-evidence-checklist.md': 'release evidence\n',
    'docs/submission-policy.md': 'policy\n',
    'frontend/package-lock.json': '{}\n',
    'frontend/package.json': '{}\n',
    'frontend/scripts/browser-regression.mjs': 'console.log("ok")\n',
    'scripts/live-smoke.mjs': liveSmokeTargets
      .split(',')
      .map((target) => `'${target}'`)
      .join('\n'),
    'scripts/test-submission-manifest.mjs': 'console.log("ok")\n',
    'scripts/test-live-smoke-upload.mjs': 'console.log("ok")\n',
    'scripts/verify-local-gates.mjs': 'console.log("ok")\n',
  })

  return fixture
}

async function writeFiles(base, files) {
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(base, path), content)
  }
}

function runManifest(cwd) {
  return spawnSync(process.execPath, ['scripts/check-submission-manifest.mjs'], {
    cwd,
    encoding: 'utf8',
  })
}

function assertExit(result, expectedCode) {
  if (result.status !== expectedCode) {
    throw new Error(
      `Expected exit ${expectedCode}, got ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
}

function assertIncludes(value, expectedText) {
  if (!value.includes(expectedText)) {
    throw new Error(`Expected output to include ${expectedText}.\n${value}`)
  }
}
