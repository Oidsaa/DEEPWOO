/**
 * اعمال ظاهر برنامه (تم روشن/تیره + رنگ تأکیدی دستی) روی ریشهٔ سند.
 * متغیرهای CSS به‌صورت inline روی <html> تنظیم می‌شوند تا هم تم دارک و هم
 * لایت از یک رنگ انتخابی کاربر پیروی کنند.
 */

export type ThemeName = 'dark' | 'light'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_RE.test(hex)) return null
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

/** Mix a color toward black (amount 0..1) — for gradient end / deep shade. */
function darken(hex: string, amount: number): string {
  const c = hexToRgb(hex)!
  return toHex(c.r * (1 - amount), c.g * (1 - amount), c.b * (1 - amount))
}

/** Mix a color toward white (amount 0..1) — for the secondary accent. */
function lighten(hex: string, amount: number): string {
  const c = hexToRgb(hex)!
  return toHex(c.r + (255 - c.r) * amount, c.g + (255 - c.g) * amount, c.b + (255 - c.b) * amount)
}

/** WCAG relative luminance (0..1) — decides readable text color on the accent. */
function luminance(hex: string): number {
  const c = hexToRgb(hex)!
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

const ACCENT_VARS = ['--accent', '--accent-2', '--accent-deep', '--accent-soft', '--accent-ink', '--accent-rgb'] as const

/**
 * Set theme (data attribute) and — when a valid hex is given — derive the whole
 * accent family from it. Without a color, inline overrides are removed so the
 * CSS defaults of the active theme apply.
 */
export function applyAppearance(theme?: ThemeName | null, accentColor?: string | null): void {
  const root = document.documentElement
  root.dataset.theme = theme === 'light' ? 'light' : 'dark'

  const hex = typeof accentColor === 'string' ? accentColor.trim().toLowerCase() : ''
  if (!HEX_RE.test(hex)) {
    ACCENT_VARS.forEach((v) => root.style.removeProperty(v))
    return
  }
  const rgb = hexToRgb(hex)!
  // Text on accent buttons: dark shade of the accent for bright colors, white otherwise.
  const ink = luminance(hex) > 0.45 ? darken(hex, 0.82) : '#ffffff'
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-2', lighten(hex, 0.14))
  root.style.setProperty('--accent-deep', darken(hex, 0.22))
  root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`)
  root.style.setProperty('--accent-ink', ink)
  root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`)
}
