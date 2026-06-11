import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { FilterSelect } from '../components/FilterSelect'
import type { Filters } from '../types/community'
import { fetchPostFilters, type PostFilterLookups } from '../utils/lookupsApi'
import '../styles/pages/WritePage.css'

type WritePageProps = {
  onCreatePost: (payload: {
    title: string
    travelDate: string
    imageUrl: string
    regionCode: string
    budgetCode: string
    themeCode: string
    season: string
    companion: string
    content: string
  }) => Promise<boolean>
}

const EMPTY_LOOKUPS: PostFilterLookups = {
  regions: [],
  themes: [],
  budgetRanges: [],
  seasons: [],
  companions: [],
}

export function WritePage({ onCreatePost }: WritePageProps) {
  const navigate = useNavigate()
  const [lookupOptions, setLookupOptions] = useState<PostFilterLookups>(EMPTY_LOOKUPS)
  const [isLoadingLookups, setIsLoadingLookups] = useState(true)
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
        if (!isMounted) {
          return
        }

        window.alert(error instanceof Error ? error.message : '작성 옵션을 불러오지 못했습니다.')
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

  return (
    <main className="page form-page">
      <section className="form-card">
        <div className="form-card__header">
          <span>WRITE POST</span>
          <h1>글쓰기</h1>
          <p>제목, 여행일자, 사진, 동행 여부, 지역, 예산, 테마, 계절, 여행 내용을 입력합니다.</p>
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
              window.alert('필수 입력값을 모두 채워주세요.')
              return
            }

            setIsSubmitting(true)

            try {
              const isSuccess = await onCreatePost({
                title: form.title.trim(),
                travelDate: form.travelDate,
                imageUrl: form.imageUrl || previewUrl,
                regionCode: form.region,
                budgetCode: form.budget,
                themeCode: form.theme,
                season: form.season,
                companion: form.companion,
                content: form.content.trim(),
              })

              if (!isSuccess) {
                return
              }

              window.alert('게시글이 등록되었습니다.')
              navigate('/main')
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
              label="동행 여부"
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
              placeholder="여행 내용, 동선, 추천 이유 등을 적어주세요."
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            />
          </label>
          <button className="primary-button" disabled={isLoadingLookups || isSubmitting} type="submit">
            {isSubmitting ? '등록 중...' : '등록하기'}
          </button>
        </form>
      </section>
    </main>
  )
}
