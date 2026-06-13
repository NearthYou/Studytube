import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { createNextPostTags } from '../utils/postTags'

type UsePostTagInputOptions = {
  onChange: (tagNames: string[]) => void
  tagNames: string[]
}

export function usePostTagInput({ onChange, tagNames }: UsePostTagInputOptions) {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')

  const addTags = (value: string) => {
    const result = createNextPostTags(tagNames, value)

    if (!result.hasCandidates) {
      setDraft('')
      return
    }

    if (result.nextTags.length !== tagNames.length) {
      onChange(result.nextTags)
    }

    setDraft('')
    setStatus(result.status)
  }

  const removeTag = (tagName: string) => {
    onChange(tagNames.filter((item) => item !== tagName))
    setStatus('')
  }

  const handleDraftBlur = () => {
    addTags(draft)
  }

  const handleDraftChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value

    if (nextValue.includes(',')) {
      const parts = nextValue.split(',')
      const pendingDraft = parts.pop() ?? ''

      addTags(parts.join(','))
      setDraft(pendingDraft)
      return
    }

    setDraft(nextValue)
    setStatus('')
  }

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== ',') {
      return
    }

    event.preventDefault()
    addTags(draft)
  }

  return {
    draft,
    handleDraftBlur,
    handleDraftChange,
    handleDraftKeyDown,
    removeTag,
    status,
  }
}
