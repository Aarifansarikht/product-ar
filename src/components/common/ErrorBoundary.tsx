import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last line of defence: a render error anywhere would otherwise unmount the whole app and leave
 * a blank screen (on a phone this looks like a crash). Shows a reload prompt instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[App] render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="ambient-bg fixed inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div>
          <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm text-white/55">Reload to continue browsing the collection.</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="brand-gradient flex h-11 items-center rounded-lg px-6 text-sm font-semibold"
        >
          Reload
        </button>
      </div>
    )
  }
}
