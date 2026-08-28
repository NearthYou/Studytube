import { Navigate, Route, Routes } from "react-router";
import { MyEditPage } from "../features/account/MyEditPage";
import { MyPage } from "../features/account/MyPage";
import { AuthPage } from "../features/auth/AuthPage";
import { RegistrationCompletionPage } from "../features/auth/RegistrationCompletionPage";
import { VerificationPage } from "../features/auth/VerificationPage";
import { CourseBuilderPage } from "../features/course/CoursePage";
import { CourseLibraryPage } from "../features/course/CourseLibraryPage";
import { LearningPage } from "../features/learning/LearningPage";
import { LearningWorkspace } from "../features/learning/LearningWorkspace";
import { TutorialPage } from "../features/onboarding/TutorialPage";
import type { Session, User } from "../types";
import { ProtectedRoute } from "./ProtectedRoute";

type AppRoutesProps = {
  session: Session | null;
  onAuthComplete: (session: Session) => void;
  onSessionUpdate: (user: User) => void;
};

export function AppRoutes({
  session,
  onAuthComplete,
  onSessionUpdate,
}: AppRoutesProps) {
  return (
    <Routes>
      <Route
        path="/login"
        element={<AuthPage mode="login" onComplete={onAuthComplete} />}
      />
      <Route
        path="/signup"
        element={<AuthPage mode="signup" onComplete={onAuthComplete} />}
      />
      <Route path="/signup/verify" element={<VerificationPage />} />
      <Route
        path="/signup/complete"
        element={<RegistrationCompletionPage onComplete={onAuthComplete} />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute session={session}>
            <LearningPage session={session!} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tutorial"
        element={
          <ProtectedRoute session={session}>
            <TutorialPage
              session={session!}
              onSessionUpdate={onSessionUpdate}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/courses"
        element={
          <ProtectedRoute session={session}>
            <CourseLibraryPage session={session!} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/courses/new"
        element={
          <ProtectedRoute session={session}>
            <CourseBuilderPage session={session!} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/watch"
        element={
          <ProtectedRoute session={session}>
            <LearningWorkspace session={session!} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/me"
        element={
          <ProtectedRoute session={session}>
            <MyPage session={session!} onSessionUpdate={onSessionUpdate} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/me/edit"
        element={
          <ProtectedRoute session={session}>
            <MyEditPage session={session!} onSessionUpdate={onSessionUpdate} />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
