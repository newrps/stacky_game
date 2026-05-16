<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { TetrisGame } from '$lib/tetris/game';
  import { drawBoard, drawPiecePreview } from '$lib/tetris/render';
  import { unlockAudio } from '$lib/tetris/sound';

  export let seed = Math.floor(Math.random() * 0x7fffffff);
  export let onStateChange: ((state: any) => void) | null = null;
  /** 멀티플레이 — 클리어로 상대에게 보낼 가비지 발생 시 */
  export let onAttack: ((power: number, hole: number) => void) | null = null;
  /** 게임 오버 시 1회 호출 */
  export let onGameOver: (() => void) | null = null;
  /** 외부에서 입력 비활성화 (관전 모드) */
  export let inputLocked = false;

  let game = new TetrisGame(seed);
  $: if (game) game.onAttack = onAttack ?? undefined;
  // 외부에서 라운드 종료(inputLocked)되면 게임도 멈춤 — 그라비티/가비지 적용 X
  $: if (game && inputLocked) game.state.paused = true;

  /** 외부에서 받은 가비지를 큐에 추가 */
  export function receiveGarbage(rows: number, hole: number) {
    game.enqueueGarbage(rows, hole);
    pendingGarbage = game.pendingGarbage.length;
  }
  /** 외부에서 새 시드로 재시작 */
  export function restart(newSeed: number) {
    seed = newSeed;
    game = new TetrisGame(newSeed);
    game.onAttack = onAttack ?? undefined;
    pendingGarbage = 0;
    gameOverNotified = false;
  }
  let pendingGarbage = 0;
  let gameOverNotified = false;
  // UI 미러 (값이 바뀔 때만 Svelte 트리거 → 매 프레임 repaint 방지)
  let uiScore = 0;
  let uiLines = 0;
  let uiLevel = 1;
  let uiLastClear: any = null;
  let canvas: HTMLCanvasElement;
  let holdCanvas: HTMLCanvasElement;
  let nextCanvases: HTMLCanvasElement[] = [];
  let raf: number | null = null;
  let keyDown: Record<string, boolean> = {};
  let dasTimer = 0;
  let dasDir: -1 | 0 | 1 = 0;
  let arrTimer = 0;
  let lastTickReport = 0;

  // 입력 자동 반복 설정
  const DAS = 130;     // ms
  const ARR = 30;      // ms

  function reset(newSeed?: number) {
    seed = newSeed ?? Math.floor(Math.random() * 0x7fffffff);
    game = new TetrisGame(seed);
  }

  function loop(now: number) {
    // DAS/ARR
    if (dasDir !== 0) {
      if (dasTimer < DAS) {
        dasTimer += 16;
      } else {
        arrTimer += 16;
        if (arrTimer >= ARR) {
          game.move(dasDir);
          arrTimer = 0;
        }
      }
    }
    if (keyDown['ArrowDown']) {
      game.softDrop();
    }

    game.tick(now);
    // Svelte 반응형은 값이 바뀔 때만 트리거 — 매 프레임 DOM 재처리/repaint 방지
    if (pendingGarbage !== game.pendingGarbage.length) {
      pendingGarbage = game.pendingGarbage.length;
    }
    if (uiScore !== game.state.score) uiScore = game.state.score;
    if (uiLines !== game.state.lines) uiLines = game.state.lines;
    if (uiLevel !== game.state.level) uiLevel = game.state.level;
    if (uiLastClear !== game.state.lastClear) uiLastClear = game.state.lastClear;
    if (game.state.gameOver && !gameOverNotified) {
      gameOverNotified = true;
      onGameOver?.();
    }
    drawBoard(canvas, game);
    drawPiecePreview(holdCanvas, game.state.hold);
    for (let i = 0; i < 5; i++) {
      if (nextCanvases[i]) drawPiecePreview(nextCanvases[i], game.state.next[i] ?? null);
    }

    // 외부 콜백 (멀티플레이 상태 동기화용)
    if (onStateChange && now - lastTickReport > 100) {
      lastTickReport = now;
      onStateChange({
        score: game.state.score,
        lines: game.state.lines,
        level: game.state.level,
        gameOver: game.state.gameOver
      });
    }

    raf = requestAnimationFrame(loop);
  }

  function onKeyDown(e: KeyboardEvent) {
    unlockAudio();
    if (inputLocked) return;
    if (game.state.gameOver) {
      // 멀티플레이에서는 외부 restart 만 — 솔로(R)는 그대로 허용
      if (!onAttack && (e.key === 'Enter' || e.key === 'r' || e.key === 'R')) reset();
      return;
    }
    if (keyDown[e.key]) return;
    keyDown[e.key] = true;
    switch (e.key) {
      case 'ArrowLeft': game.move(-1); dasDir = -1; dasTimer = 0; arrTimer = 0; break;
      case 'ArrowRight': game.move(1); dasDir = 1; dasTimer = 0; arrTimer = 0; break;
      case 'ArrowDown': game.softDrop(); break;
      case 'ArrowUp': case 'x': case 'X': game.rotate(1); break;
      case 'z': case 'Z': game.rotate(-1); break;
      case ' ': e.preventDefault(); game.hardDrop(); break;
      case 'c': case 'C': case 'Shift': game.hold(); break;
      case 'Escape': game.state.paused = !game.state.paused; break;
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    keyDown[e.key] = false;
    if (e.key === 'ArrowLeft') {
      if (keyDown['ArrowRight']) { dasDir = 1; dasTimer = 0; arrTimer = 0; }
      else if (dasDir === -1) dasDir = 0;
    }
    if (e.key === 'ArrowRight') {
      if (keyDown['ArrowLeft']) { dasDir = -1; dasTimer = 0; arrTimer = 0; }
      else if (dasDir === 1) dasDir = 0;
    }
  }
  // 포커스 잃으면 stuck 방지: 모든 키 상태 초기화
  function onBlur() {
    for (const k in keyDown) keyDown[k] = false;
    dasDir = 0;
    dasTimer = 0;
    arrTimer = 0;
  }

  // === 터치 컨트롤 ===
  let touchDevice = false;
  let touchHold: { dir: -1 | 0 | 1; timer: any } = { dir: 0, timer: null };
  let softTimer: any = null;

  function action(name: string) {
    unlockAudio();
    if (inputLocked) return;
    if (game.state.gameOver) {
      if (name === 'reset' && !onAttack) reset();
      return;
    }
    switch (name) {
      case 'left': game.move(-1); break;
      case 'right': game.move(1); break;
      case 'soft': game.softDrop(); break;
      case 'hard': game.hardDrop(); break;
      case 'cw': game.rotate(1); break;
      case 'ccw': game.rotate(-1); break;
      case 'hold': game.hold(); break;
      case 'pause': game.state.paused = !game.state.paused; break;
      case 'reset': reset(); break;
    }
  }

  function pressDir(dir: -1 | 1) {
    action(dir === -1 ? 'left' : 'right');
    // 길게 누르면 자동 반복
    if (touchHold.timer) clearInterval(touchHold.timer);
    touchHold.dir = dir;
    setTimeout(() => {
      if (touchHold.dir === dir) {
        touchHold.timer = setInterval(() => action(dir === -1 ? 'left' : 'right'), 50);
      }
    }, 180);
  }
  function releaseDir() {
    touchHold.dir = 0;
    if (touchHold.timer) { clearInterval(touchHold.timer); touchHold.timer = null; }
  }
  function capture(e: PointerEvent) {
    const t = e.currentTarget as HTMLElement | null;
    if (t && typeof t.setPointerCapture === 'function') {
      try { t.setPointerCapture(e.pointerId); } catch {}
    }
  }
  function pressSoft() {
    action('soft');
    if (softTimer) clearInterval(softTimer);
    softTimer = setInterval(() => action('soft'), 35);
  }
  function releaseSoft() {
    if (softTimer) { clearInterval(softTimer); softTimer = null; }
  }

  // 화면 어디든 손가락 떼면 자동반복 멈춤 (버튼 밖으로 슬라이드 후 떼는 경우)
  function globalPointerEnd() {
    releaseDir();
    releaseSoft();
  }

  onMount(() => {
    raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerup', globalPointerEnd);
    window.addEventListener('pointercancel', globalPointerEnd);
    // 터치 디바이스 감지 (코스 포인터)
    touchDevice = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  });

  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointerup', globalPointerEnd);
    window.removeEventListener('pointercancel', globalPointerEnd);
  });

  $: lc = uiLastClear;
</script>

<div class="game">
  <aside class="left">
    <div class="panel">
      <h3>HOLD</h3>
      <canvas bind:this={holdCanvas}></canvas>
    </div>
    <div class="panel score-panel">
      <div class="row"><span>SCORE</span><b>{uiScore.toLocaleString()}</b></div>
      <div class="row"><span>LINES</span><b>{uiLines}</b></div>
      <div class="row"><span>LEVEL</span><b>{uiLevel}</b></div>
      {#if game.state.combo > 0}
        <div class="row combo"><span>COMBO</span><b>{game.state.combo}</b></div>
      {/if}
      {#if game.state.b2b}
        <div class="row b2b"><span>B2B</span><b>✓</b></div>
      {/if}
    </div>
  </aside>

  <div class="board-wrap">
    <canvas bind:this={canvas} class="board"></canvas>
    <div class="garbage-gauge" title="대기 중인 가비지 라인">
      {#each Array(Math.min(20, pendingGarbage)) as _, i}
        <div class="g-row" class:hot={i < 4}></div>
      {/each}
    </div>
  </div>

  <aside class="right">
    <div class="panel">
      <h3>NEXT</h3>
      <div class="next-list">
        {#each Array(5) as _, i}
          <canvas bind:this={nextCanvases[i]}></canvas>
        {/each}
      </div>
    </div>
    {#if lc}
      <div class="panel last-clear" class:tspin={lc.tspin !== 'none'} class:tetris={lc.lines === 4}>
        {#if lc.tspin !== 'none'}<div class="tag">T-SPIN</div>{/if}
        {#if lc.lines === 4}<div class="tag">TETRIS!</div>{:else if lc.lines > 0}<div class="tag">{lc.lines} LINE</div>{/if}
        {#if lc.score > 0}<div class="pts">+{lc.score}</div>{/if}
      </div>
    {/if}
  </aside>
</div>

{#if touchDevice}
  <div class="touch-bar">
    <button class="tbtn dir"
      on:pointerdown|preventDefault={(e) => { capture(e); pressDir(-1); }}>◀</button>
    <button class="tbtn soft"
      on:pointerdown|preventDefault={(e) => { capture(e); pressSoft(); }}>↓</button>
    <button class="tbtn rotcw" on:pointerdown|preventDefault={() => action('cw')}>↻</button>
    <button class="tbtn hard" on:pointerdown|preventDefault={() => action('hard')}>⤓</button>
    <button class="tbtn dir"
      on:pointerdown|preventDefault={(e) => { capture(e); pressDir(1); }}>▶</button>
  </div>
{/if}

<style>
  .game {
    display: grid;
    grid-template-columns: 140px auto 140px;
    gap: 12px;
    align-items: start;
    justify-content: center;
    padding: 16px;
  }
  .board-wrap {
    position: relative;
    display: flex;
  }
  .board {
    display: block;
    background: #0F1419;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .garbage-gauge {
    width: 12px;
    margin-left: 4px;
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
    padding: 2px 0;
  }
  .g-row {
    height: 28px;
    background: #f57c00;
    border-radius: 2px;
    box-shadow: 0 0 4px rgba(245, 124, 0, 0.6);
  }
  .g-row.hot {
    background: #f44336;
    box-shadow: 0 0 6px rgba(244, 67, 54, 0.8);
    animation: pulse 0.7s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  aside { display: flex; flex-direction: column; gap: 12px; }
  .panel {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px; padding: 10px;
  }
  .panel h3 {
    margin: 0 0 8px; font-size: 11px;
    color: #8895a3; letter-spacing: 1px;
  }
  .panel canvas { display: block; margin: 0 auto; }
  .score-panel .row {
    display: flex; justify-content: space-between;
    margin: 4px 0; font-size: 12px;
  }
  .score-panel .row span { color: #8895a3; }
  .score-panel .row b { font-family: ui-monospace, monospace; }
  .row.combo b { color: #FFB300; }
  .row.b2b b { color: #00f0f0; }

  .next-list { display: flex; flex-direction: column; gap: 4px; }

  .last-clear {
    text-align: center;
    background: rgba(0, 240, 240, 0.1);
    border-color: rgba(0, 240, 240, 0.3);
    color: #00f0f0;
    animation: flash 0.4s;
  }
  .last-clear.tspin { background: rgba(160, 0, 240, 0.15); border-color: rgba(160, 0, 240, 0.4); color: #d49aff; }
  .last-clear.tetris { background: rgba(240, 160, 0, 0.15); border-color: rgba(240, 160, 0, 0.4); color: #ffce6b; }
  .last-clear .tag { font-weight: 700; font-size: 13px; }
  .last-clear .pts { font-size: 11px; color: #8895a3; margin-top: 2px; }
  @keyframes flash {
    0% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }

  @media (max-width: 720px) {
    .game {
      grid-template-columns: 80px 1fr 80px;
      gap: 6px;
      padding: 8px 8px 100px 8px; /* 하단 터치바 자리 */
    }
    .panel { padding: 6px; }
    .panel h3 { font-size: 9px; margin-bottom: 4px; }
    .score-panel .row { font-size: 10px; }
    .board { width: 100%; height: auto; max-width: 320px; }
    .next-list canvas { width: 60px; height: 60px; }
    .panel canvas { max-width: 100%; height: auto; }
  }
  @media (max-width: 480px) {
    .game {
      grid-template-columns: 64px 1fr 64px;
    }
  }

  /* 터치 컨트롤 */
  .touch-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: rgba(15, 20, 25, 0.95);
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(255,255,255,0.08);
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom)) 8px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
    gap: 6px;
    z-index: 500;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  .tbtn {
    background: rgba(255,255,255,0.08);
    color: #e8edf3;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 14px 0;
    font-size: 18px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .tbtn:active {
    background: rgba(255,255,255,0.18);
    transform: scale(0.96);
  }
  .tbtn.dir { font-size: 22px; padding: 18px 0; }
  .tbtn.soft { color: #ffd166; font-size: 24px; padding: 18px 0; }
  .tbtn.rotcw { color: #00f0f0; font-size: 26px; padding: 18px 0; }
  .tbtn.hard { color: #f44336; font-size: 26px; padding: 18px 0; }

  @media (max-width: 480px) {
    .touch-bar { padding: 6px 4px calc(6px + env(safe-area-inset-bottom)) 4px; gap: 4px; }
    .tbtn { padding: 14px 0; font-size: 18px; }
    .tbtn.dir { font-size: 20px; }
    .tbtn.soft, .tbtn.rotcw, .tbtn.hard { font-size: 22px; }
  }
</style>
