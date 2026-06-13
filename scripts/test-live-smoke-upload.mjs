#!/usr/bin/env node
import { spawn } from 'node:child_process'
import http from 'node:http'

const webpBytes = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/vuUAAA=',
  'base64',
)

await runScenario({
  expectExitCode: 0,
  expectSecondarySkip: false,
  failOnSkip: false,
  withSecondary: true,
})
await runScenario({
  expectExitCode: 0,
  expectSecondarySkip: true,
  failOnSkip: false,
  withSecondary: false,
})
await runScenario({
  expectExitCode: 0,
  expectSecondarySkip: false,
  failOnSkip: true,
  withSecondary: true,
})
await runScenario({
  expectExitCode: 1,
  expectSecondarySkip: true,
  failOnSkip: true,
  withSecondary: false,
})
await runNoOptInStrictScenario()
await runFrontendApiScenario()

console.log('Live-smoke upload target mock regression passed.')

async function runScenario({
  expectExitCode,
  expectSecondarySkip,
  failOnSkip,
  withSecondary,
}) {
  let deleted = false
  const image = {
    id: '77',
    url: '/uploads/posts/live.webp',
    thumbnailUrl: '/uploads/posts/variants/live-thumbnail.webp',
    cardUrl: '/uploads/posts/variants/live-card.webp',
    detailUrl: '/uploads/posts/variants/live-detail.webp',
    originalUrl: '/uploads/posts/live.webp',
    mimeType: 'image/webp',
  }
  const primary = createServer({
    deleted: () => deleted,
    image,
    setDeleted: () => {
      deleted = true
    },
  })
  const secondary = withSecondary
    ? createStaticServer({
        deleted: () => deleted,
      })
    : null

  try {
    const primaryPort = await listen(primary)
    const secondaryPort = secondary ? await listen(secondary) : null
    const stdout = await runLiveSmoke({
      expectExitCode,
      failOnSkip,
      primaryUrl: `http://127.0.0.1:${primaryPort}`,
      secondaryUrl: secondaryPort
        ? `http://127.0.0.1:${secondaryPort}`
        : '',
    })

    assertOutput(stdout, expectSecondarySkip)
  } finally {
    await Promise.all([close(primary), secondary ? close(secondary) : null])
  }
}

function createServer({ deleted, image, setDeleted }) {
  return http.createServer(async (request, response) => {
    if (serveStatic(request, response, deleted)) {
      return
    }

    if (request.method === 'GET' && request.url === '/api/categories') {
      sendJson(response, 200, { categories: [{ id: '1', name: '일상' }] })
      return
    }

    if (request.method === 'POST' && request.url === '/api/posts/images') {
      await drain(request)
      sendJson(response, 201, { images: [image] })
      return
    }

    if (request.method === 'POST' && request.url === '/api/posts') {
      await drain(request)
      sendJson(response, 201, { post: { id: '88', images: [image] } })
      return
    }

    if (request.method === 'GET' && request.url === '/api/posts/88') {
      sendJson(response, 200, { id: '88', images: [image] })
      return
    }

    if (request.method === 'DELETE' && request.url === '/api/posts/88') {
      setDeleted()
      sendJson(response, 200, { postId: '88' })
      return
    }

    if (
      request.method === 'DELETE' &&
      request.url === '/api/posts/images/77'
    ) {
      setDeleted()
      sendJson(response, 200, { imageId: '77' })
      return
    }

    sendJson(response, 404, { error: 'not found' })
  })
}

function createStaticServer({ deleted }) {
  return http.createServer((request, response) => {
    if (serveStatic(request, response, deleted)) {
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('missing')
  })
}

async function runFrontendApiScenario() {
  let frontendOrigin = ''
  const backend = http.createServer((request, response) => {
    response.setHeader('access-control-allow-origin', frontendOrigin)
    response.setHeader('vary', 'origin')

    if (request.method === 'GET' && request.url === '/api/categories') {
      sendJson(response, 200, { categories: [{ id: '1', name: '일상' }] })
      return
    }

    if (request.method === 'GET' && request.url === '/api/posts?page=1&limit=1') {
      sendJson(response, 200, { items: [] })
      return
    }

    sendJson(response, 404, { error: 'not found' })
  })
  const backendPort = await listen(backend)
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const frontend = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<div id="root"></div><script type="module" src="/src/main.tsx"></script>')
      return
    }

    if (request.method === 'GET' && request.url === '/src/main.tsx') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      response.end('import "/src/api/base.ts";')
      return
    }

    if (request.method === 'GET' && request.url === '/src/api/base.ts') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      response.end(`export const API_BASE_URL = ${JSON.stringify(backendUrl)};`)
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('missing')
  })

  try {
    const frontendPort = await listen(frontend)
    frontendOrigin = `http://127.0.0.1:${frontendPort}`
    const stdout = await runLiveSmoke({
      expectExitCode: 0,
      failOnSkip: false,
      frontendUrl: frontendOrigin,
      primaryUrl: backendUrl,
      secondaryUrl: '',
      targets: 'frontend-api',
    })

    if (!stdout.includes('PASS frontend-api')) {
      throw new Error(`Expected PASS frontend-api.\n${stdout}`)
    }
  } finally {
    await Promise.all([close(frontend), close(backend)])
  }
}

function serveStatic(request, response, deleted) {
  if (request.url?.startsWith('/uploads/') && !deleted()) {
    response.writeHead(200, { 'content-type': 'image/webp' })
    response.end(webpBytes)
    return true
  }

  if (request.url?.startsWith('/uploads/')) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('missing')
    return true
  }

  return false
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      data,
      message: 'ok',
      success: status < 400,
    }),
  )
}

function drain(request) {
  return new Promise((resolve) => {
    request.on('data', () => undefined)
    request.on('end', resolve)
  })
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port)
    })
  })
}

function close(server) {
  if (!server) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    server.close(resolve)
  })
}

function runLiveSmoke({
  expectExitCode,
  failOnSkip,
  frontendUrl = '',
  primaryUrl,
  secondaryUrl,
  targets = 'upload',
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/live-smoke.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LIVE_SMOKE_FAIL_ON_SKIP: failOnSkip ? 'true' : 'false',
        LIVE_SMOKE_ACCESS_TOKEN: 'mock-token',
        LIVE_SMOKE_BACKEND_URL: primaryUrl,
        LIVE_SMOKE_FRONTEND_URL: frontendUrl,
        LIVE_SMOKE_SECONDARY_BACKEND_URL: secondaryUrl,
        LIVE_SMOKE_TARGETS: targets,
        LIVE_SMOKE_UPLOAD_READ_URL: primaryUrl,
        RUN_LIVE_SMOKE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      if (code !== expectExitCode) {
        reject(
          new Error(
            `live-smoke exited ${code}, expected ${expectExitCode}\n${stdout}\n${stderr}`,
          ),
        )
        return
      }

      resolve(stdout)
    })
  })
}

function runNoOptInStrictScenario() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/live-smoke.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LIVE_SMOKE_FAIL_ON_SKIP: 'true',
        RUN_LIVE_SMOKE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      if (code !== 1 || !stdout.includes('RUN_LIVE_SMOKE=true is not set')) {
        reject(
          new Error(
            `expected no-opt-in strict run to exit 1\nexit=${code}\n${stdout}\n${stderr}`,
          ),
        )
        return
      }

      resolve()
    })
  })
}

function assertOutput(stdout, expectSecondarySkip) {
  if (!stdout.includes('PASS upload')) {
    throw new Error(`Expected PASS upload.\n${stdout}`)
  }

  if (/^FAIL\s/m.test(stdout)) {
    throw new Error(`Expected no FAIL rows.\n${stdout}`)
  }

  if (!/^OMIT\s+frontend/m.test(stdout)) {
    throw new Error(`Expected unselected targets to be marked OMIT.\n${stdout}`)
  }

  if (expectSecondarySkip && !stdout.includes('SKIP upload-secondary')) {
    throw new Error(`Expected SKIP upload-secondary.\n${stdout}`)
  }

  if (!expectSecondarySkip && stdout.includes('SKIP upload-secondary')) {
    throw new Error(`Did not expect SKIP upload-secondary.\n${stdout}`)
  }
}
