/**
 * Chat API — routes all network calls through the main process via IPC.
 *
 * The renderer runs from file:// in production, making any external
 * fetch() a cross-origin request that gets blocked by CORS.  By routing
 * through the main process (which has no CORS restrictions), we avoid
 * the problem entirely while keeping auth tokens in the main process.
 *
 * The main process does the actual HTTP request, parses the SSE stream,
 * and forwards events to the renderer via IPC.
 */

export interface SSECallbacks {
  onText: (text: string) => void
  onToolCall: (data: { toolCallId: string; toolName: string; args: any }) => void
  onToolResult: (data: { toolCallId: string; result: any; frontendScreenshot?: string }) => void
  onReasoning: (text: string) => void
  onFinish: (data: { finishReason: string; content: string; toolInvocations?: any[] }) => void
  onError: (error: string) => void
  onAwaitingHuman?: (data: { reason: string; machineId: string }) => void
}

/**
 * Send a chat message and stream the response via the main process.
 */
export async function sendChatMessage(
  params: {
    messages: Array<{ role: string; content: string }>
    chatId: string
    userId: string
    machineId: string
    model?: string
  },
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  // Listen for SSE events from the main process
  const cleanup = window.coasty.onChatSSEEvent((event) => {
    if (event.requestId !== requestId) return

    try {
      switch (event.type) {
        case '0': {
          const text = JSON.parse(event.data)
          callbacks.onText(text)
          break
        }
        case '3': {
          const errorData = JSON.parse(event.data)
          callbacks.onError(typeof errorData === 'string' ? errorData : errorData.error || 'Unknown error')
          break
        }
        case '9': {
          const toolData = JSON.parse(event.data)
          callbacks.onToolCall({
            toolCallId: toolData.toolCallId,
            toolName: toolData.toolName,
            args: toolData.args || {},
          })
          break
        }
        case 'a': {
          const resultData = JSON.parse(event.data)
          const result = resultData.result || resultData
          const screenshot = result?.frontendScreenshot || resultData?.frontendScreenshot
          callbacks.onToolResult({
            toolCallId: resultData.toolCallId,
            result: result?._result || result,
            frontendScreenshot: screenshot,
          })
          break
        }
        case 'g': {
          const reasoning = JSON.parse(event.data)
          callbacks.onReasoning(typeof reasoning === 'string' ? reasoning : reasoning.text || '')
          break
        }
        case 'd': {
          const finishData = JSON.parse(event.data)
          callbacks.onFinish({
            finishReason: finishData.finishReason || 'stop',
            content: finishData.content || '',
            toolInvocations: finishData.toolInvocations,
          })
          break
        }
        case 'h': {
          // Awaiting human input
          const awaitData = JSON.parse(event.data)
          callbacks.onAwaitingHuman?.({
            reason: awaitData.reason || 'Human intervention needed',
            machineId: awaitData.machineId || '',
          })
          break
        }
        case 'error': {
          // Direct error string from main process (not SSE-encoded)
          callbacks.onError(event.data)
          break
        }
      }
    } catch (parseError) {
      console.warn('[Chat] Failed to parse SSE event:', event.type, event.data, parseError)
    }
  })

  // Abort handling
  const onAbort = () => {
    window.coasty.abortChat(requestId)
  }
  signal?.addEventListener('abort', onAbort)

  try {
    // Invoke the main process to do the actual fetch + SSE streaming
    await window.coasty.sendChatMessage({
      requestId,
      messages: params.messages,
      chatId: params.chatId,
      userId: params.userId,
      machineId: params.machineId,
      model: params.model,
    })
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      callbacks.onError(err.message || 'Failed to send message')
    }
  } finally {
    cleanup()
    signal?.removeEventListener('abort', onAbort)
  }
}
