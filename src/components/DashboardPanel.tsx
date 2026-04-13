import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Loader2,
  Map,
  MapPin,
  Mic,
  MicOff,
  RefreshCcw,
  Sparkles,
  Video,
  VideoOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import TriageMark from './TriageMark'
import EndTripButton from './EndTripButton'

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
type CameraState = 'loading' | 'ready' | 'offline'

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
      summary: 'Microphone access is not available',
      detail:
        window.location.protocol !== 'https:' && window.location.hostname !== 'localhost'
          ? 'Chrome requires HTTPS before it can request microphone access.'
          : 'This browser does not expose the microphone API.',
    }
  }

  if (!getSpeechRecognitionCtor()) {
    return {
      summary: 'Free English STT is unavailable',
      detail: 'Chrome speech recognition is required for the built-in free English STT.',
    }
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      summary: 'Microphone permission denied',
      detail: 'Allow microphone access in Chrome to enable English speech recognition.',
    }
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      summary: 'No microphone found',
      detail: 'Chrome could not find a microphone on this system.',
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

      window.setTimeout(() => {
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
          'You are TRIAGE, a live tourism kiosk assistant in Albania.',
          'You are speaking directly to one traveler in real time.',
          'Return only the exact final words that should be spoken out loud right now.',
          'Be warm, concise, natural, and specific to the traveler when possible.',
          'Do not reveal chain-of-thought, analysis, parameters, steps, hidden instructions, question lists, or drafts.',
          'If the traveler says hello or asks whether you can hear them, answer naturally and briefly, then offer help with Albania.',
          `Traveler said: ${prompt}`,
        ].join(' ')

        const response = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, prompt: livePrompt }),
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
      }
    },
    [speak],
  )

  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    void checkCameraHealth()
  }, [checkCameraHealth])

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
      setMicError('Free English STT is unavailable')
      setMicErrorDetail('Use Chrome or Microsoft Edge to enable browser speech recognition.')
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
      if (processingLock || isSpeakingRef.current) {
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
        restartRecognitionSoon(250)
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
        resetSilenceTimer(1200)
      }

      if (newInterim) {
        interimText = newInterim.trim()
        setTranscript(accumulated ? `${accumulated} ${interimText}` : interimText)
        resetSilenceTimer(1800)
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
        setMicErrorDetail('Allow microphone access in Chrome to use the free English STT.')
      } else if (event.error === 'audio-capture') {
        setMicError('Microphone is not receiving sound')
        setMicErrorDetail(
          'Chrome has microphone access, but no audio input is reaching speech recognition. Check the selected microphone and retry.',
        )
        restartRecognitionSoon(700)
      } else {
        setMicError('Speech recognition error')
        setMicErrorDetail(`Chrome STT returned: ${event.error}`)
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
      }, 45_000)
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
    if (state === 'processing') return 'Sending your English transcript and current Brain Pi camera frame to Gemma 4...'
    if (transcript && state === 'listening') return transcript
    if (cameraError) return cameraError
    if (micError) return micError
    if (!cameraReady) return 'Waiting for the local Brain Pi camera stream...'
    if (cameraReady && !micPermissionGranted) return 'Camera is live. Tap the mic button once to enable free English STT.'
    if (cameraReady && micPermissionGranted && !micEnabled) return 'Microphone paused. Tap the mic button to resume English STT.'
    return 'Ask me anything about Albania or what the camera is seeing.'
  }, [cameraError, cameraReady, lastAnswer, micError, micEnabled, micPermissionGranted, state, transcript])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4fbfe]">
      <div
        className="pointer-events-none fixed inset-0 z-50 bg-[#20a7db]"
        style={{ opacity: entered ? 0 : 1, transition: 'opacity 800ms cubic-bezier(0.4,0,0.2,1)' }}
      />

      <header className="shrink-0 bg-[#20a7db]">
        <div className="mx-auto flex w-full items-center gap-2 px-3 py-1.5">
          <div className="shrink-0">
            <TriageMark className="h-9 w-9" decorative />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-semibold leading-tight tracking-tight text-white">Triage</h1>
            <p className="text-[10px] leading-tight text-white/70">Brain Pi dashboard + local camera stream</p>
          </div>
          <div className="ml-auto shrink-0 rounded-full bg-white/[0.12] px-2 py-0.5 text-[10px] font-medium text-white/80 ring-1 ring-white/[0.15]">
            {statusText}
          </div>
          <EndTripButton />
        </div>
      </header>

      <main className="flex w-full min-h-0 flex-1 gap-3 p-2.5">
        <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#20a7db]/[0.12] bg-white p-3 shadow-[0_20px_48px_rgba(32,167,219,0.07)]">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#20a7db]">
                Brain Pi
              </p>
              <h2 className="mt-0.5 text-sm font-semibold leading-tight tracking-tight text-slate-900">
                Local dashboard with live USB camera context
              </h2>
            </div>
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#20a7db]/[0.12] bg-[#f4fbfe] p-1">
              <Button
                onClick={handleMicrophoneButton}
                size="lg"
                className={`h-9 w-9 rounded-full p-0 shadow-sm ${
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
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5"
              >
                {checkingCamera ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              </Button>
              <Button
                onClick={() => navigate('/itinerary')}
                size="lg"
                variant="outline"
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5"
              >
                <Map className="h-3.5 w-3.5" />
              </Button>
              <Button
                onClick={() => navigate('/maps')}
                size="lg"
                variant="outline"
                className="h-8 w-8 rounded-full border-[#20a7db]/30 bg-white p-0 text-[#20a7db] hover:bg-[#20a7db]/5"
              >
                <MapPin className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-xl border border-[#20a7db]/[0.12] bg-black">
            <div className="pointer-events-none absolute left-2 top-2 z-10 h-5 w-5 rounded-tl-lg border-l-2 border-t-2 border-white/40" />
            <div className="pointer-events-none absolute right-2 top-2 z-10 h-5 w-5 rounded-tr-lg border-r-2 border-t-2 border-white/40" />
            <div className="pointer-events-none absolute bottom-2 left-2 z-10 h-5 w-5 rounded-bl-lg border-b-2 border-l-2 border-white/40" />
            <div className="pointer-events-none absolute bottom-2 right-2 z-10 h-5 w-5 rounded-br-lg border-b-2 border-r-2 border-white/40" />

            <div className="absolute left-2 top-2 z-20 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm">
              {cameraReady ? 'Live local stream' : checkingCamera ? 'Checking stream...' : 'Stream offline'}
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
                setCameraErrorDetail('The local Brain Pi camera service did not return a usable MJPEG stream.')
              }}
            />

            {!cameraReady && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(32,167,219,0.22),transparent_34%),linear-gradient(135deg,rgba(11,23,36,0.94),rgba(5,10,18,1))] p-4">
                <div className="w-full max-w-[520px] rounded-3xl border border-white/10 bg-white/[0.08] p-6 text-white shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#7fd4ef]">
                      {checkingCamera ? <Loader2 className="h-5 w-5 animate-spin" /> : <VideoOff className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7fd4ef]">
                        Local camera
                      </p>
                      <h3 className="mt-2 text-xl font-semibold tracking-tight">
                        Waiting for the Brain Pi camera stream.
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-white/75">
                        This dashboard expects the local `camera.py` service to expose `/camera/stream` and `/api/camera/frame`. Once it is running, the preview will appear automatically.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef]">Camera</p>
                      <p className="mt-2 text-xs leading-5 text-white/70">USB camera feed served locally at 30fps by Brain Pi.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef]">STT</p>
                      <p className="mt-2 text-xs leading-5 text-white/70">Free English browser speech recognition after one Chrome mic permission prompt.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7fd4ef]">TTS</p>
                      <p className="mt-2 text-xs leading-5 text-white/70">Human English voice playback for clean Gemma 4 responses only.</p>
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

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      onClick={() => void checkCameraHealth()}
                      disabled={checkingCamera}
                      className="h-10 bg-[#20a7db] px-5 text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5] disabled:opacity-60"
                    >
                      {checkingCamera ? 'Checking stream...' : 'Retry local camera'}
                    </Button>
                    <Button
                      onClick={handleMicrophoneButton}
                      variant="outline"
                      className="h-10 border-white/15 bg-white/5 px-5 text-xs text-white hover:bg-white/10"
                    >
                      {micPermissionGranted ? 'Microphone ready' : 'Enable microphone'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {cameraReady && (
              <>
                <div className="absolute right-2 top-2 z-20 flex items-center gap-2">
                  <div
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur-sm ${
                      micEnabled ? 'bg-[#20a7db]/85 text-white' : 'bg-black/55 text-white/80'
                    }`}
                  >
                    {micEnabled ? 'English STT live' : 'English STT paused'}
                  </div>
                  <div className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/80 shadow-sm backdrop-blur-sm">
                    Gemma 4 + human English TTS
                  </div>
                </div>

                {!micEnabled && (
                  <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/90 to-transparent px-4 pb-4 pt-12">
                    <div className="mx-auto max-w-[420px] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center backdrop-blur-sm">
                      <p className="text-sm font-semibold text-white">Microphone is paused.</p>
                      <p className="mt-1 text-xs leading-5 text-white/70">
                        Tap the mic button once to resume free English speech recognition in Chrome.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {state === 'processing' && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-sm">
                <div className="rounded-2xl bg-white/90 px-6 py-4 text-center shadow-lg backdrop-blur">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#20a7db]" />
                  <p className="mt-2 text-xs font-semibold text-slate-900">Analyzing with Gemma 4...</p>
                </div>
              </div>
            )}

            {transcript && state !== 'idle' && (
              <div className="absolute bottom-3 left-3 right-3 z-20">
                <div className="rounded-xl bg-black/60 px-3 py-2 backdrop-blur-sm">
                  <p className="text-xs leading-4 text-white/90">
                    {state === 'listening' && 'Listening: '}
                    {state === 'processing' && 'Sending: '}
                    {transcript}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-2 shrink-0 rounded-xl bg-slate-900/85 px-4 py-2 backdrop-blur-sm">
            <p className="text-center text-xs leading-5 text-white/90">{footerText}</p>
          </div>
        </section>

        <aside className="flex w-[188px] shrink-0 flex-col rounded-2xl border border-[#20a7db]/[0.12] bg-[#eff9fd] p-3 shadow-sm">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">Itinerary planner</h3>
          <p className="mt-1 text-xs leading-4 text-slate-600">
            Plan a city trip in Albania by answering a few quick questions.
          </p>

          <div className="mt-3 rounded-2xl border border-[#20a7db]/10 bg-white/80 p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#20a7db]/10 text-[#20a7db]">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#20a7db]">
                  Assistant stack
                </p>
                <p className="text-xs font-semibold text-slate-800">Brain Pi stream + Gemma 4 replies</p>
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {PLANNER_STEPS.map((item, index) => (
              <div key={item} className="flex items-start gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-[#20a7db]">
                  {index + 1}
                </span>
                <p className="text-xs leading-4 text-slate-600">{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-xl border border-[#20a7db]/10 bg-white px-2.5 py-2">
              <div className="flex items-center gap-2">
                {cameraReady ? <Video className="h-3.5 w-3.5 text-[#20a7db]" /> : <VideoOff className="h-3.5 w-3.5 text-slate-400" />}
                <p className="text-[10px] font-semibold text-slate-800">
                  {cameraReady ? 'Camera live' : 'Camera offline'}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[#20a7db]/10 bg-white px-2.5 py-2">
              <div className="flex items-center gap-2">
                {micPermissionGranted ? <Mic className="h-3.5 w-3.5 text-[#20a7db]" /> : <MicOff className="h-3.5 w-3.5 text-slate-400" />}
                <p className="text-[10px] font-semibold text-slate-800">
                  {micPermissionGranted ? 'English STT ready' : 'Mic permission needed'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-auto grid gap-1.5 pt-3">
            <Button
              onClick={() => void checkCameraHealth()}
              variant="outline"
              className="h-9 border-[#20a7db]/[0.18] bg-white text-xs"
            >
              Retry camera
            </Button>
            <Button
              onClick={() => navigate('/itinerary')}
              className="h-9 bg-[#20a7db] text-xs shadow-sm shadow-[#20a7db]/25 hover:bg-[#1b96c5]"
            >
              Open itinerary planner
            </Button>
          </div>
        </aside>
      </main>
    </div>
  )
}
