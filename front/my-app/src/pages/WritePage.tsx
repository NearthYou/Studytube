import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { BUDGETS, COMPANIONS, REGIONS, SEASONS, THEMES } from '../data/mockData'
import { FilterSelect } from '../components/FilterSelect'
import type { Filters } from '../types/community'
import '../styles/pages/WritePage.css'

type WritePageProps = {
  onCreatePost: (payload: {
    title: string
    travelDate: string
    imageUrl: string
    region: string
    budget: string
    theme: string
    season: string
    companion: string
    content: string
  }) => void
}

export function WritePage({ onCreatePost }: WritePageProps) {
  const navigate = useNavigate()
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
          onSubmit={(event) => {
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
            onCreatePost({
              ...form,
              title: form.title.trim(),
              content: form.content.trim(),
              imageUrl: form.imageUrl || previewUrl,
            })
            window.alert('게시글이 등록되었습니다.')
            navigate('/main')
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
              options={COMPANIONS}
              value={form.companion}
              onChange={(value) => updateSelect('companion', value)}
            />
            <FilterSelect
              label="지역"
              options={REGIONS}
              value={form.region}
              onChange={(value) => updateSelect('region', value)}
            />
            <FilterSelect
              label="예산"
              options={BUDGETS}
              value={form.budget}
              onChange={(value) => updateSelect('budget', value)}
            />
            <FilterSelect
              label="테마"
              options={THEMES}
              value={form.theme}
              onChange={(value) => updateSelect('theme', value)}
            />
            <FilterSelect
              label="계절"
              options={SEASONS}
              value={form.season}
              onChange={(value) => updateSelect('season', value)}
            />
          </div>
          <label>
            여행 내용
            <textarea
              placeholder="여행 내용, 동선, 추천 이유 등을 작성해주세요."
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            />
          </label>
          <button className="primary-button" type="submit">
            등록하기
          </button>
        </form>
      </section>
    </main>
  )
}
