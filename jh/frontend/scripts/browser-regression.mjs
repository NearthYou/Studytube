import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const frontendPort = Number(process.env.BROWSER_REGRESSION_PORT ?? 4174)
const baseUrl = `http://127.0.0.1:${frontendPort}`
const outputDirectory = resolve(process.cwd(), '..', 'output', 'playwright', 'browser-regression')
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 960 },
]

const now = new Date('2026-06-13T00:00:00.000Z').toISOString()
const categories = [
  { id: '1', name: '일상', value: 'daily' },
  { id: '2', name: '산책', value: 'walk' },
  { id: '3', name: '돌봄', value: 'care' },
  { id: '4', name: '질문', value: 'question' },
]
const imageUrl = svgDataUrl('#f8fafc', '#0f766e')
const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQqdjyH4QZYAwATZQJPfOBG2cAAAAASUVORK5CYII='
const posts = [
  createPost({
    id: '101',
    title: '브라우저 회귀 테스트 게시글',
    content: '모바일과 데스크톱에서 카드 레이아웃을 검증하기 위한 게시글입니다.',
    commentCount: 3,
    isOwner: false,
  }),
  createPost({
    id: '102',
    title: '산책 루틴 공유',
    content: '짧고 반복 가능한 산책 루틴을 공유합니다.',
    commentCount: 0,
    isOwner: false,
  }),
]
const pagedPost = createPost({
  id: 'paged-post',
  title: '댓글 페이지네이션 확인 게시글',
  content: '댓글이 21개인 상세 화면입니다.',
  commentCount: 21,
  isOwner: false,
})
const protectedPost = createPost({
  id: 'owned-post',
  title: '작성자만 관리 가능한 게시글',
  content: '다른 사용자는 수정하거나 삭제할 수 없어야 합니다.',
  commentCount: 0,
  isOwner: false,
})
let createdPost = createPost({
  id: 'created-browser-post',
  title: '브라우저 작성 게시글',
  content: '브라우저 회귀에서 작성한 게시글입니다.',
  commentCount: 0,
  isOwner: true,
})
let isCreatedPostDeleted = false
const petPlaces = [
  {
    addr1: '서울 중구 세종대로 110',
    addr2: '',
    address: '서울 중구 세종대로 110',
    contentId: 'place-1',
    contentTypeId: '39',
    copyrightType: '',
    distance: '430',
    firstImage: imageUrl,
    firstImage2: imageUrl,
    mapX: '126.978',
    mapY: '37.5665',
    tel: '02-000-0000',
    title: '꼬리톡 반려동물 카페',
    zipcode: '04524',
  },
  {
    addr1: '서울 중구 태평로 1가',
    addr2: '',
    address: '서울 중구 태평로 1가',
    contentId: 'place-2',
    contentTypeId: '12',
    copyrightType: '',
    distance: '980',
    firstImage: '',
    firstImage2: '',
    mapX: '126.976',
    mapY: '37.5651',
    tel: '',
    title: '반려견 산책 광장',
    zipcode: '',
  },
]

await mkdir(outputDirectory, { recursive: true })

const server = startVite()
let browser

try {
  await waitForServer()
  browser = await chromium.launch()

  for (const viewport of viewports) {
    await runViewportRegression(browser, viewport)
  }

  console.log(`Browser regression passed for ${viewports.map((viewport) => viewport.name).join(', ')}`)
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

function startVite() {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
    {
      env: {
        ...process.env,
        BROWSER: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  return child
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl)

      if (response.ok) {
        return
      }
    } catch {
      await delay(250)
    }
  }

  throw new Error(`Frontend dev server did not become ready at ${baseUrl}`)
}

async function runViewportRegression(browserInstance, viewport) {
  const context = await browserInstance.newContext({
    viewport: {
      height: viewport.height,
      width: viewport.width,
    },
  })
  const consoleErrors = []

  await context.route('**/*', (route) => fulfillApi(route))
  const page = await newRegressionPage(context, consoleErrors)

  try {
    await verifyHome(page, viewport.name)
    await verifyAssistantLoginGate(page, viewport.name)
    await verifyExpiredAssistantSession(context, consoleErrors, viewport.name)
    await verifyAuthenticatedAssistantCards(context, consoleErrors, viewport.name)
    await verifyPetPlaces(context, consoleErrors, viewport.name)
    await verifyCommentPagination(page, viewport.name)
    await verifyNonOwnerGuards(context, consoleErrors, viewport.name)
    await verifyPostMutationHappyPath(context, consoleErrors, viewport.name)
    assert(
      consoleErrors.length === 0,
      `Unexpected browser console errors in ${viewport.name}: ${consoleErrors.join('\n')}`,
    )
  } catch (error) {
    await page.screenshot({
      fullPage: true,
      path: join(outputDirectory, `${viewport.name}-failure.png`),
    })
    throw error
  } finally {
    await context.close()
  }
}

async function newRegressionPage(context, consoleErrors) {
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (message.text().includes('status of 401')) {
        return
      }

      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  return page
}

async function addAuthenticatedSession(page, token) {
  await page.addInitScript((accessToken) => {
    window.localStorage.setItem('accessToken', accessToken)
    window.localStorage.setItem(
      'user',
      JSON.stringify({
        createdAt: '2026-06-13T00:00:00.000Z',
        email: 'owner@example.test',
        id: '1',
        nickname: '마루집사',
        profileImageUrl: null,
      }),
    )
  }, token)
}

async function verifyHome(page, viewportName) {
  await page.goto(baseUrl)
  await page.getByRole('heading', { name: '오늘의 꼬리톡' }).waitFor()
  await assertVisible(page.getByRole('link', { name: /브라우저 회귀 테스트 게시글/ }))
  await assertNoHorizontalOverflow(page, viewportName, 'home')
}

async function verifyAssistantLoginGate(page, viewportName) {
  await page.getByRole('button', { name: 'Tail Talk Assistant 열기' }).click()
  await page.getByLabel('꼬리톡 챗봇 입력').fill('강아지 산책 게시글 보여줘')
  await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()

  await assertVisible(page.getByText('Assistant를 사용하려면 로그인이 필요합니다.'))
  await assertVisible(page.getByRole('dialog').getByText('Tail Talk에 다시 오신 걸 환영해요'))
  assert(
    (await page.getByText('Assistant 베타 연결이 잠시 불안정합니다.').count()) === 0,
    `Anonymous assistant fallback text appeared in ${viewportName}`,
  )
  await page.getByRole('button', { name: '인증 창 닫기' }).click()
}

async function verifyExpiredAssistantSession(context, consoleErrors, viewportName) {
  const page = await newRegressionPage(context, consoleErrors)

  await page.addInitScript(() => {
    window.localStorage.setItem('accessToken', 'expired-browser-regression-token')
    window.localStorage.setItem(
      'user',
      JSON.stringify({
        createdAt: '2026-06-13T00:00:00.000Z',
        email: 'expired@example.test',
        id: '3',
        nickname: '만료사용자',
        profileImageUrl: null,
      }),
    )
  })

  try {
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Tail Talk Assistant 열기' }).click()
    await page.getByLabel('꼬리톡 챗봇 입력').fill('만료 토큰 확인')
    await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()

    await assertVisible(page.getByText('로그인이 만료되었습니다. 다시 로그인해주세요.'))
    await assertVisible(page.getByRole('dialog').getByText('Tail Talk에 다시 오신 걸 환영해요'))
    assert((await page.evaluate(() => window.localStorage.getItem('accessToken'))) === null, `Expired token was not cleared in ${viewportName}`)
    assert(
      (await page.getByText('Assistant 베타 연결이 잠시 불안정합니다.').count()) === 0,
      `Expired-token assistant fallback text appeared in ${viewportName}`,
    )
  } finally {
    await page.close()
  }
}

async function verifyAuthenticatedAssistantCards(context, consoleErrors, viewportName) {
  const page = await newRegressionPage(context, consoleErrors)

  await addAuthenticatedSession(page, 'assistant-user')

  try {
    await page.goto(baseUrl)
    await page.getByRole('button', { name: 'Tail Talk Assistant 열기' }).click()
    await page.getByLabel('꼬리톡 챗봇 입력').fill('산책 장소와 게시글 추천해줘')
    await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()

    await assertVisible(page.getByText('산책 장소와 게시글을 함께 정리했어요.'))
    await assertVisible(page.getByText('관찰 체크리스트'))
    await assertVisible(page.getByRole('link', { name: /장소 꼬리톡 반려동물 카페/ }))
    await assertVisible(page.getByRole('link', { name: /게시글 브라우저 회귀 테스트 게시글/ }))

    await page.getByLabel('꼬리톡 챗봇 입력').fill('광주 알아?')
    await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()
    await assertVisible(page.getByText('광주 동반 장소를 이어서 찾아봤어요.'))
    await assertVisible(page.getByRole('link', { name: /장소 광주 반려동물 산책지/ }))
    assert(
      (await page.getByText('상황, 시간, 반복 빈도').count()) === 0,
      `Assistant repeated broad fallback for place follow-up in ${viewportName}`,
    )

    await page.getByLabel('꼬리톡 챗봇 입력').fill('강아지가 똥을 안싸')
    await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()
    await assertVisible(page.getByText('48시간 이상 변을 못 봤다면 병원 상담을 우선해 주세요.'))

    await page.getByLabel('꼬리톡 챗봇 입력').fill('몰라')
    await page.getByRole('button', { name: '챗봇 메시지 보내기' }).click()
    await assertVisible(page.getByText('몰라도 괜찮아요. 지금 확인 가능한 안전 신호부터 볼게요.'))
    assert(
      (await page.getByText('좋아요. 방금 이야기한 흐름에서 이어서 볼게요.').count()) === 0,
      `Assistant repeated generic history fallback in ${viewportName}`,
    )
    await assertNoHorizontalOverflow(page, viewportName, 'authenticated assistant cards')
  } finally {
    await page.close()
  }
}

async function verifyPetPlaces(context, consoleErrors, viewportName) {
  const page = await newRegressionPage(context, consoleErrors)

  try {
    await page.goto(`${baseUrl}/pet-places`)
    await page.getByRole('heading', { name: '같이 갈 수 있는 곳 찾기' }).waitFor()
    await assertVisible(page.getByText('지도를 불러오지 못해 기본 위치 기준으로 장소를 보여줍니다.'))
    await closeFeedbackModalIfOpen(page)
    await assertVisible(page.getByText('현재 지도 주변 동반 장소 2곳을 찾았습니다.'))
    await assertVisible(page.getByRole('link', { name: /꼬리톡 반려동물 카페/ }))
    await assertVisible(page.getByText('02-000-0000'))
    await assertVisible(page.getByText('430m'))
    await page.getByLabel('유형').selectOption('39')
    await assertVisible(page.getByText('현재 지도 주변 동반 장소 2곳을 찾았습니다.'))
    await page.getByLabel('검색 반경').selectOption('5000')
    await assertVisible(page.getByText('현재 지도 주변 동반 장소 2곳을 찾았습니다.'))
    await page.getByRole('link', { name: /꼬리톡 반려동물 카페/ }).click()
    await page.waitForURL(`${baseUrl}/pet-places/place-1`)
    await assertVisible(page.getByRole('heading', { name: '꼬리톡 반려동물 카페' }))
    await assertVisible(page.getByText('서울 중구 세종대로 110'))
    await assertVisible(page.getByText('반려동물과 보호자가 함께 쉬어갈 수 있는 카페입니다.'))
    await assertVisible(page.getByText('동반 가능 동물'))
    await assertVisible(page.getByText('중소형견'))
    await assertVisible(page.getByRole('link', { name: /이 장소 산책 후기 쓰기/ }))
    await assertNoHorizontalOverflow(page, viewportName, 'pet places')
  } finally {
    await page.close()
  }
}

async function verifyCommentPagination(page, viewportName) {
  await page.goto(`${baseUrl}/posts/paged-post`)
  await page.getByRole('heading', { name: pagedPost.title }).waitFor()
  await assertVisible(page.getByText('page comment 01'))
  await assertVisible(page.getByText('page comment 20'))
  await assertVisible(page.getByRole('button', { name: '댓글 더보기' }))
  assert((await page.getByText('page comment 21').count()) === 0, `Page 2 comment appeared early in ${viewportName}`)

  await page.getByRole('button', { name: '댓글 더보기' }).click()
  await assertVisible(page.getByText('page comment 21'))
  assert((await page.getByRole('button', { name: '댓글 더보기' }).count()) === 0, `Load more button remained in ${viewportName}`)
  await assertNoHorizontalOverflow(page, viewportName, 'post detail comments')
}

async function verifyNonOwnerGuards(context, consoleErrors, viewportName) {
  await context.addInitScript(() => {
    window.localStorage.setItem('accessToken', 'browser-regression-token')
    window.localStorage.setItem(
      'user',
      JSON.stringify({
        createdAt: '2026-06-13T00:00:00.000Z',
        email: 'other@example.test',
        id: '2',
        nickname: '다른사용자',
        profileImageUrl: null,
      }),
    )
  })

  const editPage = await newRegressionPage(context, consoleErrors)
  const deletePage = await newRegressionPage(context, consoleErrors)

  try {
    await editPage.goto(`${baseUrl}/posts/owned-post/edit`)
    await assertVisible(editPage.getByRole('heading', { name: '수정 권한이 없습니다.' }))
    await assertVisible(editPage.getByText('작성자 본인만 게시글을 수정할 수 있습니다.'))
    await assertNoHorizontalOverflow(editPage, viewportName, 'post edit guard')

    await deletePage.goto(`${baseUrl}/posts/owned-post/delete`)
    await assertVisible(deletePage.getByRole('heading', { name: '삭제 권한이 없습니다.' }))
    await assertVisible(deletePage.getByText('작성자 본인만 게시글을 삭제할 수 있습니다.'))
    await assertNoHorizontalOverflow(deletePage, viewportName, 'post delete guard')
  } finally {
    await editPage.close()
    await deletePage.close()
  }
}

async function verifyPostMutationHappyPath(context, consoleErrors, viewportName) {
  const page = await newRegressionPage(context, consoleErrors)

  await addAuthenticatedSession(page, 'owner-user')

  try {
    isCreatedPostDeleted = false
    createdPost = createPost({
      id: 'created-browser-post',
      title: '브라우저 작성 게시글',
      content: '브라우저 회귀에서 작성한 게시글입니다.',
      commentCount: 0,
      isOwner: true,
    })

    await page.goto(`${baseUrl}/posts/new`)
    await page.getByRole('heading', { name: '오늘의 동물 일상 남기기' }).waitFor()
    await page.locator('input[type="file"]').setInputFiles({
      buffer: Buffer.from(tinyPngBase64, 'base64'),
      mimeType: 'image/png',
      name: 'browser-regression.png',
    })
    await assertVisible(page.getByRole('button', { name: /browser-regression.png 제거/ }))
    await page.getByLabel('제목').fill('브라우저 작성 게시글')
    await page.getByLabel('본문').fill('브라우저 회귀에서 작성한 게시글입니다.')
    await page.getByLabel('카테고리').selectOption('1')
    await page.getByLabel('태그').fill('제리')
    await page.keyboard.press('Enter')
    await assertVisible(page.getByRole('button', { name: '#제리' }))
    assert(
      (await page.getByText('#리', { exact: true }).count()) === 0,
      `Korean IME duplicate trailing tag appeared in ${viewportName}`,
    )
    await page.getByRole('button', { name: '등록하기' }).click()
    await page.waitForURL(`${baseUrl}/posts/created-browser-post`)
    await assertVisible(page.getByRole('heading', { name: '브라우저 작성 게시글' }))
    await assertVisible(page.getByRole('link', { name: /수정/ }))
    await assertVisible(page.getByRole('link', { name: /삭제/ }))

    await page.goto(`${baseUrl}/posts/created-browser-post/edit`)
    await page.getByRole('heading', { name: '사진과 이야기를 다듬기' }).waitFor()
    await page.getByLabel('제목').fill('브라우저 수정 게시글')
    await page.getByLabel('본문').fill('수정 happy path가 정상 동작합니다.')
    await page.getByRole('button', { name: '수정 완료' }).click()
    await page.waitForURL(`${baseUrl}/posts/created-browser-post`)
    await assertVisible(page.getByRole('heading', { name: '브라우저 수정 게시글' }))

    await page.goto(`${baseUrl}/posts/created-browser-post/delete`)
    await page.getByRole('heading', { name: '이 게시글을 삭제할까요?' }).waitFor()
    await page.getByRole('button', { name: '삭제하기' }).click()
    await page.waitForURL(baseUrl)
    assert(isCreatedPostDeleted, `Created post delete API was not called in ${viewportName}`)
    await assertNoHorizontalOverflow(page, viewportName, 'post create edit delete happy path')
  } finally {
    await page.close()
  }
}

async function assertVisible(locator) {
  await locator.waitFor({ state: 'visible', timeout: 5_000 })
}

async function closeFeedbackModalIfOpen(page) {
  const closeButton = page.getByRole('button', { name: '예외 메시지 닫기' })

  if ((await closeButton.count()) > 0) {
    await closeButton.click()
  }
}

async function assertNoHorizontalOverflow(page, viewportName, label) {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)

  assert(!hasOverflow, `Horizontal overflow detected on ${label} in ${viewportName}`)
}

async function fulfillApi(route) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()

  if (!path.startsWith('/api/')) {
    return route.continue()
  }

  const isPublicPostViewIncrement = method === 'POST' && /^\/api\/posts\/[^/]+\/views$/.test(path)

  if (method !== 'GET' && !isPublicPostViewIncrement) {
    assert(
      request.headers().authorization?.startsWith('Bearer '),
      `Missing Authorization header for ${method} ${path}`,
    )
  }

  if (method === 'GET' && path === '/api/categories') {
    return route.fulfill({ json: ok({ categories, message: '카테고리 목록을 조회했습니다.' }) })
  }

  if (method === 'GET' && path === '/api/posts') {
    return route.fulfill({
      json: ok({
        items: posts,
        limit: 12,
        message: '게시글 목록을 조회했습니다.',
        page: 1,
        totalCount: posts.length,
        totalPages: 1,
      }),
    })
  }

  if (method === 'GET' && path === '/api/posts/search') {
    return route.fulfill({
      json: ok({
        items: posts,
        limit: 12,
        message: '게시글 검색 결과입니다.',
        page: 1,
        totalCount: posts.length,
        totalPages: 1,
      }),
    })
  }

  if (method === 'POST' && path === '/api/posts/images') {
    assert(
      request.headers().authorization === 'Bearer owner-user',
      'Post image upload did not include the expected owner token',
    )

    return route.fulfill({
      json: ok({
        images: [
          {
            cardUrl: imageUrl,
            detailUrl: imageUrl,
            fileSize: '128',
            id: 'uploaded-browser-image',
            mimeType: 'image/webp',
            originalFilename: 'browser-regression.png',
            originalUrl: imageUrl,
            thumbnailUrl: imageUrl,
            url: imageUrl,
          },
        ],
        message: '이미지가 업로드되었습니다.',
      }),
    })
  }

  if (method === 'POST' && path === '/api/posts') {
    assert(request.headers().authorization === 'Bearer owner-user', 'Create post used the wrong token')
    const payload = await request.postDataJSON()

    assert(payload.title === '브라우저 작성 게시글', 'Create post title payload mismatch')
    assert(payload.content === '브라우저 회귀에서 작성한 게시글입니다.', 'Create post content payload mismatch')
    assert(JSON.stringify(payload.categoryIds) === JSON.stringify(['1']), 'Create post categoryIds payload mismatch')
    assert(JSON.stringify(payload.imageIds) === JSON.stringify(['uploaded-browser-image']), 'Create post imageIds payload mismatch')
    assert(JSON.stringify(payload.tagNames) === JSON.stringify(['제리']), 'Create post tagNames payload mismatch')

    createdPost = {
      ...createdPost,
      content: payload.content,
      body: payload.content,
      images: [
        {
          cardUrl: imageUrl,
          detailUrl: imageUrl,
          fileSize: '128',
          id: 'uploaded-browser-image',
          mimeType: 'image/webp',
          originalFilename: 'browser-regression.png',
          originalUrl: imageUrl,
          thumbnailUrl: imageUrl,
          url: imageUrl,
        },
      ],
      tags: payload.tagNames.map((name, index) => ({
        id: `created-tag-${index}`,
        name,
      })),
      title: payload.title,
    }
    isCreatedPostDeleted = false

    return route.fulfill({
      json: ok({
        message: '게시글이 등록되었습니다.',
        post: createdPost,
      }),
    })
  }

  const postMatch = path.match(/^\/api\/posts\/([^/]+)$/)

  if (method === 'GET' && postMatch) {
    return route.fulfill({ json: ok(getPostById(postMatch[1])) })
  }

  if (method === 'PATCH' && postMatch) {
    assert(request.headers().authorization === 'Bearer owner-user', 'Update post used the wrong token')
    const payload = await request.postDataJSON()

    assert(postMatch[1] === createdPost.id, 'Update post id mismatch')
    assert(payload.title === '브라우저 수정 게시글', 'Update post title payload mismatch')
    assert(payload.content === '수정 happy path가 정상 동작합니다.', 'Update post content payload mismatch')
    assert(JSON.stringify(payload.categoryIds) === JSON.stringify(['1']), 'Update post categoryIds payload mismatch')
    assert(JSON.stringify(payload.imageIds) === JSON.stringify(['uploaded-browser-image']), 'Update post imageIds payload mismatch')
    assert(JSON.stringify(payload.tagNames) === JSON.stringify(['제리']), 'Update post tagNames payload mismatch')

    createdPost = {
      ...createdPost,
      body: payload.content,
      content: payload.content,
      tags: payload.tagNames.map((name, index) => ({
        id: `updated-tag-${index}`,
        name,
      })),
      title: payload.title,
    }

    return route.fulfill({
      json: ok({
        message: '게시글이 수정되었습니다.',
        post: createdPost,
      }),
    })
  }

  if (method === 'DELETE' && postMatch) {
    assert(request.headers().authorization === 'Bearer owner-user', 'Delete post used the wrong token')
    assert(postMatch[1] === createdPost.id, 'Delete post id mismatch')
    isCreatedPostDeleted = true

    return route.fulfill({
      json: ok({
        message: '게시글이 삭제되었습니다.',
        postId: postMatch[1],
      }),
    })
  }

  const viewMatch = path.match(/^\/api\/posts\/([^/]+)\/views$/)

  if (method === 'POST' && viewMatch) {
    return route.fulfill({
      json: ok({
        message: '조회수가 증가했습니다.',
        postId: viewMatch[1],
        views: 8,
      }),
    })
  }

  const commentsMatch = path.match(/^\/api\/posts\/([^/]+)\/comments$/)

  if (method === 'GET' && commentsMatch) {
    const page = Number(url.searchParams.get('page') ?? '1')
    const comments = getPagedComments(commentsMatch[1], page)

    return route.fulfill({
      json: ok({
        items: comments,
        limit: 20,
        message: '댓글 목록을 조회했습니다.',
        page,
        totalCount: 21,
        totalPages: 2,
      }),
    })
  }

  if (method === 'POST' && path === '/api/agent/chat') {
    const authorization = request.headers().authorization

    if (authorization === 'Bearer expired-browser-regression-token') {
      return route.fulfill({
        status: 401,
        json: {
          errorCode: 'UNAUTHORIZED',
          message: '유효하지 않은 로그인 토큰입니다.',
          success: false,
        },
      })
    }

    assert(authorization === 'Bearer assistant-user', 'Assistant request used the wrong token')
    const payload = await request.postDataJSON()

    assert(Array.isArray(payload.history), 'Assistant history payload is missing')
    assert(payload.context?.route === '/', 'Assistant route context mismatch')

    if (payload.message === '산책 장소와 게시글 추천해줘') {
      return route.fulfill({
        json: ok({
          answer: '산책 장소와 게시글을 함께 정리했어요.',
          cards: [
            {
              href: '/pet-places/place-1',
              id: 'place-1',
              title: '꼬리톡 반려동물 카페',
              type: 'place',
            },
            {
              href: '/posts/101',
              id: '101',
              title: '브라우저 회귀 테스트 게시글',
              type: 'post',
            },
          ],
          message: 'Assistant 응답을 생성했습니다.',
          observationChecklist: ['산책 전후 컨디션을 확인해요.'],
          riskLevel: 'behavior_support',
          usedTools: ['pet_place_search', 'post_search'],
          vetConsultCriteria: ['통증이나 호흡 이상이 있으면 병원 상담을 우선해요.'],
        }),
      })
    }

    if (payload.message === '광주 알아?') {
      assert(
        payload.history.some((entry) => entry.content?.includes('산책 장소와 게시글을 함께 정리했어요.')),
        'Assistant place follow-up did not include prior assistant context',
      )

      return route.fulfill({
        json: ok({
          answer: '광주 동반 장소를 이어서 찾아봤어요.',
          cards: [
            {
              href: '/pet-places/gwangju-place',
              id: 'gwangju-place',
              title: '광주 반려동물 산책지',
              type: 'place',
            },
          ],
          message: 'Assistant 응답을 생성했습니다.',
          observationChecklist: [],
          places: [
            {
              contentId: 'gwangju-place',
              title: '광주 반려동물 산책지',
            },
          ],
          riskLevel: 'none',
          usedTools: ['pet_place_search'],
          vetConsultCriteria: [],
        }),
      })
    }

    if (payload.message === '강아지가 똥을 안싸') {
      return route.fulfill({
        json: ok({
          answer: '48시간 이상 변을 못 봤다면 병원 상담을 우선해 주세요.',
          cards: [],
          message: 'Assistant 응답을 생성했습니다.',
          observationChecklist: ['마지막 대변 시점', '구토나 식욕 저하 여부'],
          riskLevel: 'vet_consult',
          usedTools: ['search_behavior_rag'],
          vetConsultCriteria: ['복부 팽만, 구토, 기력 저하가 있으면 바로 상담'],
        }),
      })
    }

    if (payload.message === '몰라') {
      assert(
        payload.history.some((entry) => entry.content?.includes('48시간 이상 변을 못 봤다면')),
        'Assistant health follow-up did not include prior constipation context',
      )

      return route.fulfill({
        json: ok({
          answer: '몰라도 괜찮아요. 지금 확인 가능한 안전 신호부터 볼게요.',
          cards: [],
          message: 'Assistant 응답을 생성했습니다.',
          observationChecklist: ['배가 단단한지', '식욕이 줄었는지'],
          riskLevel: 'vet_consult',
          usedTools: ['search_behavior_rag'],
          vetConsultCriteria: ['48시간 이상이면 병원 상담'],
        }),
      })
    }

    throw new Error(`Unexpected assistant message payload: ${payload.message}`)
  }

  if (method === 'GET' && path === '/api/pet-places/nearby') {
    assert(url.searchParams.get('lat') === '37.5665', 'Pet place latitude query mismatch')
    assert(url.searchParams.get('lng') === '126.978', 'Pet place longitude query mismatch')
    assert(['3000', '5000'].includes(url.searchParams.get('radius') ?? ''), 'Pet place radius query mismatch')

    if (url.searchParams.get('radius') === '5000') {
      assert(url.searchParams.get('contentTypeId') === '39', 'Pet place contentTypeId query mismatch')
    }

    return route.fulfill({
      json: ok({
        items: petPlaces,
        limit: 20,
        message: '장소 목록을 조회했습니다.',
        page: 1,
        totalCount: petPlaces.length,
        totalPages: 1,
      }),
    })
  }

  const petPlaceMatch = path.match(/^\/api\/pet-places\/([^/]+)$/)

  if (method === 'GET' && petPlaceMatch) {
    const place = petPlaces.find((item) => item.contentId === petPlaceMatch[1])

    return route.fulfill({
      json: ok({
        message: '장소 상세를 조회했습니다.',
        place: {
          ...place,
          homepage: 'https://example.test/place',
          images: [
            {
              imageName: '대표 이미지',
              originUrl: imageUrl,
              serialNumber: '1',
              thumbnailUrl: imageUrl,
            },
          ],
          overview: '<p>반려동물과 보호자가 함께 쉬어갈 수 있는 카페입니다.</p>',
          petInfo: {
            acmpyNeedMtr: '리드줄',
            acmpyPsblCpam: '중소형견',
            acmpyTypeCd: '동반 가능',
            etcAcmpyInfo: '실내 좌석 일부 가능',
            relaAcdntRiskMtr: '혼잡 시간 주의',
            relaFrnshPrdlst: '',
            relaPosesFclty: '물그릇',
            relaPurcPrdlst: '',
            relaRntlPrdlst: '',
          },
        },
      }),
    })
  }

  return route.fulfill({
    status: 404,
    json: {
      errorCode: 'NOT_FOUND',
      message: `Unhandled browser regression route: ${method} ${path}`,
      success: false,
    },
  })
}

function ok(data) {
  return {
    data,
    message: data.message ?? 'ok',
    success: true,
  }
}

function getPostById(id) {
  if (id === createdPost.id && !isCreatedPostDeleted) {
    return createdPost
  }

  if (id === pagedPost.id) {
    return pagedPost
  }

  if (id === protectedPost.id) {
    return protectedPost
  }

  const post = posts.find((item) => item.id === id)

  if (post) {
    return post
  }

  return createPost({
    id,
    title: '임시 게시글',
    content: '회귀 테스트용 fallback 게시글입니다.',
    commentCount: 0,
    isOwner: false,
  })
}

function getPagedComments(postId, page) {
  if (postId !== pagedPost.id) {
    return []
  }

  const allComments = Array.from({ length: 21 }, (_, index) =>
    createComment({
      id: String(index + 1),
      postId,
      content: `page comment ${String(index + 1).padStart(2, '0')}`,
    }),
  )

  return page === 1 ? allComments.slice(0, 20) : allComments.slice(20)
}

function createPost({ id, title, content, commentCount, isOwner }) {
  return {
    author: {
      id: '1',
      nickname: '마루집사',
      profileImageUrl: null,
    },
    body: content,
    categories: [categories[0]],
    category: categories[0],
    commentCount,
    content,
    createdAt: now,
    detailImageUrl: imageUrl,
    id,
    images: [
      {
        cardUrl: imageUrl,
        detailUrl: imageUrl,
        fileSize: '128',
        id: `${id}-image`,
        mimeType: 'image/webp',
        originalFilename: `${id}.webp`,
        originalUrl: imageUrl,
        thumbnailUrl: imageUrl,
        url: imageUrl,
      },
    ],
    isOwner,
    likeCount: 4,
    likedByMe: false,
    tags: [{ id: `${id}-tag`, name: '회귀테스트' }],
    thumbnailUrl: imageUrl,
    title,
    updatedAt: null,
    views: 7,
  }
}

function createComment({ id, postId, content }) {
  return {
    author: {
      id: '1',
      nickname: '마루집사',
      profileImageUrl: null,
    },
    body: content,
    content,
    createdAt: now,
    id,
    isOwner: false,
    likeCount: 0,
    likedByMe: false,
    postId,
    updatedAt: null,
  }
}

function svgDataUrl(background, foreground) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" fill="${background}"/><circle cx="300" cy="300" r="130" fill="${foreground}" opacity=".22"/><rect x="430" y="210" width="270" height="220" rx="28" fill="${foreground}" opacity=".7"/><text x="480" y="335" fill="white" font-family="Arial" font-size="46" font-weight="700">Tail Talk</text></svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
