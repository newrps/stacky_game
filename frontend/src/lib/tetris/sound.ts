// Web Audio API 기반 짧은 사운드 (외부 파일 X)
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean) { muted = v; }
export function isMuted(): boolean { return muted; }

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 모바일 첫 터치/탭 시 호출 — AudioContext 잠금 해제 (iOS Safari 등)
export function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  // 무음 짧은 oscillator를 한 번 돌려 unlock 강제
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.01);
  } catch {}
}

function tone(opts: {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  release?: number;
  delay?: number;
  sweepTo?: number;
}) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + opts.dur);
  }
  const vol = opts.vol ?? 0.12;
  const atk = opts.attack ?? 0.005;
  const rel = opts.release ?? 0.04;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + atk);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + rel);
}

function noise(opts: { dur: number; vol?: number; hp?: number; lp?: number; delay?: number }) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(64, Math.floor(c.sampleRate * opts.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // 짧고 빠른 감쇠 (착! 느낌)
    const env = Math.pow(1 - i / data.length, 2.2);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = opts.vol ?? 0.16;
  let node: AudioNode = src;
  if (opts.hp) {
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = opts.hp;
    node.connect(hp);
    node = hp;
  }
  if (opts.lp) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lp;
    node.connect(lp);
    node = lp;
  }
  node.connect(gain).connect(c.destination);
  src.start(t0);
}

// 짧은 클릭 (틱)
function click(opts: { freq?: number; dur?: number; vol?: number; delay?: number }) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const dur = opts.dur ?? 0.03;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(opts.freq ?? 1500, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 1500) * 0.3), t0 + dur);
  const vol = opts.vol ?? 0.12;
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// 락(말 고정) — 짧고 또렷한 "착"
export function sndLock() {
  click({ freq: 1800, dur: 0.025, vol: 0.14 });
  noise({ dur: 0.04, vol: 0.08, hp: 1500, lp: 6000 });
}

// 하드드롭 — 묵직한 "탁!"
export function sndHardDrop() {
  click({ freq: 600, dur: 0.035, vol: 0.18 });
  noise({ dur: 0.08, vol: 0.18, hp: 200, lp: 2500 });
  tone({ freq: 90, sweepTo: 50, dur: 0.08, type: 'square', vol: 0.16 });
}

// 홀드 — 산뜻한 "틱"
export function sndHold() {
  click({ freq: 2200, dur: 0.03, vol: 0.12 });
  click({ freq: 1500, dur: 0.025, vol: 0.1, delay: 0.04 });
}

// 라인 클리어 — "차자작" 돌 부서지는 소리 (빠른 노이즈 버스트 흩뿌리기)
export function sndClear(lines: number) {
  if (lines <= 0) return;
  // 베이스 임팩트 (낮은 충격)
  noise({ dur: 0.08, vol: 0.18, hp: 200, lp: 1200 });
  // 차자작 — 6~12개 짧은 노이즈 파편을 약간 랜덤 타이밍·주파수로
  const shards = 6 + lines * 2;
  for (let i = 0; i < shards; i++) {
    const delay = i * 0.018 + Math.random() * 0.012;
    const hp = 1500 + Math.random() * 3500;
    const lp = hp + 1500 + Math.random() * 2000;
    const dur = 0.018 + Math.random() * 0.025;
    const vol = 0.07 + Math.random() * 0.06;
    noise({ dur, vol, hp, lp, delay });
  }
  // 끝에 살짝 반짝 (작은 조각이 튀는 느낌)
  click({ freq: 3200, dur: 0.02, vol: 0.08, delay: shards * 0.018 });
  click({ freq: 4000, dur: 0.02, vol: 0.08, delay: shards * 0.018 + 0.025 });

  if (lines >= 4) {
    // 테트리스 — 추가로 묵직한 베이스
    tone({ freq: 80, sweepTo: 45, dur: 0.35, type: 'square', vol: 0.16, delay: 0.05 });
    noise({ dur: 0.2, vol: 0.1, hp: 80, lp: 600, delay: 0.02 });
  }
}

// T-Spin — 짧고 반짝
export function sndTSpin() {
  click({ freq: 2500, dur: 0.025, vol: 0.14 });
  click({ freq: 3200, dur: 0.025, vol: 0.14, delay: 0.04 });
  noise({ dur: 0.05, vol: 0.06, hp: 3000 });
}

// 퍼펙트 클리어 — 빠른 5연타 + 임팩트
export function sndPerfectClear() {
  noise({ dur: 0.25, vol: 0.18, hp: 400, lp: 5000 });
  for (let i = 0; i < 5; i++) {
    click({ freq: 1800 + i * 220, dur: 0.03, vol: 0.16, delay: i * 0.05 });
  }
  tone({ freq: 80, sweepTo: 40, dur: 0.35, type: 'square', vol: 0.16, delay: 0.05 });
}

// 레벨업 — 상승 클릭 3연타
export function sndLevelUp() {
  click({ freq: 1400, dur: 0.04, vol: 0.14 });
  click({ freq: 1800, dur: 0.04, vol: 0.14, delay: 0.07 });
  click({ freq: 2300, dur: 0.05, vol: 0.16, delay: 0.14 });
}

// 게임 오버 — 무거운 임팩트
export function sndGameOver() {
  noise({ dur: 0.4, vol: 0.18, hp: 100, lp: 1500 });
  tone({ freq: 200, sweepTo: 50, dur: 0.5, type: 'sawtooth', vol: 0.16 });
}

// 가비지 받음 — 두꺼운 "쿵"
export function sndGarbage() {
  noise({ dur: 0.12, vol: 0.16, hp: 80, lp: 1000 });
  tone({ freq: 70, sweepTo: 35, dur: 0.15, type: 'square', vol: 0.14 });
}
