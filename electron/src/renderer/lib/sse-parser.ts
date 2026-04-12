/**
 * SSE stream parser for the Coasty backend.
 *
 * Event codes (same as the web frontend):
 *   0 = text content chunk
 *   3 = error
 *   9 = tool call initiated
 *   a = tool result
 *   g = reasoning
 *   d = finish
 *   h = awaiting human input
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

export async function parseSSEStream(
  response: Response,
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal?.aborted) break

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE events (terminated by \n\n)
      const events = buffer.split('\n\n')
      buffer = events.pop() || '' // Keep incomplete event in buffer

      for (const event of events) {
        const trimmed = event.trim()
        if (!trimmed) continue

        // Parse "code:data" format
        const colonIndex = trimmed.indexOf(':')
        if (colonIndex === -1) continue

        const code = trimmed.slice(0, colonIndex)
        const rawData = trimmed.slice(colonIndex + 1)

        try {
          switch (code) {
            case '0': {
              // Text chunk — data is a JSON-encoded string
              const text = JSON.parse(rawData)
              callbacks.onText(text)
              break
            }
            case '3': {
              // Error
              const errorData = JSON.parse(rawData)
              callbacks.onError(typeof errorData === 'string' ? errorData : errorData.error || 'Unknown error')
              break
            }
            case '9': {
              // Tool call
              const toolData = JSON.parse(rawData)
              callbacks.onToolCall({
                toolCallId: toolData.toolCallId,
                toolName: toolData.toolName,
                args: toolData.args || {},
              })
              break
            }
            case 'a': {
              // Tool result
              const resultData = JSON.parse(rawData)
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
              // Reasoning
              const reasoning = JSON.parse(rawData)
              callbacks.onReasoning(typeof reasoning === 'string' ? reasoning : reasoning.text || '')
              break
            }
            case 'd': {
              // Finish
              const finishData = JSON.parse(rawData)
              callbacks.onFinish({
                finishReason: finishData.finishReason || 'stop',
                content: finishData.content || '',
                toolInvocations: finishData.toolInvocations,
              })
              break
            }
            case 'h': {
              // Awaiting human input
              const awaitData = JSON.parse(rawData)
              callbacks.onAwaitingHuman?.({
                reason: awaitData.reason || 'Human intervention needed',
                machineId: awaitData.machineId || '',
              })
              break
            }
          }
        } catch (parseError) {
          console.warn('[SSE] Failed to parse event:', code, rawData, parseError)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
