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
          window.alert(error instanceof Error ? error.message : 'Failed to load options.')
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
          window.alert(error instanceof Error ? error.message : 'Failed to load post.')
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
          <h1>Loading editor...</h1>
        </section>
      </main>
    )
  }

  return (
    <main className="page form-page">
      <section className="form-card">
        <div className="form-card__header">
          <span>{isEditMode ? 'EDIT POST' : 'WRITE POST'}</span>
          <h1>{isEditMode ? 'Edit Post' : 'Write Post'}</h1>
          <p>Fill in the trip information and save it to the board.</p>
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
              window.alert('Please fill in all required fields.')
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

              window.alert(isEditMode ? 'Post updated.' : 'Post created.')
              navigate(isEditMode ? `/posts/${postId}` : '/main')
            } finally {
              setIsSubmitting(false)
            }
          }}
        >
          <label>
            Title
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </label>
          <label>
            Travel Date
            <input
              type="date"
              value={form.travelDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, travelDate: event.target.value }))
              }
            />
          </label>
          <label>
            Upload Image
            <input accept="image/*" type="file" onChange={handleFileChange} />
          </label>
          {previewUrl ? (
            <div className="image-preview">
              <img alt="preview" src={previewUrl} />
            </div>
          ) : null}
          <div className="filter-grid form-filter-grid">
            <FilterSelect
              label="Companion"
              options={lookupOptions.companions}
              value={form.companion}
              onChange={(value) => updateSelect('companion', value)}
            />
            <FilterSelect
              label="Region"
              options={lookupOptions.regions}
              value={form.region}
              onChange={(value) => updateSelect('region', value)}
            />
            <FilterSelect
              label="Budget"
              options={lookupOptions.budgetRanges}
              value={form.budget}
              onChange={(value) => updateSelect('budget', value)}
            />
            <FilterSelect
              label="Theme"
              options={lookupOptions.themes}
              value={form.theme}
              onChange={(value) => updateSelect('theme', value)}
            />
            <FilterSelect
              label="Season"
              options={lookupOptions.seasons}
              value={form.season}
              onChange={(value) => updateSelect('season', value)}
            />
          </div>
          <label>
            Content
            <textarea
              placeholder="Write your trip route, budget, and recommendations."
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
            />
          </label>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Saving...' : isEditMode ? 'Update Post' : 'Create Post'}
          </button>
        </form>
      </section>
    </main>
  )
}
