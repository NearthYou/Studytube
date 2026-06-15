import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  if (command === 'build') {
    const missingKeys = ['VITE_API_BASE_URL', 'VITE_AI_BASE_URL'].filter(
      (key) => !env[key]?.trim(),
    )

    if (missingKeys.length > 0) {
      throw new Error(`Missing required build env: ${missingKeys.join(', ')}`)
    }
  }

  return {
    plugins: [react()],
  }
})
