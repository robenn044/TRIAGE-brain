import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Loader2,
  Map,
  MapPin,
  Mic,
  MicOff,
  RefreshCcw,
  Square,
  Sparkles,
  Video,
  VideoOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import TriageMark from './TriageMark'
import EndTripButton from './EndTripButton'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
type CameraState = 'loading' | 'ready' | 'offline'
type RobotMode = 'line' | 'ai' | 'unknown'

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
  availablePorts: Array<{
    path: string
    manufacturer: string | null
    friendlyName: string | null
    isRecommended: boolean
  }>
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent {
  error: string
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative
  isFinal: boolean
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
}

const PLANNER_STEPS = [
  'Choose an Albanian city.',
  'Answer a short survey.',
  'Get a personal itinerary.',
]

const MIC_CONSENT_KEY = 'triage-brain.mic-consent'
const MIC_PREFERENCE_KEY = 'triage-brain.mic-enabled'
const CAMERA_STREAM_PATH = '/camera/stream'
const CAMERA_FRAME_PATH = '/api/camera/frame'
const CAMERA_HEALTH_PATH = '/api/camera/health'
const ROBOT_STATUS_PATH = '/api/robot/status'
const SESSION_LOCK_TIMEOUT_MS = 60_000

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

function readStoredFlag(key: string, fallback = false) {
  try {
    const value = localStorage.getItem(key)
    if (value === null) {
      return fallback
    }

    return value === 'true'
  } catch {
    return fallback
  }
}

function writeStoredFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // ignore storage failures
  }
}

async function queryMicrophonePermissionState() {
  if (!navigator.permissions?.query) {
    return 'unsupported' as const
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return 'unsupported' as const
  }
}

function choosePreferredVoice() {
  const voices = speechSynthesis.getVoices()
  const englishVoices = voices.filter(voice => voice.lang.toLowerCase().startsWith('en'))

  if (englishVoices.length === 0) {
    return null
  }

  const scoreVoice = (voice: SpeechSynthesisVoice) => {
    let score = 0
    const name = voice.name.toLowerCase()

    if (/google uk english female/.test(name)) score += 12
    if (/google us english/.test(name)) score += 10
    if (/google/.test(name)) score += 6
    if (/microsoft/.test(name)) score += 5
    if (/(natural|neural|premium|enhanced|aria|jenny|libby|sonia|sara)/.test(name)) score += 4
    if (!voice.localService) score += 1

    return score
  }

  return [...englishVoices].sort((left, right) => scoreVoice(right) - scoreVoice(left))[0] ?? null
}

function describeMicrophoneError(error: unknown) {
  const err = error as { name?: string; message?: string } | null
  const name = err?.name ?? ''
  const message = err?.message ?? 'Unknown error'

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      summary: 'Voice input is not available',
      detail:
        window.location.protocol !== 'https:' && window.location.hostname !== 'localhost'
          ? 'Open Triage on a secure connection to use voice input.'
          : 'This device cannot use voice input here.',
    }
  }

  if (!getSpeechRecognitionCtor()) {
    return {
      summary: 'Voice input is unavailable',
      detail: 'Open Triage in a supported browser to use voice input.',
    }
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      summary: 'Microphone permission denied',
      detail: 'Allow microphone access to talk with Triage.',
    }
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      summary: 'No microphone found',
      detail: 'No microphone was found on this device.',
    }
  }

  return {
    summary: 'Microphone unavailable',
    detail: message,
  }
}

async function blobToBase64(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unable to read camera frame'))
        return
      }

      const base64 = result.split(',')[1]
      if (!base64) {
        reject(new Error('Camera frame was empty'))
        return
      }

      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read camera frame'))
    reader.readAsDataURL(blob)
  })
}

export default function DashboardPanel() {
  const navigate = useNavigate()
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const isSpeakingRef = useRef(false)
  const restartAfterSpeechRef = useRef(false)
  const stateRef = useRef<AssistantState>('idle')
  const requestInFlightRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [entered, setEntered] = useState(false)
  const [state, setState] = useState<AssistantState>('idle')
  const [cameraState, setCameraState] = useState<CameraState>('loading')
  const [cameraStreamKey, setCameraStreamKey] = useState(() => Date.now())
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string | null>(null)
  const [checkingCamera, setCheckingCamera] = useState(false)
  const [requestingMicAccess, setRequestingMicAccess] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [micErrorDetail, setMicErrorDetail] = useState<string | null>(null)
  const [micPermissionGranted, setMicPermissionGranted] = useState(false)
  const [micEnabled, setMicEnabled] = useState(() => readStoredFlag(MIC_PREFERENCE_KEY, true))
  const [transcript, setTranscript] = useState('')
  const [lastAnswer, setLastAnswer] = useState('')
  const [robotStatus, setRobotStatus] = useState<RobotStatus | null>(null)
  const [robotBusy, setRobotBusy] = useState(false)
  const [robotError, setRobotError] = useState<string | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    writeStoredFlag(MIC_PREFERENCE_KEY, micEnabled)
  }, [micEnabled])

  const cameraReady = cameraState === 'ready'

  const refreshCameraStream = useCallback(() => {
    setCameraStreamKey(Date.now())
    setCameraState('loading')
    setCameraError(null)
    setCameraErrorDetail(null)
  }, [])

  const checkCameraHealth = useCallback(async () => {
    setCheckingCamera(true)

    try {
      const response = await fetch(CAMERA_HEALTH_PATH, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Camera health returned ${response.status}`)
      }

      const data = await response.json()
      if (data?.ok) {
        setCameraError(null)
        setCameraErrorDetail(null)
        refreshCameraStream()
      } else {
        throw new Error(data?.error || 'Camera service is not ready')
      }
    } catch (error) {
      setCameraState('offline')
      setCameraError('Camera stream is offline')
      setCameraErrorDetail(getErrorMessage(error))
    } finally {
      setCheckingCamera(false)
    }
  }, [refreshCameraStream])

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
      setRobotStatus(data.robot ?? null)
      setRobotError(data.robot?.lastError ?? null)
    } catch (error) {
      setRobotError(getErrorMessage(error))
    }
  }, [])

  const callRobotEndpoint = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      setRobotBusy(true)
      setRobotError(null)

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

        setRobotStatus(data.robot ?? null)
        setRobotError(data.robot?.lastError ?? null)
      } catch (error) {
        setRobotError(getErrorMessage(error))
      } finally {
        setRobotBusy(false)
      }
    },
    [],
  )

  const requestMicrophoneAccess = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone API unavailable')
    }

    if (!getSpeechRecognitionCtor()) {
      throw new Error('Chrome speech recognition unavailable')
    }

    setMicError(null)
    setMicErrorDetail(null)

    const tempStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    })

    tempStream.getTracks().forEach(track => track.stop())
    setMicPermissionGranted(true)
    writeStoredFlag(MIC_CONSENT_KEY, true)
  }, [])

  const restartRecognitionSoon = useCallback(
    (delayMs = 350) => {
      if (!micEnabled || !micPermissionGranted || !recognitionRef.current) {
        return
      }

      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current)
      }

      restartTimerRef.current = window.setTimeout(() => {
        if (!micEnabled || !micPermissionGranted || !recognitionRef.current || isSpeakingRef.current) {
          return
        }

        try {
          recognitionRef.current.start()
          setState('listening')
        } catch {
          // ignore duplicate start attempts
        }
      }, delayMs)
    },
    [micEnabled, micPermissionGranted],
  )

  const speak = useCallback(
    (text: string) => {
      speechSynthesis.cancel()
      restartAfterSpeechRef.current = micEnabled && micPermissionGranted
      isSpeakingRef.current = true

      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = 0.96
      utterance.pitch = 1
      utterance.voice = choosePreferredVoice()

      utterance.onstart = () => {
        stateRef.current = 'speaking'
        setState('speaking')
      }

      utterance.onend = () => {
        isSpeakingRef.current = false
        if (restartAfterSpeechRef.current) {
          stateRef.current = 'listening'
          restartRecognitionSoon()
        } else {
          stateRef.current = cameraReady ? 'idle' : 'error'
          setState(cameraReady ? 'idle' : 'error')
        }
      }

      utterance.onerror = () => {
        isSpeakingRef.current = false
        if (restartAfterSpeechRef.current) {
          stateRef.current = 'listening'
          restartRecognitionSoon()
        } else {
          stateRef.current = cameraReady ? 'idle' : 'error'
          setState(cameraReady ? 'idle' : 'error')
        }
      }

      speechSynthesis.speak(utterance)
    },
    [cameraReady, micEnabled, micPermissionGranted, restartRecognitionSoon],
  )

  const askGemma = useCallback(
    async (prompt: string) => {
      if (requestInFlightRef.current) {
        return
      }

      requestInFlightRef.current = true

      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }

      stateRef.current = 'processing'
      setState('processing')
      setTranscript('')

      try {
        const frameResponse = await fetch(CAMERA_FRAME_PATH, {
          headers: {
            Accept: 'image/jpeg',
          },
        })

        if (!frameResponse.ok) {
          throw new Error(`Camera frame returned ${frameResponse.status}`)
        }

        const image = await blobToBase64(await frameResponse.blob())
        const livePrompt = [
          'You are replying inside a live voice-and-camera tourist kiosk conversation.',
          'Return only the exact final words that should be spoken to the traveler right now.',
          'Keep it to one or two short sentences.',
          'Be warm, personal, natural, and concise.',
          'Do not include thinking process, analysis, steps, options, drafts, quotes, labels, markdown, or bullet points.',
          'If the traveler is greeting you or checking whether you can hear them, answer naturally and briefly, then offer help with Albania.',
          `Traveler message: ${prompt}`,
        ].join(' ')

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)

        const response = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, prompt: livePrompt, max_tokens: 120 }),
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeoutId)
        })

        if (!response.ok) {
          const errorBody = await response.text()
          throw new Error(errorBody || `API error ${response.status}`)
        }

        const data = await response.json()
        const answer = data.answer || 'Sorry, I could not generate an answer.'

        setLastAnswer(answer)
        speak(answer)
      } catch (error) {
        const message = getErrorMessage(error)
        setLastAnswer(`Error: ${message}`)
        setState('error')
        setMicError('Assistant request failed')
        setMicErrorDetail(message)
        if (micEnabled && micPermissionGranted) {
          restartRecognitionSoon(600)
        }
      } finally {
        requestInFlightRef.current = false
      }
    },
    [micEnabled, micPermissionGranted, restartRecognitionSoon, speak],
  )

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    void checkCameraHealth()
  }, [checkCameraHealth])

  useEffect(() => {
    void fetchRobotStatus()
    const intervalId = window.setInterval(() => {
      void fetchRobotStatus()
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [fetchRobotStatus])

  useEffect(() => {
    let cancelled = false

    async function restoreMicrophone() {
      const storedConsent = readStoredFlag(MIC_CONSENT_KEY, false)
      const storedEnabled = readStoredFlag(MIC_PREFERENCE_KEY, true)
      const permissionState = await queryMicrophonePermissionState()

      if (cancelled) {
        return
      }

      if (permissionState === 'granted') {
        setMicPermissionGranted(true)
        setMicEnabled(storedEnabled)
        return
      }

      if (!storedConsent || permissionState === 'denied') {
        setMicPermissionGranted(false)
        setMicEnabled(false)
      }
    }

    void restoreMicrophone()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!micEnabled || !micPermissionGranted) {
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }

      if (!isSpeakingRef.current && stateRef.current !== 'processing') {
        setState(cameraReady ? 'idle' : 'error')
      }

      return
    }

    const SpeechRecognition = getSpeechRecognitionCtor()
    if (!SpeechRecognition) {
      setMicError('Voice input is unavailable')
      setMicErrorDetail('Open Triage in a supported browser to use voice input.')
      setState('error')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition

    recognition.onstart = () => {
      setMicError(null)
      setMicErrorDetail(null)
      stateRef.current = 'listening'
      setState('listening')
    }

    let silenceTimer: ReturnType<typeof setTimeout> | null = null
    let accumulated = ''
    let interimText = ''
    let processingLock = false

    const clearSilenceTimer = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer)
        silenceTimer = null
      }
    }

    const flush = () => {
      if (processingLock || isSpeakingRef.current || requestInFlightRef.current) {
        return
      }

      let text = accumulated.trim()
      if (!text && interimText.trim()) {
        text = interimText.trim()
      }

      accumulated = ''
      interimText = ''

      if (!text) {
        setTranscript('')
        return
      }

      const wordCount = text.split(/\s+/).length
      if (wordCount < 2 || text.length < 8) {
        setTranscript('')
        restartRecognitionSoon(200)
        return
      }

      processingLock = true
      askGemma(text).finally(() => {
        processingLock = false
      })
    }

    const resetSilenceTimer = (delayMs: number) => {
      clearSilenceTimer()
      silenceTimer = setTimeout(flush, delayMs)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (isSpeakingRef.current || processingLock) {
        return
      }

      let newFinal = ''
      let newInterim = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) {
          if (result[0].confidence > 0.2) {
            newFinal += result[0].transcript
          }
        } else {
          newInterim += result[0].transcript
        }
      }

      if (newFinal) {
        accumulated += `${accumulated ? ' ' : ''}${newFinal.trim()}`
        interimText = ''
        setTranscript(accumulated)
        resetSilenceTimer(850)
      }

      if (newInterim) {
        interimText = newInterim.trim()
        setTranscript(accumulated ? `${accumulated} ${interimText}` : interimText)
        resetSilenceTimer(1200)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') {
        return
      }

      if (event.error === 'no-speech') {
        restartRecognitionSoon(250)
        return
      }

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicEnabled(false)
        setMicPermissionGranted(false)
        setMicError('Microphone permission denied')
        setMicErrorDetail('Allow microphone access to talk with Triage.')
      } else if (event.error === 'audio-capture') {
        setMicError('Microphone is not receiving sound')
        setMicErrorDetail('We cannot hear you right now. Check your microphone and try again.')
        restartRecognitionSoon(700)
        return
      } else {
        setMicError('Voice input error')
        setMicErrorDetail('Voice input ran into a problem. Please try again.')
      }

      setState('error')
    }

    recognition.onend = () => {
      if (accumulated.trim() && !processingLock && !isSpeakingRef.current) {
        clearSilenceTimer()
        flush()
        return
      }

      accumulated = ''
      interimText = ''

      if (!micEnabled || !micPermissionGranted || isSpeakingRef.current || stateRef.current === 'processing') {
        return
      }

      try {
        recognition.start()
        setState('listening')
      } catch {
        // ignore restart errors
      }
    }

    try {
      recognition.start()
      setState('listening')
    } catch (error) {
      const mediaError = describeMicrophoneError(error)
      setMicError(mediaError.summary)
      setMicErrorDetail(mediaError.detail)
      setState('error')
    }

    return () => {
      clearSilenceTimer()

      try {
        recognition.stop()
      } catch {
        // ignore cleanup stop errors
      }

      recognitionRef.current = null
    }
  }, [askGemma, cameraReady, micEnabled, micPermissionGranted, restartRecognitionSoon])

  useEffect(() => {
    let lockTimer: ReturnType<typeof setTimeout>

    const resetLockTimer = () => {
      clearTimeout(lockTimer)
      lockTimer = setTimeout(() => {
        sessionStorage.clear()
        window.location.replace('/')
      }, SESSION_LOCK_TIMEOUT_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach(eventName => window.addEventListener(eventName, resetLockTimer, { passive: true }))
    resetLockTimer()

    return () => {
      clearTimeout(lockTimer)
      events.forEach(eventName => window.removeEventListener(eventName, resetLockTimer))
    }
  }, [])

  useEffect(() => {
    const syncVoices = () => {
      speechSynthesis.getVoices()
    }

    syncVoices()
    speechSynthesis.addEventListener?.('voiceschanged', syncVoices)

    return () => {
      speechSynthesis.cancel()
      speechSynthesis.removeEventListener?.('voiceschanged', syncVoices)

      try {
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current)
          restartTimerRef.current = null
        }
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  const handleMicrophoneButton = useCallback(async () => {
    if (requestingMicAccess) {
      return
    }

    if (!micPermissionGranted) {
      setRequestingMicAccess(true)

      try {
        await requestMicrophoneAccess()
        setMicEnabled(true)
        setState(cameraReady ? 'listening' : 'idle')
      } catch (error) {
        const mediaError = describeMicrophoneError(error)
        setMicError(mediaError.summary)
        setMicErrorDetail(mediaError.detail)
        setState('error')
      } finally {
        setRequestingMicAccess(false)
      }

      return
    }

    if (micEnabled) {
      speechSynthesis.cancel()
      isSpeakingRef.current = false

      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }

      setTranscript('')
      setMicEnabled(false)
      setState(cameraReady ? 'idle' : 'error')
      return
    }

    setMicError(null)
    setMicErrorDetail(null)
    setMicEnabled(true)
  }, [cameraReady, micEnabled, micPermissionGranted, requestMicrophoneAccess, requestingMicAccess])

  const handleRobotConnect = useCallback(async () => {
    await callRobotEndpoint('/api/robot/connect', {})
  }, [callRobotEndpoint])

  const handleRobotMode = useCallback(
    async (mode: RobotMode) => {
      await callRobotEndpoint('/api/robot/mode', { mode })
    },
    [callRobotEndpoint],
  )

  const handleRobotCommand = useCallback(
    async (command: string, durationMs = 375) => {
      await callRobotEndpoint('/api/robot/command', { command, durationMs })
    },
    [callRobotEndpoint],
  )

  const robotSummary = useMemo(() => {
    if (!robotStatus?.connected) {
      return 'Robot controller offline'
    }

    const modeLabel = robotStatus.mode === 'ai' ? 'AI drive' : robotStatus.mode === 'line' ? 'Line follow' : 'Unknown'
    return `${modeLabel} on ${robotStatus.portPath ?? 'USB'}`
  }, [robotStatus])

  const statusText = useMemo(() => {
    if (checkingCamera) return 'Checking camera...'
    if (requestingMicAccess) return 'Requesting mic...'
    if (state === 'listening') return 'Listening...'
    if (state === 'processing') return 'Thinking...'
    if (state === 'speaking') return 'Speaking...'
    if (cameraReady && micPermissionGranted && !micEnabled) return 'Microphone paused'
    if (cameraReady && !micPermissionGranted) return 'Camera live'
    if (state === 'error') return 'Needs attention'
    return 'Dashboard ready'
  }, [cameraReady, checkingCamera, micEnabled, micPermissionGranted, requestingMicAccess, state])

  const footerText = useMemo(() => {
    if (state === 'speaking' && lastAnswer) return lastAnswer
    if (state === 'processing') return 'Checking the scene and preparing your answer...'
    if (transcript && state === 'listening') return transcript
    if (cameraError) return cameraError
    if (micError) return micError
    if (!cameraReady) return 'Waiting for the live view...'
    if (cameraReady && !micPermissionGranted) return 'The live view is ready. Tap the mic button to speak.'
    if (cameraReady && micPermissionGranted && !micEnabled) return 'Microphone paused. Tap the mic button to resume.'
    return 'Ask me anything about Albania or what the camera is seeing.'
  }, [cameraError, cameraReady, lastAnswer, micError, micEnabled, micPermissionGranted, state, transcript])

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#f4fbfe]">
      <div
        className="pointer-events-none fixed inset-0 z-50 bg-[#20a7db]"
        style={{ opacity: entered ? 0 : 1, transition: 'opacity 800ms cubic-bezier(0.4,0,0.2,1)' }}
      />

      <header className="shrink-0 bg-[#20a7db]">
        <div className="mx-auto flex w-full items-center gap-2 px-2.5 py-1.5 max-[820px]:gap-1.5 max-[820px]:px-2 max-[820px]:py-1">
          <div className="shrink-0">
            <TriageMark className="h-9 w-9 max-[820px]:h-7 max-[820px]:w-7" decorative />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-semibold leading-tight tracking-tight text-white max-[820px]:text-[11px]">Triage</h1>
            <p className="text-[10px] leading-tight text-white/70 max-[820px]:text-[9px]">Your live guide in Albania</p>
          </div>
          <div className="ml-auto shrink-0 rounded-full bg-white/[0.12] px-2 py-0.5 text-[10px] font-medium text-white/80 ring-1 ring-white/[0.15] max-[820px]:px-1.5 max-[820px]:text-[9px]">
            {statusText}
          </div>
          <EndTripButton />
        </div>
      </header>

      <main className="flex w-full min-h-0 flex-1 gap-2 p-2 max-[820px]:gap-1.5 max-[820px]:p-1.5">
        <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[#20a7db]/[0.12] bg-white p-2.5 shadow-[0_20px_48px_rgba(32,167,219,0.07)] max-[820px]:rounded-[18px] max-[820px]:p-2">
          <div className="flex shrink-0 items-center justify-between gap-2 max-[820px]:gap-1.5">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">
                Live view
              </p>
              <h2 className="mt-0.5 text-sm font-semibold leading-tight tracking-tight text-slate-900 max-[820px]:text-[13px]">
                Ask me anything around you
              </h2>
            </div>
            <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#20a7db]/[0.12] bg-[#f4fbfe] p-1 max-[820px]:gap-0.5 max-[820px]:p-0.5">
              <Button
                onClick={handleMicrophoneButton}
                size="lg"
                className={`h-9 w-9 rounded-full p-0 shadow-sm max-[820px]:h-8 max-[820px]:w-8 ${
                  micEnabled
                    ? 'bg-[#20a7db] shadow-[#20a7db]/25 hover:bg-[#1b96c5]'
                    : 'bg-red-500 shadow-red-500/25 hover:bg-red-600'
                }`}
              >
                {requestingMicAccess ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : micEnabled ? (
                  <Mic className="h-4 w-4" />
                ) : (
                  <MicOff className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={() => void checkCameraHealth()}
                size="lg"
                variant="outline"
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5 max-[820px]:h-7 max-[820px]:w-7"
              >
                {checkingCamera ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              </Button>
              <Button
                onClick={() => navigate('/itinerary')}
                size="lg"
                variant="outline"
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5 max-[820px]:h-7 max-[820px]:w-7"
              >
                <Map className="h-3.5 w-3.5" />
              </Button>
              <Button
                onClick={() => navigate('/maps')}
                size="lg"
                variant="outline"
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5 max-[820px]:h-7 max-[820px]:w-7"
              >
                <MapPin className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-[18px] border border-[#20a7db]/[0.12] bg-black max-[820px]:mt-1.5 max-[820px]:rounded-[15px]">
            <div className="pointer-events-none absolute left-2 top-2 z-10 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-white/40" />
            <div className="pointer-events-none absolute right-2 top-2 z-10 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-white/40" />
            <div className="pointer-events-none absolute bottom-2 left-2 z-10 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-white/40" />
            <div className="pointer-events-none absolute bottom-2 right-2 z-10 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-white/40" />

            <div className="absolute left-2 top-2 z-20 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm max-[820px]:left-1.5 max-[820px]:top-1.5 max-[820px]:px-1.5 max-[820px]:text-[9px]">
              {cameraReady ? 'Live' : checkingCamera ? 'Getting ready...' : 'Waiting to start'}
            </div>

            <img
              src={`${CAMERA_STREAM_PATH}?t=${cameraStreamKey}`}
              alt="Brain Pi camera stream"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                cameraReady ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={() => {
                setCameraState('ready')
                setCameraError(null)
                setCameraErrorDetail(null)
              }}
              onError={() => {
                setCameraState('offline')
                setCameraError('Camera stream is offline')
                setCameraErrorDetail('The live view could not start. Please retry the camera.')
              }}
            />

            {!cameraReady && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(32,167,219,0.22),transparent_34%),linear-gradient(135deg,rgba(11,23,36,0.94),rgba(5,10,18,1))] p-3 max-[820px]:p-2">
                <div className="w-full max-w-[470px] rounded-[28px] border border-white/10 bg-white/[0.08] p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm max-[820px]:max-w-[390px] max-[820px]:rounded-[22px] max-[820px]:p-4">
                  <div className="flex items-start gap-3 max-[820px]:gap-2">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#7fd4ef] max-[820px]:h-10 max-[820px]:w-10 max-[820px]:rounded-[18px]">
                      {checkingCamera ? <Loader2 className="h-5 w-5 animate-spin" /> : <VideoOff className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7fd4ef] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">
                        Get started
                      </p>
                      <h3 className="mt-2 text-xl font-semibold tracking-tight max-[820px]:mt-1.5 max-[820px]:text-lg">
                        Getting the live view ready.
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-white/75 max-[820px]:text-xs max-[820px]:leading-5">
                        Once the camera is ready, you can speak naturally and get answers out loud as you explore.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2.5 sm:grid-cols-3 max-[820px]:mt-3 max-[820px]:grid-cols-1">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 max-[820px]:rounded-[18px] max-[820px]:p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef] max-[820px]:text-[8px]">Live view</p>
                      <p className="mt-2 text-xs leading-5 text-white/70 max-[820px]:mt-1 max-[820px]:leading-4">See the area around you while you chat with Triage.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 max-[820px]:rounded-[18px] max-[820px]:p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef] max-[820px]:text-[8px]">Voice input</p>
                      <p className="mt-2 text-xs leading-5 text-white/70 max-[820px]:mt-1 max-[820px]:leading-4">Ask questions naturally and keep the conversation moving.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 max-[820px]:rounded-[18px] max-[820px]:p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef] max-[820px]:text-[8px]">Spoken replies</p>
                      <p className="mt-2 text-xs leading-5 text-white/70 max-[820px]:mt-1 max-[820px]:leading-4">Hear answers out loud while you stay focused on the moment.</p>
                    </div>
                  </div>

                  {cameraError && (
                    <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3">
                      <p className="text-sm font-semibold text-white">{cameraError}</p>
                      {cameraErrorDetail && <p className="mt-1 text-xs leading-5 text-white/70">{cameraErrorDetail}</p>}
                    </div>
                  )}

                  {micError && (
                    <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3">
                      <p className="text-sm font-semibold text-white">{micError}</p>
                      {micErrorDetail && <p className="mt-1 text-xs leading-5 text-white/70">{micErrorDetail}</p>}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2 max-[820px]:mt-3">
                    <Button
                      onClick={() => void checkCameraHealth()}
                      disabled={checkingCamera}
                      className="h-10 bg-[#20a7db] px-5 text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] disabled:opacity-60 max-[820px]:h-9 max-[820px]:px-4"
                    >
                      {checkingCamera ? 'Checking stream...' : 'Retry camera'}
                    </Button>
                    <Button
                      onClick={handleMicrophoneButton}
                      variant="outline"
                      className="h-10 border-white/15 bg-white/5 px-5 text-xs text-white hover:bg-white/10 max-[820px]:h-9 max-[820px]:px-4"
                    >
                      {micPermissionGranted ? 'Microphone ready' : 'Enable microphone'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {cameraReady && (
              <>
                <div className="absolute right-2 top-2 z-20 flex items-center gap-1.5 max-[820px]:right-1.5 max-[820px]:top-1.5 max-[820px]:gap-1">
                  <div
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm max-[820px]:px-1.5 max-[820px]:text-[9px] ${
                      micEnabled ? 'bg-[#20a7db]/85 text-white' : 'bg-black/55 text-white/80'
                    }`}
                  >
                    {micEnabled ? 'Voice live' : 'Voice paused'}
                  </div>
                  <div className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/80 shadow-sm backdrop-blur-sm max-[820px]:px-1.5 max-[820px]:text-[9px]">
                    Replies out loud
                  </div>
                </div>

                {!micEnabled && (
                  <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/90 to-transparent px-3 pb-3 pt-10 max-[820px]:px-2 max-[820px]:pb-2 max-[820px]:pt-8">
                    <div className="mx-auto max-w-[420px] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center backdrop-blur-sm max-[820px]:max-w-[320px] max-[820px]:rounded-[18px] max-[820px]:px-3 max-[820px]:py-2.5">
                      <p className="text-sm font-semibold text-white max-[820px]:text-xs">Microphone is paused.</p>
                      <p className="mt-1 text-xs leading-5 text-white/70 max-[820px]:leading-4">
                        Tap the mic button to start talking again.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {state === 'processing' && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-sm">
                <div className="rounded-2xl bg-white/90 px-6 py-4 text-center shadow-lg backdrop-blur max-[820px]:px-5 max-[820px]:py-3">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#20a7db] max-[820px]:h-6 max-[820px]:w-6" />
                  <p className="mt-2 text-xs font-semibold text-slate-900">Preparing your answer...</p>
                </div>
              </div>
            )}

            {transcript && state !== 'idle' && (
              <div className="absolute bottom-2.5 left-2.5 right-2.5 z-20 max-[820px]:bottom-2 max-[820px]:left-2 max-[820px]:right-2">
                <div className="rounded-xl bg-black/60 px-3 py-2 backdrop-blur-sm max-[820px]:px-2.5 max-[820px]:py-1.5">
                  <p className="text-xs leading-4 text-white/90 max-[820px]:text-[11px] max-[820px]:leading-4">
                    {state === 'listening' && 'Listening: '}
                    {state === 'processing' && 'Sending: '}
                    {transcript}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-2 shrink-0 rounded-xl bg-slate-900/85 px-3.5 py-2 backdrop-blur-sm max-[820px]:mt-1.5 max-[820px]:px-3 max-[820px]:py-1.5">
            <p className="text-center text-xs leading-5 text-white/90 max-[820px]:text-[11px] max-[820px]:leading-4">{footerText}</p>
          </div>
        </section>

        <aside className="flex w-[172px] shrink-0 flex-col rounded-[22px] border border-[#20a7db]/[0.12] bg-[#eff9fd] p-2.5 shadow-sm max-[820px]:w-[158px] max-[820px]:rounded-[18px] max-[820px]:p-2">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900 max-[820px]:text-[13px]">Itinerary planner</h3>
          <p className="mt-1 text-xs leading-4 text-slate-600 max-[820px]:text-[11px] max-[820px]:leading-4">
            Plan a city trip in Albania by answering a few quick questions.
          </p>

          <div className="mt-2.5 rounded-2xl border border-[#20a7db]/10 bg-white/80 p-2.5 max-[820px]:mt-2 max-[820px]:rounded-[18px] max-[820px]:p-2">
            <div className="flex items-center gap-2 max-[820px]:gap-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#20a7db]/10 text-[#20a7db] max-[820px]:h-7 max-[820px]:w-7">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.18em]">
                  Trip tools
                </p>
                <p className="text-xs font-semibold text-slate-800 max-[820px]:text-[11px]">Live help + itinerary planning</p>
              </div>
            </div>
          </div>

          <div className="mt-2.5 space-y-1.5 max-[820px]:mt-2 max-[820px]:space-y-1">
            {PLANNER_STEPS.map((item, index) => (
              <div key={item} className="flex items-start gap-1.5">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-[#20a7db] max-[820px]:h-3.5 max-[820px]:w-3.5 max-[820px]:text-[9px]">
                  {index + 1}
                </span>
                <p className="text-xs leading-4 text-slate-600 max-[820px]:text-[11px] max-[820px]:leading-4">{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-2.5 space-y-1.5 max-[820px]:mt-2 max-[820px]:space-y-1">
            <div className="rounded-xl border border-[#20a7db]/10 bg-white px-2.5 py-2 max-[820px]:px-2 max-[820px]:py-1.5">
              <div className="flex items-center gap-2">
                {cameraReady ? <Video className="h-3.5 w-3.5 text-[#20a7db]" /> : <VideoOff className="h-3.5 w-3.5 text-slate-400" />}
                <p className="text-[10px] font-semibold text-slate-800 max-[820px]:text-[9px]">
                  {cameraReady ? 'Camera live' : 'Camera offline'}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[#20a7db]/10 bg-white px-2.5 py-2 max-[820px]:px-2 max-[820px]:py-1.5">
              <div className="flex items-center gap-2">
                {micPermissionGranted ? <Mic className="h-3.5 w-3.5 text-[#20a7db]" /> : <MicOff className="h-3.5 w-3.5 text-slate-400" />}
                <p className="text-[10px] font-semibold text-slate-800 max-[820px]:text-[9px]">
                  {micPermissionGranted ? 'Voice ready' : 'Mic needed'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-2.5 rounded-2xl border border-[#20a7db]/10 bg-white/85 p-2 max-[820px]:mt-2 max-[820px]:rounded-[16px] max-[820px]:p-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#20a7db] max-[820px]:text-[8px] max-[820px]:tracking-[0.16em]">
                  Robot
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-800 max-[820px]:text-[10px]">
                  {robotSummary}
                </p>
              </div>
              <div
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  robotStatus?.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {robotStatus?.connected ? 'USB' : 'Idle'}
              </div>
            </div>

            <div className="mt-2 flex gap-1">
              <Button
                onClick={handleRobotConnect}
                variant="outline"
                disabled={robotBusy}
                className="h-7 flex-1 border-[#20a7db]/[0.18] bg-white px-2 text-[10px] max-[820px]:h-6 max-[820px]:text-[9px]"
              >
                {robotBusy ? 'Connecting...' : robotStatus?.connected ? 'Reconnect' : 'Connect'}
              </Button>
              <Button
                onClick={() => void handleRobotMode('line')}
                disabled={robotBusy || !robotStatus?.connected}
                variant={robotStatus?.mode === 'line' ? 'default' : 'outline'}
                className="h-7 flex-1 px-2 text-[10px] max-[820px]:h-6 max-[820px]:text-[9px]"
              >
                Line
              </Button>
              <Button
                onClick={() => void handleRobotMode('ai')}
                disabled={robotBusy || !robotStatus?.connected}
                variant={robotStatus?.mode === 'ai' ? 'default' : 'outline'}
                className="h-7 flex-1 px-2 text-[10px] max-[820px]:h-6 max-[820px]:text-[9px]"
              >
                AI
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1">
              <div />
              <Button
                onClick={() => void handleRobotCommand('FWD')}
                disabled={robotBusy || robotStatus?.mode !== 'ai'}
                variant="outline"
                className="h-7 border-[#20a7db]/[0.18] bg-white p-0 text-[#20a7db] max-[820px]:h-6"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <div />
              <Button
                onClick={() => void handleRobotCommand('LEFT')}
                disabled={robotBusy || robotStatus?.mode !== 'ai'}
                variant="outline"
                className="h-7 border-[#20a7db]/[0.18] bg-white p-0 text-[#20a7db] max-[820px]:h-6"
              >
                <ArrowLeft className="h-3 w-3" />
              </Button>
              <Button
                onClick={() => void handleRobotCommand('STOP', 100)}
                disabled={robotBusy || robotStatus?.mode !== 'ai'}
                className="h-7 bg-red-500 p-0 text-white hover:bg-red-600 max-[820px]:h-6"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
              <Button
                onClick={() => void handleRobotCommand('RIGHT')}
                disabled={robotBusy || robotStatus?.mode !== 'ai'}
                variant="outline"
                className="h-7 border-[#20a7db]/[0.18] bg-white p-0 text-[#20a7db] max-[820px]:h-6"
              >
                <ArrowRight className="h-3 w-3" />
              </Button>
              <div />
              <Button
                onClick={() => void handleRobotCommand('BACK')}
                disabled={robotBusy || robotStatus?.mode !== 'ai'}
                variant="outline"
                className="h-7 border-[#20a7db]/[0.18] bg-white p-0 text-[#20a7db] max-[820px]:h-6"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <div />
            </div>

            <p className="mt-2 text-[10px] leading-4 text-slate-500 max-[820px]:text-[9px]">
              {robotError || robotStatus?.lastMessage || 'Use LINE for the untouched Arduino follower. Use AI for supervised USB drive tests.'}
            </p>
          </div>

          <div className="mt-auto grid gap-1.5 pt-2.5 max-[820px]:pt-2">
            <Button
              onClick={() => void checkCameraHealth()}
              variant="outline"
              className="h-9 border-[#20a7db]/[0.18] bg-white text-xs max-[820px]:h-8 max-[820px]:text-[11px]"
            >
              Retry camera
            </Button>
            <Button
              onClick={() => navigate('/itinerary')}
              className="h-9 bg-[#20a7db] text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] max-[820px]:h-8 max-[820px]:text-[11px]"
            >
              Open itinerary planner
            </Button>
            <Button
              onClick={() => navigate('/robot-control')}
              variant="outline"
              className="h-9 border-[#20a7db]/[0.18] bg-white text-xs max-[820px]:h-8 max-[820px]:text-[11px]"
            >
              Open robot control
            </Button>
          </div>
        </aside>
      </main>
    </div>
  )
}
