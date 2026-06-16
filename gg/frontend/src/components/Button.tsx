import { useNavigate } from "react-router"
import "../styles/components/button.css"

type ButtonProps = {
  text?: string
  type?: "next" | "back"
}

export default function Button({text = "버튼", type = "next"}: ButtonProps) {
  const navigate = useNavigate()

  function move_next() {
    if (type === "back") {
      navigate(-1)
      return
    }
    navigate('/about')
  }

  return (
    <button className="app-button" onClick={move_next}>
      {text}
    </button>
  )
}