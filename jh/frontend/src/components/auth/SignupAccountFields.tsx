import { UserPlus } from 'lucide-react'

type SignupAccountFieldsProps = {
  password: string
  passwordConfirm: string
  termsAccepted: boolean
  isPasswordReady: boolean
  isPasswordMatched: boolean
  canSubmit: boolean
  onPasswordChange: (value: string) => void
  onPasswordConfirmChange: (value: string) => void
  onTermsAcceptedChange: (value: boolean) => void
}

export function SignupAccountFields({
  password,
  passwordConfirm,
  termsAccepted,
  isPasswordReady,
  isPasswordMatched,
  canSubmit,
  onPasswordChange,
  onPasswordConfirmChange,
  onTermsAcceptedChange,
}: SignupAccountFieldsProps) {
  return (
    <>
      <div className="signup-details-grid">
        <label className="field-group" htmlFor="signup-password">
          <span className="field-label-row">
            <span>비밀번호</span>
            <em>8자 이상, 특수문자 1개 이상</em>
          </span>
          <input
            id="signup-password"
            type="password"
            placeholder="비밀번호 입력"
            aria-invalid={password.length > 0 && !isPasswordReady}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>

        <label className="field-group" htmlFor="signup-password-confirm">
          <span>비밀번호 확인</span>
          <input
            id="signup-password-confirm"
            type="password"
            placeholder="비밀번호 다시 입력"
            aria-invalid={passwordConfirm.length > 0 && !isPasswordMatched}
            value={passwordConfirm}
            onChange={(event) => onPasswordConfirmChange(event.target.value)}
          />
        </label>
      </div>

      <label className="remember-check terms-check">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => onTermsAcceptedChange(event.target.checked)}
        />
        <span>이용약관과 개인정보 처리방침에 동의합니다.</span>
      </label>

      <button className="ui-button ui-button--primary primary-login-button" type="submit" disabled={!canSubmit}>
        <UserPlus size={16} aria-hidden="true" />
        <span>회원가입</span>
      </button>
    </>
  )
}
