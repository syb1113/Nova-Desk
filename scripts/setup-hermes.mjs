import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoUrl = 'https://github.com/NousResearch/hermes-agent.git'
const rootDir = process.cwd()
const vendorDir = path.join(rootDir, 'vendor')
const hermesDir = path.join(vendorDir, 'hermes-agent')
const hermesHomeDir = path.join(vendorDir, 'hermes-home')
const venvDir = path.join(hermesDir, '.venv')
const binDir = process.platform === 'win32' ? 'Scripts' : 'bin'
const pythonExe = path.join(venvDir, binDir, process.platform === 'win32' ? 'python.exe' : 'python')
const hermesExe = path.join(venvDir, binDir, process.platform === 'win32' ? 'hermes.exe' : 'hermes')
const force = process.argv.includes('--force')

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        PYTHONUTF8: '1',
      },
      stdio: 'inherit',
      shell: false,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })

const findPython = async () => {
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3.11', '--version']],
          ['py', ['-3', '--version']],
          ['python', ['--version']],
        ]
      : [
          ['python3.11', ['--version']],
          ['python3', ['--version']],
          ['python', ['--version']],
        ]

  for (const [command, args] of candidates) {
    try {
      await run(command, args)
      return { command, prefixArgs: command === 'py' ? [args[0]] : [] }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('Python 3.11+ was not found. Hermes Agent requires Python >=3.11.')
}

fs.mkdirSync(vendorDir, { recursive: true })
fs.mkdirSync(hermesHomeDir, { recursive: true })

if (!fs.existsSync(hermesDir)) {
  await run('git', ['clone', '--depth', '1', repoUrl, hermesDir])
} else {
  console.log(`Using existing Hermes Agent checkout at ${hermesDir}`)
}

if (fs.existsSync(hermesExe) && !force) {
  console.log(`Hermes Agent is ready: ${hermesExe}`)
  process.exit(0)
}

if (!fs.existsSync(pythonExe)) {
  const python = await findPython()
  await run(python.command, [...python.prefixArgs, '-m', 'venv', venvDir])
}

await run(pythonExe, ['-m', 'ensurepip', '--upgrade', '--default-pip'])
await run(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'])
await run(pythonExe, ['-m', 'pip', 'install', '-e', '.[cli,pty]'], { cwd: hermesDir })

if (!fs.existsSync(hermesExe)) {
  throw new Error(`Hermes executable was not created at ${hermesExe}`)
}

console.log(`Hermes Agent is ready: ${hermesExe}`)
