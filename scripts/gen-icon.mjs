/**
 * Generates build/icon.png (512 + 256) and build/icon.ico (256) with pure Node —
 * no external image libraries. A dark rounded square with an ascending
 * three-bar "dashboard" mark in white/teal.
 */
import { deflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'build')

/* ---------------------------- png encoder ---------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function encodeIco(png256) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  header[6] = 0 // width 256
  header[7] = 0 // height 256
  header[10] = 1 // planes
  header.writeUInt16LE(32, 12) // bpp
  header.writeUInt32LE(png256.length, 14)
  header.writeUInt32LE(22, 18) // offset
  return Buffer.concat([header, png256])
}

/* ------------------------------ drawing ------------------------------ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 4x supersampled coverage of a rounded-rect at (x0,y0,w,h) with radius r. */
function insideRR(px, py, x0, y0, w, h, r) {
  let hits = 0
  for (let sy = 0; sy < 2; sy++) {
    for (let sx = 0; sx < 2; sx++) {
      const x = px + sx * 0.5 + 0.25
      const y = py + sy * 0.5 + 0.25
      const cx = clamp(x, x0 + r, x0 + w - r)
      const cy = clamp(y, y0 + r, y0 + h - r)
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r * r) hits++
    }
  }
  return hits / 4
}

const mix = (a, b, t) => a + (b - a) * t

function drawIcon(size) {
  const s = size
  const buf = Buffer.alloc(s * s * 4)
  const r = Math.round(s * 0.212) // corner radius
  const gl = s * 0.05 // icon margin (transparent gutter)

  // bar geometry (fractions of size)
  const bw = 0.1 * s
  const gap = 0.045 * s
  const totalW = bw * 3 + gap * 2
  const x0 = (s - totalW) / 2
  const baseY = 0.74 * s
  const heights = [0.21 * s, 0.32 * s, 0.43 * s]
  const bars = heights.map((h, i) => ({ x: x0 + i * (bw + gap), y: baseY - h, w: bw, h, a: [0.55, 0.78, 1][i] }))

  const glowCx = s * 0.5
  const glowCy = s * 0.34
  const glowR = s * 0.55

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const o = (y * s + x) * 4
      // rounded-square coverage
      const cov = insideRR(x, y, gl, gl, s - gl * 2, s - gl * 2, r)
      if (cov <= 0) continue

      // vertical navy gradient
      const t = y / s
      let R = mix(0x18, 0x0a, t)
      let G = mix(0x28, 0x11, t)
      let B = mix(0x42, 0x20, t)

      // teal radial glow upper area
      const d = Math.hypot(x - glowCx, y - glowCy) / glowR
      if (d < 1) {
        const g = (1 - d) * (1 - d) * 0.16
        R = mix(R, 0x2d, g)
        G = mix(G, 0xd4, g)
        B = mix(B, 0xbf, g)
      }

      // bars
      for (const bar of bars) {
        const bc = insideRR(x, y, bar.x, bar.y, bar.w, bar.h, bar.w / 2)
        if (bc > 0) {
          const ba = bar.a * bc
          R = mix(R, 0xe8, ba)
          G = mix(G, 0xff, ba)
          B = mix(B, 0xfb, ba)
        }
      }

      buf[o] = Math.round(R)
      buf[o + 1] = Math.round(G)
      buf[o + 2] = Math.round(B)
      buf[o + 3] = Math.round(255 * cov)
    }
  }
  return buf
}

/* -------------------------------- main ------------------------------- */

fs.mkdirSync(OUT, { recursive: true })

const png512 = encodePng(512, 512, drawIcon(512))
const png256 = encodePng(256, 256, drawIcon(256))
const ico = encodeIco(png256)

fs.writeFileSync(path.join(OUT, 'icon.png'), png512)
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico)
console.log('✓ build/icon.png (512×512,', png512.length, 'bytes)')
console.log('✓ build/icon.ico (256×256,', ico.length, 'bytes)')
