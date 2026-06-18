import { lazy, Suspense, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom"
import { getCurrentUser } from "./features/auth/api"
import AuthPage from "./features/auth/AuthPage"
import ReviewBoardPage from "./features/reviews/ReviewBoardPage"

const ReviewCreatePage = lazy(() => import("./features/reviews/ReviewCreatePage"))
const TheaterReviewsPage = lazy(() => import("./features/reviews/TheaterReviewsPage"))
const AdminPage = lazy(() => import("./features/admin/AdminPage"))

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "guest">("checking")

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      await Promise.resolve()

      if (!isMounted) {
        return
      }

      setAuthStatus("checking")

      try {
        await getCurrentUser()

        if (isMounted) {
          setAuthStatus("authenticated")
        }
      } catch {
        if (isMounted) {
          setAuthStatus("guest")
        }
      }
    }

    void checkSession()

    return () => {
      isMounted = false
    }
  }, [location.pathname])

  if (authStatus === "checking") {
    return <main>Checking session...</main>
  }

  return authStatus === "authenticated" ? (
    children
  ) : (
    <Navigate
      to="/auth"
      replace
      state={{ redirectTo: `${location.pathname}${location.search}` }}
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ReviewBoardPage />} />
        <Route
          path="/theaters/:theaterId"
          element={
            <Suspense fallback={<main>Loading theater reviews...</main>}>
              <TheaterReviewsPage />
            </Suspense>
          }
        />
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <Suspense fallback={<main>Loading admin tools...</main>}>
                <AdminPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/reviews/new"
          element={
            <RequireAuth>
              <Suspense fallback={<main>Loading review editor...</main>}>
                <ReviewCreatePage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/reviews/:reviewId/edit"
          element={
            <RequireAuth>
              <Suspense fallback={<main>Loading review editor...</main>}>
                <ReviewCreatePage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
