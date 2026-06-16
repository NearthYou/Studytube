type NavigateOptions = {
  replace?: boolean
}

export function navigate(path: string, options: NavigateOptions = {}) {
  if (options.replace) {
    window.location.replace(path)
    return
  }

  window.location.assign(path)
}

export function replaceCurrentPath(path: string) {
  window.history.replaceState(null, '', path)
}

export function getCurrentPathWithSearch() {
  return `${window.location.pathname}${window.location.search}`
}
