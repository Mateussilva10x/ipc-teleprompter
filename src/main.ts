import './style.css';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { parsePdf } from './pdfParser';
import { parseText } from './textParser';
import { Prompter, type Anchor, type PrompterState } from './prompter';
import {
  BUILTIN_PRESETS, DEFAULTS, FONTS, loadPresets, loadSettings, savePresets, saveSettings, type Settings,
} from './settings';
import { displayColor } from './colors';
import { RemoteHost, qrDataUrl, remoteLink, runRemote, type RemoteMessage, type RemoteState } from './remote';
import type { Script } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCRIPT_KEY = 'ipc-teleprompter:script:v1';
const IMPORT_KEY = 'ipc-teleprompter:import:v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('ipc-teleprompter') : null;

let settings: Settings = loadSettings();
let script: Script | null = loadScript();
let importOpts = loadImportOpts();
let preview: Prompter | null = null;
let live: Prompter | null = null;
let lastFile: { data: Uint8Array; name: string } | null = null;

const app = document.getElementById('app')!;
const isDisplay = new URLSearchParams(location.search).has('display');
const remoteId = new URLSearchParams(location.search).get('remote');
let lastState: PrompterState | null = null;

// ---------------------------------------------------------------- utilidades
function $(sel: string, root: ParentNode = document) {
  return root.querySelector(sel) as HTMLElement;
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
function parseTime(v: string) {
  const parts = v.trim().split(':').map((x) => parseInt(x, 10) || 0);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
function loadScript(): Script | null {
  try {
    const raw = localStorage.getItem(SCRIPT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveScript() {
  try {
    if (script) localStorage.setItem(SCRIPT_KEY, JSON.stringify(script));
  } catch {
    /* ignore */
  }
}
function loadImportOpts() {
  try {
    return { detectColumns: true, mergeWrapped: true, ...JSON.parse(localStorage.getItem(IMPORT_KEY) || '{}') };
  } catch {
    return { detectColumns: true, mergeWrapped: true };
  }
}
function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 1800);
  setTimeout(() => t.remove(), 2300);
}
function updateSettings(patch: Partial<Settings>, rerender = true) {
  settings = { ...settings, ...patch };
  saveSettings(settings);
  preview?.setSettings(settings, rerender);
  live?.setSettings(settings, rerender);
  channel?.postMessage({ type: 'settings', settings });
}

// ---------------------------------------------------------------- importação
async function importFile(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  lastFile = { data: buf, name: file.name };
  await importData(buf, file.name);
}

async function importData(buf: Uint8Array, name: string) {
  const status = document.querySelector('.import-status') as HTMLElement | null;
  const setStatus = (t: string) => status && (status.textContent = t);
  try {
    let s: Script;
    if (/\.(txt|md)$/i.test(name)) {
      s = parseText(new TextDecoder().decode(buf), name);
    } else {
      setStatus('Lendo PDF…');
      s = await parsePdf(pdfjs, buf.slice(), name, importOpts, (p) => setStatus(`Lendo PDF… ${Math.round(p * 100)}%`));
    }
    if (!s.elements.length) throw new Error('Nenhum texto encontrado (o PDF pode ser uma imagem escaneada).');
    // mantém durações de músicas com o mesmo título
    if (script) {
      const prev = new Map(script.sections.map((x) => [x.title, x.duration]));
      s.sections.forEach((sec) => (sec.duration = prev.get(sec.title) ?? 0));
    }
    script = s;
    saveScript();
    channel?.postMessage({ type: 'script', script });
    showEditor();
    toast(`${s.sections.length} música(s), ${s.elements.filter((e) => e.kind === 'line').length} linhas importadas`);
  } catch (err) {
    console.error(err);
    setStatus('');
    alert('Não foi possível ler o arquivo: ' + (err as Error).message);
  }
}

function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf,.txt,text/plain';
  inp.onchange = () => inp.files?.[0] && importFile(inp.files[0]);
  inp.click();
}

function bindDrop(el: HTMLElement) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('drag');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) importFile(f);
  });
}

// ---------------------------------------------------------------- tela inicial
function showHome() {
  destroyLive();
  preview?.destroy();
  preview = null;
  app.innerHTML = `
  <main class="home">
    <header class="brand">
      ${logo()}
      <div><h1>IPC Teleprompter</h1><p>Transforme a letra em PDF em um teleprompter profissional — com as cores originais.</p></div>
    </header>
    <section class="drop" tabindex="0">
      <div class="drop-icon">📄</div>
      <strong>Arraste o PDF aqui</strong>
      <span>ou toque para escolher um arquivo (PDF ou TXT)</span>
      <span class="import-status"></span>
    </section>
    <div class="import-opts">
      <label><input type="checkbox" id="opt-cols" ${importOpts.detectColumns ? 'checked' : ''}> Detectar colunas (ler coluna esquerda e depois a direita)</label>
      <label><input type="checkbox" id="opt-wrap" ${importOpts.mergeWrapped ? 'checked' : ''}> Juntar linhas quebradas automaticamente</label>
    </div>
    ${script ? `<button class="btn ghost resume">↺ Continuar com “${esc(script.name)}”</button>` : ''}
    <ul class="features">
      <li><b>Cores preservadas</b> — cada naipe/voz com a cor do PDF, com ajuste de contraste para fundo escuro.</li>
      <li><b>Rolagem automática</b> por velocidade (linhas/min) ou por duração de cada música.</li>
      <li><b>Estilo jornal</b>: marcador de leitura, espelhamento, contagem regressiva, linhas visíveis, tela cheia.</li>
      <li><b>Janela de exibição</b> separada para o segundo monitor, controlada por esta tela.</li>
    </ul>
  </main>`;
  const drop = $('.drop');
  drop.onclick = pickFile;
  drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && pickFile();
  bindDrop(drop);
  bindDrop(document.body);
  const saveOpts = () => {
    importOpts = { detectColumns: ($('#opt-cols') as HTMLInputElement).checked, mergeWrapped: ($('#opt-wrap') as HTMLInputElement).checked };
    localStorage.setItem(IMPORT_KEY, JSON.stringify(importOpts));
  };
  $('#opt-cols').onchange = saveOpts;
  $('#opt-wrap').onchange = saveOpts;
  const resume = document.querySelector('.resume') as HTMLElement | null;
  if (resume) resume.onclick = showEditor;
}

function logo() {
  return `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect x="4" y="10" width="56" height="40" rx="6" fill="#111" stroke="#ff3b30" stroke-width="3"/><path d="M14 22h30M14 30h36M14 38h22" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M8 30l-6-4v8z" fill="#ff3b30"/><rect x="26" y="52" width="12" height="6" rx="2" fill="#ff3b30"/></svg>`;
}

// ---------------------------------------------------------------- configurações
type Field =
  | { k: keyof Settings; t: 'range'; label: string; min: number; max: number; step: number; unit?: string; fmt?: (v: number) => string }
  | { k: keyof Settings; t: 'check'; label: string }
  | { k: keyof Settings; t: 'color'; label: string }
  | { k: keyof Settings; t: 'select'; label: string; options: { label: string; value: string }[] };

const TABS: { id: string; label: string; fields: Field[] }[] = [
  {
    id: 'scroll', label: 'Rolagem', fields: [
      { k: 'speedMode', t: 'select', label: 'Modo de rolagem', options: [{ label: 'Velocidade constante (linhas/min)', value: 'speed' }, { label: 'Duração por música (mm:ss)', value: 'duration' }] },
      { k: 'linesPerMinute', t: 'range', label: 'Velocidade', min: 2, max: 240, step: 1, unit: ' linhas/min' },
      { k: 'speedStep', t: 'range', label: 'Passo do ajuste de velocidade', min: 1, max: 20, step: 1, unit: ' l/min' },
      { k: 'countdown', t: 'range', label: 'Contagem regressiva', min: 0, max: 10, step: 1, unit: ' s' },
      { k: 'smoothStart', t: 'check', label: 'Partida suave (acelera gradualmente)' },
      { k: 'pauseOnSectionEnd', t: 'check', label: 'Pausar ao chegar na próxima música' },
      { k: 'loop', t: 'check', label: 'Repetir ao chegar no fim' },
    ],
  },
  {
    id: 'text', label: 'Texto', fields: [
      { k: 'visibleLines', t: 'range', label: 'Linhas visíveis na tela', min: 2, max: 30, step: 1, unit: ' linhas' },
      { k: 'minCharsPerLine', t: 'range', label: 'Mín. de caracteres por linha (telas estreitas)', min: 0, max: 50, step: 1, fmt: (v) => (v ? v + ' car.' : 'desligado') },
      { k: 'lineHeight', t: 'range', label: 'Espaçamento entre linhas', min: 1, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { k: 'stanzaGap', t: 'range', label: 'Espaço entre estrofes', min: 0, max: 3, step: 0.25, fmt: (v) => v + ' linha(s)' },
      { k: 'fontFamily', t: 'select', label: 'Fonte', options: FONTS },
      { k: 'bold', t: 'check', label: 'Negrito' },
      { k: 'uppercase', t: 'check', label: 'MAIÚSCULAS' },
      { k: 'textShadow', t: 'check', label: 'Contorno/sombra no texto' },
      { k: 'letterSpacing', t: 'range', label: 'Espaçamento entre letras', min: -0.05, max: 0.3, step: 0.01, fmt: (v) => v.toFixed(2) + 'em' },
      { k: 'textWidth', t: 'range', label: 'Largura do texto', min: 40, max: 100, step: 1, unit: '%' },
      { k: 'align', t: 'select', label: 'Alinhamento', options: [{ label: 'Esquerda', value: 'left' }, { label: 'Centro', value: 'center' }, { label: 'Direita', value: 'right' }] },
      { k: 'showTitles', t: 'check', label: 'Mostrar títulos das músicas' },
      { k: 'titleScale', t: 'range', label: 'Tamanho do título', min: 0.4, max: 1.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'colors', label: 'Cores', fields: [
      { k: 'keepColors', t: 'check', label: 'Usar as cores do PDF' },
      { k: 'boostContrast', t: 'check', label: 'Ajustar automaticamente cores escuras para legibilidade' },
      { k: 'background', t: 'color', label: 'Fundo' },
      { k: 'blackAs', t: 'color', label: 'Texto preto do PDF exibido como' },
      { k: 'defaultTextColor', t: 'color', label: 'Cor única (quando não usa cores do PDF)' },
    ],
  },
  {
    id: 'screen', label: 'Tela', fields: [
      { k: 'markerStyle', t: 'select', label: 'Marcador de leitura', options: [{ label: 'Seta lateral', value: 'arrow' }, { label: 'Linha', value: 'line' }, { label: 'Faixa destacada', value: 'band' }, { label: 'Nenhum', value: 'none' }] },
      { k: 'markerPosition', t: 'range', label: 'Posição do marcador (do topo)', min: 10, max: 80, step: 1, unit: '%' },
      { k: 'markerColor', t: 'color', label: 'Cor do marcador' },
      { k: 'dimOutside', t: 'range', label: 'Esmaecer linhas já lidas', min: 0, max: 90, step: 5, unit: '%' },
      { k: 'edgeFade', t: 'check', label: 'Degradê nas bordas superior/inferior' },
      { k: 'mirrorH', t: 'check', label: 'Espelhar horizontalmente (vidro do teleprompter)' },
      { k: 'mirrorV', t: 'check', label: 'Inverter verticalmente' },
      { k: 'showProgress', t: 'check', label: 'Barra de progresso' },
      { k: 'showClock', t: 'check', label: 'Relógio' },
      { k: 'showTimer', t: 'check', label: 'Cronômetro e tempo restante' },
      { k: 'hudAutoHide', t: 'check', label: 'Ocultar controles automaticamente' },
      { k: 'wakeLock', t: 'check', label: 'Manter a tela acesa' },
    ],
  },
];

let activeTab = 'scroll';

function settingsPanel(): string {
  return `
  <div class="tabs" role="tablist">
    ${[...TABS, { id: 'songs', label: 'Músicas' }, { id: 'presets', label: 'Presets' }, { id: 'keys', label: 'Atalhos' }]
      .map((t) => `<button role="tab" data-tab="${t.id}" class="${t.id === activeTab ? 'on' : ''}">${t.label}</button>`)
      .join('')}
  </div>
  <div class="tab-body">${tabBody(activeTab)}</div>`;
}

function fieldHtml(f: Field) {
  const v = settings[f.k] as unknown;
  switch (f.t) {
    case 'range': {
      const n = v as number;
      const txt = f.fmt ? f.fmt(n) : n + (f.unit ?? '');
      return `<label class="fld range"><span>${f.label}<output>${txt}</output></span>
        <input type="range" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${n}"></label>`;
    }
    case 'check':
      return `<label class="fld check"><input type="checkbox" data-k="${f.k}" ${v ? 'checked' : ''}><span>${f.label}</span></label>`;
    case 'color':
      return `<label class="fld color"><span>${f.label}</span><input type="color" data-k="${f.k}" value="${v}"></label>`;
    case 'select':
      return `<label class="fld select"><span>${f.label}</span><select data-k="${f.k}">${f.options
        .map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${o.label}</option>`)
        .join('')}</select></label>`;
  }
}

function tabBody(id: string): string {
  const tab = TABS.find((t) => t.id === id);
  if (tab) {
    let html = tab.fields.map(fieldHtml).join('');
    if (id === 'colors') html += colorLegend();
    if (id === 'scroll' && settings.speedMode === 'duration') html += `<p class="hint">Defina a duração de cada música na aba <b>Músicas</b>. Músicas sem duração usam a velocidade acima.</p>`;
    return html;
  }
  if (id === 'songs') return songsTab();
  if (id === 'presets') return presetsTab();
  if (id === 'keys') return keysTab();
  return '';
}

function colorLegend() {
  if (!script) return '';
  const entries = Object.entries(script.colors).sort((a, b) => b[1] - a[1]);
  return `<h3>Cores encontradas no PDF</h3>
  <p class="hint">Dê nomes às cores (ex.: Sopranos, Tenores, Todos), troque a cor de exibição ou esmaeça/oculte as vozes que não interessam.</p>
  <div class="legend">${entries
    .map(([hex, n]) => {
      const r = settings.colorRules[hex] ?? { label: '', display: '', mode: 'show' };
      return `<div class="lg-row" data-hex="${hex}">
        <span class="sw" style="background:${hex}" title="Original ${hex}"></span>
        <input type="color" class="lg-display" value="${displayColor(hex, settings)}" title="Cor exibida">
        <input type="text" class="lg-label" placeholder="Nome (ex.: Sopranos)" value="${esc(r.label)}">
        <select class="lg-mode"><option value="show" ${r.mode === 'show' ? 'selected' : ''}>Mostrar</option><option value="dim" ${r.mode === 'dim' ? 'selected' : ''}>Esmaecer</option><option value="hide" ${r.mode === 'hide' ? 'selected' : ''}>Ocultar</option></select>
        <small>${n} car.</small>
      </div>`;
    })
    .join('')}</div>
  <button class="btn small ghost lg-reset">Restaurar cores originais</button>`;
}

function songsTab() {
  if (!script) return '';
  return `<p class="hint">Clique no nome para ir até a música. No modo <b>Duração por música</b>, a velocidade é calculada para terminar a música no tempo definido (mm:ss).</p>
  <ol class="songs">${script.sections
    .map(
      (s, i) => `<li data-i="${i}"><button class="song-go">${esc(s.title || 'Música ' + (i + 1))}</button>
      <input class="song-dur" inputmode="numeric" placeholder="mm:ss" value="${s.duration ? fmtTime(s.duration) : ''}" aria-label="Duração"></li>`,
    )
    .join('')}</ol>
  <p class="total">Duração total definida: <b>${fmtTime(script.sections.reduce((a, s) => a + s.duration, 0))}</b></p>`;
}

function presetsTab() {
  const user = loadPresets();
  return `<p class="hint">Aplique um preset pronto ou salve sua configuração atual.</p>
  <div class="presets">${Object.keys(BUILTIN_PRESETS).map((k) => `<button class="btn small preset" data-p="${esc(k)}">${esc(k)}</button>`).join('')}</div>
  <h3>Meus presets</h3>
  <div class="presets">${Object.keys(user).map((k) => `<span class="upreset"><button class="btn small preset" data-u="${esc(k)}">${esc(k)}</button><button class="x" data-del="${esc(k)}" title="Excluir">×</button></span>`).join('') || '<small>Nenhum ainda.</small>'}</div>
  <div class="row"><button class="btn small save-preset">Salvar configuração atual…</button>
  <button class="btn small ghost reset-all">Restaurar padrões</button></div>
  <h3>Backup</h3>
  <div class="row"><button class="btn small ghost export">Exportar configurações</button><button class="btn small ghost import">Importar…</button></div>`;
}

function keysTab() {
  const rows: [string, string][] = [
    ['Espaço / Enter / clique', 'Iniciar / pausar'],
    ['↑ / ↓', 'Velocidade + / −'],
    ['← / →', 'Linha anterior / próxima'],
    ['PgUp / PgDn', 'Estrofe anterior / próxima'],
    ['N / P', 'Próxima / anterior música'],
    ['1 … 9', 'Ir para a música'],
    ['Home / End', 'Início / fim'],
    ['+ / −', 'Mais / menos linhas na tela'],
    ['M / V', 'Espelhar horizontal / vertical'],
    ['F', 'Tela cheia'],
    ['R', 'Zerar cronômetro'],
    ['H', 'Mostrar/ocultar controles'],
    ['Esc', 'Sair do teleprompter'],
    ['Roda do mouse / arrastar', 'Ajuste manual da posição'],
  ];
  return `<table class="keys">${rows.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}</table>
  <p class="hint">Controles remotos/pedais Bluetooth que enviam setas, PgUp/PgDn ou espaço funcionam automaticamente.</p>`;
}

function bindSettings(root: HTMLElement, onTab?: () => void) {
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
    b.onclick = () => {
      activeTab = b.dataset.tab!;
      root.innerHTML = settingsPanel();
      bindSettings(root, onTab);
      onTab?.();
    };
  });
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    const k = inp.dataset.k as keyof Settings;
    const handler = () => {
      let v: unknown;
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked;
      else if (inp instanceof HTMLInputElement && inp.type === 'range') v = parseFloat(inp.value);
      else v = inp.value;
      const f = TABS.flatMap((t) => t.fields).find((x) => x.k === k);
      if (f?.t === 'range') {
        const out = inp.parentElement!.querySelector('output');
        if (out) out.textContent = f.fmt ? f.fmt(v as number) : v + (f.unit ?? '');
      }
      updateSettings({ [k]: v } as Partial<Settings>);
      if (k === 'speedMode' || k === 'keepColors' || k === 'boostContrast' || k === 'background' || k === 'blackAs') {
        const body = root.querySelector('.tab-body')!;
        if (k === 'speedMode' || inp.type !== 'color') {
          body.innerHTML = tabBody(activeTab);
          bindSettings(root, onTab);
        }
      }
    };
    inp.addEventListener(inp.type === 'range' || inp.type === 'color' ? 'input' : 'change', handler);
  });
  // legenda de cores
  root.querySelectorAll<HTMLElement>('.lg-row').forEach((row) => {
    const hex = row.dataset.hex!;
    const get = () => settings.colorRules[hex] ?? { label: '', display: '', mode: 'show' as const };
    const set = (patch: Partial<Settings['colorRules'][string]>) =>
      updateSettings({ colorRules: { ...settings.colorRules, [hex]: { ...get(), ...patch } } });
    ($('.lg-display', row) as HTMLInputElement).oninput = (e) => set({ display: (e.target as HTMLInputElement).value });
    ($('.lg-label', row) as HTMLInputElement).onchange = (e) => set({ label: (e.target as HTMLInputElement).value });
    ($('.lg-mode', row) as HTMLSelectElement).onchange = (e) => set({ mode: (e.target as HTMLSelectElement).value as 'show' });
  });
  const lgReset = root.querySelector('.lg-reset') as HTMLElement | null;
  if (lgReset)
    lgReset.onclick = () => {
      updateSettings({ colorRules: {} });
      root.querySelector('.tab-body')!.innerHTML = tabBody(activeTab);
      bindSettings(root, onTab);
    };
  // músicas
  root.querySelectorAll<HTMLElement>('.songs li').forEach((li) => {
    const i = +li.dataset.i!;
    ($('.song-go', li) as HTMLElement).onclick = () => (live ?? preview)?.jumpToSection(i);
    ($('.song-dur', li) as HTMLInputElement).onchange = (e) => {
      if (!script) return;
      const v = (e.target as HTMLInputElement).value;
      script.sections[i].duration = v.trim() ? parseTime(v) : 0;
      (e.target as HTMLInputElement).value = script.sections[i].duration ? fmtTime(script.sections[i].duration) : '';
      saveScript();
      channel?.postMessage({ type: 'script', script });
      const total = root.querySelector('.total b');
      if (total) total.textContent = fmtTime(script.sections.reduce((a, s) => a + s.duration, 0));
    };
  });
  // presets
  root.querySelectorAll<HTMLElement>('.preset').forEach((b) => {
    b.onclick = () => {
      const p = b.dataset.p ? BUILTIN_PRESETS[b.dataset.p] : loadPresets()[b.dataset.u!];
      if (p) {
        updateSettings(p);
        toast('Preset aplicado: ' + (b.dataset.p || b.dataset.u));
      }
    };
  });
  root.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => {
    b.onclick = () => {
      const all = loadPresets();
      delete all[b.dataset.del!];
      savePresets(all);
      root.querySelector('.tab-body')!.innerHTML = tabBody(activeTab);
      bindSettings(root, onTab);
    };
  });
  const sp = root.querySelector('.save-preset') as HTMLElement | null;
  if (sp)
    sp.onclick = () => {
      const name = prompt('Nome do preset:');
      if (!name) return;
      const all = loadPresets();
      const { colorRules: _c, ...rest } = settings;
      all[name] = rest;
      savePresets(all);
      root.querySelector('.tab-body')!.innerHTML = tabBody(activeTab);
      bindSettings(root, onTab);
    };
  const ra = root.querySelector('.reset-all') as HTMLElement | null;
  if (ra)
    ra.onclick = () => {
      if (!confirm('Restaurar todas as configurações para o padrão?')) return;
      updateSettings(structuredClone(DEFAULTS));
      toast('Configurações restauradas');
    };
  const ex = root.querySelector('.export') as HTMLElement | null;
  if (ex)
    ex.onclick = () => {
      const blob = new Blob([JSON.stringify({ settings, presets: loadPresets() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'teleprompter-config.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  const im = root.querySelector('.import') as HTMLElement | null;
  if (im)
    im.onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        try {
          const data = JSON.parse(await inp.files![0].text());
          if (data.presets) savePresets({ ...loadPresets(), ...data.presets });
          if (data.settings) updateSettings({ ...DEFAULTS, ...data.settings });
          toast('Configurações importadas');
          root.innerHTML = settingsPanel();
          bindSettings(root, onTab);
        } catch {
          alert('Arquivo inválido');
        }
      };
      inp.click();
    };
}

// ---------------------------------------------------------------- editor
function showEditor() {
  if (!script) return showHome();
  destroyLive();
  preview?.destroy();
  app.innerHTML = `
  <div class="editor">
    <header class="topbar">
      <button class="icon-btn home-btn" title="Início">${logo()}</button>
      <div class="doc-name" title="${esc(script.name)}">${esc(script.name)}</div>
      <div class="top-actions">
        <button class="btn ghost small open-file">Trocar arquivo</button>
        <button class="btn ghost small reimport" ${lastFile ? '' : 'hidden'}>Reimportar</button>
        <button class="btn ghost small find">Localizar e substituir</button>
        <button class="btn ghost small display-win" title="Abre uma janela só com o texto (para segundo monitor/projetor), controlada por esta tela">Janela de exibição ↗</button>
        <button class="btn ghost small remote-btn" title="Controle o teleprompter pelo celular lendo um QR code">📱 Controle pelo celular<span class="remote-badge"></span></button>
        <button class="btn primary start">▶ Iniciar teleprompter</button>
      </div>
    </header>
    <div class="workspace">
      <section class="preview-wrap">
        <div class="preview-frame"></div>
        <div class="preview-bar">
          <button class="btn small ghost pv-top">⏮ Início</button>
          <button class="btn small pv-play">▶ Testar rolagem</button>
          <span class="pv-info"></span>
        </div>
      </section>
      <aside class="panel">${settingsPanel()}</aside>
    </div>
  </div>`;
  preview = new Prompter($('.preview-frame'), settings);
  preview.setScript(script);
  preview.onFrame = (a) => channel?.postMessage({ type: 'anchor', anchor: a });
  preview.onState = (st) => {
    if (!live) lastState = st;
    $('.pv-play').textContent = st.playing ? '⏸ Pausar' : '▶ Testar rolagem';
    $('.pv-info').textContent = `${script!.sections[st.section]?.title ?? ''} · ${Math.round(st.lpm)} l/min · restante ${fmtTime(st.remaining)}`;
  };
  preview.root.addEventListener('tap', () => preview?.toggle());
  preview.relayout();
  const panel = $('.panel');
  bindSettings(panel);
  $('.home-btn').onclick = showHome;
  $('.open-file').onclick = pickFile;
  $('.reimport').onclick = () => lastFile && importData(lastFile.data, lastFile.name);
  $('.find').onclick = findReplace;
  $('.display-win').onclick = openDisplayWindow;
  $('.start').onclick = () => startLive(preview?.getAnchor());
  $('.remote-btn').onclick = showRemoteModal;
  updateRemoteBadges();
  $('.pv-top').onclick = () => preview?.jumpToIndex(0);
  $('.pv-play').onclick = () => (preview?.playing ? preview.pause() : preview?.play());
  bindDrop(document.body);
}

function findReplace() {
  if (!script) return;
  const find = prompt('Localizar (texto exato):');
  if (!find) return;
  const repl = prompt(`Substituir “${find}” por:`, '');
  if (repl === null) return;
  let n = 0;
  for (const el of script.elements)
    for (const r of el.runs) {
      const parts = r.text.split(find);
      if (parts.length > 1) {
        n += parts.length - 1;
        r.text = parts.join(repl);
      }
    }
  for (const sec of script.sections) sec.title = sec.title.split(find).join(repl);
  saveScript();
  preview?.setScript(script);
  channel?.postMessage({ type: 'script', script });
  toast(`${n} ocorrência(s) substituída(s)`);
}

// ---------------------------------------------------------------- modo ao vivo
let hudTimer = 0;
let wakeLock: { release: () => Promise<void> } | null = null;
let clockTimer = 0;

async function requestWakeLock() {
  if (!settings.wakeLock) return;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    /* não suportado */
  }
}

function startLive(anchor?: Anchor) {
  if (!script) return;
  preview?.pause();
  const wrap = document.createElement('div');
  wrap.className = 'live';
  wrap.innerHTML = `
    <div class="hud top">
      <select class="sec-select" title="Ir para música">${script.sections.map((s, i) => `<option value="${i}">${i + 1}. ${esc(s.title)}</option>`).join('')}</select>
      <div class="hud-stats"><span class="t-elapsed" title="Tempo decorrido"></span><span class="t-remaining" title="Tempo restante estimado"></span><span class="t-clock"></span></div>
      <button class="icon-btn exit" title="Sair (Esc)">✕</button>
    </div>
    <div class="hud bottom">
      <div class="grp">
        <button class="icon-btn prev-sec" title="Música anterior (P)">⏮</button>
        <button class="icon-btn prev-st" title="Estrofe anterior (PgUp)">⏪</button>
        <button class="icon-btn play big" title="Play/Pausa (Espaço)">▶</button>
        <button class="icon-btn next-st" title="Próxima estrofe (PgDn)">⏩</button>
        <button class="icon-btn next-sec" title="Próxima música (N)">⏭</button>
      </div>
      <div class="grp speed"><button class="icon-btn slower" title="Mais devagar (↓)">−</button><span class="speed-val"></span><button class="icon-btn faster" title="Mais rápido (↑)">+</button></div>
      <div class="grp"><button class="icon-btn fewer" title="Letra maior (−)">A+</button><span class="lines-val"></span><button class="icon-btn more" title="Letra menor (+)">A−</button></div>
      <div class="grp">
        <button class="icon-btn mirror" title="Espelhar (M)">⇋</button>
        <button class="icon-btn fs" title="Tela cheia (F)">⛶</button>
        <button class="icon-btn remote" title="Controle pelo celular">📱<span class="remote-badge"></span></button>
        <button class="icon-btn cfg" title="Configurações">⚙</button>
      </div>
    </div>
    <div class="progress"><div></div></div>
    <aside class="drawer" hidden></aside>`;
  document.body.appendChild(wrap);
  document.body.classList.add('is-live');
  live = new Prompter(wrap, settings);
  wrap.insertBefore(live.root, wrap.firstChild);
  live.setScript(script);
  live.onFrame = (a) => channel?.postMessage({ type: 'anchor', anchor: a });
  live.onState = (st) => {
    lastState = st;
    renderHud(wrap, st);
  };
  live.onUserScroll = () => pokeHud(wrap);
  live.root.addEventListener('tap', () => {
    live?.toggle();
    pokeHud(wrap);
  });
  if (anchor) live.setAnchor(anchor);
  requestWakeLock();

  const q = (s: string) => $(s, wrap);
  q('.exit').onclick = () => exitLive();
  q('.play').onclick = () => live?.toggle();
  q('.prev-st').onclick = () => live?.jumpStanza(-1);
  q('.next-st').onclick = () => live?.jumpStanza(1);
  q('.prev-sec').onclick = () => live?.prevSection();
  q('.next-sec').onclick = () => live?.jumpToSection(live.section + 1);
  q('.slower').onclick = () => changeSpeed(-1);
  q('.faster').onclick = () => changeSpeed(1);
  q('.fewer').onclick = () => updateSettings({ visibleLines: Math.max(2, settings.visibleLines - 1) });
  q('.more').onclick = () => updateSettings({ visibleLines: Math.min(30, settings.visibleLines + 1) });
  q('.mirror').onclick = () => updateSettings({ mirrorH: !settings.mirrorH });
  q('.fs').onclick = toggleFullscreen;
  q('.remote').onclick = showRemoteModal;
  updateRemoteBadges();
  q('.cfg').onclick = () => {
    const d = q('.drawer');
    d.hidden = !d.hidden;
    if (!d.hidden) {
      d.innerHTML = settingsPanel();
      bindSettings(d);
    }
  };
  (q('.sec-select') as HTMLSelectElement).onchange = (e) => live?.jumpToSection(+(e.target as HTMLSelectElement).value);
  wrap.addEventListener('pointermove', () => pokeHud(wrap));
  clockTimer = window.setInterval(() => {
    const c = q('.t-clock');
    c.textContent = settings.showClock ? new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  }, 1000);
  pokeHud(wrap);
  if (!settings.startPaused) live.startWithCountdown();
}

function changeSpeed(dir: 1 | -1) {
  if (!live && !preview) return;
  if (settings.speedMode === 'duration') {
    const p = live ?? preview!;
    p.speedMul = Math.max(0.2, Math.min(3, +(p.speedMul + dir * 0.05).toFixed(2)));
    toast(`Velocidade ${Math.round(p.speedMul * 100)}% do tempo definido`);
    p.update(true);
    return;
  }
  updateSettings({ linesPerMinute: Math.max(2, Math.min(240, settings.linesPerMinute + dir * settings.speedStep)) }, false);
  (live ?? preview)?.update(true);
}

function renderHud(wrap: HTMLElement, st: PrompterState) {
  const q = (s: string) => $(s, wrap);
  q('.play').textContent = st.playing || st.countdown ? '⏸' : '▶';
  q('.speed-val').textContent = settings.speedMode === 'duration' ? `${Math.round(st.lpm)} l/min` : `${settings.linesPerMinute} l/min`;
  q('.lines-val').textContent = `${settings.visibleLines} linhas`;
  q('.t-elapsed').textContent = settings.showTimer ? '⏱ ' + fmtTime(st.elapsed) : '';
  q('.t-remaining').textContent = settings.showTimer ? '⌛ −' + fmtTime(st.remaining) : '';
  const sel = q('.sec-select') as HTMLSelectElement;
  if (sel.value !== String(st.section)) sel.value = String(st.section);
  const prog = q('.progress');
  prog.hidden = !settings.showProgress;
  (prog.firstElementChild as HTMLElement).style.width = st.progress * 100 + '%';
  wrap.classList.toggle('paused', !st.playing);
  if (!st.playing) pokeHud(wrap, true);
}

function pokeHud(wrap: HTMLElement, keep = false) {
  wrap.classList.add('hud-on');
  clearTimeout(hudTimer);
  if (keep || !settings.hudAutoHide) return;
  hudTimer = window.setTimeout(() => {
    if (live?.playing && wrap.querySelector('.drawer')!.hasAttribute('hidden')) wrap.classList.remove('hud-on');
  }, 2500);
}

function exitLive() {
  const anchor = live?.getAnchor();
  destroyLive();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (anchor && preview) preview.setAnchor(anchor);
}

function destroyLive() {
  if (!live) return;
  live.destroy();
  live = null;
  document.querySelector('.live')?.remove();
  document.body.classList.remove('is-live');
  clearInterval(clockTimer);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && live) requestWakeLock();
});

// ---------------------------------------------------------------- comandos (teclado e celular)
function runCommand(cmd: RemoteMessage['cmd'], arg = 0) {
  const p = live ?? (isDisplay ? null : preview);
  const wrap = document.querySelector('.live') as HTMLElement | null;
  if (wrap) pokeHud(wrap);
  switch (cmd) {
    case 'start':
      if (!live && script) startLive(preview?.getAnchor());
      return;
    case 'exit':
      if (live) exitLive();
      return;
    case 'toggle':
      if (live) live.toggle();
      else if (remoteToggleStartsLive && script) startLive(preview?.getAnchor());
      else if (p) p.playing ? p.pause() : p.play();
      return;
  }
  if (!p) return;
  switch (cmd) {
    case 'speed':
      changeSpeed(arg >= 0 ? 1 : -1);
      break;
    case 'line':
      p.jumpLine(arg >= 0 ? 1 : -1);
      break;
    case 'stanza':
      p.jumpStanza(arg >= 0 ? 1 : -1);
      break;
    case 'section':
      if (arg >= 0) p.jumpToSection(p.section + 1);
      else p.prevSection();
      break;
    case 'goto':
      p.jumpToSection(arg);
      break;
    case 'home':
      p.jumpToIndex(0);
      break;
    case 'lines':
      updateSettings({ visibleLines: Math.max(2, Math.min(30, settings.visibleLines + (arg >= 0 ? 1 : -1))) });
      break;
    case 'mirror':
      updateSettings({ mirrorH: !settings.mirrorH });
      break;
    case 'reset':
      p.resetTimer();
      break;
    case 'scroll':
      p.scrollBy(arg);
      break;
  }
}
// pelo celular, "play" fora do modo ao vivo abre o teleprompter (com contagem regressiva)
let remoteToggleStartsLive = false;

document.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if (tgt.closest('input, select, textarea') && !(tgt as HTMLInputElement).type?.match(/range|checkbox|color/)) return;
  const p = live ?? (isDisplay ? null : preview);
  if (!p) return;
  const wrap = document.querySelector('.live') as HTMLElement | null;
  if (wrap) pokeHud(wrap);
  let handled = true;
  const map: Record<string, [RemoteMessage['cmd'], number?]> = {
    ' ': ['toggle'], Enter: ['toggle'], ArrowUp: ['speed', 1], ArrowDown: ['speed', -1],
    ArrowLeft: ['line', -1], ArrowRight: ['line', 1], PageUp: ['stanza', -1], PageDown: ['stanza', 1],
    Home: ['home'], n: ['section', 1], N: ['section', 1], p: ['section', -1], P: ['section', -1],
    '+': ['lines', 1], '=': ['lines', 1], '-': ['lines', -1], _: ['lines', -1], m: ['mirror'], M: ['mirror'],
    r: ['reset'], R: ['reset'],
  };
  const m = map[e.key];
  if (m) runCommand(m[0], m[1] ?? 0);
  else
    switch (e.key) {
      case 'End':
        p.jumpToIndex(1e9);
        break;
      case 'v':
      case 'V':
        updateSettings({ mirrorV: !settings.mirrorV });
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'h':
      case 'H':
        wrap?.classList.toggle('hud-hidden');
        break;
      case 'Escape':
        if (document.querySelector('.modal')) closeRemoteModal();
        else if (live) exitLive();
        else handled = false;
        break;
      default:
        if (/^[1-9]$/.test(e.key)) p.jumpToSection(+e.key - 1);
        else handled = false;
    }
  if (handled) e.preventDefault();
});

// ---------------------------------------------------------------- controle pelo celular (host)
const remote = new RemoteHost();
remote.getState = (): RemoteState | null => {
  if (!script) return null;
  const st = lastState;
  return {
    type: 'state',
    live: !!live,
    playing: !!st?.playing,
    countdown: st?.countdown ?? 0,
    section: st?.section ?? 0,
    sections: script.sections.map((x) => x.title),
    speedLabel:
      settings.speedMode === 'duration' && st ? `${Math.round(st.lpm)} l/min` : `${settings.linesPerMinute} l/min`,
    lines: settings.visibleLines,
    mirror: settings.mirrorH,
    progress: st?.progress ?? 0,
    elapsed: st?.elapsed ?? 0,
    remaining: st?.remaining ?? 0,
    scriptName: script.name,
  };
};
remote.onCommand = (m) => {
  remoteToggleStartsLive = true;
  try {
    runCommand(m.cmd, m.arg ?? 0);
  } finally {
    remoteToggleStartsLive = false;
  }
};
remote.onChange = () => {
  updateRemoteBadges();
  renderRemoteModal();
};

function updateRemoteBadges() {
  document.querySelectorAll<HTMLElement>('.remote-badge').forEach((b) => {
    b.textContent = remote.connected ? String(remote.connected) : '';
    b.parentElement?.classList.toggle('remote-on', remote.connected > 0);
  });
}

function showRemoteModal() {
  if (remote.status === 'off' || remote.status === 'error') remote.start();
  closeRemoteModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-card" role="dialog" aria-label="Controle pelo celular">
    <button class="icon-btn modal-x" title="Fechar (Esc)">✕</button>
    <h2>📱 Controle pelo celular</h2>
    <p class="hint">Aponte a câmera do celular para o QR code. A página de controle abre no navegador do celular.</p>
    <div class="qr-box"><div class="qr-wait">Gerando…</div></div>
    <div class="remote-status"></div>
    <div class="remote-link"></div>
    <div class="row">
      <button class="btn small ghost copy-link">Copiar link</button>
      <button class="btn small ghost renew">Gerar novo código</button>
      <button class="btn small ghost stop-remote">Desligar</button>
    </div>
    <p class="hint small">O celular e o computador precisam estar com internet. Funciona melhor na mesma rede Wi-Fi.</p>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => e.target === m && closeRemoteModal());
  $('.modal-x', m).onclick = closeRemoteModal;
  $('.copy-link', m).onclick = async () => {
    try {
      await navigator.clipboard.writeText(remoteLink(remote.id));
      toast('Link copiado');
    } catch {
      prompt('Copie o link:', remoteLink(remote.id));
    }
  };
  $('.renew', m).onclick = () => {
    remote.renew();
    toast('Novo código gerado — o QR anterior deixou de funcionar');
  };
  $('.stop-remote', m).onclick = () => {
    remote.stop();
    closeRemoteModal();
    toast('Controle pelo celular desligado');
  };
  renderRemoteModal();
}

let qrFor = '';
async function renderRemoteModal() {
  const m = document.querySelector('.modal') as HTMLElement | null;
  if (!m) return;
  const st = $('.remote-status', m);
  const box = $('.qr-box', m);
  if (remote.status === 'ready') {
    const link = remoteLink(remote.id);
    if (qrFor !== link || !box.querySelector('img')) {
      qrFor = link;
      box.innerHTML = `<img alt="QR code para controlar pelo celular" src="${await qrDataUrl(link)}">`;
    }
    $('.remote-link', m).textContent = link;
    st.className = 'remote-status ' + (remote.connected ? 'ok' : 'wait');
    st.textContent = remote.connected
      ? `✅ ${remote.connected} celular(es) conectado(s) — pode fechar esta janela`
      : '⏳ Aguardando o celular…';
  } else if (remote.status === 'error') {
    box.innerHTML = '<div class="qr-wait">—</div>';
    st.className = 'remote-status err';
    st.textContent = remote.error;
  } else {
    box.innerHTML = '<div class="qr-wait">Gerando…</div>';
    st.className = 'remote-status wait';
    st.textContent = 'Preparando a conexão…';
  }
}

function closeRemoteModal() {
  document.querySelector('.modal')?.remove();
}

// ---------------------------------------------------------------- janela de exibição
function openDisplayWindow() {
  const url = new URL(location.href);
  url.search = '?display=1';
  const w = window.open(url.toString(), 'ipc-teleprompter-display', 'popup,width=1280,height=720');
  if (!w) alert('O navegador bloqueou a janela. Permita pop-ups para este site.');
  else toast('Arraste a janela para o outro monitor e pressione F para tela cheia');
}

function runDisplay() {
  document.body.classList.add('is-live', 'display-mode');
  app.innerHTML = `<div class="live display"><div class="display-hint">Aguardando a tela de controle… <br><small>F = tela cheia · M = espelhar nesta janela</small></div></div>`;
  const wrap = $('.live');
  let localMirror: boolean | null = null;
  let p: Prompter | null = null;
  const eff = (s: Settings) => (localMirror === null ? s : { ...s, mirrorH: localMirror });
  const ensure = () => {
    if (p || !script) return;
    p = new Prompter(wrap, eff(settings));
    p.follower = true;
    p.setScript(script);
    wrap.querySelector('.display-hint')?.remove();
  };
  ensure();
  channel?.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'script') {
      script = m.script;
      if (p) p.setScript(script!);
      else ensure();
    } else if (m.type === 'settings') {
      settings = m.settings;
      p?.setSettings(eff(settings));
    } else if (m.type === 'anchor') {
      ensure();
      p?.setAnchor(m.anchor);
    }
  });
  channel?.postMessage({ type: 'hello' });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'm' || e.key === 'M') {
      localMirror = !(localMirror ?? settings.mirrorH);
      p?.setSettings(eff(settings));
    }
  });
  wrap.addEventListener('dblclick', toggleFullscreen);
}

// controlador responde à janela de exibição que acabou de abrir
channel?.addEventListener('message', (ev) => {
  if (isDisplay || ev.data?.type !== 'hello' || !script) return;
  channel.postMessage({ type: 'script', script });
  channel.postMessage({ type: 'settings', settings });
  const p = live ?? preview;
  if (p) channel.postMessage({ type: 'anchor', anchor: p.getAnchor() });
});

// ---------------------------------------------------------------- PWA
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------------------------------------------------------------- início
if (remoteId) runRemote(app, remoteId);
else if (isDisplay) runDisplay();
else {
  if (script) showEditor();
  else showHome();
  // reativa automaticamente para o celular reconectar após recarregar a página
  if (RemoteHost.wasEnabled()) remote.start();
}

// exposto para testes/depuração
(window as unknown as { __tp: unknown }).__tp = { get script() { return script; }, get settings() { return settings; }, importData };
