/**
 * Name matching for find_people — the same matcher the inbox uses to resolve
 * dictated names (src/lib/parseCapture.ts), copied here because an edge
 * function is deployed on its own. Keep the two in step.
 */

/** Lowercase, accents off, apostrophes and hyphens dropped: "O'Gilt" → "ogilt". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`-]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const joined = (s: string) => normalizeName(s).replace(/ /g, '')

/**
 * A rough sound-alike key. Speech keeps the consonants of a name far more
 * reliably than its vowels — "Wangnoo" comes back as "Wang new", "Akanksha" as
 * "Akansha" — so this keeps the first letter, folds letters that sound alike,
 * and drops the vowels after it.
 */
export function soundKey(s: string): string {
  let w = joined(s)
  if (!w) return ''
  w = w
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^ps/, 's')
    .replace(/mb$/, 'm')
    .replace(/tch/g, 'ch')
    .replace(/(sh|ch|sch)/g, 'X')
    .replace(/ph/g, 'f')
    .replace(/(ck|cq)/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/dg/g, 'j')
    .replace(/wh/g, 'w')
    .replace(/th/g, 't')
    .replace(/(?!^)gh/g, '')
    .replace(/v/g, 'f')
    .replace(/y/g, 'i')
  const first = /[aeiou]/.test(w[0]) ? 'a' : w[0]
  const rest = w
    .slice(1)
    .replace(/[aeiou]/g, '')
    .replace(/h/g, '')
    .replace(/w(?![aeiou])/g, '')
  return (first + rest).replace(/(.)\1+/g, '$1')
}

/** Jaro-Winkler similarity, 0–1. Rewards a shared beginning, which names usually keep. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 || lb === 0) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aHit = new Array<boolean>(la).fill(false)
  const bHit = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, lb)
    for (let j = lo; j < hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue
      aHit[i] = true
      bHit[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0
  let k = 0
  let transpositions = 0
  for (let i = 0; i < la; i++) {
    if (!aHit[i]) continue
    while (!bHit[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3
  let prefix = 0
  while (prefix < Math.min(4, la, lb) && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

export type Nameable = { first_name: string; last_name: string | null; nickname: string | null }

/**
 * How well a spoken or typed name fits a contact, 0–1. Every word said has to
 * find a home in the contact's name (first, last or nickname): "Sarah" fits
 * every Sarah, "Sarah Little" only one of them, and "Sarah Thornley" still
 * fits Sarah Thornely. Whole-name sound-alikes catch "a conscious wang new".
 */
export function nameScore(query: string, c: Nameable): number {
  const q = normalizeName(query)
  if (!q) return 0
  const parts = [c.first_name, c.last_name, c.nickname].filter((p): p is string => !!p).flatMap((p) => normalizeName(p).split(' '))
  const full = normalizeName([c.first_name, c.last_name].filter(Boolean).join(' '))
  if (q === full || (c.nickname && q === normalizeName(c.nickname))) return 1

  const words = q.split(' ')
  let total = 0
  for (const w of words) {
    let best = 0
    for (const p of parts) {
      if (!p) continue
      let s = jaroWinkler(w, p)
      if (p.startsWith(w) && w.length >= 3) s = Math.max(s, 0.93)
      if (w.length >= 3 && soundKey(w) === soundKey(p)) s = Math.max(s, 0.9)
      best = Math.max(best, s)
    }
    total += best
  }
  const perWord = total / words.length

  // Said as one run of sounds, however the words fell — "a conscious wang new"
  // for Akanksha Wangnoo. Only for longer names: short sound keys collide.
  const qs = soundKey(q)
  const fs = soundKey(full)
  const whole = qs && qs === fs ? 0.9 : qs.length >= 6 && fs.length >= 6 ? jaroWinkler(qs, fs) * 0.95 : 0
  return Math.max(perWord, whole, jaroWinkler(joined(q), joined(full)) * 0.97)
}
