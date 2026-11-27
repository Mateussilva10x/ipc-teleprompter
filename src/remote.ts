/**
 * Controle remoto pelo celular.
 *
 * O computador do teleprompter (host) cria um "peer" WebRTC com um ID aleatório e
 * mostra um QR code com o link `?remote=<id>`. O celular abre o link, conecta
 * direto ao host (canal de dados WebRTC, ponto a ponto) e envia comandos; o host
 * devolve o estado (tocando, música atual, velocidade, progresso, tempos).
 *
 * A troca inicial de sinalização usa o servidor público gratuito do PeerJS, então
 * não é preciso backend próprio (funciona em hospedagem estática como a Vercel).
 */
import Peer, { type DataConnection } from 'peerjs';
import QRCode from 'qrcode';

export type RemoteCommand =
  | 'toggle' | 'start' | 'exit' | 'speed' | 'line' | 'stanza' | 'section' | 'goto' | 'home'
  | 'lines' | 'mirror' | 'reset' | 'scroll';

export interface RemoteMessage {
  type: 'cmd';
  cmd: RemoteCommand;
  arg?: number;
}

export interface RemoteState {
  type: 'state';
  live: boolean;
  playing: boolean;
  countdown: number;
  section: number;
  sections: string[];
  speedLabel: string;
  lines: number;
  mirror: boolean;
  progress: number;
  elapsed: number;
  remaining: number;
  scriptName: string;
}

const ID_KEY = 'ipc-teleprompter:remote-id';
const ON_KEY = 'ipc-teleprompter:remote-on';

function randomId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'ipctp-' + Array.from(a, (b) => (b % 36).toString(36)).join('');
}

function storedId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

export function remoteLink(id: string) {
  const u = new URL(location.href);
  u.search = '?remote=' + encodeURIComponent(id);
  u.hash = '';
  return u.toString();
}

export function qrDataUrl(text: string) {
  return QRCode.toDataURL(text, { margin: 1, width: 520, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

/** Lado do teleprompter: recebe comandos e envia o estado. */
export class RemoteHost {
  private peer: Peer | null = null;
  private conns = new Set<DataConnection>();
  id = '';
  status: 'off' | 'connecting' | 'ready' | 'error' = 'off';
  error = '';
  onCommand?: (m: RemoteMessage) => void;
  onChange?: () => void;
  getState?: () => RemoteState | null;
  private timer = 0;

  get connected() {
    return this.conns.size;
  }

  static wasEnabled() {
    try {
      return localStorage.getItem(ON_KEY) === '1';
    } catch {
      return false;
    }
  }

  start(retry = 0) {
    if (this.peer && !this.peer.destroyed) return;
    this.id = retry ? randomId() : storedId();
    this.status = 'connecting';
    this.onChange?.();
    const peer = new Peer(this.id, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'ready';
      try {
        localStorage.setItem(ID_KEY, this.id);
        localStorage.setItem(ON_KEY, '1');
      } catch {
        /* ignore */
      }
      this.onChange?.();
    });
    peer.on('connection', (c) => this.accept(c));
    peer.on('disconnected', () => {
      // perdeu o servidor de sinalização; conexões já abertas continuam funcionando
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id' && retry < 3) {
        // ID ainda preso a uma sessão antiga: gera outro
        peer.destroy();
        this.peer = null;
        this.start(retry + 1);
        return;
      }
      if (err.type === 'peer-unavailable') return;
      this.status = 'error';
      this.error =
        err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error'
          ? 'Sem conexão com o servidor de pareamento. Verifique a internet.'
          : err.type === 'browser-incompatible'
            ? 'Este navegador não suporta WebRTC.'
            : 'Erro no controle remoto: ' + (err.type || err.message);
      this.onChange?.();
    });
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.broadcast(), 250);
  }

  private accept(c: DataConnection) {
    c.on('open', () => {
      this.conns.add(c);
      this.onChange?.();
      this.broadcast(true);
    });
    c.on('data', (d) => {
      const m = d as RemoteMessage;
      if (m && m.type === 'cmd') {
        this.onCommand?.(m);
        setTimeout(() => this.broadcast(true), 30);
      }
    });
    const drop = () => {
      this.conns.delete(c);
      this.onChange?.();
    };
    c.on('close', drop);
    c.on('error', drop);
  }

  private lastSent = '';
  broadcast(force = false) {
    if (!this.conns.size || !this.getState) return;
    const st = this.getState();
    if (!st) return;
    const json = JSON.stringify(st);
    if (!force && json === this.lastSent) return;
    this.lastSent = json;
    for (const c of this.conns) if (c.open) c.send(st);
  }

  stop() {
    clearInterval(this.timer);
    for (const c of this.conns) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
    this.status = 'off';
    try {
      localStorage.removeItem(ON_KEY);
    } catch {
      /* ignore */
    }
    this.onChange?.();
  }

  /** Gera um novo ID (o QR antigo deixa de funcionar). */
  renew() {
    this.stop();
    try {
      localStorage.setItem(ID_KEY, randomId());
    } catch {
      /* ignore */
    }
    this.start();
  }
}

// ---------------------------------------------------------------------------
// Lado do celular
// ---------------------------------------------------------------------------
function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function runRemote(app: HTMLElement, hostId: string) {
  document.body.classList.add('remote-mode');
  document.title = 'Controle — IPC Teleprompter';
  app.innerHTML = `
  <main class="rc">
    <header class="rc-top">
      <span class="rc-dot" aria-hidden="true"></span>
      <span class="rc-status">Conectando…</span>
    </header>
    <section class="rc-now">
      <small class="rc-script"></small>
      <select class="rc-song" aria-label="Música"></select>
      <div class="rc-prog"><div></div></div>
      <div class="rc-times"><span class="rc-el">0:00</span><span class="rc-rem">−0:00</span></div>
    </section>
    <section class="rc-main">
      <button class="rc-btn" data-c="stanza" data-a="-1" aria-label="Estrofe anterior">⏪</button>
      <button class="rc-play" data-c="toggle" aria-label="Play/Pausa">▶</button>
      <button class="rc-btn" data-c="stanza" data-a="1" aria-label="Próxima estrofe">⏩</button>
    </section>
    <section class="rc-row">
      <button class="rc-btn" data-c="line" data-a="-1">▲ Linha</button>
      <button class="rc-btn" data-c="line" data-a="1">▼ Linha</button>
    </section>
    <section class="rc-card">
      <span class="rc-label">Velocidade</span>
      <div class="rc-stepper"><button class="rc-btn" data-c="speed" data-a="-1">−</button><b class="rc-speed">—</b><button class="rc-btn" data-c="speed" data-a="1">+</button></div>
    </section>
    <section class="rc-card">
      <span class="rc-label">Tamanho da letra</span>
      <div class="rc-stepper"><button class="rc-btn" data-c="lines" data-a="1">A−</button><b class="rc-lines">—</b><button class="rc-btn" data-c="lines" data-a="-1">A+</button></div>
    </section>
    <section class="rc-pad" aria-label="Arraste para ajustar a posição">
      <span>Arraste aqui para rolar o texto</span>
    </section>
    <section class="rc-row">
      <button class="rc-btn" data-c="section" data-a="-1">⏮ Música</button>
      <button class="rc-btn" data-c="section" data-a="1">Música ⏭</button>
    </section>
    <section class="rc-row">
      <button class="rc-btn" data-c="home">⤒ Início</button>
      <button class="rc-btn" data-c="mirror">⇋ Espelhar</button>
      <button class="rc-btn" data-c="reset">⏱ Zerar</button>
    </section>
    <section class="rc-row">
      <button class="rc-btn rc-start" data-c="start">▶ Abrir teleprompter</button>
      <button class="rc-btn rc-exit" data-c="exit">✕ Sair do modo ao vivo</button>
    </section>
  </main>`;

  const $ = (s: string) => app.querySelector(s) as HTMLElement;
  let conn: DataConnection | null = null;
  let peer: Peer | null = null;
  let state: RemoteState | null = null;
  let retry = 0;

  const setStatus = (txt: string, cls: 'ok' | 'wait' | 'err') => {
    $('.rc-status').textContent = txt;
    $('.rc-dot').className = 'rc-dot ' + cls;
    app.querySelector('.rc')!.classList.toggle('offline', cls !== 'ok');
  };

  const send = (cmd: RemoteCommand, arg?: number) => {
    if (!conn?.open) return;
    conn.send({ type: 'cmd', cmd, arg } satisfies RemoteMessage);
    navigator.vibrate?.(12);
  };

  app.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => {
    b.onclick = () => send(b.dataset.c as RemoteCommand, b.dataset.a !== undefined ? +b.dataset.a : undefined);
  });
  ($('.rc-song') as HTMLSelectElement).onchange = (e) => send('goto', +(e.target as HTMLSelectElement).value);

  // área de arrasto: rola o texto proporcionalmente ao movimento do dedo
  const pad = $('.rc-pad');
  let lastY = 0, acc = 0;
  pad.addEventListener('pointerdown', (e) => {
    lastY = e.clientY;
    acc = 0;
    pad.setPointerCapture(e.pointerId);
    pad.classList.add('on');
  });
  pad.addEventListener('pointermove', (e) => {
    if (!pad.classList.contains('on')) return;
    acc += lastY - e.clientY;
    lastY = e.clientY;
    if (Math.abs(acc) >= 6) {
      send('scroll', Math.round(acc * 2));
      acc = 0;
    }
  });
  const up = () => pad.classList.remove('on');
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);

  const render = () => {
    if (!state) return;
    const s = state;
    $('.rc-play').textContent = s.playing || s.countdown ? '⏸' : '▶';
    $('.rc-play').classList.toggle('playing', s.playing || s.countdown > 0);
    $('.rc-speed').textContent = s.speedLabel;
    $('.rc-lines').textContent = s.lines + ' linhas';
    $('.rc-el').textContent = '⏱ ' + fmt(s.elapsed);
    $('.rc-rem').textContent = '−' + fmt(s.remaining);
    ($('.rc-prog').firstElementChild as HTMLElement).style.width = s.progress * 100 + '%';
    $('.rc-script').textContent = s.scriptName;
    const sel = $('.rc-song') as HTMLSelectElement;
    const opts = s.sections.map((t, i) => `<option value="${i}">${i + 1}. ${esc(t)}</option>`).join('');
    if (sel.dataset.opts !== opts) {
      sel.innerHTML = opts;
      sel.dataset.opts = opts;
    }
    if (sel.value !== String(s.section)) sel.value = String(s.section);
    $('.rc-start').hidden = s.live;
    $('.rc-exit').hidden = !s.live;
    $('[data-c="mirror"]').classList.toggle('on', s.mirror);
  };

  const connect = () => {
    setStatus(retry ? 'Reconectando…' : 'Conectando…', 'wait');
    if (!peer || peer.destroyed) {
      peer = new Peer({ debug: 0 });
      peer.on('error', (err: Error & { type?: string }) => {
        if (err.type === 'peer-unavailable') {
          setStatus('Teleprompter não encontrado. Ele está aberto? Tentando de novo…', 'err');
          scheduleRetry();
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          setStatus('Sem internet ou servidor indisponível. Tentando de novo…', 'err');
          scheduleRetry();
        } else {
          setStatus('Erro: ' + (err.type || err.message), 'err');
          scheduleRetry();
        }
      });
      peer.on('open', open);
      peer.on('disconnected', () => !peer!.destroyed && peer!.reconnect());
    } else if (peer.open) open();
  };

  const open = () => {
    conn?.close();
    conn = peer!.connect(hostId, { reliable: true });
    conn.on('open', () => {
      retry = 0;
      setStatus('Conectado', 'ok');
      navigator.vibrate?.(30);
    });
    conn.on('data', (d) => {
      const m = d as RemoteState;
      if (m && m.type === 'state') {
        state = m;
        render();
      }
    });
    conn.on('close', () => {
      setStatus('Conexão perdida. Reconectando…', 'err');
      scheduleRetry();
    });
  };

  let retryTimer = 0;
  const scheduleRetry = () => {
    clearTimeout(retryTimer);
    retry++;
    retryTimer = window.setTimeout(connect, Math.min(8000, 1500 * retry));
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !conn?.open) {
      retry = 0;
      connect();
    }
  });

  // mantém a tela do celular acesa enquanto controla
  const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } };
  const wake = () => nav.wakeLock?.request('screen').catch(() => {});
  wake();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());

  connect();
}
