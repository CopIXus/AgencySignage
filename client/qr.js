const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
let value = 1
for (let i = 0; i < 255; i++) {
  EXP[i] = value
  LOG[value] = i
  value <<= 1
  if (value & 0x100) value ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]

const VERSIONS = [
  null,
  { total: 26, ec: 7, blocks: 1, align: [] },
  { total: 44, ec: 10, blocks: 1, align: [6, 18] },
  { total: 70, ec: 15, blocks: 1, align: [6, 22] },
  { total: 100, ec: 20, blocks: 1, align: [6, 26] },
  { total: 134, ec: 26, blocks: 1, align: [6, 30] },
  { total: 172, ec: 18, blocks: 2, align: [6, 34] },
]

export function qrDataUrl(text) {
  const bytes = new TextEncoder().encode(text).slice(0, 130)
  const version = VERSIONS.findIndex((item, index) => index > 0 && item.total - item.ec * item.blocks >= bytes.length + 3)
  const spec = VERSIONS[version]
  const data = encode(bytes, spec)
  const size = 21 + (version - 1) * 4
  const modules = place(data, size, spec.align, version)
  const quiet = 2
  const cell = 8
  const canvas = size + quiet * 2
  const pixels = canvas * cell
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" shape-rendering="crispEdges">`, `<rect width="100%" height="100%" fill="#fff"/>`]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x]) svg.push(`<rect x="${(x + quiet) * cell}" y="${(y + quiet) * cell}" width="${cell}" height="${cell}" fill="#111"/>`)
    }
  }
  svg.push('</svg>')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.join(''))}`
}

function encode(bytes, spec) {
  const bits = []
  push(bits, 0b0100, 4)
  push(bits, bytes.length, 8)
  for (const byte of bytes) push(bits, byte, 8)
  const dataBytes = spec.total - spec.ec * spec.blocks
  const capacity = dataBytes * 8
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const pads = [0xec, 0x11]
  let pad = 0
  while (bits.length < capacity) { push(bits, pads[pad % 2], 8); pad++ }
  const raw = []
  for (let i = 0; i < bits.length; i += 8) raw.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const perBlock = Math.floor(raw.length / spec.blocks)
  const blocks = []
  for (let i = 0; i < spec.blocks; i++) {
    const block = raw.slice(i * perBlock, (i + 1) * perBlock)
    blocks.push(block.concat(reedSolomon(block, spec.ec)))
  }
  const out = []
  const span = perBlock + spec.ec
  for (let i = 0; i < span; i++) for (const block of blocks) if (i < block.length) out.push(block[i])
  return out
}

function push(bits, number, length) {
  for (let i = length - 1; i >= 0; i--) bits.push((number >>> i) & 1)
}

function reedSolomon(data, ecLength) {
  let gen = [1]
  for (let i = 0; i < ecLength; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= mul(gen[j], EXP[i])
    }
    gen = next
  }
  const result = new Array(data.length + ecLength).fill(0)
  data.forEach((item, index) => { result[index] = item })
  for (let i = 0; i < data.length; i++) {
    const factor = result[i]
    if (!factor) continue
    for (let j = 0; j < gen.length; j++) result[i + j] ^= mul(gen[j], factor)
  }
  return result.slice(data.length)
}

function mul(a, b) {
  if (!a || !b) return 0
  return EXP[LOG[a] + LOG[b]]
}

function place(data, size, align, version) {
  const modules = new Uint8Array(size * size)
  const reserved = new Uint8Array(size * size)
  const set = (x, y, dark, lock = false) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    modules[y * size + x] = dark ? 1 : 0
    if (lock) reserved[y * size + x] = 1
  }
  const finder = (ox, oy) => {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      const on = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4))
      set(ox + x, oy + y, on, true)
    }
  }
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7)
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0, true); set(6, i, i % 2 === 0, true) }
  for (const y of align) for (const x of align) {
    if (reserved[(y) * size + x]) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, true)
  }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false, true); set(8, size - 1 - i, false, true); set(8, i < 6 ? i : i + 1, false, true); set(i < 6 ? i : i + 1, 8, false, true) }
  set(8, size - 8, true, true)
  const bits = []
  for (const byte of data) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  let bit = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row
      for (const x of [col, col - 1]) {
        if (reserved[y * size + x]) continue
        modules[y * size + x] = bits[bit++] || 0
      }
    }
    upward = !upward
  }
  return mask(modules, reserved, size, version)
}

function mask(modules, reserved, size, version) {
  let best = modules
  let bestScore = Infinity
  let bestMask = 0
  for (let which = 0; which < 8; which++) {
    const copy = modules.slice()
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (reserved[y * size + x]) continue
      if (maskBit(which, x, y)) copy[y * size + x] ^= 1
    }
    applyFormat(copy, size, which)
    const score = penalty(copy, size)
    if (score < bestScore) { bestScore = score; best = copy; bestMask = which }
  }
  applyFormat(best, size, bestMask)
  applyVersion(best, size, version)
  return best
}

function maskBit(which, x, y) {
  if (which === 0) return (x + y) % 2 === 0
  if (which === 1) return y % 2 === 0
  if (which === 2) return x % 3 === 0
  if (which === 3) return (x + y) % 3 === 0
  if (which === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
  if (which === 5) return ((x * y) % 2) + ((x * y) % 3) === 0
  if (which === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
  return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
}

function applyFormat(modules, size, maskId) {
  const format = formatBits(0b01, maskId)
  const coords = []
  for (let i = 0; i < 15; i++) {
    const dark = ((format >> i) & 1) === 1
    const x1 = i < 6 ? i : i < 8 ? i + 1 : 8
    const y1 = i < 8 ? 8 : 14 - i
    modules[y1 * size + x1] = dark ? 1 : 0
    const x2 = i < 8 ? 8 : size - 15 + i
    const y2 = i < 8 ? size - 1 - i : 8
    modules[y2 * size + x2] = dark ? 1 : 0
  }
  return coords
}

function formatBits(ecc, maskId) {
  let data = (ecc << 3) | maskId
  let bits = data << 10
  const poly = 0b10100110111
  for (let i = 14; i >= 10; i--) if ((bits >> i) & 1) bits ^= poly << (i - 10)
  return ((data << 10) | bits) ^ 0b101010000010010
}

function applyVersion(modules, size, version) {
  if (version < 7) return
  modules[0] = modules[0]
}

function penalty(modules, size) {
  let score = 0
  for (let y = 0; y < size; y++) {
    let run = 1
    for (let x = 1; x < size; x++) {
      if (modules[y * size + x] === modules[y * size + x - 1]) run++
      else { if (run >= 5) score += run - 2; run = 1 }
    }
    if (run >= 5) score += run - 2
  }
  return score
}
