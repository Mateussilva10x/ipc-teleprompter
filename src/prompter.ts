import type { Script } from './types';
import type { Settings } from './settings';
import { colorMode, displayColor } from './colors';

export interface PrompterState {
  playing: boolean;
  progress: number;
  section: number;
  /** Linhas por minuto efetivas no momento */
  lpm: number;
  elapsed: number;
  remaining: number;
  atEnd: boolean;
  countdown: number;
}

export interface Anchor {
  index: number;
  frac: number;
}

/**
 * Motor do teleprompter: renderiza o roteiro e faz a rolagem suave com
 * requestAnimationFrame. A posição é guardada em pixels, mas pode ser
 * convertida para uma âncora (elemento + fração) para sobreviver a mudanças
 * de tamanho de fonte/janela e para sincronizar com outra janela.
 */
export class Prompter {
  readonly root: HTMLElement;
  private viewport: HTMLElement;
  private content: HTMLElement;
  private marker: HTMLElement;
  private countdownEl: HTMLElement;
  private nodes: HTMLElement[] = [];
  private tops: number[] = [];
  private heights: number[] = [];
  private sectionStarts: number[] = [];
  private script: Script | null = null;
  private s: Settings;

  pos = 0;
  private maxPos = 0;
  private lineH = 40;
  private markerY = 0;
  playing = false;
  private ramp = 1;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private currentIdx = -1;
  private currentSection = 0;
  private countdownLeft = 0;
  private countdownTimer = 0;
  private dragging = false;
  private wasPlaying = false;
  private anim: { from: number; to: number; t0: number; dur: number } | null = null;
  /** Ajuste temporário de velocidade (multiplicador) no modo duração */
  speedMul = 1;
  follower = false;
  onState?: (st: PrompterState) => void;
  onUserScroll?: () => void;
  /** Chamado a cada atualização de posição (para sincronizar outra janela) */
  onFrame?: (a: Anchor) => void;

  constructor(parent: HTMLElement, settings: Settings) {
    this.s = settings;
    this.root = document.createElement('div');
    this.root.className = 'prompter';
    this.root.innerHTML = `
      <div class="pv"><div class="pc"></div></div>
      <div class="marker"></div>
      <div class="countdown" hidden></div>`;
    parent.appendChild(this.root);
    this.viewport = this.root.querySelector('.pv')!;
    this.content = this.root.querySelector('.pc')!;
    this.marker = this.root.querySelector('.marker')!;
    this.countdownEl = this.root.querySelector('.countdown')!;
    this.bindInput();
    new ResizeObserver(() => this.relayout()).observe(this.viewport);
  }

  setScript(script: Script) {
    this.script = script;
    this.render();
  }

  setSettings(s: Settings, rerender = true) {
    this.s = s;
    if (rerender) this.render();
  }

  private render() {
    if (!this.script) return;
    const anchor = this.nodes.length ? this.getAnchor() : null;
    const s = this.s;
    const frag = document.createDocumentFragment();
    this.nodes = [];
    this.sectionStarts = [];
    let lastSection = -1;
    this.script.elements.forEach((el, i) => {
      const d = document.createElement('div');
      d.dataset.i = String(i);
      if (el.section !== lastSection) {
        this.sectionStarts[el.section] = i;
        lastSection = el.section;
      }
      if (el.kind === 'break') {
        d.className = 'el brk';
      } else {
        d.className = el.kind === 'title' ? 'el title' : 'el line';
        if (el.kind === 'title' && !s.showTitles) d.classList.add('hidden');
        let visible = 0;
        for (const r of el.runs) {
          const mode = colorMode(r.color, s);
          if (mode === 'hide') continue;
          const span = document.createElement('span');
          span.textContent = r.text;
          span.style.color = el.kind === 'title' ? displayColor(r.color, s) : displayColor(r.color, s);
          if (r.italic) span.style.fontStyle = 'italic';
          if (mode === 'dim') span.classList.add('dimc');
          else if (r.text.trim()) visible++;
          d.appendChild(span);
        }
        if (!visible && el.kind === 'line' && el.runs.every((r) => colorMode(r.color, s) === 'hide')) d.classList.add('hidden');
      }
      frag.appendChild(d);
      this.nodes.push(d);
    });
    this.content.replaceChildren(frag);
    this.applyStyle();
    this.relayout(anchor);
  }

  private applyStyle() {
    const s = this.s;
    const r = this.root.style;
    r.setProperty('--bg', s.background);
    r.setProperty('--lh', String(s.lineHeight));
    r.setProperty('--font', s.fontFamily);
    r.setProperty('--weight', s.bold ? '700' : '400');
    r.setProperty('--ls', s.letterSpacing + 'em');
    r.setProperty('--width', s.textWidth + '%');
    r.setProperty('--align', s.align);
    r.setProperty('--gap', String(s.stanzaGap));
    r.setProperty('--title-scale', String(s.titleScale));
    r.setProperty('--marker', s.markerColor);
    r.setProperty('--dim', String(1 - s.dimOutside / 100));
    r.setProperty('--markerpos', s.markerPosition + '%');
    this.root.classList.toggle('upper', s.uppercase);
    this.root.classList.toggle('shadow', s.textShadow);
    this.root.classList.toggle('fade', s.edgeFade);
    this.root.dataset.marker = s.markerStyle;
    const sx = s.mirrorH ? -1 : 1, sy = s.mirrorV ? -1 : 1;
    this.viewport.style.transform = sx !== 1 || sy !== 1 ? `scale(${sx}, ${sy})` : '';
    this.marker.style.transform = sy === -1 ? 'scaleY(-1)' : '';
    this.marker.style.top = (sy === -1 ? 100 - s.markerPosition : s.markerPosition) + '%';
    this.marker.classList.toggle('mirror-h', s.mirrorH);
  }

  relayout(anchor?: Anchor | null) {
    if (!this.script) return;
    const a = anchor ?? (this.nodes.length && this.tops.length ? this.getAnchor() : null);
    const h = this.viewport.clientHeight || window.innerHeight;
    const w = (this.viewport.clientWidth || window.innerWidth) * (this.s.textWidth / 100);
    // Fonte definida pelas linhas visíveis, limitada pela largura para caber
    // um mínimo de caracteres por linha (evita uma palavra por linha no celular).
    const byHeight = h / (this.s.visibleLines * this.s.lineHeight);
    const byWidth = this.s.minCharsPerLine > 0 ? w / (this.s.minCharsPerLine * 0.56) : Infinity;
    const fontPx = Math.max(8, Math.min(byHeight, byWidth));
    this.root.style.setProperty('--fs', fontPx + 'px');
    this.lineH = fontPx * this.s.lineHeight;
    this.markerY = (h * this.s.markerPosition) / 100;
    // Primeira linha começa no marcador; espaço livre no final para a última linha chegar nele.
    this.content.style.paddingTop = this.markerY - this.lineH / 2 + 'px';
    this.content.style.paddingBottom = h - this.markerY + 'px';
    this.measure();
    if (a) this.setAnchor(a);
    else this.update(true);
  }

  private measure() {
    // .pc é position:relative, então offsetTop já é relativo ao conteúdo
    this.tops = this.nodes.map((n) => n.offsetTop);
    this.heights = this.nodes.map((n) => n.offsetHeight);
    const pt = parseFloat(this.content.style.paddingTop) || 0;
    const lastIdx = this.nodes.length - 1;
    this.maxPos = lastIdx >= 0 ? this.tops[lastIdx] + this.heights[lastIdx] - pt - this.lineH / 2 : 0;
    this.maxPos = Math.max(0, this.maxPos);
  }

  /** Posição (px) do ponto de leitura dentro do conteúdo */
  private readPoint() {
    const pt = parseFloat(this.content.style.paddingTop) || 0;
    return this.pos + pt + this.lineH / 2;
  }

  getAnchor(): Anchor {
    const y = this.readPoint();
    let i = this.indexAt(y);
    if (i < 0) i = 0;
    const h = this.heights[i] || 1;
    return { index: i, frac: Math.max(0, Math.min(1, (y - (this.tops[i] ?? 0)) / h)) };
  }

  setAnchor(a: Anchor) {
    if (!this.tops.length) return;
    const i = Math.max(0, Math.min(this.tops.length - 1, a.index));
    const pt = parseFloat(this.content.style.paddingTop) || 0;
    this.pos = this.tops[i] + a.frac * (this.heights[i] || 0) - pt - this.lineH / 2;
    this.clamp();
    this.update(true);
  }

  private indexAt(y: number) {
    let lo = 0, hi = this.tops.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.tops[mid] <= y) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  private clamp() {
    this.pos = Math.max(0, Math.min(this.maxPos, this.pos));
  }

  /** Velocidade atual em px/s */
  private velocity(): number {
    const s = this.s;
    let lpm = s.linesPerMinute;
    if (s.speedMode === 'duration' && this.script) {
      const sec = this.script.sections[this.currentSection];
      if (sec && sec.duration > 0) {
        const pxSec = this.sectionHeight(this.currentSection);
        return (pxSec / sec.duration) * this.speedMul;
      }
      lpm *= this.speedMul;
    }
    return (lpm / 60) * this.lineH;
  }

  sectionHeight(i: number) {
    const start = this.sectionStarts[i];
    if (start === undefined) return 0;
    const next = this.sectionStarts.slice(i + 1).find((v) => v !== undefined);
    const end = next !== undefined ? this.tops[next] : this.tops[this.tops.length - 1] + this.heights[this.heights.length - 1];
    return Math.max(0, end - this.tops[start]);
  }

  currentLpm() {
    return (this.velocity() / this.lineH) * 60;
  }

  play() {
    if (this.playing || this.follower) return;
    if (this.pos >= this.maxPos - 1) {
      if (this.s.loop) this.pos = 0;
      else return;
    }
    this.playing = true;
    this.ramp = this.s.smoothStart ? 0 : 1;
    this.loop();
    this.emit();
  }

  pause() {
    this.playing = false;
    this.cancelCountdown();
    this.emit();
  }

  toggle() {
    if (this.countdownLeft > 0) return this.cancelCountdown();
    if (this.playing) this.pause();
    else this.startWithCountdown();
  }

  startWithCountdown() {
    const n = this.s.countdown;
    if (n <= 0 || this.follower) return this.play();
    this.cancelCountdown();
    this.countdownLeft = n;
    this.showCountdown();
    this.countdownTimer = window.setInterval(() => {
      this.countdownLeft--;
      if (this.countdownLeft <= 0) {
        this.cancelCountdown();
        this.play();
      } else this.showCountdown();
    }, 1000);
  }

  private showCountdown() {
    this.countdownEl.hidden = false;
    this.countdownEl.textContent = String(this.countdownLeft);
    this.countdownEl.classList.remove('pulse');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pulse');
    this.emit();
  }

  cancelCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = 0;
    this.countdownLeft = 0;
    this.countdownEl.hidden = true;
  }

  private loop() {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      if (this.anim) {
        const k = Math.min(1, (t - this.anim.t0) / this.anim.dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.pos = this.anim.from + (this.anim.to - this.anim.from) * e;
        if (k >= 1) this.anim = null;
        this.update();
      } else if (this.playing && !this.dragging) {
        this.ramp = Math.min(1, this.ramp + dt / 1.2);
        const prevSection = this.currentSection;
        this.pos += this.velocity() * this.ramp * dt;
        this.elapsed += dt;
        if (this.pos >= this.maxPos) {
          this.pos = this.maxPos;
          if (this.s.loop) this.pos = 0;
          else this.playing = false;
        }
        this.update();
        if (this.s.pauseOnSectionEnd && this.currentSection !== prevSection && this.playing) {
          this.playing = false;
          this.emit();
        }
      }
      if (this.playing || this.anim) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Atualiza transformação e destaque da linha atual */
  update(force = false) {
    this.content.style.transform = `translate3d(0, ${-this.pos}px, 0)`;
    const idx = Math.max(0, this.indexAt(this.readPoint()));
    if (idx !== this.currentIdx || force) {
      const prev = this.currentIdx;
      this.currentIdx = idx;
      // marca linhas já lidas para o efeito de esmaecimento
      const lo = Math.min(prev < 0 ? 0 : prev, idx), hi = Math.max(prev, idx);
      const from = force ? 0 : lo, to = force ? this.nodes.length - 1 : hi;
      for (let i = from; i <= to; i++) {
        const n = this.nodes[i];
        if (!n) continue;
        n.classList.toggle('past', i < idx);
        n.classList.toggle('cur', i === idx);
      }
      const el = this.script?.elements[idx];
      if (el) this.currentSection = el.section;
    }
    if (this.onFrame && this.tops.length) this.onFrame(this.getAnchor());
    this.emit(force);
  }

  private lastEmit = 0;
  private emit(force = false) {
    if (!this.onState) return;
    const now = performance.now();
    if (!force && this.playing && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    const v = this.velocity();
    this.onState({
      playing: this.playing,
      progress: this.maxPos ? this.pos / this.maxPos : 0,
      section: this.currentSection,
      lpm: (v / this.lineH) * 60,
      elapsed: this.elapsed,
      remaining: this.remainingSeconds(),
      atEnd: this.pos >= this.maxPos - 1,
      countdown: this.countdownLeft,
    });
  }

  private remainingSeconds() {
    if (!this.script) return 0;
    const s = this.s;
    if (s.speedMode === 'duration') {
      let total = 0;
      for (let i = this.currentSection; i < this.script.sections.length; i++) {
        const h = this.sectionHeight(i);
        const start = this.tops[this.sectionStarts[i]] ?? 0;
        const readY = this.readPoint();
        const left = i === this.currentSection ? Math.max(0, start + h - readY) : h;
        const sec = this.script.sections[i];
        const v = sec.duration > 0 ? (h / sec.duration) * this.speedMul : (s.linesPerMinute * this.speedMul / 60) * this.lineH;
        total += v > 0 ? left / v : 0;
      }
      return total;
    }
    const v = this.velocity();
    return v > 0 ? (this.maxPos - this.pos) / v : 0;
  }

  resetTimer() {
    this.elapsed = 0;
    this.emit();
  }

  scrollBy(px: number, smooth = false) {
    if (smooth) return this.animateTo(this.pos + px);
    this.pos += px;
    this.clamp();
    this.update();
  }

  animateTo(target: number, dur = 450) {
    target = Math.max(0, Math.min(this.maxPos, target));
    this.anim = { from: this.pos, to: target, t0: performance.now(), dur };
    if (!this.playing) this.loop();
  }

  jumpToIndex(i: number, smooth = true) {
    if (!this.tops.length) return;
    i = Math.max(0, Math.min(this.tops.length - 1, i));
    const pt = parseFloat(this.content.style.paddingTop) || 0;
    const target = this.tops[i] - pt + (this.heights[i] - this.lineH) / 2;
    if (smooth) this.animateTo(target);
    else {
      this.pos = target;
      this.clamp();
      this.update(true);
    }
  }

  jumpToSection(i: number, smooth = true) {
    const idx = this.sectionStarts[i];
    if (idx !== undefined) this.jumpToIndex(idx, smooth);
  }

  /** Volta ao início da música atual; se já estiver no início, vai para a anterior */
  prevSection() {
    const start = this.sectionStarts[this.currentSection] ?? 0;
    if (this.currentIdx - start > 2 || this.currentSection === 0) this.jumpToSection(this.currentSection);
    else this.jumpToSection(this.currentSection - 1);
  }

  /** Próxima / anterior estrofe (bloco separado por quebra) */
  jumpStanza(dir: 1 | -1) {
    if (!this.script) return;
    const els = this.script.elements;
    const cur = Math.max(0, this.currentIdx);
    const isStart = (i: number) =>
      els[i] && els[i].kind !== 'break' && (i === 0 || els[i - 1].kind === 'break' || els[i].kind === 'title' || els[i - 1].kind === 'title');
    let i = cur + dir;
    while (i >= 0 && i < els.length && !isStart(i)) i += dir;
    if (dir === -1) {
      // se já estamos no início da estrofe atual, volta para a anterior
      let start = cur;
      while (start > 0 && !isStart(start)) start--;
      if (start < cur) i = start;
    }
    if (i >= 0 && i < els.length) this.jumpToIndex(i);
  }

  jumpLine(dir: 1 | -1) {
    this.scrollBy(dir * this.lineH, true);
  }

  get section() {
    return this.currentSection;
  }

  private bindInput() {
    // roda do mouse: ajuste manual fino
    this.viewport.addEventListener(
      'wheel',
      (e) => {
        if (this.follower) return;
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * this.lineH : e.deltaY;
        this.scrollBy(this.s.mirrorV ? -dy : dy);
        this.onUserScroll?.();
      },
      { passive: false },
    );
    // toque/arrasto: desloca manualmente; toque rápido alterna play/pause
    let startY = 0, startPos = 0, t0 = 0, moved = false;
    this.viewport.addEventListener('pointerdown', (e) => {
      if (this.follower || e.button !== 0) return;
      this.dragging = true;
      this.wasPlaying = this.playing;
      startY = e.clientY;
      startPos = this.pos;
      t0 = performance.now();
      moved = false;
      this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) {
        this.pos = startPos - (this.s.mirrorV ? -dy : dy);
        this.clamp();
        this.update();
        this.onUserScroll?.();
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        this.viewport.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!moved && performance.now() - t0 < 350) {
        this.root.dispatchEvent(new CustomEvent('tap', { detail: { x: e.clientX, y: e.clientY } }));
      } else if (this.wasPlaying) {
        this.last = performance.now();
      }
    };
    this.viewport.addEventListener('pointerup', end);
    this.viewport.addEventListener('pointercancel', end);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cancelCountdown();
    this.root.remove();
  }
}
