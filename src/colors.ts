import type { Settings } from './settings';

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** Ajusta a luminosidade até atingir um contraste mínimo com o fundo, mantendo o matiz. */
export function ensureContrast(hex: string, bg: string, min = 4.5): string {
  if (contrast(hex, bg) >= min) return hex;
  const [h, s, l0] = rgbToHsl(...hexToRgb(hex));
  const darkBg = luminance(bg) < 0.5;
  let l = l0;
  for (let i = 0; i < 40; i++) {
    l = darkBg ? Math.min(1, l + 0.025) : Math.max(0, l - 0.025);
    const c = rgbToHex(...hslToRgb(h, s, l));
    if (contrast(c, bg) >= min) return c;
  }
  return darkBg ? '#ffffff' : '#000000';
}

const isBlackish = (hex: string) => luminance(hex) < 0.01;

/** Cor final de exibição para uma cor original do PDF. */
export function displayColor(original: string, s: Settings): string {
  const rule = s.colorRules[original];
  if (!s.keepColors) return s.defaultTextColor;
  let c = rule?.display || original;
  if (!rule?.display || rule.display === original) {
    if (isBlackish(original)) c = s.blackAs;
  }
  if (s.boostContrast) c = ensureContrast(c, s.background, 4.5);
  return c;
}

export function colorMode(original: string, s: Settings) {
  return s.colorRules[original]?.mode ?? 'show';
}
