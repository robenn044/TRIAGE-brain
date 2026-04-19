import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RobotFace from '@/components/RobotFace'

const Index = () => {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  const handleUnlock = () => {
    setLeaving(true)
    const returnPath = sessionStorage.getItem('lockReturnPath') || '/dashboard'
    sessionStorage.removeItem('lockReturnPath')
    setTimeout(() => navigate(returnPath), 350)
  }

  return (
    <div
      className="flex min-h-screen bg-[#20a7db]"
      style={{ opacity: leaving ? 0 : 1, transition: 'opacity 700ms cubic-bezier(0.4,0,0.2,1)' }}
    >
      <RobotFace onUnlock={handleUnlock} />
    </div>
  )
}

export default Index
