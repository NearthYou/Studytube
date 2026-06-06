import './App.css'
import { Link, Route, Routes } from "react-router"
import Hompage from './pages/Hompage'
import UsersPage from './pages/UsersPage'
import AboutPage from './pages/AboutPage'
import NotFoundPage from './pages/NotFoundPage'

function App() {

  return (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link> {" | "}
          <Link to="/about">About</Link> {" | "}
          <Link to="/users">Users</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Hompage/>}/>
        <Route path="/about" element={<AboutPage/>}/>
        <Route path="/users" element={<UsersPage/>}/>
        <Route path="*" element={<NotFoundPage/>}/>
      </Routes>
    </>
  )
}

export default App
