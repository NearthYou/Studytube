import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const allowedStatuses = new Set([
  'Cancelled',
  'Cancelling',
  'Delayed',
  'Failed',
  'InProgress',
  'Pending',
  'Success',
  'Terminated',
  'TimedOut',
  'Undeliverable',
  'Unknown'
])

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const numericIdPattern = /^[1-9][0-9]*$/u
const shaPattern = /^[0-9a-f]{40}$/u

function parseArguments(argv) {
  const options = new Map()

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!['--source', '--output'].includes(option) || value === undefined) {
      throw new Error('Usage: write-public-deployment-diagnostics.mjs --source PATH --output PATH')
    }
    if (options.has(option)) {
      throw new Error(`${option} may only be provided once`)
    }
    options.set(option, value)
  }

  if (!options.has('--source') || !options.has('--output')) {
    throw new Error('Both --source and --output are required')
  }

  return {
    sourceDirectory: resolve(options.get('--source')),
    outputDirectory: resolve(options.get('--output'))
  }
}

function pathsOverlap(first, second) {
  const firstToSecond = relative(first, second)
  const secondToFirst = relative(second, first)
  const contains = value => value === '' || (!value.startsWith('..') && !isAbsolute(value))
  return contains(firstToSecond) || contains(secondToFirst)
}

function requireEnvironment(environment, name, pattern) {
  const value = environment[name] ?? ''
  if (!pattern.test(value)) {
    throw new Error(`${name} is missing or invalid`)
  }
  return value
}

function safeTimestamp(value) {
  if (typeof value !== 'string') {
    return null
  }

  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString()
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readInvocation(sourceDirectory) {
  const invocationPath = resolve(sourceDirectory, 'command-invocation.json')
  if (!(await pathExists(invocationPath))) {
    return null
  }

  try {
    const value = JSON.parse(await readFile(invocationPath, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null
  } catch {
    return null
  }
}

export async function writePublicDeploymentDiagnostics({
  sourceDirectory,
  outputDirectory,
  environment = process.env
}) {
  if (pathsOverlap(sourceDirectory, outputDirectory)) {
    throw new Error('Public diagnostics output must not overlap private diagnostics')
  }

  const repository = requireEnvironment(
    environment,
    'GITHUB_REPOSITORY',
    repositoryPattern
  )
  const runId = requireEnvironment(environment, 'GITHUB_RUN_ID', numericIdPattern)
  const runAttempt = requireEnvironment(
    environment,
    'GITHUB_RUN_ATTEMPT',
    numericIdPattern
  )
  const deploySha = requireEnvironment(environment, 'DEPLOY_SHA', shaPattern)

  const invocation = await readInvocation(sourceDirectory)
  const attempted =
    invocation !== null ||
    (await pathExists(resolve(sourceDirectory, 'send-command.json')))
  let status = 'NotStarted'
  if (attempted) {
    status = allowedStatuses.has(invocation?.Status)
      ? invocation.Status
      : 'Unknown'
  }
  const responseCode =
    Number.isSafeInteger(invocation?.ResponseCode) &&
    invocation.ResponseCode >= -1 &&
    invocation.ResponseCode <= 255
      ? invocation.ResponseCode
      : null

  const summary = {
    schemaVersion: 1,
    repository,
    runId,
    runAttempt,
    deploySha,
    deployment: {
      attempted,
      status,
      responseCode,
      executionStartedAt: safeTimestamp(invocation?.ExecutionStartDateTime),
      executionEndedAt: safeTimestamp(invocation?.ExecutionEndDateTime)
    }
  }

  await mkdir(outputDirectory, { recursive: false })
  await writeFile(
    resolve(outputDirectory, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2))
  await writePublicDeploymentDiagnostics(options)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
