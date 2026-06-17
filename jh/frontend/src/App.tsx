import { matchRoute } from './routes'

function App() {
  return matchRoute(window.location.pathname)
}

export default App
