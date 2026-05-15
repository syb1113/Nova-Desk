import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const binDir = process.platform === 'win32' ? 'Scripts' : 'bin'
const executable = process.platform === 'win32' ? 'hermes.exe' : 'hermes'
const hermesPath = path.join(rootDir, 'vendor', 'hermes-agent', '.venv', binDir, executable)
const hermesHome = path.join(rootDir, 'vendor', 'hermes-home')

if (!fs.existsSync(hermesPath)) {
  console.error(`Bundled Hermes Agent is not ready at ${hermesPath}`)
  console.error('Run "pnpm setup:hermes" first.')
  process.exit(1)
}

const child = spawn(hermesPath, process.argv.slice(2), {
  cwd: rootDir,
  env: {
    ...process.env,
    HERMES_HOME: process.env.HERMES_HOME || hermesHome,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  },
  stdio: 'inherit',
  shell: false,
})

child.once('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.once('exit', (code) => {
  process.exit(code ?? 0)
})
