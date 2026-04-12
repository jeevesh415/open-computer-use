import WebSocket from 'ws'
import { BrowserWindow, screen } from 'electron'
import * as os from 'os'
import { LocalExecutor } from './local-executor'
import { ApprovalManager } from './approval-manager'
import { showRainbowBorder, hideRainbowBorder, initRainbowBorder } from './rainbow-border'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Collect local system details to send to the backend. */
function getSystemInfo(): Record<string, string> {
  const primary = screen.getPrimaryDisplay()
  return {
    platform: process.platform,                    // win32, darwin, linux
    os_name: `${os.type()} ${os.release()}`,       // Windows_NT 10.0.26200, Darwin 23.2.0, etc.
    os_version: os.release(),
    arch: os.arch(),                               // x64, arm64
    hostname: os.hostname(),
    username: os.userInfo().username,
    home_dir: os.homedir(),
    shell: process.platform === 'win32' ? 'powershell' : (process.env.SHELL || '/bin/bash'),
    screen_width: String(primary.size.width),
    screen_height: String(primary.size.height),
  }
}

export class WebSocketBridge {
  private ws: WebSocket | null = null
  private executor: LocalExecutor
  private backendUrl: string
  private token: string
  private machineId: string
  private userId: string
  private reconnectAttempts = 0
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private state: ConnectionState = 'disconnected'
  private intentionalClose = false
  private approvalManager: ApprovalManager
  // Remote approval tracking: approval_id → { resolve }
  private pendingRemoteApprovals = new Map<string, { resolve: (result: { approved: boolean; reason?: string }) => void }>()
  // Rainbow border: on for the entire task, off on task_end / disconnect
  private rainbowActive = false
  // When true, reject all incoming commands (user clicked Stop)
  private taskStopped = false

  private getToken: (() => Promise<string | null>) | null = null

  constructor(backendUrl: string, token: string, machineId: string, userId: string, approvalManager: ApprovalManager) {
    this.backendUrl = backendUrl
    this.token = token
    this.machineId = machineId
    this.userId = userId
    this.executor = new LocalExecutor()
    this.approvalManager = approvalManager
  }

  /** Provide a callback to fetch a fresh token on reconnect. */
  setTokenProvider(fn: () => Promise<string | null>): void {
    this.getToken = fn
  }

  /** Turn on the rainbow aura for the duration of the task. */
  private startRainbow(): void {
    if (this.rainbowActive) return
    this.rainbowActive = true
    showRainbowBorder()
  }

  /** Turn off the rainbow (task_end / disconnect). */
  private stopRainbow(): void {
    if (!this.rainbowActive) return
    this.rainbowActive = false
    hideRainbowBorder()
  }

  getState(): ConnectionState {
    return this.state
  }

  /** Signal that the user stopped the current task. Tells the backend to
   *  cancel the CUA executor and rejects any further commands on the bridge
   *  until a new task begins. */
  stopTask(): void {
    if (this.taskStopped) return
    this.taskStopped = true
    this.send({ type: 'task_stop' })
    this.stopRainbow()
    this.approvalManager.cancelAll()
    this.cancelAllRemoteApprovals()
    console.log('[WS Bridge] Task stopped by user')
  }

  /** Reset the stopped flag so the bridge accepts commands for the next task. */
  resumeTask(): void {
    this.taskStopped = false
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.setState('connecting')
    this.intentionalClose = false

    // Only non-sensitive system info goes in the URL query params.
    // Auth credentials (token, user_id, machine_id) are sent in the
    // first message after the connection opens — this avoids exposing
    // tokens in URLs which get logged by proxies, servers, and CDNs.
    const sysInfo = getSystemInfo()
    const params = new URLSearchParams(sysInfo)
    const wsUrl = `${this.backendUrl.replace(/^http/, 'ws')}/api/electron/ws?${params.toString()}`

    this.ws = new WebSocket(wsUrl)

    this.ws.on('open', async () => {
      console.log('[WS Bridge] Connected, authenticating...')
      // On reconnect (e.g. after sleep/hibernate), the stored token may be
      // expired. Ask the auth layer for a fresh token before authenticating.
      if (this.getToken) {
        try {
          const freshToken = await this.getToken()
          if (freshToken) {
            this.token = freshToken
          }
        } catch (err) {
          console.error('[WS Bridge] Failed to refresh token on reconnect:', err)
        }
      }
      // Send auth credentials in the message body, not the URL
      this.send({
        type: 'auth',
        token: this.token,
        machine_id: this.machineId,
        user_id: this.userId,
      })
    })

    this.ws.on('message', async (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.type === 'command') {
          const { command, parameters } = message.data
          console.log(`[WS Bridge] Received command: ${command}`)

          // Reject commands that arrive after the user stopped the task.
          // The backend may still have in-flight commands queued before
          // it processes our task_stop message.
          if (this.taskStopped) {
            console.log(`[WS Bridge] Rejected (task stopped): ${command}`)
            this.send({
              type: 'result',
              data: { success: false, error: 'Task was stopped by user' },
            })
          } else if (this.approvalManager.isDenyAll()) {
            console.log(`[WS Bridge] Denied (mode=off): ${command}`)
            this.send({
              type: 'result',
              data: { success: false, error: 'Action blocked: agent actions are currently paused by user' },
            })
          } else if (this.approvalManager.shouldAutoApprove(command)) {
            console.log(`[WS Bridge] Auto-approved: ${command}`)
            this.startRainbow()
            try {
              const result = await this.executor.executeCommand(command, parameters)
              this.send({ type: 'result', data: result })
            } catch (error: any) {
              this.send({
                type: 'result',
                data: { success: false, error: error.message || String(error) },
              })
            }
          } else {
            console.log(`[WS Bridge] Requesting approval: ${command}`)

            // Notify backend about the pending approval so the web/phone UI
            // can also show the prompt and respond remotely.
            const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            this.send({
              type: 'approval_request',
              data: { id: approvalId, command, parameters },
            })

            // Race: local Electron overlay approval vs remote web/phone approval.
            // The approval manager handles local UI; we also listen for a
            // 'approval_response' message from the backend (sent by the web UI).
            const localPromise = this.approvalManager.requestApproval(command, parameters)
            const remotePromise = this.waitForRemoteApproval(approvalId)

            const { approved, reason } = await Promise.race([localPromise, remotePromise])

            // Cancel the local approval prompt if remote won the race (and vice versa)
            this.approvalManager.cancelAll()
            this.clearRemoteApproval(approvalId)

            if (approved) {
              console.log(`[WS Bridge] Approved: ${command}`)
              this.startRainbow()
              try {
                const result = await this.executor.executeCommand(command, parameters)
                this.send({ type: 'result', data: result })
              } catch (error: any) {
                this.send({
                  type: 'result',
                  data: { success: false, error: error.message || String(error) },
                })
              }
            } else {
              const msg = reason ? `Action denied by user: ${reason}` : 'Action denied by user'
              console.log(`[WS Bridge] Denied: ${command} — ${msg}`)
              this.send({
                type: 'result',
                data: { success: false, error: msg },
              })
            }
          }
        } else if (message.type === 'task_end') {
          console.log('[WS Bridge] Task ended')
          this.taskStopped = false
          this.stopRainbow()
        } else if (message.type === 'approval_response') {
          // Remote approval response from web/phone UI (forwarded by backend)
          const { id, approved, reason } = message.data || {}
          console.log(`[WS Bridge] Remote approval response: ${id} → ${approved ? 'approved' : 'denied'}`)
          this.resolveRemoteApproval(id, { approved: !!approved, reason })
        } else if (message.type === 'ping') {
          this.send({ type: 'heartbeat' })
        } else if (message.type === 'auth_success') {
          console.log('[WS Bridge] Authenticated with backend')
          this.reconnectAttempts = 0
          this.setState('connected')
          this.startHeartbeat()
          // Pre-create rainbow border so first show is instant
          initRainbowBorder()
        } else if (message.type === 'auth_failed') {
          console.error('[WS Bridge] Authentication failed:', message.reason)
          this.setState('error')
          this.intentionalClose = true
          this.ws?.close()
        }
      } catch (e) {
        console.error('[WS Bridge] Error processing message:', e)
      }
    })

    this.ws.on('close', (code, reason) => {
      console.log(`[WS Bridge] Disconnected: ${code} ${reason}`)
      this.stopHeartbeat()
      this.stopRainbow()
      // Cancel all pending approvals (local + remote) so promises don't hang
      this.approvalManager.cancelAll()
      this.cancelAllRemoteApprovals()

      if (!this.intentionalClose) {
        this.setState('disconnected')
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (error) => {
      console.error('[WS Bridge] Error:', error.message)
      this.setState('error')
    })
  }

  disconnect(): void {
    this.intentionalClose = true
    this.stopHeartbeat()
    this.stopRainbow()
    this.clearReconnectTimer()
    this.approvalManager.cancelAll()
    this.cancelAllRemoteApprovals()
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }

  updateToken(token: string): void {
    this.token = token
    // Re-authenticate on the existing connection instead of tearing it down.
    // This avoids a visible 'disconnected' flicker in the UI every ~55 minutes
    // when the scheduled token refresh fires.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: 'auth',
        token: this.token,
        machine_id: this.machineId,
        user_id: this.userId,
      })
    }
  }

  /** Wait for a remote approval response from the backend (web/phone UI).
   *  Includes a 120-second timeout to prevent indefinite hangs. */
  private waitForRemoteApproval(approvalId: string): Promise<{ approved: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRemoteApprovals.delete(approvalId)
        resolve({ approved: false, reason: 'Remote approval timed out' })
      }, 120_000)

      this.pendingRemoteApprovals.set(approvalId, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
      })
    })
  }

  /** Resolve a pending remote approval promise. */
  private resolveRemoteApproval(approvalId: string, result: { approved: boolean; reason?: string }): void {
    const pending = this.pendingRemoteApprovals.get(approvalId)
    if (pending) {
      this.pendingRemoteApprovals.delete(approvalId)
      pending.resolve(result)
    }
  }

  /** Clear a remote approval by resolving it as denied (e.g. when local won the race). */
  private clearRemoteApproval(approvalId: string): void {
    const pending = this.pendingRemoteApprovals.get(approvalId)
    if (pending) {
      this.pendingRemoteApprovals.delete(approvalId)
      pending.resolve({ approved: false, reason: 'Superseded by local approval' })
    }
  }

  /** Cancel all pending remote approvals (e.g. on disconnect). */
  private cancelAllRemoteApprovals(): void {
    for (const [id, pending] of this.pendingRemoteApprovals) {
      pending.resolve({ approved: false, reason: 'Disconnected' })
    }
    this.pendingRemoteApprovals.clear()
  }

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'heartbeat' })
    }, 30000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(): void {
    // Cap backoff at 15s so the overlay reconnects quickly when the backend comes up
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000)
    this.reconnectAttempts++
    console.log(`[WS Bridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private setState(state: ConnectionState): void {
    this.state = state
    // Notify all renderer windows
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('connection-state-changed', state)
    })
  }
}
