import { initials } from '../lib/utils'

const HUES = [210, 260, 300, 340, 20, 60, 100, 140, 180]

export function Avatar({
  contact,
  size = 'md',
}: {
  contact: { first_name: string; last_name?: string | null }
  size?: 'sm' | 'md' | 'lg'
}) {
  const text = initials(contact).toUpperCase()
  const hue = HUES[(text.charCodeAt(0) + (text.charCodeAt(1) || 0)) % HUES.length]
  const cls = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-xl' }[size]
  return (
    <div
      className={`${cls} rounded-full grid place-items-center font-semibold shrink-0 text-white`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${hue + 40} 60% 35%))` }}
    >
      {text}
    </div>
  )
}
