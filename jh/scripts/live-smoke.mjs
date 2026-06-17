#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const allTargets = [
  'frontend',
  'frontend-api',
  'backend',
  'auth',
  'agent',
  'crud',
  'upload',
  'tourapi',
  'kakao-map',
  'frontend-bundle',
  'security',
  'cors',
  'ai',
  'openai',
]
const liveMode = process.env.RUN_LIVE_SMOKE === 'true'
const timeoutMs = Number(process.env.LIVE_SMOKE_TIMEOUT_MS || 30000)
const startedAt = new Date()

const rootEnv = await readEnvFile('.env')
const productionEnv = await readEnvFile('.env.production')
const backendEnv = await readEnvFile('backend/.env')
const frontendEnv = await readEnvFile('frontend/.env')
const aiEnv = await readEnvFile('AI/.env')
const failOnSkip = getBooleanEnv('LIVE_SMOKE_FAIL_ON_SKIP')
const results = []
const context = {
  accessToken: getSecret('LIVE_SMOKE_ACCESS_TOKEN'),
  backendUrl: getBackendUrl(),
  categoryId: null,
  createdPostId: null,
  frontendUrl: getFrontendUrl(),
  aiUrl: getAiUrl(),
  uploadReadUrl: getUploadReadUrl(),
  uploadSecondaryReadUrl: getUploadSecondaryReadUrl(),
}

const selectedTargets = new Set(
  splitList(getConfig('LIVE_SMOKE_TARGETS') || allTargets.join(',')),
)

for (const target of selectedTargets) {
  if (!allTargets.includes(target)) {
    record('FAIL', target, 'unknown target in LIVE_SMOKE_TARGETS')
  }
}

if (!liveMode) {
  for (const target of allTargets) {
    record('SKIP', target, 'RUN_LIVE_SMOKE=true is not set; no live HTTP calls were made')
  }
  printSummary()
  process.exit(failOnSkip ? 1 : 0)
}

await runSelected('frontend', checkFrontend)
await runSelected('frontend-api', checkFrontendApi)
await runSelected('backend', checkBackend)
await runSelected('auth', checkAuth)
await runSelected('agent', checkAgent)
await runSelected('crud', checkCrud)
await runSelected('upload', checkUpload)
await runSelected('tourapi', checkTourApi)
await runSelected('kakao-map', checkKakaoMap)
await runSelected('frontend-bundle', checkFrontendBundle)
await runSelected('security', checkSecurity)
await runSelected('cors', checkCors)
await runSelected('ai', checkAiWorker)
await runSelected('openai', checkOpenAiViaAiWorker)

for (const target of allTargets) {
  if (!selectedTargets.has(target)) {
    record('OMIT', target, 'not selected in LIVE_SMOKE_TARGETS', {
      blocking: false,
    })
  }
}

printSummary()

if (shouldExitWithFailure()) {
  process.exitCode = 1
}

async function runSelected(target, check) {
  if (!selectedTargets.has(target)) {
    return
  }

  try {
    const detail = await check()
    record('PASS', target, detail)
  } catch (error) {
    record('FAIL', target, safeErrorMessage(error))
  }
}

async function checkFrontend() {
  const response = await requestText(urlOf(context.frontendUrl, '/'))

  if (!response.ok) {
    throw new Error(`frontend returned HTTP ${response.status}`)
  }

  if (!response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('frontend did not return HTML')
  }

  return `served HTML from ${originOnly(context.frontendUrl)}`
}

async function checkBackend() {
  const health = await requestJson(urlOf(context.backendUrl, '/api/health'))

  assertOk(health.response, 'backend health')
  const healthData = unwrap(health.payload)

  if (!isRecord(healthData) || healthData.status !== 'ok') {
    throw new Error('backend health payload did not include status=ok')
  }

  const categories = await requestJson(urlOf(context.backendUrl, '/api/categories'))
  assertOk(categories.response, 'categories read')
  const categoriesData = unwrap(categories.payload)
  const categoryList = Array.isArray(categoriesData)
    ? categoriesData
    : isRecord(categoriesData) && Array.isArray(categoriesData.categories)
      ? categoriesData.categories
      : []

  const requiredCategoryValues = ['daily', 'walk', 'care', 'question']
  const categoryValues = new Set(
    categoryList
      .filter((category) => isRecord(category))
      .map((category) => String(category.value || '')),
  )
  const missingCategoryValues = requiredCategoryValues.filter(
    (value) => !categoryValues.has(value),
  )

  if (categoryList.length < requiredCategoryValues.length || missingCategoryValues.length) {
    throw new Error(
      `categories seed is incomplete; expected values ${requiredCategoryValues.join(', ')}, missing ${missingCategoryValues.join(', ') || 'category rows'}`,
    )
  }

  const firstCategory = categoryList.find((category) => isRecord(category) && category.id)

  if (!isRecord(firstCategory)) {
    throw new Error('categories read did not return any category id')
  }

  context.categoryId = String(firstCategory.id)

  const posts = await requestJson(urlOf(context.backendUrl, '/api/posts?page=1&limit=1'))
  assertOk(posts.response, 'posts read')
  const postsData = unwrap(posts.payload)

  if (!isRecord(postsData) || !Array.isArray(postsData.items)) {
    throw new Error('posts read did not return a paged item list')
  }

  return 'health ok; DB-backed categories/posts reads ok'
}

async function checkFrontendApi() {
  const { browser } = await launchFrontendBrowser()
  const pageErrors = []

  try {
    const page = await browser.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(redact(message.text()))
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(redact(error.message))
    })

    await page.goto(urlOf(context.frontendUrl, '/'), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    })
    const result = await page.evaluate(async ({ expectedBackendOrigin }) => {
      async function findDevApiBaseUrl() {
        try {
          const module = await import('/src/api/base.ts')

          return typeof module.API_BASE_URL === 'string' ? module.API_BASE_URL : ''
        } catch {
          return ''
        }
      }

      async function findBundledApiBaseUrl() {
        const moduleScripts = [...document.querySelectorAll('script[type="module"][src]')]
        .map((script) => script.getAttribute('src'))
          .filter(Boolean)

        for (const moduleScript of moduleScripts) {
          const moduleUrl = new URL(moduleScript, window.location.href).href
          const bundle = await fetch(moduleUrl).then((response) => response.text())
          const urlCandidates = [
            ...bundle.matchAll(/https?:\/\/[^'"`\\\s)]+/g),
          ].map((match) => match[0].replace(/\/$/, ''))
          const expectedCandidate = urlCandidates.find(
            (candidate) => new URL(candidate).origin === expectedBackendOrigin,
          )

          if (expectedCandidate) {
            return expectedCandidate
          }
        }

        return ''
      }

      const apiBaseUrl = (await findDevApiBaseUrl()) || (await findBundledApiBaseUrl())

      if (!apiBaseUrl) {
        return {
          ok: false,
          reason: 'frontend API base URL was not discoverable from dev modules or production bundle',
        }
      }

      const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, '')
      const actualBackendOrigin = new URL(normalizedApiBaseUrl).origin

      if (actualBackendOrigin !== expectedBackendOrigin) {
        return {
          apiBaseUrl: normalizedApiBaseUrl,
          ok: false,
          reason: `frontend API base origin ${actualBackendOrigin} did not match expected backend ${expectedBackendOrigin}`,
        }
      }

      const [categoriesResponse, postsResponse] = await Promise.all([
        fetch(`${normalizedApiBaseUrl}/api/categories`),
        fetch(`${normalizedApiBaseUrl}/api/posts?page=1&limit=1`),
      ])

      return {
        apiBaseUrl: normalizedApiBaseUrl,
        categoriesContentType: categoriesResponse.headers.get('content-type') || '',
        categoriesOk: categoriesResponse.ok,
        categoriesStatus: categoriesResponse.status,
        ok: categoriesResponse.ok && postsResponse.ok,
        postsContentType: postsResponse.headers.get('content-type') || '',
        postsOk: postsResponse.ok,
        postsStatus: postsResponse.status,
      }
    }, { expectedBackendOrigin: originOnly(context.backendUrl) })

    if (!result.ok) {
      throw new Error(
        result.reason ||
          `frontend API fetch failed (categories=${result.categoriesStatus}, posts=${result.postsStatus})`,
      )
    }

    if (
      !result.categoriesContentType.includes('application/json') ||
      !result.postsContentType.includes('application/json')
    ) {
      throw new Error('frontend API fetch did not return JSON responses')
    }

    const relevantErrors = pageErrors.filter((message) =>
      /cors|network|failed|api|fetch|blocked/i.test(message),
    )

    if (relevantErrors.length) {
      throw new Error(`frontend API console/page errors: ${relevantErrors.slice(0, 3).join(' | ')}`)
    }

    return `frontend bundle fetched backend API through ${originOnly(result.apiBaseUrl)}`
  } finally {
    await browser.close()
  }
}

async function checkFrontendBundle() {
  const html = await requestText(urlOf(context.frontendUrl, '/'))

  assertOkLike(html, 'frontend HTML')

  const scriptUrls = getScriptUrls(html.text, context.frontendUrl)

  if (!scriptUrls.length) {
    throw new Error('frontend HTML did not include any JavaScript bundle script')
  }

  const bundles = await Promise.all(
    scriptUrls.map(async (scriptUrl) => {
      const bundle = await requestText(scriptUrl)

      assertOkLike(bundle, `frontend bundle ${scriptUrl}`)
      return bundle.text
    }),
  )
  const bundleText = bundles.join('\n')
  const configuredKakaoKey = getSecret('VITE_KAKAO_MAP_JS_KEY')

  if (bundleText.includes('frontend/.env에 VITE_KAKAO_MAP_JS_KEY')) {
    throw new Error('frontend bundle still contains stale developer-only Kakao map env message; rebuild frontend')
  }

  if (bundleText.includes('VITE_KAKAO_MAP_JS_KE')) {
    throw new Error('frontend bundle/config contains misspelled VITE_KAKAO_MAP_JS_KE; expected VITE_KAKAO_MAP_JS_KEY')
  }

  if (configuredKakaoKey && !bundleText.includes(configuredKakaoKey)) {
    throw new Error('frontend bundle does not contain configured VITE_KAKAO_MAP_JS_KEY; rebuild frontend after .env.production changes')
  }

  const enabledSocialProviders = splitList(getConfig('VITE_ENABLED_SOCIAL_PROVIDERS') || '')
  const socialDetail = await checkSocialButtons(enabledSocialProviders)

  return `frontend JS bundle loaded with production env; ${socialDetail}`
}

async function checkSocialButtons(enabledSocialProviders) {
  const { browser } = await launchFrontendBrowser()

  try {
    const page = await browser.newPage()

    await page.goto(urlOf(context.frontendUrl, '/'), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('button', { name: /로그인|회원가입/ }).first().click()

    if (enabledSocialProviders.includes('kakao')) {
      await page.getByRole('link', { name: /카카오톡/ }).waitFor({
        state: 'visible',
        timeout: timeoutMs,
      })
    } else if ((await page.getByRole('link', { name: /카카오톡/ }).count()) > 0) {
      throw new Error('Kakao social button is visible but VITE_ENABLED_SOCIAL_PROVIDERS does not include kakao')
    }

    for (const [provider, label] of [
      ['google', '구글'],
      ['naver', '네이버'],
    ]) {
      if (!enabledSocialProviders.includes(provider)) {
        const count = await page.getByRole('link', { name: new RegExp(label) }).count()

        if (count > 0) {
          throw new Error(`${label} social button is visible but VITE_ENABLED_SOCIAL_PROVIDERS does not include ${provider}`)
        }
      }
    }

    return enabledSocialProviders.length
      ? `social buttons match ${enabledSocialProviders.join(', ')}`
      : 'social buttons are hidden because no providers are enabled'
  } finally {
    await browser.close()
  }
}

async function checkAuth() {
  const email = getSecret('LIVE_SMOKE_EMAIL')
  const password = getSecret('LIVE_SMOKE_PASSWORD')

  if (!email || !password) {
    throw new Error('LIVE_SMOKE_EMAIL and LIVE_SMOKE_PASSWORD are required for auth target')
  }

  const login = await requestJson(urlOf(context.backendUrl, '/api/auth/login'), {
    body: JSON.stringify({ email, password }),
    headers: jsonHeaders(),
    method: 'POST',
  })

  assertOk(login.response, 'smoke account login')
  const loginData = unwrap(login.payload)

  if (!isRecord(loginData) || typeof loginData.accessToken !== 'string') {
    throw new Error('login response did not include accessToken')
  }

  context.accessToken = loginData.accessToken

  return 'smoke credential login returned a JWT'
}

async function checkAgent() {
  const unauth = await requestJson(urlOf(context.backendUrl, '/api/agent/chat'), {
    body: JSON.stringify({ message: '강아지가 산책 중 다른 개를 보면 짖어요' }),
    headers: jsonHeaders(),
    method: 'POST',
  })

  if (unauth.response.status !== 401) {
    throw new Error(`unauthenticated agent request returned HTTP ${unauth.response.status}, expected 401`)
  }

  const token = await getAccessToken()
  const auth = await requestJson(urlOf(context.backendUrl, '/api/agent/chat'), {
    body: JSON.stringify({
      message: '강아지가 산책 중 다른 개를 보면 짖어요',
      species: 'dog',
    }),
    headers: jsonHeaders(token),
    method: 'POST',
  })

  assertOk(auth.response, 'authenticated agent request')
  const agentData = unwrap(auth.payload)

  if (
    !isRecord(agentData) ||
    typeof agentData.answer !== 'string' ||
    typeof agentData.riskLevel !== 'string'
  ) {
    throw new Error('authenticated agent response did not include answer and riskLevel')
  }

  return 'anonymous request rejected; authenticated assistant response returned'
}

async function checkCrud() {
  const token = await getAccessToken()
  const categoryId = context.categoryId || (await fetchFirstCategoryId())
  const stamp = startedAt.toISOString()
  const createPayload = {
    title: `[live-smoke] ${stamp}`,
    content: 'Live smoke verification post. It should be deleted by the same run.',
    categoryIds: [categoryId],
    imageIds: [],
    tagNames: ['live-smoke'],
  }
  let deleted = false

  try {
    const created = await requestJson(urlOf(context.backendUrl, '/api/posts'), {
      body: JSON.stringify(createPayload),
      headers: jsonHeaders(token),
      method: 'POST',
    })

    assertOk(created.response, 'post create')
    const createdData = unwrap(created.payload)
    const post = isRecord(createdData) ? createdData.post : null
    const postId = isRecord(post) && post.id ? String(post.id) : ''

    if (!postId) {
      throw new Error('post create response did not include post.id')
    }

    context.createdPostId = postId

    const fetched = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`))
    assertOk(fetched.response, 'post fetch after create')

    const updated = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`), {
      body: JSON.stringify({
        ...createPayload,
        title: `[live-smoke updated] ${stamp}`,
      }),
      headers: jsonHeaders(token),
      method: 'PATCH',
    })
    assertOk(updated.response, 'post update')

    const removed = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`), {
      headers: jsonHeaders(token),
      method: 'DELETE',
    })
    assertOk(removed.response, 'post delete cleanup')
    deleted = true

    const afterDelete = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`))

    if (afterDelete.response.status !== 404) {
      throw new Error(`post cleanup check returned HTTP ${afterDelete.response.status}, expected 404`)
    }

    context.createdPostId = null
    return 'post create/read/update/delete cleanup verified'
  } finally {
    if (context.createdPostId && !deleted) {
      const cleanup = await requestJson(urlOf(context.backendUrl, `/api/posts/${context.createdPostId}`), {
        headers: jsonHeaders(token),
        method: 'DELETE',
      })

      if (!cleanup.response.ok && cleanup.response.status !== 404) {
        throw new Error(`post cleanup failed with HTTP ${cleanup.response.status}`)
      }

      context.createdPostId = null
    }
  }
}

async function checkUpload() {
  const token = await getAccessToken()
  const categoryId = context.categoryId || (await fetchFirstCategoryId())
  const stamp = startedAt.toISOString()
  let imageId = null
  let postId = null
  let imagePaths = []

  try {
    const upload = await uploadSmokeImage(token)
    const uploadedImage = getFirstUploadedImage(upload)

    imageId = String(uploadedImage.id)
    imagePaths = getImagePaths(uploadedImage)

    if (!imagePaths.length) {
      throw new Error('upload response did not include any image URL fields')
    }

    await assertUploadPathsReadable(imagePaths, context.uploadReadUrl, 'primary backend')

    if (context.uploadSecondaryReadUrl) {
      if (originOnly(context.uploadSecondaryReadUrl) === originOnly(context.uploadReadUrl)) {
        throw new Error('LIVE_SMOKE_SECONDARY_BACKEND_URL must use a different origin than the primary upload read URL')
      }

      await assertUploadPathsReadable(
        imagePaths,
        context.uploadSecondaryReadUrl,
        'secondary backend',
      )
    } else {
      record(
        'SKIP',
        'upload-secondary',
        'LIVE_SMOKE_SECONDARY_BACKEND_URL is not set; shared upload storage not verified',
      )
    }

    const created = await requestJson(urlOf(context.backendUrl, '/api/posts'), {
      body: JSON.stringify({
        title: `[live-smoke upload] ${stamp}`,
        content: 'Live smoke upload verification post. It should be deleted by the same run.',
        categoryIds: [categoryId],
        imageIds: [imageId],
        tagNames: ['live-smoke', 'upload'],
      }),
      headers: jsonHeaders(token),
      method: 'POST',
    })
    assertOk(created.response, 'post create with uploaded image')
    const createdData = unwrap(created.payload)
    const post = isRecord(createdData) ? createdData.post : null

    if (!isRecord(post) || !post.id) {
      throw new Error('post create with uploaded image did not include post.id')
    }

    postId = String(post.id)
    const fetched = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`))
    assertOk(fetched.response, 'post fetch after image attach')
    assertPostContainsImage(unwrap(fetched.payload), imageId)

    const removed = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`), {
      headers: authHeaders(token),
      method: 'DELETE',
    })
    assertOk(removed.response, 'post delete upload cleanup')
    postId = null
    imageId = null

    await assertUploadPathsDeleted(imagePaths, context.uploadReadUrl)

    return context.uploadSecondaryReadUrl
      ? 'post image upload, DB attach, primary/secondary static reads, and cleanup verified'
      : 'post image upload, DB attach, primary static read, and cleanup verified; secondary backend not configured'
  } finally {
    if (postId) {
      const cleanup = await requestJson(urlOf(context.backendUrl, `/api/posts/${postId}`), {
        headers: authHeaders(token),
        method: 'DELETE',
      })

      if (!cleanup.response.ok && cleanup.response.status !== 404) {
        throw new Error(`upload post cleanup failed with HTTP ${cleanup.response.status}`)
      }
    } else if (imageId) {
      const cleanup = await requestJson(urlOf(context.backendUrl, `/api/posts/images/${imageId}`), {
        headers: authHeaders(token),
        method: 'DELETE',
      })

      if (!cleanup.response.ok && cleanup.response.status !== 404) {
        throw new Error(`uploaded image cleanup failed with HTTP ${cleanup.response.status}`)
      }
    }
  }
}

async function uploadSmokeImage(token) {
  const formData = new FormData()
  const image = new Blob([getSmokePngBuffer()], { type: 'image/png' })

  formData.append('images', image, 'live-smoke.png')

  const upload = await requestJson(urlOf(context.backendUrl, '/api/posts/images'), {
    body: formData,
    headers: authHeaders(token),
    method: 'POST',
  })
  assertOk(upload.response, 'post image upload')

  return upload.payload
}

function getFirstUploadedImage(payload) {
  const uploadData = unwrap(payload)
  const images = isRecord(uploadData) && Array.isArray(uploadData.images) ? uploadData.images : []
  const image = images.find((item) => isRecord(item) && item.id)

  if (!isRecord(image)) {
    throw new Error('post image upload response did not include images[0].id')
  }

  return image
}

function getImagePaths(image) {
  return [
    image.url,
    image.thumbnailUrl,
    image.cardUrl,
    image.detailUrl,
    image.originalUrl,
  ]
    .filter((value) => typeof value === 'string' && value)
    .map((value) => stripUrlQuery(value))
    .filter((value, index, values) => values.indexOf(value) === index)
}

async function assertUploadPathsReadable(paths, baseUrl, label) {
  for (const publicPath of paths) {
    const response = await requestBytes(resolvePublicUrl(baseUrl, publicPath, true))

    assertOk(response.response, `${label} static read`)

    const contentType = response.response.headers.get('content-type') ?? ''

    if (!contentType.includes('image/webp')) {
      throw new Error(`${label} static read returned ${contentType || 'no content-type'}, expected image/webp`)
    }

    if (response.byteLength <= 0) {
      throw new Error(`${label} static read returned an empty body`)
    }
  }
}

async function assertUploadPathsDeleted(paths, baseUrl) {
  for (const publicPath of paths) {
    const response = await requestBytes(resolvePublicUrl(baseUrl, publicPath, true))

    if (response.response.status === 200) {
      throw new Error('deleted upload file is still readable')
    }
  }
}

function assertPostContainsImage(postPayload, imageId) {
  const post = isRecord(postPayload) && isRecord(postPayload.post) ? postPayload.post : postPayload
  const images = isRecord(post) && Array.isArray(post.images) ? post.images : []
  const matched = images.some((image) => isRecord(image) && String(image.id) === imageId)

  if (!matched) {
    throw new Error('created post detail did not include uploaded image metadata')
  }
}

function getSmokePngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQqdjyH4QZYAwATZQJPfOBG2cAAAAASUVORK5CYII=',
    'base64',
  )
}

async function checkTourApi() {
  requireConfiguredSecret('TOUR_API_SERVICE_KEY', 'tourapi')

  const nearby = await requestJson(
    urlOf(context.backendUrl, '/api/pet-places/nearby?lat=37.5665&lng=126.9780&radius=20000&limit=5'),
  )
  assertOk(nearby.response, 'TourAPI nearby through backend')
  assertNoInsecureTourApiUrl('TourAPI nearby response', nearby.payload)
  const nearbyData = unwrap(nearby.payload)
  const items = isRecord(nearbyData) && Array.isArray(nearbyData.items) ? nearbyData.items : []

  if (!items.length) {
    throw new Error('TourAPI nearby returned zero items')
  }

  const first = items.find((item) => isRecord(item) && item.contentId && item.title)

  if (!isRecord(first)) {
    throw new Error('TourAPI nearby item did not include contentId and title')
  }

  if (!first.address && !first.addr1 && (!first.mapX || !first.mapY)) {
    throw new Error('TourAPI nearby item did not include address or coordinates')
  }

  const detail = await requestJson(urlOf(context.backendUrl, `/api/pet-places/${first.contentId}`))
  assertOk(detail.response, 'TourAPI detail through backend')
  assertNoInsecureTourApiUrl('TourAPI detail response', detail.payload)
  const detailData = unwrap(detail.payload)

  if (!isRecord(detailData) || !isRecord(detailData.place) || !detailData.place.contentId) {
    throw new Error('TourAPI detail response did not include place.contentId')
  }

  return 'nearby and detail mapping verified through backend'
}

async function checkKakaoSdkDirectFetch() {
  const appKey = getSecret('VITE_KAKAO_MAP_JS_KEY')
  const sdkUrl = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`
  const response = await requestText(sdkUrl, {
    headers: {
      referer: urlOf(context.frontendUrl, '/pet-places'),
      'user-agent': 'tailtalk-live-smoke/1.0',
    },
  })
  const contentType = response.headers.get('content-type') || ''
  const bodyPreview = response.text.slice(0, 500)

  if (!response.ok || /domain mismatched/i.test(response.text)) {
    if (/domain mismatched/i.test(response.text)) {
      throw new Error(
        `Kakao SDK domain mismatched for ${originOnly(context.frontendUrl)}; register https://pongki.shop and https://www.pongki.shop in Kakao Developers Web platform domains`,
      )
    }

    throw new Error(`Kakao SDK request returned HTTP ${response.status}: ${bodyPreview}`)
  }

  if (contentType.includes('application/json') || bodyPreview.trim().startsWith('{')) {
    const errorPayload = parseJson(response.text)
    const message = isRecord(errorPayload)
      ? errorPayload.message || errorPayload.error || JSON.stringify(errorPayload)
      : response.text

    throw new Error(`Kakao SDK returned JSON instead of JavaScript: ${message}`)
  }

  if (!response.text.includes('kakao')) {
    throw new Error('Kakao SDK response did not look like the maps JavaScript SDK')
  }
}

async function checkKakaoMap() {
  requireConfiguredSecret('VITE_KAKAO_MAP_JS_KEY', 'kakao-map')
  await checkKakaoSdkDirectFetch()
  const { browser } = await launchFrontendBrowser()
  const pageErrors = []

  try {
    const page = await browser.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(redact(message.text()))
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(redact(error.message))
    })
    page.on('requestfailed', (request) => {
      if (/kakao|dapi|sdk/i.test(request.url())) {
        pageErrors.push(redact(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`))
      }
    })

    await page.goto(urlOf(context.frontendUrl, '/pet-places'), {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded',
    })
    try {
      await page.waitForFunction(() => Boolean(window.kakao?.maps), null, {
        timeout: timeoutMs,
      })
    } catch (error) {
      const details = pageErrors.length
        ? `; ${pageErrors.slice(0, 3).join(' | ')}`
        : ''

      throw new Error(`Kakao map SDK did not load${details}`)
    }
    await page.locator('.pet-place-map').waitFor({ state: 'visible', timeout: timeoutMs })

    const mapBox = await page.locator('.pet-place-map').boundingBox()

    if (!mapBox || mapBox.width < 100 || mapBox.height < 100) {
      throw new Error('Kakao map container is not visibly rendered')
    }

    const kakaoErrors = pageErrors.filter((message) =>
      /kakao|map|appkey|unauthorized|forbidden|denied/i.test(message),
    )

    if (kakaoErrors.length) {
      throw new Error(`Kakao map console/page errors: ${kakaoErrors.slice(0, 3).join(' | ')}`)
    }

    return 'window.kakao.maps loaded and map container rendered'
  } finally {
    await browser.close()
  }
}

async function checkSecurity() {
  const frontend = await requestText(urlOf(context.frontendUrl, '/'))

  assertOkLike(frontend, 'frontend security header response')

  const requiredHeaders = [
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ]
  const missingHeaders = requiredHeaders.filter(
    (header) => !frontend.headers.get(header),
  )

  if (missingHeaders.length) {
    throw new Error(`public frontend response is missing security headers: ${missingHeaders.join(', ')}`)
  }

  const serverHeader = frontend.headers.get('server') || ''

  if (/nginx\/\d/i.test(serverHeader)) {
    throw new Error('public Server header exposes the Nginx version; set server_tokens off in host Nginx')
  }

  const backendHealth = await requestText(urlOf(context.backendUrl, '/api/health'))

  assertOkLike(backendHealth, 'backend health security header response')

  if (backendHealth.headers.get('x-powered-by')) {
    throw new Error('backend public response still exposes X-Powered-By')
  }

  return 'HSTS and core browser security headers present; X-Powered-By hidden'
}

async function checkCors() {
  const evilOrigin = 'https://evil.example'
  const response = await requestText(urlOf(context.backendUrl, '/api/health'), {
    headers: {
      origin: evilOrigin,
    },
  })

  assertOkLike(response, 'CORS probe health response')

  const allowOrigin = response.headers.get('access-control-allow-origin') || ''

  if (allowOrigin === evilOrigin || allowOrigin === '*') {
    throw new Error(`CORS allowed unexpected Origin ${evilOrigin}`)
  }

  return 'unexpected cross-origin request did not receive permissive CORS headers'
}

async function launchFrontendBrowser() {
  const frontendRequire = createRequire(join(root, 'frontend/package.json'))
  let chromium

  try {
    ;({ chromium } = frontendRequire('playwright'))
  } catch {
    throw new Error('frontend Playwright dependency is required; run cd frontend && npm install && npx playwright install chromium')
  }

  return {
    browser: await chromium.launch({ headless: true }),
  }
}

async function checkAiWorker() {
  const health = await requestJson(urlOf(context.aiUrl, '/health'))
  assertOk(health.response, 'AI worker health')
  const healthData = unwrap(health.payload)

  if (!isRecord(healthData) || healthData.status !== 'ok') {
    throw new Error('AI worker health payload did not include status=ok')
  }

  const question = await requestJson(urlOf(context.aiUrl, '/pet-behavior/question'), {
    body: JSON.stringify({
      question: '강아지가 산책 중 다른 개를 보면 짖어요',
      species: 'dog',
    }),
    headers: jsonHeaders(),
    method: 'POST',
  })
  assertOk(question.response, 'AI worker pet behavior question')
  const questionData = unwrap(question.payload)

  if (
    !isRecord(questionData) ||
    typeof questionData.answer !== 'string' ||
    typeof questionData.riskLevel !== 'string'
  ) {
    throw new Error('AI worker question response did not include answer and riskLevel')
  }

  return 'health and behavior question endpoint ok'
}

async function checkOpenAiViaAiWorker() {
  requireConfiguredSecret('OPENAI_API_KEY', 'openai')

  const question = await requestJson(urlOf(context.aiUrl, '/pet-behavior/question'), {
    body: JSON.stringify({
      question: '강아지가 산책 중 다른 개를 보면 짖어요',
      species: 'dog',
    }),
    headers: jsonHeaders(),
    method: 'POST',
  })
  assertOk(question.response, 'OpenAI-backed AI worker question')
  const data = unwrap(question.payload)

  if (!isRecord(data)) {
    throw new Error('AI worker response was not an object')
  }

  if (data.answerProvider !== 'openai' || data.fallbackUsed !== false) {
    throw new Error('AI worker did not report answerProvider=openai and fallbackUsed=false')
  }

  return 'AI worker reported OpenAI answer generation without fallback'
}

async function fetchFirstCategoryId() {
  const categories = await requestJson(urlOf(context.backendUrl, '/api/categories'))
  assertOk(categories.response, 'categories read')
  const categoriesData = unwrap(categories.payload)
  const categoryList = Array.isArray(categoriesData)
    ? categoriesData
    : isRecord(categoriesData) && Array.isArray(categoriesData.categories)
      ? categoriesData.categories
      : []
  const first = categoryList.find((category) => isRecord(category) && category.id)

  if (!isRecord(first)) {
    throw new Error('no category id available for CRUD smoke')
  }

  return String(first.id)
}

async function getAccessToken() {
  if (context.accessToken) {
    return context.accessToken
  }

  const email = getSecret('LIVE_SMOKE_EMAIL')
  const password = getSecret('LIVE_SMOKE_PASSWORD')

  if (!email || !password) {
    throw new Error('LIVE_SMOKE_ACCESS_TOKEN or LIVE_SMOKE_EMAIL + LIVE_SMOKE_PASSWORD is required')
  }

  const login = await requestJson(urlOf(context.backendUrl, '/api/auth/login'), {
    body: JSON.stringify({ email, password }),
    headers: jsonHeaders(),
    method: 'POST',
  })
  assertOk(login.response, 'smoke account login')
  const loginData = unwrap(login.payload)

  if (!isRecord(loginData) || typeof loginData.accessToken !== 'string') {
    throw new Error('login response did not include accessToken')
  }

  context.accessToken = loginData.accessToken
  return context.accessToken
}

async function requestJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options)
  const text = await response.text()

  return {
    payload: parseJson(text),
    response,
  }
}

async function requestText(url, options = {}) {
  const response = await fetchWithTimeout(url, options)
  const text = await response.text()

  return {
    headers: response.headers,
    ok: response.ok,
    status: response.status,
    text,
  }
}

async function requestBytes(url, options = {}) {
  const response = await fetchWithTimeout(url, options)
  const bytes = await response.arrayBuffer()

  return {
    byteLength: bytes.byteLength,
    response,
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`)
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readEnvFile(path) {
  const text = await readFile(join(root, path), 'utf8').catch(() => '')
  return parseEnv(text)
}

function parseEnv(text) {
  const parsed = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)

    if (!match) {
      continue
    }

    let value = match[2].trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[match[1]] = value
  }

  return parsed
}

function getConfig(key) {
  return process.env[key] ?? productionEnv[key] ?? rootEnv[key] ?? backendEnv[key] ?? frontendEnv[key] ?? aiEnv[key]
}

function getSecret(key) {
  const value = getConfig(key)
  return isConfigured(value) ? value : ''
}

function requireConfiguredSecret(key, target) {
  if (!getSecret(key)) {
    throw new Error(`${key} is required for ${target} target`)
  }
}

function getBackendUrl() {
  const configured =
    process.env.LIVE_SMOKE_BACKEND_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.VITE_API_BASE_URL ||
    productionEnv.BACKEND_PUBLIC_URL ||
    productionEnv.VITE_API_BASE_URL ||
    backendEnv.BACKEND_PUBLIC_URL ||
    frontendEnv.VITE_API_BASE_URL

  if (configured) {
    return stripApiSuffix(configured)
  }

  return `http://localhost:${backendEnv.PORT || 3000}`
}

function getFrontendUrl() {
  return (
    process.env.LIVE_SMOKE_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.SOCIAL_AUTH_FRONTEND_URL ||
    productionEnv.FRONTEND_URL ||
    productionEnv.SOCIAL_AUTH_FRONTEND_URL ||
    backendEnv.FRONTEND_URL ||
    backendEnv.SOCIAL_AUTH_FRONTEND_URL ||
    'http://localhost:5173'
  )
}

function getAiUrl() {
  return (
    process.env.LIVE_SMOKE_AI_URL ||
    process.env.AI_SERVICE_URL ||
    productionEnv.AI_SERVICE_URL ||
    backendEnv.AI_SERVICE_URL ||
    aiEnv.AI_SERVICE_URL ||
    'http://localhost:8000'
  )
}

function getUploadReadUrl() {
  return (
    process.env.LIVE_SMOKE_UPLOAD_READ_URL ||
    process.env.LIVE_SMOKE_UPLOAD_STATIC_BASE_URL ||
    productionEnv.LIVE_SMOKE_UPLOAD_READ_URL ||
    productionEnv.LIVE_SMOKE_UPLOAD_STATIC_BASE_URL ||
    backendEnv.LIVE_SMOKE_UPLOAD_READ_URL ||
    backendEnv.LIVE_SMOKE_UPLOAD_STATIC_BASE_URL ||
    getBackendUrl()
  )
}

function getUploadSecondaryReadUrl() {
  return (
    process.env.LIVE_SMOKE_SECONDARY_BACKEND_URL ||
    process.env.LIVE_SMOKE_UPLOAD_PEER_READ_URL ||
    productionEnv.LIVE_SMOKE_SECONDARY_BACKEND_URL ||
    productionEnv.LIVE_SMOKE_UPLOAD_PEER_READ_URL ||
    backendEnv.LIVE_SMOKE_SECONDARY_BACKEND_URL ||
    backendEnv.LIVE_SMOKE_UPLOAD_PEER_READ_URL ||
    ''
  )
}

function stripApiSuffix(value) {
  return value.replace(/\/+$/, '').replace(/\/api$/, '')
}

function originOnly(value) {
  const url = new URL(value)
  return url.origin
}

function urlOf(base, path) {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(path.replace(/^\//, ''), normalizedBase).toString()
}

function resolvePublicUrl(base, publicPath, cacheBust = false) {
  const url = /^https?:\/\//i.test(publicPath)
    ? new URL(publicPath)
    : new URL(stripUrlQuery(publicPath).replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`)

  if (cacheBust) {
    url.searchParams.set('liveSmoke', String(Date.now()))
  }

  return url.toString()
}

function jsonHeaders(token) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'content-type': 'application/json',
  }
}

function authHeaders(token) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`)
  }
}

function assertOkLike(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`)
  }
}

function assertNoInsecureTourApiUrl(label, payload) {
  const serialized = JSON.stringify(payload)

  if (serialized.includes('http://tong.visitkorea.or.kr')) {
    throw new Error(`${label} still contains insecure http://tong.visitkorea.or.kr image URL`)
  }
}

function getScriptUrls(html, baseUrl) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], urlOf(baseUrl, '/')).toString())
    .filter((value, index, values) => values.indexOf(value) === index)
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function unwrap(payload) {
  if (isRecord(payload) && payload.success === true && 'data' in payload) {
    return payload.data
  }

  return payload
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isConfigured(value) {
  if (typeof value !== 'string') {
    return false
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return false
  }

  return !/^(replace-|your-|dummy|example|test-|changeme)/i.test(trimmed)
}

function splitList(value) {
  return value
    .split(/[,\s]+/)
    .map((target) => target.trim())
    .filter(Boolean)
}

function record(status, target, detail, options = {}) {
  results.push({
    blocking: options.blocking ?? true,
    detail: redact(detail),
    status,
    target,
  })
}

function printSummary() {
  const failures = results.filter((result) => result.status === 'FAIL')
  const skips = results.filter((result) => result.status === 'SKIP')
  const allPassed = failures.length === 0 && skips.length === 0
  const selectedPassed =
    liveMode &&
    failures.length === 0 &&
    results.some((result) => result.status === 'PASS')
  const overall = !liveMode
    ? 'SKIP'
    : failures.length
      ? 'FAIL'
      : allPassed
        ? 'PASS'
        : selectedPassed
          ? 'PARTIAL'
          : 'SKIP'

  console.log(`Live smoke overall: ${overall}`)
  console.log(`Started at: ${startedAt.toISOString()}`)
  console.log(`Backend: ${originOnly(context.backendUrl)}`)
  console.log(`Frontend: ${originOnly(context.frontendUrl)}`)
  console.log(`AI worker: ${originOnly(context.aiUrl)}`)

  for (const result of results) {
    console.log(`${result.status.padEnd(4)} ${result.target.padEnd(10)} ${result.detail}`)
  }

  if (overall === 'PARTIAL') {
    console.log('Selected targets passed, but skipped targets mean this is not a full live verification.')
  }

  if (failOnSkip && skips.length > 0) {
    console.log('LIVE_SMOKE_FAIL_ON_SKIP=true is set; any SKIP row makes this run fail.')
  }
}

function shouldExitWithFailure() {
  if (results.some((result) => result.status === 'FAIL')) {
    return true
  }

  return (
    failOnSkip &&
    results.some((result) => result.status === 'SKIP')
  )
}

function safeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(
      /((?:serviceKey|appkey|api[_-]?key|access[_-]?token|token|password|client[_-]?secret|jwt[_-]?secret|openai[_-]?api[_-]?key|code|state))=([^&\s]+)/gi,
      '$1=[redacted]',
    )
    .replace(
      /((?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET|JWT_SECRET|OPENAI_API_KEY|PASSWORD)):\s*([^\s,;]+)/g,
      '$1: [redacted]',
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-[redacted]')
}

function stripUrlQuery(value) {
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value)

    return url.pathname
  }

  return value.split('?')[0]
}

function getBooleanEnv(key) {
  const value = getConfig(key)

  return value === 'true' || value === '1'
}
