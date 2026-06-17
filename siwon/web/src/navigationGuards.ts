export type NavigationLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function shouldIgnoreSamePageNavigation(
  current: NavigationLocation,
  target: string,
) {
  const targetUrl = new URL(
    target,
    `https://studytube.local${current.pathname}${current.search ?? ''}${
      current.hash ?? ''
    }`,
  );

  if (normalizePathname(targetUrl.pathname) !== normalizePathname(current.pathname)) {
    return false;
  }

  if (!target.includes('?') && !target.includes('#')) {
    return true;
  }

  return (
    targetUrl.search === (current.search ?? '') &&
    targetUrl.hash === (current.hash ?? '')
  );
}

function normalizePathname(pathname: string) {
  if (pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/, '');
}
