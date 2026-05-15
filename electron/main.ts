import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const devServerUrl = process.env.NOVA_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const hermesExecutableName = process.platform === 'win32' ? 'hermes.exe' : 'hermes'
const hermesBinDir = process.platform === 'win32' ? 'Scripts' : 'bin'

const getBundledHermesCommand = () => {
  if (process.env.HERMES_CLI_PATH) {
    return process.env.HERMES_CLI_PATH
  }

  const vendorRoot = isDev ? path.join(process.cwd(), 'vendor') : path.join(process.resourcesPath, 'vendor')

  return path.join(vendorRoot, 'hermes-agent', '.venv', hermesBinDir, hermesExecutableName)
}

const getBundledHermesHome = () => {
  if (process.env.HERMES_HOME) {
    return process.env.HERMES_HOME
  }

  const vendorRoot = isDev ? path.join(process.cwd(), 'vendor') : path.join(process.resourcesPath, 'vendor')

  return path.join(vendorRoot, 'hermes-home')
}

type HermesChatRequest = {
  requestId?: string
  prompt: string
  sessionId?: string | null
}

type HermesChatResponse = {
  text: string
  sessionId: string | null
}

const parseSessionId = (stderr: string) => {
  const match = stderr.match(/session_id:\s*([^\s]+)/i)
  return match?.[1] ?? null
}

const chatWithHermes = ({ prompt, requestId, sessionId }: HermesChatRequest, emitChunk?: (chunk: string) => void) =>
  new Promise<HermesChatResponse>((resolve, reject) => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      reject(new Error('Prompt is empty.'))
      return
    }

    const args = ['chat', '--query', trimmedPrompt, '--quiet', '--source', 'nova-desk']

    if (sessionId) {
      args.push('--resume', sessionId)
    }

    const hermesCommand = getBundledHermesCommand()
    const hermesHome = getBundledHermesHome()

    if (!fs.existsSync(hermesCommand)) {
      reject(
        new Error(
          `Bundled Hermes Agent is not ready at ${hermesCommand}. Run "pnpm setup:hermes", then "pnpm hermes -- setup" and "pnpm hermes -- model".`,
        ),
      )
      return
    }

    const child = spawn(hermesCommand, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMES_HOME: hermesHome,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Hermes Agent request timed out.'))
    }, 300_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      emitChunk?.(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(
        new Error(
          `Failed to start bundled Hermes Agent at ${hermesCommand}. Run "pnpm setup:hermes" in this project, then configure the bundled agent model. ${error.message}`,
        ),
      )
    })

    child.once('exit', (code) => {
      clearTimeout(timeout)

      const text = stdout.trim()
      const nextSessionId = parseSessionId(stderr) || sessionId || null

      if (code === 0) {
        resolve({ text, sessionId: nextSessionId })
        return
      }

      reject(new Error((stderr || stdout || `Hermes Agent exited with code ${code}`).trim()))
    })
  })

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#F5F7FB',
    title: 'Nova Desk',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    try {
      await window.loadURL(devServerUrl)
    } catch (error) {
      console.error(`Failed to load Vite dev server at ${devServerUrl}. Run pnpm start to launch both Vite and Electron.`, error)
      throw error
    }
    window.webContents.openDevTools({ mode: 'detach' })
    return
  }

  await window.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(async () => {
  ipcMain.handle('nova:runtime-info', () => ({
    appName: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }))

  ipcMain.handle('hermes:chat', (_event, request: HermesChatRequest) => chatWithHermes(request))
  ipcMain.handle('hermes:chat-stream', (event, request: HermesChatRequest) =>
    chatWithHermes(request, (chunk) => {
      if (request.requestId) {
        event.sender.send(`hermes:chat-stream:${request.requestId}:chunk`, chunk)
      }
    }),
  )

  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
