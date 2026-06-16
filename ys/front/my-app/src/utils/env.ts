const PUBLIC_ENV = import.meta.env as Record<string, string | boolean | undefined>

function getPublicEnv(name: string, developmentDefault: string) {
  const value = PUBLIC_ENV[name]

  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (import.meta.env.PROD) {
    throw new Error(`${name} is required for production builds.`)
  }

  return developmentDefault
}

export const API_BASE_URL = getPublicEnv('VITE_API_BASE_URL', 'http://localhost:3000/api')
export const AI_BASE_URL = getPublicEnv('VITE_AI_BASE_URL', 'http://localhost:8000')
