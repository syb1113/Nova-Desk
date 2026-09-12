import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runHermes, controlTurn, cancelOwner } from '../dist-electron/hermes-runtime.js'

// Real vendored AIAgent, local mock HTTP only; no user credentials or home.
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-runtime-test-'))
for (const key of Object.keys(process.env)) {
  if (/API_KEY|TOKEN|SECRET|PASSWORD|BASE_URL/i.test(key)) delete process.env[key]
}
process.env.HERMES_HOME = path.join(data, 'home')
fs.mkdirSync(process.env.HERMES_HOME)
fs.writeFileSync(path.join(process.env.HERMES_HOME, 'config.yaml'), 'model:\n  default: test-model\n  provider: deepseek\n')
const received = []
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  if (!body) { res.writeHead(404); res.end(); return }
  const request = JSON.parse(body)
  received.push({ url: req.url, headers: req.headers, body: request })
  if (request.model === 'fail-model') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid test key', type: 'authentication_error' } })); return }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  if (request.model === 'tool-model' && !request.messages.some((m) => m.role === 'tool')) {
    res.end(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_clarify', type: 'function', function: { name: 'clarify', arguments: JSON.stringify({ question: '请选择颜色', choices: ['蓝色', '绿色'] }) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
    return
  }
  if (req.url.includes('messages')) {
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    event('message_start', { message: { id: 'test', type: 'message', role: 'assistant', model: request.model, content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } })
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '你好' } })
    setTimeout(() => {
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '，Nova' } })
      event('content_block_stop', { index: 0 })
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
      event('message_stop', {})
      res.end()
    }, 150)
  } else {
    const delta = (text, finish = null) => res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`)
    delta('你好')
    setTimeout(() => { delta('，Nova'); delta('', 'stop'); res.end('data: [DONE]\n\n') }, request.model === 'slow-model' ? 8000 : 150)
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const paths = { vendor: path.resolve('vendor'), bridge: path.resolve('scripts/hermes-bridge.py'), data }
const config = { provider: 'kimi', apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${port}/v1`, protocol: 'openai', activeModel: 'Exact-Case/Model' }
try {
  if (process.argv.includes('--cleanup-only')) {
    const requestId = randomUUID()
    const turn = runHermes({ requestId, prompt: 'cancel during startup', modelConfig: config, testMode: true }, 7, () => {}, paths)
    let finished = false
    void turn.then(() => { finished = true })
    await cancelOwner(7)
    assert.equal(finished, true, 'window cleanup must wait for child termination')
    assert.equal((await turn).cancelled, true)
    assert.equal(controlTurn(7, requestId), false, 'finished request must leave registry')
    assert.equal(received.length, 0, 'startup cancellation should not call the model')
    console.log('PASS window cleanup awaits process termination and removes request')
  } else {
  if (!process.argv.includes('--tools-only')) {
  for (const [provider, protocol] of [['deepseek', 'openai'], ['kimi', 'openai'], ['glm', 'openai'], ['mimo', 'openai']]) {
    const events = []
    const activeModel = provider === 'mimo' ? 'mimo-v2.5-pro' : config.activeModel
    const result = await runHermes({ requestId: randomUUID(), prompt: 'hi', modelConfig: { ...config, activeModel, provider, protocol }, testMode: true }, 1, (e) => events.push(e), paths)
    assert.equal(result.text, '你好，Nova')
    assert.ok(events.filter((e) => e.type === 'delta').length >= 2, `${provider}: real deltas`)
    const request = received.at(-1)
    assert.equal(request.body.model, activeModel)
    assert.equal(request.body.stream, true)
    assert.ok(!request.body.tools?.length, 'test mode must not expose tools')
    assert.equal(protocol === 'anthropic' ? request.headers['x-api-key'] : request.headers.authorization, protocol === 'anthropic' ? config.apiKey : `Bearer ${config.apiKey}`)
    console.log(`PASS ${provider}: endpoint, key, exact model ID, ${protocol}, streaming, no tools`)
  }
  // Persist complete native message history and restore it in a new Python process.
  fs.writeFileSync(path.join(process.env.HERMES_HOME, 'config.yaml'), 'model:\n  default: test-model\n  provider: deepseek\nplatform_toolsets:\n  cli: []\n')
  const first = await runHermes({ requestId: randomUUID(), prompt: 'remember first turn', modelConfig: config }, 1, () => {}, paths)
  assert.ok(first.sessionId)
  await runHermes({ requestId: randomUUID(), sessionId: first.sessionId, prompt: 'second turn', modelConfig: config }, 1, () => {}, paths)
  assert.ok(received.at(-1).body.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('remember first turn')))
  console.log('PASS native session history across processes')
  const snapshot = fs.readFileSync(path.join(data, 'sessions', first.sessionId + '.json'), 'utf8')
  const id = randomUUID()
  const stopped = await runHermes({ requestId: id, sessionId: first.sessionId, prompt: 'cancel this', modelConfig: { ...config, activeModel: 'slow-model' } }, 1, (event) => {
    if (event.type === 'delta') {
      assert.equal(controlTurn(2, id), false, 'other renderer cannot cancel')
      controlTurn(1, id)
    }
  }, paths)
  assert.equal(stopped.cancelled, true)
  assert.equal(fs.readFileSync(path.join(data, 'sessions', first.sessionId + '.json'), 'utf8'), snapshot)
  console.log('PASS cancellation, ownership, preserved session checkpoint')
  }
  fs.writeFileSync(path.join(process.env.HERMES_HOME, 'config.yaml'), 'platform_toolsets:\n  cli: [clarify]\n')
  const toolId = randomUUID()
  const toolEvents = []
  await runHermes({ requestId: toolId, prompt: 'ask color', modelConfig: { ...config, activeModel: 'tool-model' } }, 1, (event) => {
    toolEvents.push(event)
    if (event.type === 'clarify') {
      assert.equal(controlTurn(2, toolId, event.id, '绿色'), false)
      assert.equal(controlTurn(1, toolId, event.id, '蓝色'), true)
      assert.equal(controlTurn(1, toolId, event.id, '绿色'), false)
    }
  }, paths)
  assert.ok(toolEvents.some((e) => e.type === 'tool_start'), JSON.stringify(toolEvents))
  assert.ok(toolEvents.some((e) => e.type === 'tool_complete' && e.result.includes('蓝色')))
  console.log('PASS real tool events, clarification reply, ownership and single-use interaction')
  await assert.rejects(runHermes({ requestId: randomUUID(), prompt: 'fail', modelConfig: { ...config, activeModel: 'fail-model' }, testMode: true }, 1, () => {}, paths))
  console.log('PASS API failure is reported as failure')
  }
} finally {
  server.closeAllConnections()
  server.close()
  // Generated test directory only; never touch the user's Hermes home.
  assert.equal(path.dirname(data), os.tmpdir())
  assert.ok(path.basename(data).startsWith('nova-runtime-test-'))
  fs.rmSync(data, { recursive: true, force: true })
}
