import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import type { Filters } from '../types/community'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'
import { fetchPostById } from '../utils/postsApi'
import '../styles/pages/WritePage.css'

type PostFormPayload = {
  title: string
  travelDate: string
  imageUrl: string
  regionCode: string
  budgetCode: string
  themeCode: string
  season: string
  companion: string
  content: string
}

type WritePageProps = {
  onCreatePost: (payload: PostFormPayload) => Promise<boolean>
  onUpdatePost: (postId: number, payload: PostFormPayload) => Promise<boolean>
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

export function WritePage({ onCreatePost, onUpdatePost }: WritePageProps) {
  const navigate = useNavigate()
  const params = useParams()
  const postId = Number(params.postId)
  const isEditMode = Number.isFinite(postId)
  const [lookupOptions, setLookupOptions] = useState<PostFilterLookups>(EMPTY_LOOKUPS)
  const [isLoadingLookups, setIsLoadingLookups] = useState(true)
  const [isLoadingPost, setIsLoadingPost] = useState(isEditMode)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    title: '',
    travelDate: '',
    imageUrl: '',
    region: '',
    budget: '',
    theme: '',
    season: '',
    companion: '',
    content: '',
  })
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadLookups = async () => {
      try {
        const data = await fetchPostFilters()

        if (!isMounted) {
          return
        }

        setLookupOptions(data)
      } catch (error) {
        if (isMounted) {
          window.alert(error instanceof Error ? error.message : '옵션을 불러오지 못했습니다.')
        }
      } finally {
        if (isMounted) {
          setIsLoadingLookups(false)
        }
      }
    }

    void loadLookups()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!isEditMode) {
      setIsLoadingPost(false)
      return
    }

    let isMounted = true

    const loadPost = async () => {
      setIsLoadingPost(true)

      try {
        const response = await fetchPostById(postId)

        if (!isMounted) {
          return
        }

        setForm({
          title: response.post.title,
          travelDate: response.post.travelDate,
          imageUrl: response.post.imageUrl,
          region: response.post.regionCode ?? '',
          budget: response.post.budgetCode ?? '',
          theme: response.post.themeCode ?? '',
          season: response.post.season,
          companion: response.post.companion,
          content: response.post.content,
        })
        setPreviewUrl(response.post.imageUrl)
      } catch (error) {
        if (isMounted) {
          window.alert(error instanceof Error ? error.message : '게시글을 불러오지 못했습니다.')
          navigate('/main')
        }
      } finally {
        if (isMounted) {
          setIsLoadingPost(false)
        }
      }
    }

    void loadPost()

    return () => {
      isMounted = false
    }
  }, [isEditMode, navigate, postId])

  const updateSelect = (key: keyof Filters, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setPreviewUrl(result)
      setForm((current) => ({ ...current, imageUrl: result }))
    }
    reader.readAsDataURL(file)
  }

  if (isLoadingLookups || isLoadingPost) {
    return (
      <main className="page">
        <section className="empty-state">
          <h1>작성 화면을 불러오는 중입니다...</h1>
        </section>
      </main>
    )
  }

  return (
    <main className="page form-page">
      <section className="form-card">
        <div className="form-card__header">
          <span>{isEditMode ? '게시글 수정' : '게시글 작성'}</span>
          <h1>{isEditMode ? '게시글 수정하기' : '새 게시글 작성하기'}</h1>
          <p>여행 정보를 입력하고 게시판에 저장하세요.</p>
        </div>
        <form
          className="write-form"
          onSubmit={async (event) => {
            event.preventDefault()

            if (
              !form.title.trim() ||
              !form.travelDate ||
              !form.region ||
              !form.budget ||
              !form.theme ||
              !form.season ||
              !form.companion ||
              !form.content.trim()
            ) {
              window.alert('필수 항목을 모두 입력해주세요.')
              return
            }

            setIsSubmitting(true)

            try {
              const payload = {
                title: form.title.trim(),
                travelDate: form.travelDate,
                imageUrl: form.imageUrl || previewUrl,
                regionCode: form.region,
                budgetCode: form.budget,
                themeCode: form.theme,
                season: form.season,
                companion: form.companion,
                content: form.content.trim(),
              }

              const isSuccess = isEditMode
                ? await onUpdatePost(postId, payload)
                : await onCreatePost(payload)

              if (!isSuccess) {
                return
              }

              window.alert(isEditMode ? '게시글이 수정되었습니다.' : '게시글이 등록되었습니다.')
              navigate(isEditMode ? `/posts/${postId}` : '/main')
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            제목
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label>
            여행일자
            <input
              type="date"
              value={form.travelDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, travelDate: event.target.value }))
              }
            />
          </label>
          <label>
            사진 업로드
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>
          {previewUrl ? (
            <div className="image-preview">
              <img alt="preview" src={previewUrl} />
            </div>
          ) : null}
          <div className="filter-grid form-filter-grid">
            <FilterSelect
              label="동행"
              options={lookupOptions.companions}
              value={form.companion}
              onChange={(value) => updateSelect('companion', value)}
            />
            <FilterSelect
              label="지역"
              options={lookupOptions.regions}
              value={form.region}
              onChange={(value) => updateSelect('region', value)}
            />
            <FilterSelect
              label="예산"
              options={lookupOptions.budgetRanges}
              value={form.budget}
              onChange={(value) => updateSelect('budget', value)}
            />
            <FilterSelect
              label="테마"
              options={lookupOptions.themes}
              value={form.theme}
              onChange={(value) => updateSelect('theme', value)}
            />
            <FilterSelect
              label="계절"
              options={lookupOptions.seasons}
              value={form.season}
              onChange={(value) => updateSelect('season', value)}
            />
          </div>
          <label>
            여행 내용
            <textarea
              placeholder="동선, 예산, 추천 포인트를 자유롭게 적어주세요."
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            />
          </label>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? '저장 중...' : isEditMode ? '수정 완료' : '등록하기'}
          </button>
        </form>
      </section>
    </main>
  )
}
