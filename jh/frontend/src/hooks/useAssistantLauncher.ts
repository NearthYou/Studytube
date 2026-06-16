import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { sendAgentMessage } from '../api/agent'
import type { AgentMessageResponse } from '../api/agent'
import { isUnauthorizedApiError } from '../api/response'
import { getStoredAccessToken, redirectToLogin } from '../utils/authStorage'
import { getErrorMessage } from '../utils/error'

type UseAssistantLauncherOptions = {
  onError?: (message: string) => void
}

export type AssistantThreadMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: AgentMessageResponse
}

export function useAssistantLauncher({ onError }: UseAssistantLauncherOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [messages, setMessages] = useState<AssistantThreadMessage[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)

  const closeAssistant = useCallback(() => {
    shouldRestoreFocusRef.current = true
    setIsOpen(false)
  }, [])

  const toggleAssistant = () => {
    setIsOpen((current) => {
      if (current) {
        shouldRestoreFocusRef.current = true
        return false
      }

      return true
    })
  }

  const handleMessageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(event.target.value)
    setStatus('')
  }

  const handlePromptSelect = (prompt: string) => {
    setMessage(prompt)
    setStatus('')
  }

  const handleSubmit = async () => {
    const trimmedMessage = message.trim()

    if (!trimmedMessage) {
      setStatus('궁금한 내용을 입력해 주세요.')
      return
    }

    if (!getStoredAccessToken()) {
      setStatus('Assistant를 사용하려면 로그인이 필요합니다.')
      redirectToLogin(getAssistantRedirectPath())
      return
    }

    const userThreadMessage: AssistantThreadMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: trimmedMessage,
    }
    const currentMessages = [...messages, userThreadMessage]

    setMessages(currentMessages)
    setMessage('')
    setIsSubmitting(true)
    setStatus('Assistant가 안전하게 확인하고 있어요.')

    try {
      const nextResponse = await sendAgentMessage({
        message: trimmedMessage,
        history: currentMessages.slice(-8).map(({ role, content }) => ({ role, content })),
        context: getAssistantContext(),
      })

      setMessages((current) => [
        ...current,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: nextResponse.answer,
          response: nextResponse,
        },
      ])
      setStatus('')
    } catch (error) {
      if (isUnauthorizedApiError(error)) {
        setStatus('로그인이 만료되었습니다. 다시 로그인해주세요.')
        redirectToLogin(getAssistantRedirectPath())
        return
      }

      onError?.(getErrorMessage(error, 'Assistant 응답을 불러오지 못했습니다.'))
      const fallbackResponse: AgentMessageResponse = {
        answer:
          'Assistant 베타 연결이 잠시 불안정합니다. 건강이나 안전과 관련된 내용은 단정하지 말고 동물병원 상담을 우선해 주세요.',
        riskLevel: 'caution',
        usedTools: [],
        message: 'Assistant 응답을 불러오지 못했습니다.',
      }
      setMessages((current) => [
        ...current,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: fallbackResponse.answer,
          response: fallbackResponse,
        },
      ])
      setStatus('Assistant 베타 응답을 안전한 안내로 대체했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (isOpen) return

    if (!shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAssistant()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeAssistant, isOpen])

  return {
    closeAssistant,
    closeButtonRef,
    handleMessageChange,
    handlePromptSelect,
    handleSubmit,
    isOpen,
    isSubmitting,
    message,
    messages,
    status,
    toggleAssistant,
    triggerRef,
  }
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getAssistantContext() {
  const postMatch = window.location.pathname.match(/^\/posts\/([^/]+)/)
  const searchParams = new URLSearchParams(window.location.search)
  const categoryId = searchParams.get('categoryId') ?? undefined

  return {
    route: window.location.pathname,
    postId: postMatch?.[1],
    categoryId,
  }
}

function getAssistantRedirectPath() {
  return `${window.location.pathname}${window.location.search}`
}
