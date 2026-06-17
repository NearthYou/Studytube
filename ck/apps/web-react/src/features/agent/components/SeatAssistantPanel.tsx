import { useEffect, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent } from "react"
import { askSeatRecommendation } from "../api"
import type { SeatRecommendation } from "../types"
import "./seat-assistant-panel.css"

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  text: string
}

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatAssistantText(result: SeatRecommendation) {
  return result.recommendation
}

export default function SeatAssistantPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "궁금한 좌석을 편하게 물어보세요. 극장명, 층, 구역, 보고 싶은 기준을 한 문장으로 적으면 알아서 읽고 답할게요.",
    },
  ])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const messageEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [isOpen, messages, isLoading])

  async function submitQuestion(question: string) {
    const trimmedQuestion = question.trim()

    if (!trimmedQuestion || isLoading) {
      return
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: makeMessageId(),
        role: "user",
        text: trimmedQuestion,
      },
    ])
    setInput("")
    setError("")
    setIsLoading(true)

    try {
      const result = await askSeatRecommendation({
        question: trimmedQuestion,
        limit: 5,
        useRag: true,
      })

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: makeMessageId(),
          role: "assistant",
          text: formatAssistantText(result),
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : "답변을 불러오지 못했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitQuestion(input)
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submitQuestion(input)
    }
  }

  return (
    <>
      <button
        className="seat-assistant-launcher"
        type="button"
        aria-label={isOpen ? "AI 좌석 도우미 닫기" : "AI 좌석 도우미 열기"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>AI</span>
      </button>

      {isOpen ? (
        <section className="seat-assistant-chat" aria-label="AI 좌석 도우미">
          <header className="seat-assistant-chat-header">
            <div>
              <p>AI 좌석 도우미</p>
              <h2>무엇이 궁금해?</h2>
            </div>
            <button type="button" aria-label="AI 좌석 도우미 닫기" onClick={() => setIsOpen(false)}>
              ×
            </button>
          </header>

          <div className="seat-assistant-messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`seat-assistant-message seat-assistant-message--${message.role}`}
                key={message.id}
              >
                <p>{message.text}</p>
              </article>
            ))}

            {isLoading ? (
              <article className="seat-assistant-message seat-assistant-message--assistant">
                <div className="seat-assistant-typing" aria-label="답변 작성 중">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            ) : null}
            <div ref={messageEndRef} />
          </div>

          {error ? <p className="seat-assistant-error">{error}</p> : null}

          <form className="seat-assistant-composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="예: 블루스퀘어 2층 중앙 시야 괜찮아?"
              rows={1}
            />
            <button type="submit" disabled={isLoading || !input.trim()}>
              보내기
            </button>
          </form>
        </section>
      ) : null}
    </>
  )
}
