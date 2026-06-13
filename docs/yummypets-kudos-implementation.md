# Yummypets `/photos/kudos` 구현 분석 문서

작성일: 2026-06-12  
대상 페이지: https://www.yummypets.com/photos/kudos  
분석 목적: Tail Talk의 사진 피드/커뮤니티 UI를 개선할 때 참고할 수 있도록, Yummypets의 `Best in Show` 페이지가 어떤 구조와 방식으로 구현되어 있는지 정리한다.

## 1. 한 줄 결론

Yummypets의 `/photos/kudos`는 Angular SPA 안에서 동작하는 사진 랭킹/탐색 페이지다. 데스크톱에서는 `3열 정사각 카드 + 하단 메타 정보 오버레이`를 보여주고, 모바일에서는 같은 데이터를 `3열 사진 썸네일 갤러리`로 축소해 빠르게 훑어보는 경험을 만든다.

Tail Talk에 그대로 복제하기보다는, 다음 패턴만 선별적으로 가져오는 것이 좋다.

- 사진 중심의 일정한 정사각 비율
- 카테고리/동물 필터를 상단 pill로 고정
- 좋아요, 댓글, 저장 액션을 카드 단위 컴포넌트로 분리
- 이미지 CDN, responsive image, lazy loading 조합
- 모바일에서는 정보량을 줄이고 썸네일 탐색성을 우선하는 방식

단, 접근성 측면에서는 `alt="undefined"`, 아이콘 버튼의 `aria-label` 누락, 전역 focus outline 제거 등 그대로 따라 하면 안 되는 부분이 확인된다.

## 2. 조사 방법

확인한 범위는 다음과 같다.

- 실제 페이지 DOM 관찰
- 1280, 768, 390, 360, 320px 뷰포트 계측
- 초기 HTML 소스 확인
- 로드되는 CSS/JS 번들명 확인
- Angular 번들에서 라우트/헤더/일부 API 호출 패턴 확인
- 카드 DOM, 이미지 구성, 액션 버튼 접근성 속성 확인

주의할 점:

- 공개 소스맵이나 원본 Angular 프로젝트 코드는 확인할 수 없었다.
- 실제 사진 목록 API endpoint는 번들 난독화와 런타임 요청 구조 때문에 정확한 URL까지 확정하지 못했다.
- 따라서 API 내부 구현은 `확인됨`과 `추정`을 분리해서 적는다.

## 3. 기술 스택

확인된 주요 구현 요소:

| 구분 | 내용 | 근거 |
| --- | --- | --- |
| 프레임워크 | Angular SPA | `<yummypets-root>`, `ng-star-inserted`, `_ngcontent-*`, Angular 라우터/컴포넌트 흔적 |
| UI 라이브러리 | Angular Material 사용 | `mat-menu`, `matInput`, `mat-option`, `--mat-*`, `--mdc-*` CSS 변수 |
| 스타일 | 전역 CSS + Angular component scoped CSS | `styles-G5N4SPP3.css`, `_ngcontent-*` 속성 |
| 폰트 | Figtree, Material Icons, Typekit | HTML font preload/style |
| 이미지 | CloudFront CDN | `d2d0m32kr3hci1.cloudfront.net`, `d19duk2jpd3pwk.cloudfront.net` |
| 이미지 로딩 | `<picture>` + lazy loading | `yp-ui-image`, `lazy-img`, `ng-lazyloaded` |
| 앱 형태 | PWA 성격 일부 | `assets/manifest.json`, `theme-color` |
| 분석/마케팅 | GA, Cookiebot, Intercom, Taboola, Facebook/Twitter Pixel | 초기 HTML script |

초기 HTML에서 확인된 번들:

- `polyfills-SCHOHYNV.js`
- `scripts-BGFE627N.js`
- `main-RKVXKGIL.js`
- `styles-G5N4SPP3.css`
- 여러 `chunk-*.js` modulepreload

`scripts-BGFE627N.js`에는 비디오/HLS 관련 코드가 많이 포함되어 있고, `/photos/kudos`의 핵심 라우트/컴포넌트 흔적은 주로 `main-RKVXKGIL.js`에서 확인된다.

## 4. 페이지 역할

페이지의 공개 제목은 `Best in Show`다. URL은 `/photos/kudos`이며, Yummypets 전체 서비스 안에서는 “많은 반응을 받은 사진” 또는 “추천/인기 사진”을 탐색하는 갤러리 성격으로 보인다.

상단 서브내비게이션에는 다음 흐름이 같은 미디어 탐색 그룹으로 묶여 있다.

- `/photos/kudos`
- `/photos/latest`
- `/videos`
- `/yon`

번들에서 확인된 구조:

```text
subNavLinks = [
  { url: "/photos/kudos", t: "common.key.kudo" },
  { url: "/photos/latest", t: "photo.latest" },
  { url: "/videos", t: "video.latest" },
  { url: "/yon", t: "yorn.yon" }
]
```

즉, `/photos/kudos`는 독립 랜딩 페이지가 아니라 Yummypets의 미디어 탐색 섹션 중 하나다.

## 5. 전체 화면 구조

실제 DOM 기준 화면은 다음 순서로 구성된다.

1. 글로벌 헤더
2. 서브내비게이션
3. breadcrumb
4. 페이지 제목 `Best in Show`
5. 동물 종류 필터 pill
6. 사진 그리드
7. 푸터

상단 헤더에서 확인된 주요 링크:

- 검색 아이콘: `/search`
- `Social petwork`
- `Animal aid program`: `/voice`
- `Pet owner panel`: 외부 링크 `https://explorer.yummypets.com`
- `#FavoriteToy`: `/tags/FavoriteToy`
- `Yummy or Not`: `/yon`
- `Sign in`: `/login`
- `Sign up`: `/signup`

푸터에서는 `© 2011-2026`, 소셜 링크, `Forum`, `Breeds`, `Contact`, 언어 `EN` 등이 확인된다.

## 6. 필터 UI

페이지 제목 아래에 동물 필터가 pill 형태로 배치된다.

확인된 필터:

- All
- Dogs
- Cats
- Reptiles
- Fish
- Birds
- Rodents
- Horses
- Insects
- Other

활성 필터는 `pill__link pill__link--active` 클래스를 가진다. `All` pill의 계산 스타일은 대략 다음과 같다.

- 배경색: `rgb(168, 179, 44)`
- 글자색: 흰색
- border radius: `10px`
- 크기: 약 `46 x 31px`

접근성 주의:

- 필터 요소가 `a` 태그로 렌더링되지만 `href`가 없다.
- 활성 상태에 `aria-current`가 없다.
- Tail Talk에서는 `button` 또는 실제 `href`가 있는 링크를 쓰고, 활성 필터에 `aria-current="page"` 또는 `aria-pressed`를 붙이는 편이 좋다.

## 7. 미디어 그리드 구조

핵심 그리드에는 `media-grid` 계열 클래스가 사용된다.

대표 클래스:

- `cols`
- `cols--mobile`
- `cols--multiline`
- `media-grid`
- `media-grid__item-container`
- `col`
- `col-4`

`col-4`를 기준으로 12컬럼 시스템의 4칸, 즉 3열 레이아웃을 만든다. 흥미로운 점은 모바일에서도 1열 카드로 바꾸지 않고 3열 썸네일을 유지한다는 것이다.

계측 결과:

| 뷰포트 | 배경 | 그리드 폭 | 첫 줄 컬럼 | 카드 컨테이너 크기 | 가로 스크롤 |
| --- | --- | ---: | ---: | ---: | --- |
| 1280x720 | `#EFEEED` | 약 966px | 3 | 322x322px | 없음 |
| 768x1024 | 흰색 | 약 694px | 3 | 231x231px | 없음 |
| 390x844 | 흰색 | 약 349px | 3 | 116x116px | 없음 |
| 360x800 | 흰색 | 약 321px | 3 | 107x107px | 없음 |
| 320x800 | 흰색 | 약 285px | 3 | 95x95px | 없음 |

초기 렌더링에서 확인된 카드 수는 20개다. 이후 pagination 또는 infinite loading이 붙을 가능성이 있지만, 정확한 로딩 트리거는 확정하지 못했다.

## 8. 카드 구조

데스크톱 기준 카드 한 개는 다음 구조에 가깝다.

```html
<div class="media-grid__item">
  <a role="button" class="img-wrapper media-grid__item__media">
    <yp-ui-image>
      <picture>
        <source media="(min-width: 960px)">
        <source media="(min-width: 770px)">
        <img class="lazy-img ng-lazyloaded">
      </picture>
    </yp-ui-image>
  </a>

  <div class="media-grid__item-data">
    <a class="avatar-link">...</a>
    <h3>pet name</h3>
    <time>...</time>
    <yp-ui-resource-actions>...</yp-ui-resource-actions>
  </div>
</div>
```

계산 스타일상 `.media-grid__item`은 `position: relative`이고, 이미지 링크와 데이터 영역은 내부에서 `position: absolute`로 배치된다.

데스크톱 첫 카드에서 확인된 구조:

- 카드 전체: 약 `316 x 316px`
- 이미지 영역: `position: absolute`, `316 x 316px`
- 데이터 영역: `position: absolute`, 하단 쪽 `316 x 85px`
- 데이터 영역 배경: 흰색
- 카드 radius: `0px`
- box-shadow: 없음

카드 데이터 영역에 포함되는 내용:

- 반려동물 아바타
- 반려동물 이름
- 작성 시간
- 짧은 본문 또는 캡션
- 반응 액션

모바일에서는 카드 메타 정보가 실질적으로 숨겨진다. 390px 계측에서 `yp-ui-resource-actions`, `h3` 등은 DOM에 남아 있지만 `width: 0`, `height: 0`에 가깝게 계산되었다. 사용자가 보는 것은 거의 사진 썸네일뿐이다.

## 9. 액션 컴포넌트

카드 하단 반응 영역은 독립 컴포넌트로 분리되어 있다.

확인된 커스텀 요소:

- `yp-ui-resource-actions`
- `yp-ui-yummy-btn`
- `yp-ui-bookmark-btn`

액션 유형:

- paw/yummy 반응 수
- 댓글 수
- 저장/bookmark 수
- 더보기 메뉴

더보기 메뉴는 Angular Material의 `mat-menu`를 사용한다.

예시로 첫 카드에서 보인 숫자:

- yummy: 52
- comments: 18
- bookmark: 0

로그인하지 않은 사용자가 액션을 누를 경우 로그인 유도 또는 인증 플로우로 연결될 가능성이 높다. 이 동작 자체는 이번 분석에서 끝까지 검증하지 않았다.

접근성 주의:

- 액션 링크들이 `role="button"`을 가진 `a` 태그로 구현되어 있다.
- 대부분 `aria-label`이 없다.
- 아이콘만 있는 더보기 `button`에도 accessible name이 없다.
- Tail Talk에서는 `button type="button" aria-label="좋아요"`처럼 명시적으로 구현하는 것이 좋다.

## 10. 이미지 처리

이미지는 `yp-ui-image`라는 커스텀 Angular 컴포넌트를 통해 렌더링된다.

확인된 특징:

- `<picture>` 사용
- viewport별 `<source media="...">` 사용
- fallback `<img>` 사용
- lazy loading 클래스 사용
- CloudFront CDN 사용
- 썸네일 파일명에 `_160.jpg` 같은 크기 suffix 사용

사진 CDN 예:

- `https://d2d0m32kr3hci1.cloudfront.net/..._160.jpg`

아바타 CDN 예:

- `https://d19duk2jpd3pwk.cloudfront.net/48x48/...jpg`

정적 자산 CDN 예:

- `https://d2ocidupsqths7.cloudfront.net/...`

Tail Talk에 적용할 때는 다음 구성이 적합하다.

```tsx
<picture>
  <source media="(min-width: 960px)" srcSet={largeUrl} />
  <source media="(min-width: 640px)" srcSet={mediumUrl} />
  <img
    src={thumbnailUrl}
    alt={meaningfulAlt}
    loading="lazy"
    decoding="async"
  />
</picture>
```

단, Yummypets에서는 일부 이미지의 `alt`가 `undefined` 또는 `null` 문자열로 렌더링된다. 이 부분은 Tail Talk에서 반드시 개선해야 한다.

## 11. 라우팅과 데이터 흐름

확인된 것:

- Angular Router 기반 SPA다.
- `/photos/kudos`, `/photos/latest`, `/videos`, `/yon`이 미디어 섹션의 서브내비게이션으로 묶여 있다.
- 헤더는 `yp-ui-header-menu` 컴포넌트에서 라우터 링크를 구성한다.
- 사진 상세 resolver는 `photoApi.fetch(+params.id)` 형태의 호출을 사용한다.
- 북마크 보드에서는 `yp-ui-media`에 `request`와 `kind`를 넘기는 패턴이 확인된다.

번들에서 확인된 북마크 영역 패턴:

```html
<yp-ui-media
  [request]="bookmarkRequest$"
  [kind]="bookmarksKind"
  (updated)="updatedMedia($event)">
</yp-ui-media>
```

추정되는 `/photos/kudos` 데이터 흐름:

1. 라우터가 `/photos/kudos` 페이지 컴포넌트를 활성화한다.
2. 페이지 컴포넌트가 Photo API 서비스에서 kudos용 request collection을 만든다.
3. `yp-ui-media` 같은 재사용 미디어 그리드 컴포넌트에 request 객체를 전달한다.
4. 그리드 컴포넌트가 초기 20개 사진을 렌더링한다.
5. 필터 pill 클릭 시 request parameter를 바꾸거나 별도 endpoint를 호출한다.
6. 개별 액션은 `yp-ui-resource-actions` 내부 컴포넌트에서 처리한다.

정확한 목록 API URL은 확인하지 못했다. 다만 번들에 `requestService.newRequestCollection(...)` 패턴이 여러 곳에서 확인되며, Yummypets는 단순 fetch 배열보다 request collection 객체를 중심으로 목록 로딩을 추상화한 것으로 보인다.

## 12. SEO와 초기 HTML

초기 HTML은 Angular SPA shell을 제공한다.

확인된 요소:

- `<base href="/">`
- `<yummypets-root>`에 loading logo fallback
- canonical: `https://www.yummypets.com/photos/kudos`
- Open Graph/Twitter meta는 존재하지만 일부 content가 비어 있음
- `meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"`
- PWA manifest

`maximum-scale=1`은 확대를 제한할 수 있으므로 접근성 측면에서 주의가 필요하다. Tail Talk에서는 사용자 확대를 막지 않는 편이 낫다.

## 13. 서드파티 스크립트와 운영 요소

초기 HTML에서 확인된 외부 스크립트:

- Facebook SDK
- Google Analytics
- Cookiebot
- Intercom
- Taboola Pixel
- Twitter Pixel
- Facebook Pixel
- Cloudflare challenge script

이 페이지는 서비스 운영/마케팅 도구가 많이 붙은 실제 프로덕션 SPA다. 반면 로드 이벤트가 외부 스크립트 영향으로 오래 걸릴 수 있고, 초기 스크립트 양이 많아질 수 있다.

Tail Talk MVP에서는 다음 순서가 적합하다.

1. 필수 기능과 접근성 먼저 안정화
2. analytics는 최소 이벤트만 도입
3. 채팅/마케팅 위젯은 모바일 CTA를 가리지 않도록 조건부 노출
4. 쿠키/동의 배너는 실제 추적 스크립트를 붙일 때 함께 도입

## 14. 접근성 관찰

좋은 점:

- 주요 콘텐츠가 `h1` 아래에 모인다.
- 필터 텍스트가 시각적으로 명확하다.
- 숫자 반응이 카드마다 일관되게 배치된다.
- 이미지 링크, 펫 프로필 링크, 액션 컴포넌트가 기능별로 나뉘어 있다.

문제점:

- 전역 CSS에 `*:focus { outline: none }`가 확인된다.
- 필터 활성 상태에 `aria-current`가 없다.
- `href` 없는 `a` 태그가 필터에 사용된다.
- 사진 링크가 `role="button"`이지만 이름이 비어 있다.
- 액션 버튼/링크에 `aria-label`이 없다.
- 아이콘만 있는 더보기 버튼의 accessible name이 없다.
- 일부 이미지 alt가 `undefined` 또는 `null` 문자열이다.
- `maximum-scale=1`로 확대 제한 가능성이 있다.

Tail Talk 적용 기준:

- focus-visible ring은 절대 제거하지 않는다.
- 아이콘 버튼에는 항상 `aria-label`을 붙인다.
- 이미지 alt는 게시글 제목/반려동물 이름/상황 설명 기반으로 만든다.
- 필터는 `button` 또는 실제 링크 중 하나로 명확히 결정한다.
- active filter는 `aria-current` 또는 `aria-pressed`로 표현한다.
- 모바일에서도 숨겨진 DOM이 키보드 포커스를 받지 않도록 `display: none`, `hidden`, `aria-hidden` 등을 함께 고려한다.

## 15. Tail Talk에 가져올 구현 패턴

가져오면 좋은 것:

1. 사진 비율 안정화
   - 게시글 이미지를 `aspect-ratio: 1 / 1` 또는 `4 / 3`으로 고정해 레이아웃 점프를 줄인다.

2. 반응 액션 컴포넌트화
   - 좋아요, 댓글, 저장, 더보기는 카드마다 반복되므로 하나의 `PostActions` 컴포넌트로 분리한다.

3. 필터 pill의 시각적 우선순위
   - 현재 Tail Talk의 카테고리도 상단 pill 또는 하단 nav와 연결해 “지금 어떤 피드를 보는지”를 명확히 보여준다.

4. CDN/썸네일 전략
   - 큰 원본 이미지를 카드에 직접 쓰지 않고 카드용 썸네일을 사용한다.

5. 데스크톱/모바일 정보량 차등
   - 데스크톱: 작성자, 설명, 반응 수까지 노출
   - 모바일: 사진, 카테고리, 핵심 반응만 노출

가져오지 말아야 할 것:

1. focus outline 제거
2. accessible name 없는 아이콘 버튼
3. `alt="undefined"` 같은 잘못된 대체 텍스트
4. 모바일에서 너무 작은 95px 카드 안에 과도한 액션 DOM을 남기는 방식
5. 필터를 `href` 없는 `a` 태그로 처리하는 방식
6. MVP 단계에서 과도한 서드파티 위젯을 동시에 붙이는 방식

## 16. Tail Talk용 구현 스케치

Yummypets의 구조를 Tail Talk에 맞게 바꾸면 다음 정도가 적합하다.

```tsx
function FeedPage() {
  return (
    <AppLayout variant="feed">
      <FeedHeader
        title="Best in Tail Talk"
        description="오늘 가장 많은 반응을 받은 반려동물 이야기"
        filters={categories}
      />
      <PostGrid>
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </PostGrid>
    </AppLayout>
  );
}
```

```tsx
function PostCard({ post }: { post: Post }) {
  return (
    <article className="post-card">
      <a className="post-card__media" href={`/posts/${post.id}`}>
        <picture>
          <source media="(min-width: 960px)" srcSet={post.image.large} />
          <img
            src={post.image.thumb}
            alt={post.image.alt}
            loading="lazy"
            decoding="async"
          />
        </picture>
      </a>

      <div className="post-card__body">
        <PostAuthor author={post.author} />
        <p>{post.excerpt}</p>
        <PostActions post={post} />
      </div>
    </article>
  );
}
```

CSS 방향:

```css
.post-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.post-card__media {
  display: block;
  aspect-ratio: 1 / 1;
  overflow: hidden;
}

.post-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 480px) {
  .post-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .post-card__body {
    padding: 8px;
  }
}
```

Tail Talk은 Yummypets처럼 모바일 3열 95px 썸네일만 유지하면 커뮤니티 텍스트가 거의 사라진다. 게시판 성격을 살리려면 모바일은 2열 카드 또는 1열 compact card가 더 적합하다.

## 17. 최종 평가

Yummypets `/photos/kudos`는 오래 운영된 실제 서비스답게 미디어 그리드, CDN 이미지, 반응 액션 컴포넌트, 서브내비게이션 구성이 안정적이다. 특히 “사진을 빠르게 훑는 갤러리”로는 매우 명확한 구현이다.

하지만 Tail Talk는 단순 사진 랭킹보다 게시글 본문, 질문/케어 맥락, 장소 정보까지 중요하다. 따라서 Yummypets에서 배울 핵심은 `사진 중심 정보 구조`와 `반응 액션의 컴포넌트화`이고, 모바일 UI와 접근성은 Tail Talk의 요구에 맞춰 더 안전하게 재설계해야 한다.

