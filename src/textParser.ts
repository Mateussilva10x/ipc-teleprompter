import type { Script, ScriptElement, Section } from './types';

/**
 * Importa texto simples: linha em branco = nova estrofe, linha começando com
 * "# " = título de música. Cores podem ser indicadas com [#rrggbb]texto[/].
 */
export function parseText(txt: string, name: string): Script {
  const elements: ScriptElement[] = [];
  const sections: Section[] = [];
  let section = -1;
  const colors: Record<string, number> = {};
  const runsOf = (line: string) => {
    const runs = [];
    const re = /\[(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > last) runs.push({ text: line.slice(last, m.index), color: '#000000' });
      runs.push({ text: m[2], color: m[1].toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < line.length) runs.push({ text: line.slice(last), color: '#000000' });
    for (const r of runs) if (r.text.trim()) colors[r.color] = (colors[r.color] || 0) + r.text.length;
    return runs;
  };
  for (const raw of txt.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) {
      sections.push({ title: line.replace(/^#\s+/, ''), duration: 0 });
      section = sections.length - 1;
      elements.push({ kind: 'title', runs: [{ text: sections[section].title, color: '#000000', bold: true }], section });
      continue;
    }
    if (section < 0) {
      sections.push({ title: name.replace(/\.\w+$/, ''), duration: 0 });
      section = 0;
    }
    const prev = elements[elements.length - 1];
    if (!line.trim()) {
      if (prev && prev.kind === 'line') elements.push({ kind: 'break', runs: [], section });
      continue;
    }
    elements.push({ kind: 'line', runs: runsOf(line), section });
  }
  while (elements.length && elements[elements.length - 1].kind === 'break') elements.pop();
  return { name, elements, sections, colors };
}
