import { useEffect, useState } from "react";
import "./App.css";
import "./styles/theme.css";
import { AppRoutes } from "./app/AppRoutes";
import { SiteNav } from "./app/SiteNav";
import { normalizeSession, readSession, saveSession } from "./authSession";
import { logout, setUnauthorizedHandler } from "./api";
import { SESSION_STORAGE_KEY } from "./localStudyStorage";
import {
  clearStudyTubeStorage,
  ensureStudyTubeStorageEpoch,
} from "./studyStorageReset";
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

  function handleAccountDeleted() {
    clearStudyTubeStorage(window.localStorage);
    clearStudyTubeStorage(window.sessionStorage);
    setSession(null);
  }

  return (
    <>
      <SiteNav session={session} onLogout={handleLogout} />
      <AppRoutes
        session={session}
        onAuthComplete={handleAuthComplete}
        onSessionUpdate={handleUserUpdate}
        onAccountDeleted={handleAccountDeleted}
      />
    </>
  );
}

export default App;
