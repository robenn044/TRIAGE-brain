import { useLocation, useNavigate } from 'react-router-dom'

export default function EndTripButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <button
      onClick={() => {
        sessionStorage.clear()
        if (pathname !== '/') {
          navigate('/')
          return
        }

        window.location.replace('/')
      }}
      className="shrink-0 rounded-full bg-white/[0.12] px-2.5 py-1 text-[9px] font-semibold text-red-200 ring-1 ring-red-300/30 transition-colors hover:bg-red-500/20 hover:text-white active:scale-95"
    >
      End Trip
    </button>
  )
}
