import React from 'react'
import { useConnectionStore } from '../stores/connection-store'

const STATUS_CONFIG = {
  connected: { color: 'bg-emerald-500', label: 'Connected' },
  connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting...' },
  disconnected: { color: 'bg-neutral-500', label: 'Disconnected' },
  error: { color: 'bg-red-500', label: 'Connection Error' },
  auth_error: { color: 'bg-red-500', label: 'Sign-in Required' },
}

export function ConnectionStatus() {
  const { state, connect, disconnect } = useConnectionStore()
  const config = STATUS_CONFIG[state]

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg">
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      <span className="text-xs text-neutral-400">{config.label}</span>

      {state === 'disconnected' || state === 'error' ? (
        <>
          <button
            onClick={connect}
            className="text-xs text-brand-400 hover:text-brand-300 ml-2"
          >
            Reconnect
          </button>
        </>
      ) : state === 'connected' ? (
        <button
          onClick={disconnect}
          className="text-xs text-neutral-500 hover:text-neutral-400 ml-2"
        >
          Disconnect
        </button>
      ) : null}
    </div>
  )
}
