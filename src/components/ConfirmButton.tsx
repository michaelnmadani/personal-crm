import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A remove button that takes two taps: the first turns it into "Remove?", the
 * second does it. A stray tap on a small × can't lose anything, there's no
 * dialog to dismiss, and it stands down by itself after a few seconds.
 */
export function ConfirmButton({
  onConfirm,
  label,
  children,
  className = '',
  idleClassName = 'text-slate-600 hover:text-red-400',
  armedClassName = 'text-xs font-medium text-red-400 whitespace-nowrap',
  confirmText = 'Remove?',
}: {
  onConfirm: () => void
  /** What it does, for screen readers: "Remove connection". */
  label: string
  /** The resting look — usually an × icon. */
  children: ReactNode
  /** Always applied: layout and position. */
  className?: string
  /** Only while waiting for the first tap — colour, and hide-until-hover. */
  idleClassName?: string
  /** Only while waiting for the second tap. */
  armedClassName?: string
  confirmText?: string
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      className={`${className} ${armed ? armedClassName : idleClassName}`}
      aria-label={armed ? `Confirm: ${label}` : label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.clearTimeout(timer.current)
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          timer.current = window.setTimeout(() => setArmed(false), 4000)
        }
      }}
    >
      {armed ? confirmText : children}
    </button>
  )
}
