type NicknameStepProps = {
  nickname: string
  isNicknameChecked: boolean
  isSubmitting: boolean
  onNicknameChange: (value: string) => void
  onCheckNickname: () => void
}

export function NicknameStep({
  nickname,
  isNicknameChecked,
  isSubmitting,
  onNicknameChange,
  onCheckNickname,
}: NicknameStepProps) {
  return (
    <div className="nickname-check-box">
      <div className="field-group">
        <label htmlFor="signup-nickname">닉네임</label>
        <div className="inline-field">
          <input
            id="signup-nickname"
            type="text"
            placeholder="게시판에서 사용할 이름"
            aria-describedby="signup-status"
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            disabled={isNicknameChecked}
          />
          <button
            className="ui-button ui-button--secondary secondary-action-button"
            type="button"
            onClick={onCheckNickname}
            disabled={isNicknameChecked || isSubmitting}
          >
            {isNicknameChecked ? '확인 완료' : '중복확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
