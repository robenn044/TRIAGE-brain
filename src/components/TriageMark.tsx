import { cn } from '@/lib/utils'

interface TriageMarkProps {
  className?: string
  alt?: string
  decorative?: boolean
}

export default function TriageMark({
  className,
  alt = 'TRIAGE logo',
  decorative = false,
}: TriageMarkProps) {
  return (
    <img
      src="/triage-mark.svg"
      alt={decorative ? '' : alt}
      aria-hidden={decorative || undefined}
      className={cn('block h-10 w-10 object-contain', className)}
    />
  )
}
