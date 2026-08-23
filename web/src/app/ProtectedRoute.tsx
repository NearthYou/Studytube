import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Session } from "../types";

export function ProtectedRoute({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  const location = useLocation();

  if (!session) {
    return (
      <Navigate
        replace
        state={{ from: location.pathname + location.search + location.hash }}
        to="/login"
      />
    );
  }

  return children;
}
