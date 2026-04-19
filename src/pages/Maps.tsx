import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import RobotFace from '@/components/RobotFace'
import EndTripButton from '@/components/EndTripButton'

const TIMEOUT = 60_000

export default function Maps() {
  const navigate = useNavigate()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { sessionStorage.setItem('lockReturnPath', '/maps'); navigate('/') }, TIMEOUT)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, reset))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, reset))
    }
  }, [navigate])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4fbfe]">
      {/* Header */}
      <header className="shrink-0 bg-[#20a7db]">
        <div className="mx-auto flex w-full items-center gap-2 px-3 py-1.5">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.12] text-white/80 ring-1 ring-white/[0.15] transition-colors hover:bg-white/[0.18] hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>

          <div className="shrink-0 flex items-center justify-center">
            <RobotFace mini />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xs font-semibold text-white">Triage</h1>
            <p className="truncate text-[10px] text-white/70">Explore the map</p>
          </div>
          <EndTripButton />
        </div>
      </header>

      {/* Full-screen map iframe */}
      <main className="min-h-0 flex-1">
        <iframe
          title="Google Maps"
          src="https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d1500000!2d20.1!3d41.1!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sal!4v1"
          className="h-full w-full border-0"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </main>
    </div>
  )
}
