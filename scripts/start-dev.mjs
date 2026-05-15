import { spawn } from 'node:child_process'
import net from 'node:net'
import process from 'node:process'

const host = '127.0.0.1'
const port = 5173
const children = new Set()

const command = 'pnpm'
const useShell = process.platform === 'win32'

const isPortOpen = () =>
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

const waitForPort = async (timeoutMs = 30_000) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Timed out waiting for http://${host}:${port}`)
}

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
  await runOnce(['exec', 'tsc', '-p', 'tsconfig.electron.json'])

  const viteAlreadyRunning = await isPortOpen()

  if (!viteAlreadyRunning) {
    runLongLived(['dev:web', '--', '--host', host, '--port', String(port)])
    await waitForPort()
  }

  const electron = runLongLived(['start'])

  electron.once('exit', (code) => {
    cleanup()
    process.exit(code ?? 0)
  })
} catch (error) {
  cleanup()
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
