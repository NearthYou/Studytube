import { FeedbackModal } from '../common/FeedbackModal'
import { useFeedbackModal } from '../../hooks/useFeedbackModal'
import { useAssistantLauncher } from '../../hooks/useAssistantLauncher'
import { AssistantPopover } from './AssistantPopover'
import { AssistantTrigger } from './AssistantTrigger'

type AssistantLauncherProps = {
  layoutVariant: 'feed' | 'board'
}

export function AssistantLauncher({ layoutVariant }: AssistantLauncherProps) {
  const { closeModal, modalMessage, openErrorModal } = useFeedbackModal()
  const {
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
  } = useAssistantLauncher({ onError: openErrorModal })

  return (
    <div className={`assistant-launcher assistant-launcher--${layoutVariant}`}>
      <AssistantTrigger isOpen={isOpen} triggerRef={triggerRef} onToggle={toggleAssistant} />

      {isOpen && (
        <AssistantPopover
          closeButtonRef={closeButtonRef}
          isSubmitting={isSubmitting}
          message={message}
          messages={messages}
          status={status}
          onClose={closeAssistant}
          onMessageChange={handleMessageChange}
          onPromptSelect={handlePromptSelect}
          onSubmit={handleSubmit}
        />
      )}
      {modalMessage && <FeedbackModal message={modalMessage} onClose={closeModal} />}
    </div>
  )
}
