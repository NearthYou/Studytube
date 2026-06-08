import { useState } from 'react'
import '../styles/pages/ChatPage.css'

export function ChatPage() {
  const [message, setMessage] = useState('여름에 친구랑 갈 만한 10-20만원 바다 여행지 추천해줘')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: '추후 GPT API와 연결될 화면입니다. 지금은 대화형 레이아웃과 추천 응답 분위기만 먼저 구성해두었습니다.',
    },
  ])

  return (
    <main className="page chat-page">
      <section className="chat-shell">
        <div className="chat-shell__header">
          <span>TRAVEL RECOMMEND BOT</span>
          <h1>여행추천봇</h1>
          <p>대화형으로 원하는 여행지를 추천받을 수 있도록 채팅 UI로 구성했습니다.</p>
        </div>
        <div className="chat-window">
          {messages.map((item, index) => (
            <div className={`chat-bubble ${item.role}`} key={`${item.role}-${index}`}>
              {item.text}
            </div>
          ))}
        </div>
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!message.trim()) {
              return
            }
            setMessages((current) => [
              ...current,
              { role: 'user', text: message.trim() },
              {
                role: 'assistant',
                text: '현재는 프론트 단계라 고정 응답이 들어가지만, 이후 GPT API와 연결하면 예산, 지역, 동행 여부에 맞춘 추천으로 바꿀 수 있습니다.',
              },
            ])
            setMessage('')
          }}
        >
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
          <button className="primary-button" type="submit">
            보내기
          </button>
        </form>
      </section>
    </main>
  )
}
