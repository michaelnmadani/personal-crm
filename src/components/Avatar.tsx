import { initials } from '../lib/utils'

const HUES = [210, 260, 300, 340, 20, 60, 100, 140, 180]
const SIZES = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-xl', xl: 'w-24 h-24 text-3xl' }

export function Avatar({
  contact,
  size = 'md',
  src,
}: {
  contact: { first_name: string; last_name?: string | null }
  size?: 'sm' | 'md' | 'lg' | 'xl'
  src?: string | null
}) {
  const cls = SIZES[size]
  if (src) {
    return <img src={src} alt="" className={`${cls} rounded-full object-cover shrink-0 bg-slate-800`} />
  }
  const text = initials(contact).toUpperCase()
  const hue = HUES[(text.charCodeAt(0) + (text.charCodeAt(1) || 0)) % HUES.length]
  return (
    <div
      className={`${cls} rounded-full grid place-items-center font-semibold shrink-0 text-white`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${hue + 40} 60% 35%))` }}
    >
      {text}
    </div>
  )
}
