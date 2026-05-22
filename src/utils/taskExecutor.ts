import { sendHermesMessage } from '../api/hermes'
import { logger } from '../state/logStore'
import type { ScheduledTask } from '../state/scheduledTaskStore'
import { useScheduledTaskStore } from '../state/scheduledTaskStore'
import { useWorkspaceStore } from '../state/workspaceStore'

export const executeTask = async (task: ScheduledTask): Promise<boolean> => {
  const workspaceStore = useWorkspaceStore.getState()
  const taskStore = useScheduledTaskStore.getState()

  logger.info('task-executor', `开始执行任务「${task.name}」`, {
    taskId: task.id,
    scheduleType: task.scheduleType,
    promptLength: task.prompt.length,
  })

  // Create a new chat session for this task run
  const chatId = workspaceStore.createChat()
  const label = `[定时] ${task.name}`
  workspaceStore.renameChat(chatId, label)

  // Append user message
  workspaceStore.appendMessage(chatId, {
    id: crypto.randomUUID(),
    role: 'user',
    content: task.prompt,
  })

  // Append empty assistant message (will be filled with response)
  const assistantMsgId = crypto.randomUUID()
  workspaceStore.appendMessage(chatId, {
    id: assistantMsgId,
    role: 'assistant',
    content: '',
  })

  try {
    const modelConfig = workspaceStore.getActiveModelConfig()
    const result = await sendHermesMessage(task.prompt, null, modelConfig)

    const responseText = result?.text || '任务执行完成，但未返回内容。'

    workspaceStore.updateMessage(chatId, assistantMsgId, (msg) => ({
      ...msg,
      content: responseText,
    }))

    // Mark task as run
    taskStore.updateTask(task.id, { lastRunAt: new Date().toISOString() })

    logger.info('task-executor', `任务「${task.name}」执行成功`, {
      taskId: task.id,
      chatId,
      responseLength: responseText.length,
    })

    return true
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '任务执行失败'

    workspaceStore.updateMessage(chatId, assistantMsgId, (msg) => ({
      ...msg,
      role: 'system',
      content: `任务执行失败：${errorMsg}`,
    }))

    logger.error('task-executor', `任务「${task.name}」执行失败`, {
      taskId: task.id,
      chatId,
      error: errorMsg,
    })

    return false
  }
}
