import { Component, type ReactNode } from 'react'

/** Catch render errors so one broken view never takes down the whole app. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="m-6 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6">
          <h1 className="mb-1 font-bold text-red-700">Something went wrong in this view</h1>
          <p className="mb-3 text-sm text-red-600">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
