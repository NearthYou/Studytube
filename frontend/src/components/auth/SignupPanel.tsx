import { FeedbackModal } from '../common/FeedbackModal'
import { useFeedbackModal } from '../../hooks/useFeedbackModal'
import { useSignupForm } from '../../hooks/useSignupForm'
import { EmailVerificationStep } from './EmailVerificationStep'
import { NicknameStep } from './NicknameStep'
import { ProfileImagePicker } from './ProfileImagePicker'
import { SignupAccountFields } from './SignupAccountFields'
import { SocialAuthLinks } from './SocialAuthLinks'
import { appPaths } from '../../utils/paths'

type SignupPanelProps = {
  onSignupComplete?: () => void
  onSwitchToLogin?: () => void
  presentation?: 'page' | 'modal'
  redirectPath?: string
}

export function SignupPanel({
  onSignupComplete,
  onSwitchToLogin,
  presentation = 'page',
  redirectPath = '/',
}: SignupPanelProps = {}) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
    canSubmit,
    email,
    isEmailVerified,
    isNicknameChecked,
    isPasswordMatched,
    isPasswordReady,
    isSubmitting,
    isVerificationCodeVisible,
    nickname,
    password,
    passwordConfirm,
    profileImage,
    signupStatus,
    signupStep,
    termsAccepted,
    verificationCode,
    handleEmailChange,
    handleEmailCodeRequest,
    handleNicknameChange,
    handleNicknameCheck,
    handleSubmit,
    handleVerificationConfirm,
    setPassword,
    setPasswordConfirm,
    setProfileImage,
    setSignupStatus,
    setTermsAccepted,
    setVerificationCode,
  } = useSignupForm({ onError: openErrorModal, onSignupComplete })
  const isModal = presentation === 'modal'

  return (
    <>
      <section
        className={isModal ? 'login-panel signup-panel login-panel--modal signup-panel--modal' : 'login-panel signup-panel'}
        aria-labelledby={isModal ? undefined : 'signup-title'}
      >
        {!isModal && <div className="login-copy">
          <p className="login-kicker">Tail Talk 회원가입</p>
          <h1 id="signup-title">꼬리톡에 새 이야기를 남겨보세요</h1>
          <p className="auth-description">이메일 인증을 완료한 뒤 동물 일상 사진 게시판에서 사용할 계정을 만들 수 있습니다.</p>

          <ProfileImagePicker image={profileImage} onChange={setProfileImage} onStatusChange={setSignupStatus} />
        </div>}

        <form className="login-form signup-form" data-signup-step={signupStep} onSubmit={handleSubmit}>
          {isModal && <ProfileImagePicker image={profileImage} onChange={setProfileImage} onStatusChange={setSignupStatus} />}
          <EmailVerificationStep
            email={email}
            verificationCode={verificationCode}
            isVerificationCodeVisible={isVerificationCodeVisible}
            isEmailVerified={isEmailVerified}
            isSubmitting={isSubmitting}
            onEmailChange={handleEmailChange}
            onVerificationCodeChange={setVerificationCode}
            onRequestCode={handleEmailCodeRequest}
            onConfirmCode={handleVerificationConfirm}
          />

          {isEmailVerified && (
            <NicknameStep
              nickname={nickname}
              isNicknameChecked={isNicknameChecked}
              isSubmitting={isSubmitting}
              onNicknameChange={handleNicknameChange}
              onCheckNickname={handleNicknameCheck}
            />
          )}

          {isNicknameChecked && (
            <SignupAccountFields
              password={password}
              passwordConfirm={passwordConfirm}
              termsAccepted={termsAccepted}
              isPasswordReady={isPasswordReady}
              isPasswordMatched={isPasswordMatched}
              canSubmit={canSubmit}
              onPasswordChange={setPassword}
              onPasswordConfirmChange={setPasswordConfirm}
              onTermsAcceptedChange={setTermsAccepted}
            />
          )}
          {signupStatus && (
            <p className="form-status" id="signup-status" role="status" aria-live="polite">
              {signupStatus}
            </p>
          )}
        </form>

        <p className="auth-divider">또는</p>
        <SocialAuthLinks mode="signup" redirectPath={redirectPath} />

        <div className="signup-row">
          <span>이미 계정이 있나요?</span>
          {onSwitchToLogin ? (
            <button className="auth-switch-button" type="button" onClick={onSwitchToLogin}>
              로그인
            </button>
          ) : (
            <a href={appPaths.login}>로그인</a>
          )}
        </div>
      </section>
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </>
  )
}
