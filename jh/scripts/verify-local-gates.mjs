#!/usr/bin/env node
import { spawn } from 'node:child_process'

const commands = [
  ['node', ['--check', 'scripts/verify-local-gates.mjs']],
  ['node', ['--check', 'scripts/live-smoke.mjs']],
  ['node', ['--check', 'scripts/test-live-smoke-upload.mjs']],
  ['node', ['--check', 'scripts/check-submission-manifest.mjs']],
  ['node', ['--check', 'scripts/test-submission-manifest.mjs']],
  ['node', ['scripts/test-live-smoke-upload.mjs']],
  ['node', ['scripts/test-submission-manifest.mjs']],
  ['node', ['scripts/check-submission-manifest.mjs']],
]

for (const [command, args] of commands) {
  await run(command, args)
}

console.log('Local release gate regression suite passed.')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const displayCommand = [command, ...args].join(' ')
    console.log(`$ ${displayCommand}`)

    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${displayCommand} exited with code ${code}`))
    })
  })
}
