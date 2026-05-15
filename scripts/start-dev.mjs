import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

const host = '127.0.0.1'
const preferredPort = 5173
const children = new Set()

const command = 'pnpm'
const useShell = process.platform === 'win32'
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const hermesPath = path.join(
  process.cwd(),
  'vendor',
  'hermes-agent',
  '.venv',
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'hermes.exe' : 'hermes',
)

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port })

    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })

const waitForPort = async (port, timeoutMs = 30_000) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Timed out waiting for http://${host}:${port}`)
}

const findAvailablePort = (startPort) =>
  new Promise((resolve, reject) => {
    const probe = (port) => {
      const server = net.createServer()

      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          probe(port + 1)
          return
        }

        reject(error)
      })

      server.once('listening', () => {
        server.close(() => resolve(port))
      })

      server.listen(port, host)
    }

    probe(startPort)
  })

const runOnce = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: useShell,
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

const runLongLived = (args) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: useShell,
  })

  children.add(child)
  child.once('exit', () => children.delete(child))

  return child
}

const runElectron = (devServerUrl) => {
  const child = spawn(electronPath, ['.'], {
    env: {
      ...process.env,
      NOVA_DEV_SERVER_URL: devServerUrl,
    },
    stdio: 'inherit',
    shell: false,
  })

  children.add(child)
  child.once('exit', () => children.delete(child))

  return child
}

const cleanup = () => {
  for (const child of children) {
    child.kill()
  }
}

process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})

process.once('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

try {
  if (!fs.existsSync(hermesPath)) {
    console.log('[nova] preparing embedded Hermes Agent runtime...')
    await runOnce(['setup:hermes'])
  }

  console.log('[nova] compiling Electron main process...')
  await runOnce(['exec', 'tsc', '-p', 'tsconfig.electron.json'])

  const port = await findAvailablePort(preferredPort)
  const devServerUrl = `http://${host}:${port}`

  console.log(`[nova] starting Vite at ${devServerUrl}...`)
  runLongLived(['exec', 'vite', '--host', host, '--port', String(port), '--strictPort'])
  await waitForPort(port)

  console.log('[nova] launching Electron...')
  const electron = runElectron(devServerUrl)

  electron.once('exit', (code) => {
    console.log(`[nova] Electron exited with code ${code ?? 0}`)
    cleanup()
    process.exit(code ?? 0)
  })
} catch (error) {
  cleanup()
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
