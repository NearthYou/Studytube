import { useCallback, useState } from 'react'

export function useFeedbackModal() {
  const [modalMessage, setModalMessage] = useState('')

  const openErrorModal = useCallback((message: string) => {
    setModalMessage(message)
  }, [])

  const closeModal = useCallback(() => {
    setModalMessage('')
  }, [])

  return {
    closeModal,
    modalMessage,
    openErrorModal,
  }
}
