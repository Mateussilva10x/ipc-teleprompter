export type SpeedMode = 'speed' | 'duration';
export type MarkerStyle = 'arrow' | 'line' | 'band' | 'none';
export type Align = 'left' | 'center' | 'right';

export interface ColorRule {
  /** Nome amigável (ex.: "Sopranos") */
  label: string;
  /** Cor de exibição (pode ser diferente da original) */
  display: string;
  /** 'show' normal | 'dim' esmaecido | 'hide' oculto */
  mode: 'show' | 'dim' | 'hide';
}

export interface Settings {
  // Rolagem
  speedMode: SpeedMode;
  /** Linhas por minuto no modo velocidade */
  linesPerMinute: number;
  speedStep: number;
  countdown: number;
  loop: boolean;
  smoothStart: boolean;
  pauseOnSectionEnd: boolean;
  startPaused: boolean;
  // Texto
  visibleLines: number;
  /** Mínimo de caracteres por linha: limita a fonte em telas estreitas (celular em pé) */
  minCharsPerLine: number;
  lineHeight: number;
  fontFamily: string;
  bold: boolean;
  uppercase: boolean;
  letterSpacing: number;
  textWidth: number;
  align: Align;
  stanzaGap: number;
  showTitles: boolean;
  titleScale: number;
  textShadow: boolean;
  // Cores
  keepColors: boolean;
  background: string;
  defaultTextColor: string;
  blackAs: string;
  boostContrast: boolean;
  colorRules: Record<string, ColorRule>;
  // Tela
  mirrorH: boolean;
  mirrorV: boolean;
  markerStyle: MarkerStyle;
  markerPosition: number;
  markerColor: string;
  dimOutside: number;
  edgeFade: boolean;
  showProgress: boolean;
  showClock: boolean;
  showTimer: boolean;
  hudAutoHide: boolean;
  wakeLock: boolean;
}

export const FONTS: { label: string; value: string }[] = [
  { label: 'Sans (Arial / Helvetica)', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Roboto', value: "'Roboto', Arial, sans-serif" },
  { label: 'Open Sans', value: "'Open Sans', Arial, sans-serif" },
  { label: 'Verdana (alta legibilidade)', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Georgia (serifa)', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Monoespaçada', value: "'Courier New', monospace" },
];

export const DEFAULTS: Settings = {
  speedMode: 'speed',
  linesPerMinute: 30,
  speedStep: 2,
  countdown: 3,
  loop: false,
  smoothStart: true,
  pauseOnSectionEnd: false,
  startPaused: false,

  visibleLines: 6,
  minCharsPerLine: 22,
  lineHeight: 1.35,
  fontFamily: FONTS[0].value,
  bold: true,
  uppercase: false,
  letterSpacing: 0,
  textWidth: 90,
  align: 'left',
  stanzaGap: 1,
  showTitles: true,
  titleScale: 0.8,
  textShadow: false,

  keepColors: true,
  background: '#000000',
  defaultTextColor: '#ffffff',
  blackAs: '#ffffff',
  boostContrast: true,
  colorRules: {},

  mirrorH: false,
  mirrorV: false,
  markerStyle: 'arrow',
  markerPosition: 30,
  markerColor: '#ff3b30',
  dimOutside: 35,
  edgeFade: true,
  showProgress: true,
  showClock: true,
  showTimer: true,
  hudAutoHide: true,
  wakeLock: true,
};

const KEY = 'ipc-teleprompter:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage indisponível */
  }
  return structuredClone(DEFAULTS);
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const PRESETS_KEY = 'ipc-teleprompter:presets:v1';

export function loadPresets(): Record<string, Partial<Settings>> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePresets(p: Record<string, Partial<Settings>>) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const BUILTIN_PRESETS: Record<string, Partial<Settings>> = {
  'Jornal (padrão TV)': {
    background: '#000000', blackAs: '#ffffff', visibleLines: 6, lineHeight: 1.3, bold: true, uppercase: false,
    markerStyle: 'arrow', markerPosition: 30, dimOutside: 35, textWidth: 90, align: 'left', fontFamily: FONTS[0].value,
  },
  'Coral / Cantata': {
    background: '#000000', blackAs: '#ffffff', visibleLines: 8, lineHeight: 1.35, bold: true,
    markerStyle: 'band', markerPosition: 35, dimOutside: 25, textWidth: 95, align: 'center', showTitles: true,
  },
  'Palco (letras grandes)': {
    visibleLines: 4, lineHeight: 1.2, bold: true, uppercase: true, markerStyle: 'line', markerPosition: 40, dimOutside: 45,
    textWidth: 98, align: 'center',
  },
  'Papel (fundo claro)': {
    background: '#ffffff', blackAs: '#000000', boostContrast: false, visibleLines: 10, bold: false, markerStyle: 'band',
    dimOutside: 0, edgeFade: false,
  },
  'Espelho (vidro/beam-splitter)': { mirrorH: true },
};
