import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
}

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || 'Unknown application error',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TRIAGE Brain UI crash:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(32,167,219,0.18),transparent_34%),linear-gradient(180deg,#eaf8fd_0%,#f7fbfd_48%,#eef6fb_100%)] px-4 text-slate-900">
        <div className="w-full max-w-[520px] rounded-[28px] border border-[#20a7db]/15 bg-white p-6 shadow-[0_22px_80px_rgba(15,23,42,0.12)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#20a7db]">TRIAGE Brain</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">The interface hit a runtime error.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Reload the page to recover. If this keeps happening, the error text below will help us track it down quickly.
          </p>
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700">Error details</p>
            <p className="mt-2 break-words text-sm leading-6 text-red-600">{this.state.message}</p>
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-[#20a7db] px-5 text-sm font-semibold text-white shadow-sm shadow-[#20a7db]/25 transition hover:bg-[#1b96c5]"
          >
            Reload TRIAGE
          </button>
        </div>
      </div>
    )
  }
}
