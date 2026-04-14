import { contextBridge, ipcRenderer } from 'electron'

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('coasty', {
  // Auth
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  signInWithEmail: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-in-email', email, password),
  signUpWithEmail: (email: string, password: string) =>
    ipcRenderer.invoke('auth:sign-up-email', email, password),
  sendMagicLink: (email: string) =>
    ipcRenderer.invoke('auth:send-magic-link', email),
  awaitMagicLink: () =>
    ipcRenderer.invoke('auth:await-magic-link'),
  resetPassword: (email: string) =>
    ipcRenderer.invoke('auth:reset-password', email),
  cancelAuth: () => ipcRenderer.invoke('auth:cancel-auth'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  getSession: () => ipcRenderer.invoke('auth:get-session'),
  getToken: () => ipcRenderer.invoke('auth:get-token'),

  // WebSocket bridge
  connectBridge: () => ipcRenderer.invoke('bridge:connect'),
  disconnectBridge: () => ipcRenderer.invoke('bridge:disconnect'),
  getBridgeState: () => ipcRenderer.invoke('bridge:get-state'),

  // Config
  getBackendUrl: () => ipcRenderer.invoke('config:get-backend-url'),
  getMachineId: () => ipcRenderer.invoke('config:get-machine-id'),

  // Chat CRUD
  createChat: (params: { title?: string; model?: string }) =>
    ipcRenderer.invoke('chats:create', params),
  listChats: () => ipcRenderer.invoke('chats:list'),
  getChatMessages: (chatId: string) => ipcRenderer.invoke('chats:get-messages', chatId),
  updateChat: (params: { chatId: string; title: string }) =>
    ipcRenderer.invoke('chats:update', params),
  deleteChat: (chatId: string) => ipcRenderer.invoke('chats:delete', chatId),

  // Resume from human handoff
  resumeHuman: (machineId: string) => ipcRenderer.invoke('chat:resume-human', machineId),

  // Credits / Billing
  getCredits: () => ipcRenderer.invoke('credits:get-balance'),

  // Chat SSE streaming (routed through main process to avoid CORS)
  sendChatMessage: (params: {
    requestId: string
    messages: Array<{ role: string; content: string }>
    chatId: string
    userId: string
    machineId: string
    model?: string
  }) => ipcRenderer.invoke('chat:send-message', params),
  abortChat: (requestId: string) => ipcRenderer.invoke('chat:abort', requestId),
  onChatSSEEvent: (callback: (data: { requestId: string; type: string; data: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:sse-event', handler)
    return () => ipcRenderer.removeListener('chat:sse-event', handler)
  },

  // Window mode control
  setWindowMode: (mode: string) => ipcRenderer.invoke('window:set-mode', mode),
  onWindowModeChanged: (callback: (mode: string) => void) => {
    const handler = (_event: any, mode: string) => callback(mode)
    ipcRenderer.on('window-mode-changed', handler)
    return () => ipcRenderer.removeListener('window-mode-changed', handler)
  },

  // Window opacity control
  setOpacity: (value: number) => ipcRenderer.invoke('window:set-opacity', value),
  getOpacity: () => ipcRenderer.invoke('window:get-opacity'),
  onOpacityChanged: (callback: (value: number) => void) => {
    const handler = (_event: any, value: number) => callback(value)
    ipcRenderer.on('window-opacity-changed', handler)
    return () => ipcRenderer.removeListener('window-opacity-changed', handler)
  },

  // Window size
  getWindowSize: () => ipcRenderer.invoke('window:get-size'),
  onWindowSizeChanged: (callback: (size: { width: number; height: number }) => void) => {
    const handler = (_event: any, size: { width: number; height: number }) => callback(size)
    ipcRenderer.on('window-size-changed', handler)
    return () => ipcRenderer.removeListener('window-size-changed', handler)
  },

  // Custom resize for frameless transparent windows — main process polls cursor
  getWindowBounds: () => ipcRenderer.invoke('window:get-bounds'),
  startResize: (edge: string) => ipcRenderer.invoke('window:start-resize', edge),
  stopResize: () => ipcRenderer.invoke('window:stop-resize'),

  // Auto-update
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  getUpdateVersion: () => ipcRenderer.invoke('update:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatusChanged: (callback: (status: string) => void) => {
    const handler = (_event: any, status: string) => callback(status)
    ipcRenderer.on('update-status-changed', handler)
    return () => ipcRenderer.removeListener('update-status-changed', handler)
  },

  // Permissions (macOS)
  checkPermissions: () => ipcRenderer.invoke('permissions:check'),
  requestAccessibility: () => ipcRenderer.invoke('permissions:request-accessibility'),
  openScreenRecordingSettings: () => ipcRenderer.invoke('permissions:open-screen-recording'),
  openAccessibilitySettings: () => ipcRenderer.invoke('permissions:open-accessibility'),
  onPermissionDenied: (callback: (data: { type: string; message: string }) => void) => {
    const handler = (_event: any, data: { type: string; message: string }) => callback(data)
    ipcRenderer.on('permission:denied', handler)
    return () => ipcRenderer.removeListener('permission:denied', handler)
  },
  getPlatform: () => process.platform,

  // Action approval
  getApprovalMode: () => ipcRenderer.invoke('approval:get-mode'),
  setApprovalMode: (mode: string) => ipcRenderer.invoke('approval:set-mode', mode),
  respondToApproval: (id: string, approved: boolean, reason?: string) =>
    ipcRenderer.invoke('approval:respond', id, approved, reason),
  onApprovalRequest: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('approval-request', handler)
    return () => ipcRenderer.removeListener('approval-request', handler)
  },
  onApprovalModeChanged: (callback: (mode: string) => void) => {
    const handler = (_event: any, mode: string) => callback(mode)
    ipcRenderer.on('approval-mode-changed', handler)
    return () => ipcRenderer.removeListener('approval-mode-changed', handler)
  },

  // Display selection (multi-monitor)
  getDisplays: () => ipcRenderer.invoke('displays:list'),
  getActiveDisplay: () => ipcRenderer.invoke('displays:get-active'),
  setActiveDisplay: (id: number | null) => ipcRenderer.invoke('displays:set-active', id),

  // File/folder picker — opens native dialog, returns paths + names
  selectFiles: (opts?: { directories?: boolean }) =>
    ipcRenderer.invoke('files:select', opts),

  // App lifecycle
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  quit: () => ipcRenderer.invoke('app:quit'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  // Events from main process
  onConnectionStateChanged: (callback: (state: string) => void) => {
    const handler = (_event: any, state: string) => callback(state)
    ipcRenderer.on('connection-state-changed', handler)
    return () => ipcRenderer.removeListener('connection-state-changed', handler)
  },
})

// Type declaration for renderer
export interface CoastyAPI {
  signIn: () => Promise<{ success: boolean; user?: any; error?: string }>
  signInWithEmail: (email: string, password: string) =>
    Promise<{ success: boolean; user?: any; error?: string }>
  signUpWithEmail: (email: string, password: string) =>
    Promise<{ success: boolean; user?: any; error?: string }>
  sendMagicLink: (email: string) =>
    Promise<{ success: boolean; error?: string }>
  awaitMagicLink: () =>
    Promise<{ success: boolean; user?: any; error?: string }>
  resetPassword: (email: string) =>
    Promise<{ success: boolean; error?: string }>
  cancelAuth: () => Promise<{ success: boolean }>
  signOut: () => Promise<{ success: boolean; error?: string }>
  getSession: () => Promise<{
    isAuthenticated: boolean
    userId: string | null
    email: string | null
    name: string | null
    avatar: string | null
    machineId: string
  }>
  getToken: () => Promise<string | null>

  connectBridge: () => Promise<{ success: boolean; machineId?: string; error?: string }>
  disconnectBridge: () => Promise<{ success: boolean }>
  getBridgeState: () => Promise<string>

  getBackendUrl: () => Promise<string>
  getMachineId: () => Promise<string>

  // Chat CRUD
  createChat: (params: { title?: string; model?: string }) =>
    Promise<{ success: boolean; chat?: any; error?: string }>
  listChats: () =>
    Promise<{ success: boolean; chats?: any[]; error?: string }>
  getChatMessages: (chatId: string) =>
    Promise<{ success: boolean; messages?: any[]; error?: string }>
  updateChat: (params: { chatId: string; title: string }) =>
    Promise<{ success: boolean; error?: string }>
  deleteChat: (chatId: string) =>
    Promise<{ success: boolean; error?: string }>

  resumeHuman: (machineId: string) => Promise<{ success: boolean; resumed?: boolean; error?: string }>

  getCredits: () => Promise<{
    success: boolean
    balance?: number
    can_start_session?: boolean
    estimated_runtime_minutes?: number
    error?: string
  }>

  // Chat SSE streaming (routed through main process)
  sendChatMessage: (params: {
    requestId: string
    messages: Array<{ role: string; content: string }>
    chatId: string
    userId: string
    machineId: string
    model?: string
  }) => Promise<{ success: boolean; error?: string; aborted?: boolean }>
  abortChat: (requestId: string) => Promise<{ success: boolean }>
  onChatSSEEvent: (callback: (data: {
    requestId: string
    type: string
    data: string
  }) => void) => () => void

  setWindowMode: (mode: string) => Promise<void>
  onWindowModeChanged: (callback: (mode: string) => void) => () => void

  setOpacity: (value: number) => Promise<void>
  getOpacity: () => Promise<number>
  onOpacityChanged: (callback: (value: number) => void) => () => void

  getWindowSize: () => Promise<{ width: number; height: number }>
  onWindowSizeChanged: (callback: (size: { width: number; height: number }) => void) => () => void
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  startResize: (edge: string) => Promise<void>
  stopResize: () => Promise<void>

  getUpdateStatus: () => Promise<string>
  getUpdateVersion: () => Promise<string | null>
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateStatusChanged: (callback: (status: string) => void) => () => void

  // Permissions (macOS)
  checkPermissions: () => Promise<{
    screenRecording: 'granted' | 'denied' | 'not-applicable'
    accessibility: 'granted' | 'denied' | 'not-applicable'
  }>
  requestAccessibility: () => Promise<boolean>
  openScreenRecordingSettings: () => Promise<void>
  openAccessibilitySettings: () => Promise<void>
  onPermissionDenied: (callback: (data: { type: string; message: string }) => void) => () => void
  getPlatform: () => string

  // Action approval
  getApprovalMode: () => Promise<string>
  setApprovalMode: (mode: string) => Promise<void>
  respondToApproval: (id: string, approved: boolean, reason?: string) => Promise<void>
  onApprovalRequest: (callback: (data: {
    id: string
    command: string
    parameters: any
  }) => void) => () => void
  onApprovalModeChanged: (callback: (mode: string) => void) => () => void

  // Display selection (multi-monitor)
  getDisplays: () => Promise<Array<{
    id: number
    name: string
    width: number
    height: number
    isPrimary: boolean
    scaleFactor: number
    bounds: { x: number; y: number; width: number; height: number }
  }>>
  getActiveDisplay: () => Promise<number | null>
  setActiveDisplay: (id: number | null) => Promise<void>

  selectFiles: (opts?: { directories?: boolean }) => Promise<{
    success: boolean
    files: Array<{ path: string; name: string; ext: string; isDirectory: boolean }>
  }>

  relaunch: () => Promise<void>
  quit: () => Promise<void>
  getAppVersion: () => Promise<string>

  onConnectionStateChanged: (callback: (state: string) => void) => () => void
}

declare global {
  interface Window {
    coasty: CoastyAPI
  }
}
