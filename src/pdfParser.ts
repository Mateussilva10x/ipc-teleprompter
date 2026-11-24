import type { Run, Script, ScriptElement, Section } from './types';

/**
 * Lê um PDF e converte em um roteiro de teleprompter preservando as cores do texto.
 *
 * O pdf.js não informa cor no getTextContent(), então combinamos duas fontes:
 *  1. getOperatorList(): percorre os operadores de desenho e registra, para cada
 *     caractere desenhado, a cor de preenchimento e a fonte ativas.
 *  2. getTextContent(): fornece o texto com posições (para montar linhas, colunas
 *     e estrofes).
 * Os dois fluxos seguem a ordem do content stream, então alinhamos caractere a
 * caractere (ignorando espaços) para atribuir a cor certa a cada trecho.
 */

// Tipagem mínima do pdf.js que usamos (evita acoplar ao d.ts da lib).
/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfJs = any;

interface StyledChar {
  ch: string;
  color: string;
  font: string;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  runs: Run[];
}

interface RawLine {
  x: number;
  y: number;
  size: number;
  runs: Run[];
  page: number;
  col: number;
}

export interface ParseOptions {
  detectColumns: boolean;
  mergeWrapped: boolean;
}

const OPS_CACHE: Record<string, number> = {};

function hex2(n: number) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function toHex(args: any): string | null {
  if (!args) return null;
  if (typeof args === 'string') return args.startsWith('#') ? args.toLowerCase() : null;
  if (typeof args[0] === 'string') return toHex(args[0]);
  const r = args[0], g = args[1], b = args[2];
  if ([r, g, b].some((v) => typeof v !== 'number')) return null;
  // Valores em 0..1 (versões antigas) ou 0..255
  const unit = r <= 1 && g <= 1 && b <= 1 && [r, g, b].some((v) => !Number.isInteger(v));
  const scale = unit ? 255 : 1;
  return '#' + hex2(r * scale) + hex2(g * scale) + hex2(b * scale);
}

function grayHex(g: number) {
  const v = g <= 1 ? g * 255 : g;
  return '#' + hex2(v) + hex2(v) + hex2(v);
}

function cmykHex(c: number, m: number, y: number, k: number) {
  return '#' + hex2(255 * (1 - c) * (1 - k)) + hex2(255 * (1 - m) * (1 - k)) + hex2(255 * (1 - y) * (1 - k));
}

const norm = (s: string) => s.normalize('NFKC');
const isWs = (c: string) => /\s/.test(c);

async function styledChars(pdfjs: PdfJs, page: any): Promise<StyledChar[]> {
  const OPS = pdfjs.OPS;
  if (!OPS_CACHE.init) Object.assign(OPS_CACHE, OPS, { init: 1 });
  const list = await page.getOperatorList();
  const out: StyledChar[] = [];
  let color = '#000000';
  let font = '';
  const stack: { color: string; font: string }[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push({ color, font });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ color, font } = s);
        break;
      }
      case OPS.setFillRGBColor: {
        const h = toHex(args);
        if (h) color = h;
        break;
      }
      case OPS.setFillGray:
        if (args && typeof args[0] === 'number') color = grayHex(args[0]);
        break;
      case OPS.setFillCMYKColor:
        if (args && args.length >= 4) color = cmykHex(args[0], args[1], args[2], args[3]);
        break;
      case OPS.setFont:
        font = args?.[0] ?? '';
        break;
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText: {
        const glyphs = Array.isArray(args?.[0]) ? args[0] : args?.[args.length - 1];
        if (!Array.isArray(glyphs)) break;
        for (const g of glyphs) {
          if (!g || typeof g !== 'object') continue;
          const u: string = norm(g.unicode ?? '');
          for (const ch of u) if (!isWs(ch)) out.push({ ch, color, font });
        }
        break;
      }
    }
  }
  return out;
}

function fontStyle(page: any, fontId: string, cache: Map<string, { bold: boolean; italic: boolean }>) {
  if (cache.has(fontId)) return cache.get(fontId)!;
  let name = '';
  try {
    const f = page.commonObjs.has(fontId) ? page.commonObjs.get(fontId) : page.objs.has(fontId) ? page.objs.get(fontId) : null;
    name = (f?.name || f?.loadedName || '') + ' ' + (f?.fallbackName || '');
    if (f?.bold) name += ' bold';
    if (f?.italic) name += ' italic';
  } catch {
    /* fonte ainda não resolvida */
  }
  const st = {
    bold: /bold|black|heavy|semibold|demi/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
  cache.set(fontId, st);
  return st;
}

function pushRun(runs: Run[], text: string, color: string, bold: boolean, italic: boolean) {
  const last = runs[runs.length - 1];
  if (last && last.color === color && !!last.bold === bold && !!last.italic === italic) last.text += text;
  else runs.push({ text, color, bold, italic });
}

function trimRuns(runs: Run[]): Run[] {
  const r = runs.map((x) => ({ ...x }));
  while (r.length && !r[0].text.trim()) r.shift();
  while (r.length && !r[r.length - 1].text.trim()) r.pop();
  if (!r.length) return r;
  r[0].text = r[0].text.replace(/^\s+/, '');
  r[r.length - 1].text = r[r.length - 1].text.replace(/\s+$/, '');
  // Espaços em branco internos: herdam a cor do trecho anterior (evita cores "fantasmas").
  const merged: Run[] = [];
  for (const run of r) {
    run.text = run.text.replace(/\s{2,}/g, ' ');
    const last = merged[merged.length - 1];
    if (last && !run.text.trim()) {
      last.text += run.text;
      continue;
    }
    if (last && last.color === run.color && !!last.bold === !!run.bold && !!last.italic === !!run.italic) last.text += run.text;
    else merged.push(run);
  }
  return merged;
}

/**
 * O Word exporta ligaduras (ex.: "ti" em "gratidão") com /ActualText, que o pdf.js
 * ignora — o glifo vira um caractere aleatório isolado ("graNdão"). Detectamos um item
 * de 1 caractere maiúsculo colado entre letras minúsculas na mesma linha e o
 * substituímos pela ligadura mais comum em português ("ti").
 */
function detectBrokenLigatures(items: any[]): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 1; i < items.length - 1; i++) {
    const s = items[i].str;
    if (s.length !== 1 || !/[A-ZÀ-Ý]/.test(s)) continue;
    const a = items[i - 1], b = items[i + 1];
    const y = items[i].transform[5];
    if (Math.abs(a.transform[5] - y) > 1 || Math.abs(b.transform[5] - y) > 1) continue;
    if (/\p{Ll}$/u.test(a.str) && /^\p{Ll}/u.test(b.str)) out.set(i, 'ti');
  }
  return out;
}

function median(arr: number[]) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function linesText(runs: Run[]) {
  return runs.map((r) => r.text).join('');
}

export async function parsePdf(
  pdfjs: PdfJs,
  data: ArrayBuffer | Uint8Array,
  name: string,
  opts: ParseOptions,
  onProgress?: (p: number) => void,
): Promise<Script> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const allLines: RawLine[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const chars = await styledChars(pdfjs, page);
    const tc = await page.getTextContent();
    const fcache = new Map<string, { bold: boolean; italic: boolean }>();

    // 1) Itens de texto com runs coloridos
    let ci = 0;
    let lastColor = '#000000';
    let lastFont = '';
    const items: RawItem[] = [];
    const tItems = (tc.items as any[]).filter((it) => typeof it.str === 'string');
    const ligatures = detectBrokenLigatures(tItems);
    for (let ti = 0; ti < tItems.length; ti++) {
      const it = tItems[ti];
      const str = norm(it.str);
      const runs: Run[] = [];
      for (const ch of str) {
        if (isWs(ch)) {
          const st = fontStyle(page, lastFont, fcache);
          pushRun(runs, ' ', lastColor, st.bold, st.italic);
          continue;
        }
        // Re-sincroniza se houver divergência (ex.: ligaduras, caracteres ocultos)
        let k = ci;
        while (k < chars.length && k < ci + 24 && chars[k].ch !== ch) k++;
        if (k < chars.length && chars[k].ch === ch) {
          lastColor = chars[k].color;
          lastFont = chars[k].font;
          ci = k + 1;
        }
        const st = fontStyle(page, lastFont, fcache);
        pushRun(runs, ligatures.has(ti) ? ligatures.get(ti)! : ch, lastColor, st.bold, st.italic);
      }
      if (!str.trim() && !it.hasEOL) {
        if (str.length) items.push({ str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[3]) || it.height || 10, runs });
        continue;
      }
      if (!str.length) continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      items.push({ str, x: it.transform[4], y: it.transform[5], w: it.width, size, runs });
    }

    // 2) Agrupa itens em linhas (ordem do fluxo + mesma linha de base)
    const pageLines: RawLine[] = [];
    let cur: RawLine | null = null;
    let curEnd = 0;
    for (const it of items) {
      const sameLine = cur && Math.abs(it.y - cur.y) < Math.max(cur.size, it.size) * 0.45 && it.x >= curEnd - cur.size * 2;
      if (cur && sameLine) {
        // espaço implícito entre itens distantes
        const gap = it.x - curEnd;
        const lastRun = cur.runs[cur.runs.length - 1];
        if (gap > it.size * 0.2 && lastRun && !/\s$/.test(lastRun.text) && !/^\s/.test(it.str)) {
          pushRun(cur.runs, ' ', lastRun.color, !!lastRun.bold, !!lastRun.italic);
        }
        for (const r of it.runs) pushRun(cur.runs, r.text, r.color, !!r.bold, !!r.italic);
        curEnd = Math.max(curEnd, it.x + it.w);
        cur.size = Math.max(cur.size, it.size);
      } else {
        if (cur) pageLines.push(cur);
        cur = { x: it.x, y: it.y, size: it.size, runs: it.runs.map((r) => ({ ...r })), page: p, col: 0 };
        curEnd = it.x + it.w;
      }
    }
    if (cur) pageLines.push(cur);

    const lines = pageLines
      .map((l) => ({ ...l, runs: trimRuns(l.runs) }))
      .filter((l) => l.runs.length && linesText(l.runs).trim());

    // 3) Colunas
    if (opts.detectColumns && lines.length > 3) {
      const width = viewport.width;
      const xs = [...new Set(lines.map((l) => Math.round(l.x)))].sort((a, b) => a - b);
      const clusters: { min: number; max: number; n: number }[] = [];
      for (const x of xs) {
        const c = clusters[clusters.length - 1];
        const n = lines.filter((l) => Math.round(l.x) === x).length;
        if (c && x - c.max < width * 0.15) {
          c.max = x;
          c.n += n;
        } else clusters.push({ min: x, max: x, n });
      }
      // Clusters pequenos (títulos centralizados, recuos) são absorvidos pela coluna à esquerda
      const big = clusters.filter((c) => c.n >= 3);
      const starts = (big.length ? big : clusters).map((c) => c.min);
      for (const l of lines) {
        let col = 0;
        for (let i = 0; i < starts.length; i++) if (l.x >= starts[i] - 4) col = i;
        l.col = col;
      }
      lines.sort((a, b) => a.col - b.col || b.y - a.y);
    }
    allLines.push(...lines);
    onProgress?.(p / doc.numPages);
  }

  // 4) Estrofes, quebras de linha e títulos
  // Espaçamento típico entre linhas, calculado por página (fontes/entrelinhas variam)
  const gapsByPage = new Map<number, number[]>();
  for (let i = 1; i < allLines.length; i++) {
    const a = allLines[i - 1], b = allLines[i];
    if (a.page === b.page && a.col === b.col && a.y > b.y) {
      if (!gapsByPage.has(a.page)) gapsByPage.set(a.page, []);
      gapsByPage.get(a.page)!.push((a.y - b.y) / Math.max(a.size, b.size));
    }
  }
  const typicalOf = (page: number) => median(gapsByPage.get(page) ?? []) || 1.6;

  const elements: ScriptElement[] = [];
  const sections: Section[] = [];
  let section = -1;
  const isTitleLine = (l: RawLine) => l.runs.every((r) => r.bold || !r.text.trim());

  const ensureSection = (title: string) => {
    sections.push({ title, duration: 0 });
    section = sections.length - 1;
  };

  for (let i = 0; i < allLines.length; i++) {
    const l = allLines[i];
    const prev = allLines[i - 1];
    let rel = Infinity;
    if (prev && prev.page === l.page && prev.col === l.col && prev.y > l.y) rel = (prev.y - l.y) / Math.max(prev.size, l.size);

    if (isTitleLine(l)) {
      ensureSection(linesText(l.runs).trim());
      elements.push({ kind: 'title', runs: l.runs, section });
      continue;
    }
    if (section < 0) ensureSection(name.replace(/\.pdf$/i, ''));

    const last = elements[elements.length - 1];
    if (opts.mergeWrapped && last && last.kind === 'line' && rel < typicalOf(l.page) * 0.8) {
      // Continuação de linha quebrada no PDF
      const lr = last.runs[last.runs.length - 1];
      if (lr) pushRun(last.runs, ' ', lr.color, !!lr.bold, !!lr.italic);
      for (const r of l.runs) pushRun(last.runs, r.text, r.color, !!r.bold, !!r.italic);
      last.runs = trimRuns(last.runs);
      continue;
    }
    // Nova estrofe: espaço vertical maior que o normal, ou mudança de coluna/página
    if (last && last.kind === 'line' && rel > typicalOf(l.page) * 1.5) {
      elements.push({ kind: 'break', runs: [], section });
    }
    elements.push({ kind: 'line', runs: l.runs, section });
  }

  const colors: Record<string, number> = {};
  for (const e of elements) for (const r of e.runs) if (r.text.trim()) colors[r.color] = (colors[r.color] || 0) + r.text.replace(/\s/g, '').length;

  return { name, elements, sections, colors };
}
