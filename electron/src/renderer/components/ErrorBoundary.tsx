import React from 'react'

/**
 * App-wide React error boundary.
 *
 * Catches errors thrown during render / lifecycle in the component tree,
 * forwards them to the main-process error reporter (which persists +
 * ships to the backend), and renders a minimal fallback so the user
 * doesn't see a fully-blank window.
 *
 * Why both a boundary AND `window.onerror`/`unhandledrejection`? They
 * cover non-overlapping classes of failure:
 *   - Boundary catches errors thrown synchronously by `render` /
 *     `componentDidMount` / `useEffect` body / event handlers that bubble
 *     into React.
 *   - `window.onerror` catches async errors thrown outside React (e.g.
 *     `setTimeout` callbacks, top-level Promise rejections from
 *     non-React code paths).
 *
 * We forward both into the same reporter; the main-process IPC handler
 * stamps the right category based on the `from` field.
 */

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  errorMessage?: string
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      window.coasty?.reportRendererError({
        message: error.message || String(error),
        stack: error.stack,
        component: info.componentStack || undefined,
        userAgent: navigator.userAgent,
        from: 'boundary',
      })
    } catch {
      // If even the IPC bridge is broken we can't do better than this
      // — but at least the original error is in DevTools console.
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] failed to forward error:', error)
    }
  }

  private handleReload = () => {
    this.setState({ hasError: false, errorMessage: undefined })
    // Hard reload — clears any corrupted in-memory state from the crash.
    if (typeof window !== 'undefined') window.location.reload()
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children

    // Minimal fallback UI matching the rest of the app's neutral-950 palette.
    // We deliberately avoid pulling in styled components / complex children
    // because if the crash was caused by a global stylesheet or store bug,
    // anything fancy here would crash again.
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-neutral-950 text-neutral-200 p-6 rounded-2xl">
        <div className="text-sm text-neutral-400 mb-4">Something went wrong.</div>
        {this.state.errorMessage && (
          <div className="text-xs text-neutral-500 max-w-md text-center mb-6 font-mono">
            {this.state.errorMessage.slice(0, 200)}
          </div>
        )}
        <button
          onClick={this.handleReload}
          className="px-4 py-2 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors"
        >
          Reload app
        </button>
      </div>
    )
  }
}
