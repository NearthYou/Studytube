import type { ChangeEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import type { Filters } from '../types/community'
import { localizeLookupOptions } from '../utils/i18n'
import type { Language } from '../utils/language'
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
  language: Language
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

const COPY = {
  ko: {
    loading: '불러오는 중',
    editEyebrow: '게시글 수정',
    createEyebrow: '게시글 작성',
    editTitle: '글 수정',
    createTitle: '여행 글쓰기',
    body: '',
    title: '제목',
    travelDate: '여행 날짜',
    imageUpload: '사진 업로드',
    companion: '동행',
    region: '지역',
    budget: '예산',
    theme: '테마',
    season: '계절',
    content: '여행 내용',
    contentPlaceholder: '내용을 입력하세요.',
    submitCreate: '등록하기',
    submitEdit: '수정 완료',
    submitting: '저장 중...',
    required: '필수 항목을 모두 입력해 주세요.',
    createDone: '게시글이 등록되었습니다.',
    editDone: '게시글이 수정되었습니다.',
    lookupError: '옵션을 불러오지 못했습니다.',
    loadPostError: '게시글을 불러오지 못했습니다.',
    all: '전체',
  },
  en: {
    loading: 'Loading',
    editEyebrow: 'Edit post',
    createEyebrow: 'Create post',
    editTitle: 'Edit post',
    createTitle: 'Write trip post',
    body: '',
    title: 'Title',
    travelDate: 'Travel date',
    imageUpload: 'Upload image',
    companion: 'Companion',
    region: 'Region',
    budget: 'Budget',
    theme: 'Theme',
    season: 'Season',
    content: 'Trip story',
    contentPlaceholder: 'Write your trip story.',
    submitCreate: 'Publish',
    submitEdit: 'Save changes',
    submitting: 'Saving...',
    required: 'Fill in every required field.',
    createDone: 'Post created.',
    editDone: 'Post updated.',
    lookupError: 'Failed to load options.',
    loadPostError: 'Failed to load the post.',
    all: 'All',
  },
} satisfies Record<Language, Record<string, string>>

export function WritePage({ onCreatePost, onUpdatePost, language }: WritePageProps) {
  const copy = COPY[language]
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
          window.alert(error instanceof Error ? error.message : copy.lookupError)
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
  }, [copy.lookupError])

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
          window.alert(error instanceof Error ? error.message : copy.loadPostError)
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
  }, [copy.loadPostError, isEditMode, navigate, postId])

  const localizedLookups: PostFilterLookups = {
    regions: localizeLookupOptions('region', lookupOptions.regions, language),
    themes: localizeLookupOptions('theme', lookupOptions.themes, language),
    budgetRanges: localizeLookupOptions('budget', lookupOptions.budgetRanges, language),
    seasons: localizeLookupOptions('season', lookupOptions.seasons, language),
    companions: localizeLookupOptions('companion', lookupOptions.companions, language),
  }

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
          <h1>{copy.loading}</h1>
        </section>
      </main>
    )
  }

  return (
    <main className="page form-page">
      <section className="form-card">
        <div className="form-card__header">
          <span>{isEditMode ? copy.editEyebrow : copy.createEyebrow}</span>
          <h1>{isEditMode ? copy.editTitle : copy.createTitle}</h1>
          {copy.body ? <p>{copy.body}</p> : null}
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
              window.alert(copy.required)
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

              const isSuccess = isEditMode ? await onUpdatePost(postId, payload) : await onCreatePost(payload)

              if (!isSuccess) {
                return
              }

              window.alert(isEditMode ? copy.editDone : copy.createDone)
              navigate(isEditMode ? `/posts/${postId}` : '/main')
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            {copy.title}
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            {copy.travelDate}
            <input type="date" value={form.travelDate} onChange={(event) => setForm((current) => ({ ...current, travelDate: event.target.value }))} />
          </label>
          <label>
            {copy.imageUpload}
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>
          {previewUrl ? (
            <div className="image-preview">
              <img alt="preview" src={previewUrl} />
            </div>
          ) : null}
          <div className="filter-grid form-filter-grid">
            <FilterSelect label={copy.companion} options={localizedLookups.companions} placeholder={copy.all} value={form.companion} onChange={(value) => updateSelect('companion', value)} />
            <FilterSelect label={copy.region} options={localizedLookups.regions} placeholder={copy.all} value={form.region} onChange={(value) => updateSelect('region', value)} />
            <FilterSelect label={copy.budget} options={localizedLookups.budgetRanges} placeholder={copy.all} value={form.budget} onChange={(value) => updateSelect('budget', value)} />
            <FilterSelect label={copy.theme} options={localizedLookups.themes} placeholder={copy.all} value={form.theme} onChange={(value) => updateSelect('theme', value)} />
            <FilterSelect label={copy.season} options={localizedLookups.seasons} placeholder={copy.all} value={form.season} onChange={(value) => updateSelect('season', value)} />
          </div>
          <label>
            {copy.content}
            <textarea placeholder={copy.contentPlaceholder} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} />
          </label>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? copy.submitting : isEditMode ? copy.submitEdit : copy.submitCreate}
          </button>
        </form>
      </section>
    </main>
  )
}
