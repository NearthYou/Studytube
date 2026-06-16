type EmailVerificationStepProps = {
  email: string
  verificationCode: string
  isVerificationCodeVisible: boolean
  isEmailVerified: boolean
  isSubmitting: boolean
  onEmailChange: (value: string) => void
  onVerificationCodeChange: (value: string) => void
  onRequestCode: () => void
  onConfirmCode: () => void
}

export function EmailVerificationStep({
  email,
  verificationCode,
  isVerificationCodeVisible,
  isEmailVerified,
  isSubmitting,
  onEmailChange,
  onVerificationCodeChange,
  onRequestCode,
  onConfirmCode,
}: EmailVerificationStepProps) {
  return (
    <div className="email-verification-box">
      <div className="verification-heading">
        <span>이메일 인증</span>
        <strong>{isEmailVerified ? '완료' : '필수'}</strong>
      </div>

      <div className="field-group">
        <label htmlFor="signup-email">이메일</label>
        <div className="inline-field">
          <input
            id="signup-email"
            type="email"
            placeholder="name@example.com"
            aria-describedby="signup-status"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={isEmailVerified}
          />
          <button
            className="ui-button ui-button--secondary secondary-action-button"
            type="button"
            onClick={onRequestCode}
            disabled={isEmailVerified || isSubmitting}
          >
            {isVerificationCodeVisible ? '재발송' : '인증번호 발송'}
          </button>
        </div>
      </div>

      {isVerificationCodeVisible && (
        <div className="field-group">
          <label htmlFor="verification-code">인증번호</label>
          <div className="inline-field">
            <input
              id="verification-code"
              inputMode="numeric"
              placeholder="6자리 인증번호"
              aria-describedby="signup-status"
              value={verificationCode}
              onChange={(event) => onVerificationCodeChange(event.target.value)}
              disabled={isEmailVerified}
            />
            <button
              className="ui-button ui-button--secondary secondary-action-button"
              type="button"
              onClick={onConfirmCode}
              disabled={isEmailVerified || isSubmitting}
            >
              {isEmailVerified ? '인증 완료' : '확인'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
