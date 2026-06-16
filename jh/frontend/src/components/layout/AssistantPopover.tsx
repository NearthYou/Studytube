import { Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'
import type { AgentMessageResponse } from '../../api/agent'
import tailTalkLogo from '../../assets/tail_talk_logo.png'
import { assistantQuickPrompts } from '../../data/assistantPrompts'
import type { AssistantThreadMessage } from '../../hooks/useAssistantLauncher'

type AssistantPopoverProps = {
  closeButtonRef: RefObject<HTMLButtonElement | null>
  isSubmitting: boolean
  message: string
  messages: AssistantThreadMessage[]
  status: string
  onClose: () => void
  onMessageChange: (event: ChangeEvent<HTMLInputElement>) => void
  onPromptSelect: (prompt: string) => void
  onSubmit: () => Promise<void>
}

export function AssistantPopover({
  closeButtonRef,
  isSubmitting,
  message,
  messages,
  status,
  onClose,
  onMessageChange,
  onPromptSelect,
  onSubmit,
}: AssistantPopoverProps) {
  const threadRef = useRef<HTMLDivElement>(null)
  const isEmpty = messages.length === 0

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const thread = threadRef.current

      if (!thread) return

      thread.scrollTop = thread.scrollHeight
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isSubmitting, messages.length, status])

  return (
    <section
      className="assistant-popover"
      id="tail-talk-assistant-panel"
      aria-labelledby="tail-talk-assistant-title"
      role="dialog"
    >
      <div className="assistant-popover-header">
        <div className="assistant-popover-title">
          <img className="assistant-popover-logo" src={tailTalkLogo} alt="" />
          <div>
            <p>Tail Talk Assistant</p>
            <h2 id="tail-talk-assistant-title">궁금한 게시글을 빠르게 찾아보세요</h2>
          </div>
        </div>
        <button
          className="assistant-close-button"
          type="button"
          aria-label="Tail Talk Assistant 닫기"
          ref={closeButtonRef}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      {isEmpty && (
        <div className="assistant-intro">
          <div className="assistant-suggestion">
            <Sparkles size={17} aria-hidden="true" />
            <span>반려동물 행동, 건강 신호, 산책 장소, 게시글을 자연스럽게 물어보세요.</span>
          </div>

          <div className="assistant-prompt-list" aria-label="추천 질문">
            {assistantQuickPrompts.map((prompt) => (
              <button className="assistant-prompt-chip" type="button" key={prompt} onClick={() => onPromptSelect(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="assistant-thread" aria-label="챗봇 대화 내역" ref={threadRef}>
        {isEmpty ? (
          <p className="assistant-empty-message">안녕하세요. 궁금한 걸 한 문장으로 입력해 주세요.</p>
        ) : (
          messages.map((threadMessage) =>
            threadMessage.role === 'user' ? (
              <div className="assistant-message assistant-message--user" key={threadMessage.id}>
                <p>{threadMessage.content}</p>
              </div>
            ) : (
              <AssistantAnswer key={threadMessage.id} response={threadMessage.response} text={threadMessage.content} />
            ),
          )
        )}
      </div>

      {status && (
        <p className="assistant-status" role="status">
          {status}
        </p>
      )}

      <form
        className="assistant-input-row"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        <label className="assistant-input-label" htmlFor="tail-talk-assistant-input">
          꼬리톡 챗봇 입력
        </label>
        <input
          className="assistant-input"
          id="tail-talk-assistant-input"
          placeholder="예: 강아지 산책 게시글 보여줘"
          type="text"
          value={message}
          disabled={isSubmitting}
          onChange={onMessageChange}
        />
        <button className="assistant-send-button" type="submit" aria-label="챗봇 메시지 보내기" disabled={isSubmitting}>
          <Send size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}

function AssistantAnswer({ response, text }: { response?: AgentMessageResponse; text: string }) {
  const riskLevel = response?.riskLevel ?? 'none'

  return (
    <div className={`assistant-answer assistant-answer--${riskLevel}`}>
      <MarkdownText text={text} />
      {response?.observationChecklist && response.observationChecklist.length > 0 && (
        <div className="assistant-detail-block">
          <strong>관찰 체크리스트</strong>
          <ul>
            {response.observationChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response?.vetConsultCriteria && response.vetConsultCriteria.length > 0 && (
        <div className="assistant-detail-block assistant-detail-block--caution">
          <strong>상담 기준</strong>
          <ul>
            {response.vetConsultCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {response?.cards && response.cards.length > 0 && (
        <div className="assistant-card-list" aria-label="Assistant 추천 링크">
          {response.cards.map((card) => (
            <a className="assistant-card" href={card.href} key={`${card.type}-${card.id}`}>
              <span>{card.type === 'place' ? '장소' : '게시글'}</span>
              <strong>{card.title}</strong>
            </a>
          ))}
        </div>
      )}
      {response?.sources && response.sources.length > 0 && (
        <ul className="assistant-source-list" aria-label="Assistant 참고 내용">
          {response.sources.map((source) => (
            <li key={`${source.title}-${source.excerpt ?? source.url ?? source.year ?? ''}`}>
              <strong>{source.year ? `${source.title} (${source.year})` : source.title}</strong>
              {source.excerpt && <span>{source.excerpt}</span>}
              {source.url && <span>{source.url}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MarkdownText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let paragraphLines: string[] = []
  let listItems: string[] = []
  let listType: 'ol' | 'ul' | null = null

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return

    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInlineMarkdown(paragraphLines.join(' '))}
      </p>,
    )
    paragraphLines = []
  }

  const flushList = () => {
    if (!listType || listItems.length === 0) return

    const ListTag = listType
    blocks.push(
      <ListTag key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ListTag>,
    )
    listItems = []
    listType = null
  }

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      return
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const HeadingTag = heading[1].length === 2 ? 'h3' : 'h4'
      blocks.push(
        <HeadingTag key={`heading-${blocks.length}`}>
          {renderInlineMarkdown(heading[2])}
        </HeadingTag>,
      )
      return
    }

    const unorderedItem = line.match(/^[-*]\s+(.+)$/)
    if (unorderedItem) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(unorderedItem[1])
      return
    }

    const orderedItem = line.match(/^\d+[.)]\s+(.+)$/)
    if (orderedItem) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(orderedItem[1])
      return
    }

    flushList()
    paragraphLines.push(line)
  })

  flushParagraph()
  flushList()

  return <div className="assistant-markdown">{blocks}</div>
}

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue

    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index))
    }

    if (match[0].startsWith('**')) {
      nodes.push(
        <strong key={`strong-${match.index}`}>
          {match[0].slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <em key={`em-${match.index}`}>
          {match[0].slice(1, -1)}
        </em>,
      )
    }
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes.length > 0 ? nodes : text
}
