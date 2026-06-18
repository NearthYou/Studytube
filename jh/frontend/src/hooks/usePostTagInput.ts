import { useRef, useState } from 'react'
import type { ChangeEvent, CompositionEvent, KeyboardEvent } from 'react'
import { createNextPostTags } from '../utils/postTags'

type UsePostTagInputOptions = {
  onChange: (tagNames: string[]) => void
  tagNames: string[]
}

export function usePostTagInput({ onChange, tagNames }: UsePostTagInputOptions) {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const isComposingRef = useRef(false)

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
    if (isComposingRef.current) {
      return
    }

    addTags(draft)
  }

  const handleDraftChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value

    if (!isComposingRef.current && !isComposingNativeEvent(event.nativeEvent) && nextValue.includes(',')) {
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
    if (isComposingRef.current || isComposingNativeEvent(event.nativeEvent) || isCompositionKey(event)) {
      return
    }

    if (event.key !== 'Enter' && event.key !== ',') {
      return
    }

    event.preventDefault()
    addTags(draft)
  }

  const handleDraftCompositionStart = () => {
    isComposingRef.current = true
  }

  const handleDraftCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false
    setDraft(event.currentTarget.value)
  }

  return {
    draft,
    handleDraftBlur,
    handleDraftChange,
    handleDraftCompositionEnd,
    handleDraftCompositionStart,
    handleDraftKeyDown,
    removeTag,
    status,
  }
}

function isComposingNativeEvent(event: Event) {
  return 'isComposing' in event && Boolean((event as { isComposing?: boolean }).isComposing)
}

function isCompositionKey(event: KeyboardEvent<HTMLInputElement>) {
  const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent & {
    keyCode?: number
  }

  return nativeEvent.keyCode === 229
}
