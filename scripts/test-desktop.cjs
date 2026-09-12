const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-desktop-test-'))
app.setPath('userData', data)
let pending
let count = 0
const calls = []
ipcMain.handle('nova:runtime-info', () => ({ appName: 'test', version: 'test', platform: process.platform }))
ipcMain.handle('hermes:chat-stream', (event, request) => {
  calls.push(request)
  count++
  if (count === 3) throw new Error('测试网络故障')
  if (count === 4) return { text: '重试成功', sessionId: '00000000-0000-4000-8000-000000000001' }
  return new Promise((resolve) => {
    pending = { resolve, request }
    event.sender.send(`hermes:event:${request.requestId}`, { type: 'delta', text: '实时回答' })
    if (count === 1) event.sender.send(`hermes:event:${request.requestId}`, { type: 'approval', id: 'approval-one', command: 'echo test', description: '测试确认交互' })
  })
})
ipcMain.handle('hermes:reply', (_event, requestId, id, value) => {
  assert.equal(requestId, pending.request.requestId)
  assert.equal(id, 'approval-one')
  assert.equal(value, 'once')
  pending.resolve({ text: '回答完成', sessionId: '00000000-0000-4000-8000-000000000001' })
  return true
})
ipcMain.handle('hermes:cancel', () => { pending.resolve({ text: '', sessionId: pending.request.sessionId, cancelled: true }); return true })

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 920, webPreferences: {
    preload: path.resolve('dist-electron/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false,
  } })
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  const waitFor = async (code) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await new Promise((r) => setTimeout(r, 50)) }
    throw new Error(`UI condition timed out: ${code}`)
  }
  const clickText = (text) => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`)
  const fill = (selector, value, textarea = false) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const send = async (text) => {
    await fill('textarea', text, true)
    await evaluate("document.querySelector('textarea').form.requestSubmit()")
  }
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await waitFor("Boolean(document.querySelector('textarea'))")
    await clickText('配置模型')
    await waitFor("Boolean(document.querySelector('input[placeholder=\"输入你的 API Key\"]'))")
    await fill('input[placeholder="输入你的 API Key"]', 'test-key')
    await clickText('保存')
    await waitFor("!document.querySelector('input[placeholder=\"输入你的 API Key\"]')")
    await send('第一轮')
    await waitFor("document.body.textContent.includes('实时回答') && document.body.textContent.includes('允许本次')")
    await clickText('允许本次')
    await waitFor("document.body.textContent.includes('回答完成')")
    assert.equal(calls[0].modelConfig.activeModel, 'deepseek-chat')
    await send('第二轮')
    await waitFor("Boolean(document.querySelector('[aria-label=\"停止执行\"]'))")
    await evaluate("document.querySelector('[aria-label=\"停止执行\"]').click()")
    await waitFor("document.body.textContent.includes('已停止。')")
    assert.equal(calls[1].sessionId, '00000000-0000-4000-8000-000000000001')
    await send('第三轮')
    await waitFor("document.body.textContent.includes('测试网络故障')")
    await clickText('重试本轮（可能再次执行工具）')
    await waitFor("document.body.textContent.includes('重试成功')")
    assert.equal(calls[3].prompt, '第三轮')
    assert.equal(await evaluate("Array.from(document.querySelectorAll('article')).filter(e => e.textContent === '第三轮').length"), 1)
    console.log('PASS packaged page assets, preload, configuration, streaming, approval, session ID, stop and retry without duplicate user message')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { win.destroy(); app.quit() }
})
app.on('will-quit', () => {
  assert.equal(path.dirname(data), os.tmpdir())
  assert.ok(path.basename(data).startsWith('nova-desktop-test-'))
  try { fs.rmSync(data, { recursive: true, force: true }) } catch { /* Chromium may still hold cache handles. */ }
})
