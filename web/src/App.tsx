import { useEffect, useState } from "react";
import "./App.css";
import "./styles/theme.css";
import { AppRoutes } from "./app/AppRoutes";
import { SiteNav } from "./app/SiteNav";
import { normalizeSession, readSession, saveSession } from "./authSession";
import { logout, setUnauthorizedHandler } from "./api";
import { SESSION_STORAGE_KEY } from "./localStudyStorage";
import { ensureStudyTubeStorageEpoch } from "./studyStorageReset";
import type { Session, User } from "./types";

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    ensureStudyTubeStorageEpoch(window.localStorage, window.sessionStorage);
    return readSession();
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  function handleAuthComplete(nextSession: Session) {
    const normalizedSession = normalizeSession(nextSession);
    saveSession(normalizedSession);
    setSession(normalizedSession);
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
    }
  }

  function handleUserUpdate(user: User) {
    setSession((current) => {
      if (!current) return current;
      const nextSession = normalizeSession({ ...current, user });
      saveSession(nextSession);
      return nextSession;
    });
  }

  return (
    <>
      <SiteNav session={session} onLogout={handleLogout} />
      <AppRoutes
        session={session}
        onAuthComplete={handleAuthComplete}
        onSessionUpdate={handleUserUpdate}
      />
    </>
  );
}

export default App;
