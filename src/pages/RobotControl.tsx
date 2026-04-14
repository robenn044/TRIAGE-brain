import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Cable,
  RotateCcw,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

type RobotMode = 'line' | 'ai' | 'unknown'

interface RobotPort {
  path: string
  manufacturer: string | null
  friendlyName: string | null
  isRecommended: boolean
}

interface RobotStatus {
  connected: boolean
  portPath: string | null
  baudRate: number
  mode: RobotMode
  drive: string
  lastError: string | null
  lastMessage: string | null
  lastTelemetryAt: string | null
  lastCommandAt: string | null
  availablePorts: RobotPort[]
}

const ROBOT_STATUS_PATH = '/api/robot/status'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

export default function RobotControl() {
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null)
  const [selectedPort, setSelectedPort] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const holdCommandRef = useRef<'FWD' | 'BACK' | 'LEFT' | 'RIGHT' | null>(null)
  const holdStartedRef = useRef(false)
  const suppressTapCommandRef = useRef<'FWD' | 'BACK' | 'LEFT' | 'RIGHT' | null>(null)

  const fetchRobotStatus = useCallback(async () => {
    try {
      const response = await fetch(ROBOT_STATUS_PATH, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Robot status returned ${response.status}`)
      }

      const data = await response.json()
      const nextStatus = (data.robot ?? null) as RobotStatus | null
      setRobotStatus(nextStatus)
      setSelectedPort(currentValue => currentValue || nextStatus?.portPath || nextStatus?.availablePorts?.[0]?.path || '')
      setError(nextStatus?.lastError ?? null)
    } catch (nextError) {
      setError(getErrorMessage(nextError))
    }
  }, [])

  useEffect(() => {
    void fetchRobotStatus()
    const intervalId = window.setInterval(() => {
      void fetchRobotStatus()
    }, 2000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchRobotStatus])

  const callRobotEndpoint = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      setBusy(true)
      setError(null)

      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        })

        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || `Robot request returned ${response.status}`)
        }

        const nextStatus = (data.robot ?? null) as RobotStatus | null
        setRobotStatus(nextStatus)
        setError(nextStatus?.lastError ?? null)
      } catch (nextError) {
        setError(getErrorMessage(nextError))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const robotSummary = useMemo(() => {
    if (!robotStatus?.connected) {
      return 'Arduino not connected to Brain Pi yet.'
    }

    if (robotStatus.mode === 'line') {
      return 'Line mode is active. The untouched Arduino follower is driving.'
    }

    if (robotStatus.mode === 'ai') {
      return 'AI mode is active. Brain Pi can send supervised drive bursts.'
    }

    return 'Robot is connected. Choose a mode to begin.'
  }, [robotStatus])

  const handleConnect = useCallback(async () => {
    await callRobotEndpoint('/api/robot/connect', {
      path: selectedPort || undefined,
    })
  }, [callRobotEndpoint, selectedPort])

  const handleModeChange = useCallback(
    async (mode: 'line' | 'ai') => {
      await callRobotEndpoint('/api/robot/mode', { mode })
    },
    [callRobotEndpoint],
  )

  const handleDrive = useCallback(
    async (
      command: 'FWD' | 'BACK' | 'LEFT' | 'RIGHT' | 'STOP',
      options?: { durationMs?: number; continuous?: boolean },
    ) => {
      if (command === 'STOP') {
        await callRobotEndpoint('/api/robot/stop')
        return
      }

      await callRobotEndpoint('/api/robot/command', {
        command,
        durationMs: options?.durationMs,
        continuous: options?.continuous,
      })
    },
    [callRobotEndpoint],
  )

  const portOptions = robotStatus?.availablePorts ?? []
  const canDrive = robotStatus?.connected && robotStatus.mode === 'ai' && !busy
  const connectionTone = robotStatus?.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
  const modeLabel = robotStatus?.mode?.toUpperCase() || 'UNKNOWN'
  const compactStatus = [modeLabel, robotStatus?.drive || 'STOP', robotStatus?.portPath || 'Auto-detect'].join(' · ')

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const finishHold = useCallback(
    async (command?: 'FWD' | 'BACK' | 'LEFT' | 'RIGHT') => {
      clearHoldTimer()
      const activeCommand = command || holdCommandRef.current
      if (!activeCommand) {
        return
      }

      if (holdStartedRef.current) {
        suppressTapCommandRef.current = activeCommand
        holdStartedRef.current = false
        holdCommandRef.current = null
        await handleDrive('STOP')
        return
      }

      holdCommandRef.current = null
    },
    [clearHoldTimer, handleDrive],
  )

  const startHold = useCallback(
    (command: 'FWD' | 'BACK' | 'LEFT' | 'RIGHT') => {
      if (!canDrive) {
        return
      }

      clearHoldTimer()
      holdCommandRef.current = command
      holdStartedRef.current = false
      holdTimerRef.current = window.setTimeout(() => {
        holdStartedRef.current = true
        void handleDrive(command, { continuous: true })
      }, 260)
    },
    [canDrive, clearHoldTimer, handleDrive],
  )

  const tapDrive = useCallback(
    async (command: 'FWD' | 'BACK' | 'LEFT' | 'RIGHT') => {
      if (suppressTapCommandRef.current === command) {
        suppressTapCommandRef.current = null
        return
      }

      await handleDrive(command)
    },
    [handleDrive],
  )

  useEffect(() => {
    return () => {
      clearHoldTimer()
    }
  }, [clearHoldTimer])

  return (
    <div
      className="min-h-[100vh] min-h-[100dvh] overflow-x-hidden overflow-y-visible bg-[radial-gradient(circle_at_top,rgba(32,167,219,0.18),transparent_34%),linear-gradient(180deg,#eaf8fd_0%,#f7fbfd_48%,#eef6fb_100%)] px-2 pt-2 text-slate-900 sm:px-5 sm:py-5"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)' }}
    >
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 rounded-[24px] border border-[#20a7db]/15 bg-white/88 p-2 shadow-[0_22px_80px_rgba(15,23,42,0.12)] backdrop-blur-sm sm:min-h-[calc(100dvh-2.5rem)] sm:gap-4 sm:rounded-[28px] sm:p-5">
        <header className="flex flex-col gap-3 rounded-[20px] border border-[#20a7db]/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(232,248,253,0.96))] p-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-[24px] sm:p-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#20a7db] sm:text-[11px]">
              Brain Pi robot control
            </p>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:mt-2 sm:text-3xl">Switch modes without touching the Arduino</h1>
            <p className="mt-1.5 max-w-[720px] text-[13px] leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">
              Open this screen on the Brain Pi display or from your phone on the same network. The Arduino stays connected by USB, and Brain Pi sends the mode switch for you.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button asChild variant="outline" className="h-10 border-[#20a7db]/20 bg-white px-3 text-xs sm:h-11 sm:px-4 sm:text-sm">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
            <Button
              onClick={() => void fetchRobotStatus()}
              variant="outline"
              className="h-10 border-[#20a7db]/20 bg-white px-3 text-xs sm:h-11 sm:px-4 sm:text-sm"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Refresh status
            </Button>
          </div>
        </header>

        <main className="grid flex-1 gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="order-2 rounded-[22px] border border-[#20a7db]/12 bg-white p-3 shadow-sm sm:rounded-[24px] sm:p-4 lg:order-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] sm:text-[11px]">Connection</p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-tight sm:mt-2 sm:text-xl">Robot link</h2>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">{robotSummary}</p>
              </div>
              <div
                className={`self-start rounded-full px-3 py-1 text-xs font-semibold ${connectionTone}`}
              >
                {robotStatus?.connected ? 'Connected' : 'Disconnected'}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:gap-3 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Serial port</span>
                <select
                  value={selectedPort}
                  onChange={event => setSelectedPort(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-[#20a7db]/15 bg-[#f8fcfe] px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-[#20a7db]"
                >
                  <option value="">Auto-detect Arduino</option>
                  {portOptions.map(port => (
                    <option key={port.path} value={port.path}>
                      {port.path}
                      {port.isRecommended ? ' - recommended' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                onClick={() => void handleConnect()}
                disabled={busy}
                className="h-12 rounded-2xl bg-[#20a7db] px-5 text-sm shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] sm:min-w-[164px]"
              >
                <Cable className="mr-2 h-4 w-4" />
                {busy ? 'Working...' : robotStatus?.connected ? 'Reconnect' : 'Connect robot'}
              </Button>
            </div>

            <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-3">
              <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mode</p>
                <p className="mt-2 text-base font-semibold text-slate-900">{modeLabel}</p>
              </div>
              <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Drive</p>
                <p className="mt-2 text-base font-semibold text-slate-900">{robotStatus?.drive || 'STOP'}</p>
              </div>
              <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Port</p>
                <p className="mt-2 truncate text-base font-semibold text-slate-900">{robotStatus?.portPath || 'Auto-detect'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-[20px] border border-[#20a7db]/10 bg-[linear-gradient(135deg,rgba(32,167,219,0.1),rgba(255,255,255,0.9))] px-3 py-2 sm:hidden">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#20a7db]">Live status</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{compactStatus}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:mt-5 sm:gap-3 sm:grid-cols-2">
              <Button
                onClick={() => void handleModeChange('line')}
                disabled={busy || !robotStatus?.connected}
                variant={robotStatus?.mode === 'line' ? 'default' : 'outline'}
                className="h-12 rounded-[18px] text-sm sm:h-14 sm:rounded-[20px] sm:text-base"
              >
                <Bot className="mr-2 h-5 w-5" />
                Switch to line mode
              </Button>
              <Button
                onClick={() => void handleModeChange('ai')}
                disabled={busy || !robotStatus?.connected}
                variant={robotStatus?.mode === 'ai' ? 'default' : 'outline'}
                className="h-12 rounded-[18px] text-sm sm:h-14 sm:rounded-[20px] sm:text-base"
              >
                <Bot className="mr-2 h-5 w-5" />
                Switch to AI mode
              </Button>
            </div>

            <div className="mt-4 rounded-[22px] border border-[#20a7db]/10 bg-[linear-gradient(180deg,rgba(242,251,254,1),rgba(248,252,254,1))] p-3 sm:mt-5 sm:rounded-[24px] sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] sm:text-[11px]">Emergency control</p>
                  <h3 className="mt-1.5 text-base font-semibold tracking-tight sm:mt-2 sm:text-lg">Manual drive pad</h3>
                  <p className="mt-1 text-[13px] leading-5 text-slate-600 sm:text-sm sm:leading-6">
                    Tap for a short burst. Press and hold to keep moving continuously until you release.
                  </p>
                </div>
                <Button
                  onClick={() => void handleDrive('STOP')}
                  disabled={busy || !robotStatus?.connected}
                  className="h-12 w-full rounded-[18px] bg-red-500 px-5 text-sm font-semibold text-white hover:bg-red-600 sm:h-14 sm:w-auto sm:rounded-[20px]"
                >
                  <Square className="mr-2 h-4 w-4 fill-current" />
                  Stop now
                </Button>
              </div>

              <div className="mx-auto mt-4 grid max-w-[340px] grid-cols-3 gap-2 sm:mt-5 sm:max-w-[320px] sm:gap-3">
                <div />
                <Button
                  onClick={() => void tapDrive('FWD')}
                  onPointerDown={() => startHold('FWD')}
                  onPointerUp={() => void finishHold('FWD')}
                  onPointerCancel={() => void finishHold('FWD')}
                  onPointerLeave={() => void finishHold('FWD')}
                  disabled={!canDrive}
                  variant="outline"
                  className="h-20 rounded-[22px] border-[#20a7db]/18 bg-white text-[#20a7db] shadow-sm active:scale-[0.98] sm:h-16 sm:rounded-[20px]"
                >
                  <ArrowUp className="h-7 w-7 sm:h-6 sm:w-6" />
                </Button>
                <div />
                <Button
                  onClick={() => void tapDrive('LEFT')}
                  onPointerDown={() => startHold('LEFT')}
                  onPointerUp={() => void finishHold('LEFT')}
                  onPointerCancel={() => void finishHold('LEFT')}
                  onPointerLeave={() => void finishHold('LEFT')}
                  disabled={!canDrive}
                  variant="outline"
                  className="h-20 rounded-[22px] border-[#20a7db]/18 bg-white text-[#20a7db] shadow-sm active:scale-[0.98] sm:h-16 sm:rounded-[20px]"
                >
                  <ArrowLeft className="h-7 w-7 sm:h-6 sm:w-6" />
                </Button>
                <Button
                  onClick={() => void handleDrive('STOP')}
                  disabled={busy || !robotStatus?.connected}
                  className="h-20 rounded-[22px] bg-red-500 text-white shadow-sm hover:bg-red-600 active:scale-[0.98] sm:h-16 sm:rounded-[20px]"
                >
                  <Square className="h-6 w-6 fill-current sm:h-5 sm:w-5" />
                </Button>
                <Button
                  onClick={() => void tapDrive('RIGHT')}
                  onPointerDown={() => startHold('RIGHT')}
                  onPointerUp={() => void finishHold('RIGHT')}
                  onPointerCancel={() => void finishHold('RIGHT')}
                  onPointerLeave={() => void finishHold('RIGHT')}
                  disabled={!canDrive}
                  variant="outline"
                  className="h-20 rounded-[22px] border-[#20a7db]/18 bg-white text-[#20a7db] shadow-sm active:scale-[0.98] sm:h-16 sm:rounded-[20px]"
                >
                  <ArrowRight className="h-7 w-7 sm:h-6 sm:w-6" />
                </Button>
                <div />
                <Button
                  onClick={() => void tapDrive('BACK')}
                  onPointerDown={() => startHold('BACK')}
                  onPointerUp={() => void finishHold('BACK')}
                  onPointerCancel={() => void finishHold('BACK')}
                  onPointerLeave={() => void finishHold('BACK')}
                  disabled={!canDrive}
                  variant="outline"
                  className="h-20 rounded-[22px] border-[#20a7db]/18 bg-white text-[#20a7db] shadow-sm active:scale-[0.98] sm:h-16 sm:rounded-[20px]"
                >
                  <ArrowDown className="h-7 w-7 sm:h-6 sm:w-6" />
                </Button>
                <div />
              </div>

              <p className="mt-3 text-center text-[11px] leading-5 text-slate-500 sm:hidden">
                Thumb-friendly controls are always centered here. Use one short tap per movement.
              </p>
            </div>
          </section>

          <aside className="order-1 flex flex-col gap-3 rounded-[22px] border border-[#20a7db]/12 bg-white p-3 shadow-sm sm:rounded-[24px] sm:p-4 lg:order-2">
            <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3 sm:rounded-[22px] sm:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] sm:text-[11px]">Remote access</p>
              <h2 className="mt-1.5 text-base font-semibold tracking-tight sm:mt-2 sm:text-lg">Use this page from any device on the same Wi-Fi</h2>
              <p className="mt-1.5 text-[13px] leading-5 text-slate-600 sm:mt-2 sm:text-sm sm:leading-6">
                Open the Brain Pi address in a browser and go to <span className="font-semibold text-slate-900">/robot-control</span>. Example: <span className="font-semibold text-slate-900">http://brain-pi-ip:3000/robot-control</span>
              </p>
            </div>

            <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3 sm:rounded-[22px] sm:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] sm:text-[11px]">Safe workflow</p>
              <ol className="mt-2.5 space-y-1.5 text-[13px] leading-5 text-slate-600 sm:mt-3 sm:space-y-2 sm:text-sm sm:leading-6">
                <li>1. Connect the robot over USB.</li>
                <li>2. Switch to <span className="font-semibold text-slate-900">LINE</span> when you want the untouched Arduino follower.</li>
                <li>3. Switch to <span className="font-semibold text-slate-900">AI</span> only for supervised camera-guided experiments.</li>
                <li>4. Use <span className="font-semibold text-slate-900">Stop now</span> whenever the robot behaves unexpectedly.</li>
              </ol>
            </div>

            <div className="rounded-[20px] border border-[#20a7db]/10 bg-[#f8fcfe] p-3 sm:rounded-[22px] sm:p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] sm:text-[11px]">Live status</p>
              <div className="mt-2.5 space-y-2 text-[13px] text-slate-600 sm:mt-3 sm:text-sm">
                <p>
                  <span className="font-semibold text-slate-900">Last message:</span>{' '}
                  {robotStatus?.lastMessage || 'No telemetry yet'}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Last telemetry:</span>{' '}
                  {robotStatus?.lastTelemetryAt || 'Not received'}
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Last command:</span>{' '}
                  {robotStatus?.lastCommandAt || 'None sent'}
                </p>
              </div>
            </div>

            {(error || robotStatus?.lastError) && (
              <div className="rounded-[20px] border border-red-200 bg-red-50 p-3 sm:rounded-[22px] sm:p-4">
                <p className="text-sm font-semibold text-red-700">Robot error</p>
                <p className="mt-2 text-sm leading-6 text-red-600">{error || robotStatus?.lastError}</p>
              </div>
            )}
          </aside>
        </main>

        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-[#20a7db]/10 bg-white/92 px-3 pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        >
          <div className="mx-auto flex max-w-[420px] items-center gap-2">
            <div className="min-w-0 flex-1 rounded-2xl bg-[#f2fbfe] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#20a7db]">Robot</p>
              <p className="truncate text-sm font-semibold text-slate-900">{robotStatus?.connected ? compactStatus : 'Disconnected'}</p>
            </div>
            <Button
              onClick={() => void handleDrive('STOP')}
              disabled={busy || !robotStatus?.connected}
              className="h-12 rounded-2xl bg-red-500 px-4 text-sm font-semibold text-white hover:bg-red-600"
            >
              <Square className="mr-2 h-4 w-4 fill-current" />
              Stop
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
