import { useState } from 'react'
import { checkNickname } from '../api/auth'

type NicknameStatus = 'idle' | 'checked'

type UseNicknameCheckOptions = {
  runAsync: (callback: () => Promise<void>) => Promise<void>
  setStatus: (message: string) => void
}

export function useNicknameCheck({ runAsync, setStatus }: UseNicknameCheckOptions) {
  const [nickname, setNickname] = useState('')
  const [nicknameStatus, setNicknameStatus] = useState<NicknameStatus>('idle')
  const isNicknameChecked = nicknameStatus === 'checked'

  const handleNicknameCheck = async () => {
    if (!nickname.trim()) {
      setStatus('닉네임을 입력해 주세요.')
      return
    }

    await runAsync(async () => {
      const response = await checkNickname(nickname)

      setNicknameStatus('checked')
      setStatus(response.message)
    })
  }

  const handleNicknameChange = (value: string) => {
    setNickname(value)
    setNicknameStatus('idle')
    setStatus('')
  }

  const resetNicknameCheck = () => {
    setNicknameStatus('idle')
  }

  return {
    isNicknameChecked,
    nickname,
    nicknameStatus,
    handleNicknameChange,
    handleNicknameCheck,
    resetNicknameCheck,
  }
}
