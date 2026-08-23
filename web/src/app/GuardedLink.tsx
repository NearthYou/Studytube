import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Link, NavLink, useLocation } from "react-router";
import { shouldIgnoreSamePageNavigation } from "../navigationGuards";

type GuardedLinkProps = {
  children: ReactNode;
  className?: string;
  to: string;
  "aria-label"?: string;
};

export function GuardedLink({
  children,
  className,
  to,
  "aria-label": ariaLabel,
}: GuardedLinkProps) {
  const location = useLocation();

  function ignoreSamePageClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (shouldIgnoreSamePageNavigation(location, to)) event.preventDefault();
  }

  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      to={to}
      onClick={ignoreSamePageClick}
    >
      {children}
    </Link>
  );
}

export function GuardedNavLink({
  children,
  to,
}: {
  children: ReactNode;
  to: string;
}) {
  const location = useLocation();

  function ignoreSamePageClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (shouldIgnoreSamePageNavigation(location, to)) event.preventDefault();
  }

  return (
    <NavLink to={to} onClick={ignoreSamePageClick}>
      {children}
    </NavLink>
  );
}
