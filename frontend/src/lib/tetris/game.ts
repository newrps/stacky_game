import {
  type Piece, type PieceType, BagRng, getMatrix, kicks, spawnPosition, COLORS, PIECES
} from './piece';
import {
  sndLock, sndHardDrop, sndHold, sndClear, sndTSpin, sndPerfectClear,
  sndLevelUp, sndGameOver, sndGarbage
} from './sound';

export const BOARD_W = 10;
export const BOARD_H = 20;
export const HIDDEN_ROWS = 2; // spawn 위 영역 (2줄)
export const TOTAL_H = BOARD_H + HIDDEN_ROWS;

export type Cell = PieceType | 'G' | null;

export interface GameState {
  grid: Cell[][];          // [TOTAL_H][BOARD_W]
  current: Piece | null;
  hold: PieceType | null;
  canHold: boolean;
  next: PieceType[];       // 5개 미리보기
  score: number;
  lines: number;
  level: number;
  combo: number;
  b2b: boolean;            // back-to-back (테트리스/T-Spin 연속)
  gameOver: boolean;
  paused: boolean;
  /** 마지막 액션이 회전이었는지 (T-Spin 검출에 사용) */
  lastRotated: boolean;
  /** 마지막 락 클리어 정보 */
  lastClear: ClearInfo | null;
}

export interface ClearInfo {
  lines: number;
  tspin: 'none' | 'mini' | 'full';
  combo: number;
  b2b: boolean;
  score: number;
  /** 이 클리어로 상대에게 보내는 가비지 줄 수 */
  attackOut: number;
}

export interface Particle {
  x: number; y: number;       // pixel coords (relative to board top-left, hidden rows excluded)
  vx: number; vy: number;     // pixels per second
  size: number;
  color: string;
  life: number;               // ms remaining
  maxLife: number;
  rot: number;                // rotation rad
  vrot: number;
}

export class TetrisGame {
  state: GameState;
  rng: BagRng;
  /** 멀티플레이용 — 라인 클리어로 상대에게 보낼 가비지 발생 시 호출 */
  onAttack?: (power: number, hole: number) => void;
  /** 들어온 가비지 큐 — { hole: 0..9 } */
  pendingGarbage: { hole: number }[] = [];
  /** 라인 클리어 파티클 */
  particles: Particle[] = [];
  private lastTickTime = 0;
  // 락 딜레이 / 그라비티
  private lastGravityTime = 0;
  private lockTimer = 0;
  private lockDelay = 500; // ms
  private lockResets = 0;
  private maxLockResets = 15;
  // 입력 자동 반복
  private dasTimer = 0;
  private dasDir: -1 | 0 | 1 = 0;
  private dasDelay = 130;
  private arr = 30;
  private softDropping = false;

  constructor(seed: number) {
    this.rng = new BagRng(seed);
    this.state = {
      grid: makeEmptyGrid(),
      current: null,
      hold: null,
      canHold: true,
      next: [],
      score: 0, lines: 0, level: 1,
      combo: -1, b2b: false,
      gameOver: false, paused: false,
      lastRotated: false, lastClear: null
    };
    this.refillNext();
    this.spawnNext();
  }

  private refillNext() {
    while (this.state.next.length < 5) {
      this.state.next.push(this.rng.draw());
    }
  }

  spawnNext() {
    const t = this.state.next.shift()!;
    this.refillNext();
    const pos = spawnPosition(t);
    const piece: Piece = { type: t, rotation: 0, x: pos.x, y: pos.y };
    if (this.collides(piece, this.state.grid)) {
      // top out
      this.state.gameOver = true;
      this.state.current = null;
      sndGameOver();
      return;
    }
    this.state.current = piece;
    this.state.canHold = true;
    this.lastGravityTime = performance.now();
    this.lockTimer = 0;
    this.lockResets = 0;
    this.state.lastRotated = false;
  }

  collides(p: Piece, grid: Cell[][]): boolean {
    const m = getMatrix(p);
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || x >= BOARD_W) return true;
        if (y >= TOTAL_H) return true;
        if (y < 0) continue;
        if (grid[y][x]) return true;
      }
    }
    return false;
  }

  move(dx: number): boolean {
    const p = this.state.current; if (!p) return false;
    const np = { ...p, x: p.x + dx };
    if (!this.collides(np, this.state.grid)) {
      this.state.current = np;
      this.resetLock();
      this.state.lastRotated = false;
      return true;
    }
    return false;
  }

  rotate(dir: 1 | -1): boolean {
    const p = this.state.current; if (!p) return false;
    if (p.type === 'O') return false;
    const from = p.rotation;
    const to = (p.rotation + (dir === 1 ? 1 : 3)) % 4;
    const offsets = kicks(p.type, from, to);
    for (const [dx, dy] of offsets) {
      const np = { ...p, rotation: to, x: p.x + dx, y: p.y - dy }; // SRS Y축 반전
      if (!this.collides(np, this.state.grid)) {
        this.state.current = np;
        this.resetLock();
        this.state.lastRotated = true;
        return true;
      }
    }
    return false;
  }

  softDrop(): boolean {
    return this.move_y(1);
  }

  private move_y(dy: number): boolean {
    const p = this.state.current; if (!p) return false;
    const np = { ...p, y: p.y + dy };
    if (!this.collides(np, this.state.grid)) {
      this.state.current = np;
      if (dy > 0) this.state.score += 1; // 소프트드롭 점수
      this.state.lastRotated = false;
      return true;
    }
    return false;
  }

  hardDrop() {
    const p = this.state.current; if (!p) return;
    let dropped = 0;
    while (this.move_y(1)) dropped++;
    this.state.score += dropped * 2;
    sndHardDrop();
    this.lockPiece();
  }

  hold() {
    if (!this.state.canHold) return;
    const cur = this.state.current; if (!cur) return;
    const prev = this.state.hold;
    this.state.hold = cur.type;
    this.state.canHold = false;
    sndHold();
    if (prev) {
      const pos = spawnPosition(prev);
      const np: Piece = { type: prev, rotation: 0, x: pos.x, y: pos.y };
      if (this.collides(np, this.state.grid)) {
        this.state.gameOver = true;
        this.state.current = null;
        sndGameOver();
        return;
      }
      this.state.current = np;
      this.lastGravityTime = performance.now();
      this.lockTimer = 0;
    } else {
      this.spawnNext();
    }
    this.state.lastRotated = false;
  }

  private resetLock() {
    if (!this.state.current) return;
    if (!this.isOnGround(this.state.current)) return;
    if (this.lockResets < this.maxLockResets) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  private isOnGround(p: Piece): boolean {
    return this.collides({ ...p, y: p.y + 1 }, this.state.grid);
  }

  /** 락(고정) — 라인 클리어 + 다음 piece spawn */
  private lockPiece() {
    const p = this.state.current; if (!p) return;
    const m = getMatrix(p);
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = p.x + dx, y = p.y + dy;
        if (y < 0 || y >= TOTAL_H || x < 0 || x >= BOARD_W) continue;
        this.state.grid[y][x] = p.type;
      }
    }

    // T-Spin 검출 — 마지막 액션이 회전이고, T-piece가 코너 3+ 차있으면 T-Spin
    let tspin: ClearInfo['tspin'] = 'none';
    if (p.type === 'T' && this.state.lastRotated) {
      tspin = this.detectTSpin(p);
    }

    // 라인 클리어
    const cleared: number[] = [];
    for (let y = TOTAL_H - 1; y >= 0; y--) {
      if (this.state.grid[y].every(c => c)) cleared.push(y);
    }
    if (cleared.length > 0) {
      // 사라지는 셀에서 파티클 스폰
      this.spawnClearParticles(cleared);
      // 위에서부터 비우고 다 위로 당김
      const newGrid = this.state.grid.filter((_, y) => !cleared.includes(y));
      while (newGrid.length < TOTAL_H) newGrid.unshift(new Array(BOARD_W).fill(null));
      this.state.grid = newGrid;
    }

    // 콤보 (점수 계산 전에 갱신)
    if (cleared.length > 0) {
      this.state.combo++;
    }

    // Perfect Clear 체크 (모든 셀이 비었으면)
    const perfectClear = cleared.length > 0 &&
      this.state.grid.every(row => row.every(c => !c));

    // 점수 계산
    const info = this.scoreLines(cleared.length, tspin, perfectClear);

    if (cleared.length > 0) {
      // 콤보 점수
      this.state.score += this.state.combo * 50 * this.state.level;
    } else {
      this.state.combo = -1;
    }

    // B2B 갱신
    const isHard = cleared.length === 4 || (tspin !== 'none' && cleared.length > 0);
    if (cleared.length > 0) {
      this.state.b2b = isHard;
    }

    // 라인·레벨
    const prevLevel = this.state.level;
    this.state.lines += cleared.length;
    this.state.level = Math.max(1, Math.floor(this.state.lines / 10) + 1);

    // 사운드: 라인 수 / T-Spin / Perfect Clear / 레벨업 / 락
    if (perfectClear) {
      sndPerfectClear();
    } else if (tspin !== 'none' && cleared.length > 0) {
      sndTSpin();
      sndClear(cleared.length);
    } else if (cleared.length > 0) {
      sndClear(cleared.length);
    } else {
      sndLock();
    }
    if (this.state.level > prevLevel) {
      setTimeout(() => sndLevelUp(), 200);
    }

    // === 가비지 어택 처리 ===
    let attackOut = computeAttack(cleared.length, tspin, this.state.b2b, this.state.combo, perfectClear);
    if (cleared.length > 0) {
      // 라인 클리어 시 들어온 가비지 캔슬
      while (this.pendingGarbage.length > 0 && attackOut > 0) {
        this.pendingGarbage.shift();
        attackOut--;
      }
      // 남은 어택은 상대에게
      if (attackOut > 0 && this.onAttack) {
        const hole = Math.floor(Math.random() * BOARD_W);
        this.onAttack(attackOut, hole);
      }
    } else {
      // 라인 클리어 0 → 큐에 쌓인 가비지 적용
      const queued = this.pendingGarbage.slice();
      this.pendingGarbage = [];
      for (const g of queued) this.applyGarbageRow(g.hole);
    }
    info.attackOut = attackOut;
    this.state.lastClear = info;

    this.spawnNext();
  }

  /** 라인 클리어 시 사라지는 셀에서 파티클 스폰 */
  private spawnClearParticles(clearedRows: number[]) {
    const CELL_PX = 30;
    for (const y of clearedRows) {
      for (let x = 0; x < BOARD_W; x++) {
        const c = this.state.grid[y][x];
        if (!c) continue;
        const color = c === 'G' ? '#5a6470' : COLORS[c as PieceType];
        const cx = x * CELL_PX + CELL_PX / 2 + 2;
        const cy = (y - HIDDEN_ROWS) * CELL_PX + CELL_PX / 2 + 2;
        // 셀당 파편 6~8개
        const n = 6 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 80 + Math.random() * 200;
          this.particles.push({
            x: cx + (Math.random() - 0.5) * 8,
            y: cy + (Math.random() - 0.5) * 8,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 100, // 위로 살짝
            size: 3 + Math.random() * 5,
            color,
            life: 600 + Math.random() * 200,
            maxLife: 700,
            rot: Math.random() * Math.PI * 2,
            vrot: (Math.random() - 0.5) * 12
          });
        }
      }
    }
  }

  /** 외부에서 가비지 받기 (멀티플레이) */
  enqueueGarbage(rows: number, hole: number) {
    for (let i = 0; i < rows; i++) {
      this.pendingGarbage.push({ hole });
    }
  }

  /** 화면 하단에 가비지 한 줄 추가 (보드 위로 한 칸 밀고) */
  private applyGarbageRow(hole: number) {
    // 위쪽에 있는 모든 줄을 한 칸 위로 이동 (= shift())
    this.state.grid.shift();
    const row: Cell[] = new Array(BOARD_W).fill('G');
    if (hole >= 0 && hole < BOARD_W) row[hole] = null;
    this.state.grid.push(row);
    sndGarbage();
    // 만약 piece가 천장에 박히면 game over
    if (this.state.current && this.collides(this.state.current, this.state.grid)) {
      this.state.gameOver = true;
      sndGameOver();
    }
  }

  private detectTSpin(p: Piece): 'none' | 'mini' | 'full' {
    // T-piece 중심 기준 4 코너 중 3+ 차있으면 T-Spin
    const cx = p.x + 1, cy = p.y + 1;
    const corners = [
      [cx - 1, cy - 1], [cx + 1, cy - 1],
      [cx - 1, cy + 1], [cx + 1, cy + 1]
    ];
    let filled = 0;
    for (const [x, y] of corners) {
      if (x < 0 || x >= BOARD_W || y < 0 || y >= TOTAL_H) { filled++; continue; }
      if (this.state.grid[y][x]) filled++;
    }
    return filled >= 3 ? 'full' : 'none';
  }

  private scoreLines(lines: number, tspin: 'none' | 'mini' | 'full', perfectClear: boolean): ClearInfo {
    let base = 0;
    if (tspin === 'full') {
      base = [400, 800, 1200, 1600][lines] ?? 0;
    } else if (tspin === 'mini') {
      base = [100, 200, 400, 0][lines] ?? 0;
    } else {
      base = [0, 100, 300, 500, 800][lines] ?? 0;
    }
    let score = base * this.state.level;
    if (this.state.b2b && (lines === 4 || tspin !== 'none')) {
      score = Math.floor(score * 1.5);
    }
    if (perfectClear) score += 1500 * this.state.level;
    this.state.score += score;
    return { lines, tspin, combo: this.state.combo, b2b: this.state.b2b, score, attackOut: 0 };
  }

  /** 매 프레임 호출 — gravity, lock delay, 파티클 업데이트 */
  tick(now: number) {
    // 파티클은 paused/gameover 와 무관하게 업데이트
    const dt = this.lastTickTime > 0 ? Math.min(50, now - this.lastTickTime) : 16;
    this.lastTickTime = now;
    if (this.particles.length > 0) {
      const dts = dt / 1000;
      for (const pt of this.particles) {
        pt.x += pt.vx * dts;
        pt.y += pt.vy * dts;
        pt.vy += 600 * dts;       // 중력
        pt.vx *= 0.98;
        pt.rot += pt.vrot * dts;
        pt.life -= dt;
      }
      this.particles = this.particles.filter(p => p.life > 0);
    }

    if (this.state.gameOver || this.state.paused) return;
    const p = this.state.current; if (!p) return;

    const gravityInterval = Math.max(50, 1000 - (this.state.level - 1) * 80);
    if (now - this.lastGravityTime >= gravityInterval) {
      if (!this.move_y(1)) {
        // bottom 닿음 — 락 타이머
        this.lockTimer += now - this.lastGravityTime;
        if (this.lockTimer >= this.lockDelay) {
          this.lockPiece();
        }
      } else {
        this.lockTimer = 0;
      }
      this.lastGravityTime = now;
    } else if (this.isOnGround(p)) {
      this.lockTimer += 16; // ~60fps frame
      if (this.lockTimer >= this.lockDelay) {
        this.lockPiece();
      }
    }
  }

  /** ghost piece y 좌표 (현재 piece가 떨어질 위치) */
  ghostY(): number {
    const p = this.state.current; if (!p) return 0;
    let y = p.y;
    while (!this.collides({ ...p, y: y + 1 }, this.state.grid)) y++;
    return y;
  }
}

/** 가비지 어택 계산 — 표준 vs 모드 (Tetris Friends/Tetr.io 근사) */
export function computeAttack(
  lines: number,
  tspin: 'none' | 'mini' | 'full',
  b2b: boolean,
  combo: number,
  perfectClear: boolean
): number {
  if (lines === 0) return 0;
  let atk = 0;
  if (tspin === 'full') {
    atk = [0, 2, 4, 6][lines] ?? 0;
  } else if (tspin === 'mini') {
    atk = [0, 0, 1, 0][lines] ?? 0;
  } else {
    atk = [0, 0, 1, 2, 4][lines] ?? 0;
  }
  if (b2b && (lines === 4 || tspin !== 'none')) atk += 1;
  // 콤보 보너스 — 0,0,1,1,2,2,3,3,4,4,4,5,5...
  const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
  if (combo > 0) {
    atk += COMBO_TABLE[Math.min(combo, COMBO_TABLE.length - 1)];
  }
  if (perfectClear) atk += 10;
  return atk;
}

function makeEmptyGrid(): Cell[][] {
  const g: Cell[][] = [];
  for (let y = 0; y < TOTAL_H; y++) {
    g.push(new Array(BOARD_W).fill(null));
  }
  return g;
}

export { COLORS };
