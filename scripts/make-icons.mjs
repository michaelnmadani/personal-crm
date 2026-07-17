// Generates the PWA icons (a small network-graph motif) with zero dependencies:
// raw RGBA pixels hand-encoded into PNG via zlib.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const smooth = (d, aa) => clamp01(0.5 - d / aa) // d<0 inside

function render(size) {
  const buf = Buffer.alloc(size * size * 4)
  const aa = 2 / size
  // network: three big nodes + one small, connected
  const nodes = [
    { x: 0.32, y: 0.34, r: 0.1 },
    { x: 0.7, y: 0.28, r: 0.085 },
    { x: 0.5, y: 0.7, r: 0.1 },
    { x: 0.76, y: 0.62, r: 0.06 },
  ]
  const edges = [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 3],
    [2, 3],
  ]
  const segDist = (px, py, a, b) => {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const t = clamp01(((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy))
    return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy))
  }
  for (let yi = 0; yi < size; yi++) {
    for (let xi = 0; xi < size; xi++) {
      const x = (xi + 0.5) / size
      const y = (yi + 0.5) / size
      // diagonal background gradient: deep indigo -> slate
      const g = (x + y) / 2
      let r = 30 + (15 - 30) * g
      let gc = 27 + (23 - 27) * g
      let b = 75 + (42 - 75) * g
      // edges
      let lineA = 0
      for (const [i, j] of edges) lineA = Math.max(lineA, smooth(segDist(x, y, nodes[i], nodes[j]) - 0.018, aa))
      if (lineA > 0) {
        r = r + (129 - r) * lineA
        gc = gc + (140 - gc) * lineA
        b = b + (248 - b) * lineA
      }
      // nodes (light indigo fill)
      let nodeA = 0
      for (const n of nodes) nodeA = Math.max(nodeA, smooth(Math.hypot(x - n.x, y - n.y) - n.r, aa))
      if (nodeA > 0) {
        r = r + (199 - r) * nodeA
        gc = gc + (210 - gc) * nodeA
        b = b + (254 - b) * nodeA
      }
      const o = (yi * size + xi) * 4
      buf[o] = Math.round(r)
      buf[o + 1] = Math.round(gc)
      buf[o + 2] = Math.round(b)
      buf[o + 3] = 255
    }
  }
  return buf
}

for (const [file, size] of [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
  ['build/icon.png', 1024], // electron-builder derives the .icns / .ico from this
]) {
  mkdirSync(dirname(file), { recursive: true }) // dirs aren't tracked by git when empty
  writeFileSync(file, png(size, render(size)))
  console.log(`wrote ${file}`)
}
