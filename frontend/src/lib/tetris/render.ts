import { COLORS, BOARD_W, BOARD_H, HIDDEN_ROWS, TOTAL_H, type TetrisGame } from './game';
import { getMatrix, SHAPES, type PieceType } from './piece';

const CELL = 30;
const BOARD_PAD = 2;
const GARBAGE_COLOR = '#5a6470';

export function drawBoard(canvas: HTMLCanvasElement, game: TetrisGame) {
  const ctx = canvas.getContext('2d')!;
  const W = BOARD_W * CELL + BOARD_PAD * 2;
  const H = BOARD_H * CELL + BOARD_PAD * 2;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  // 배경
  ctx.fillStyle = '#0F1419';
  ctx.fillRect(0, 0, W, H);

  // grid line
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= BOARD_W; x++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_PAD + x * CELL + 0.5, BOARD_PAD);
    ctx.lineTo(BOARD_PAD + x * CELL + 0.5, BOARD_PAD + BOARD_H * CELL);
    ctx.stroke();
  }
  for (let y = 0; y <= BOARD_H; y++) {
    ctx.beginPath();
    ctx.moveTo(BOARD_PAD, BOARD_PAD + y * CELL + 0.5);
    ctx.lineTo(BOARD_PAD + BOARD_W * CELL, BOARD_PAD + y * CELL + 0.5);
    ctx.stroke();
  }

  // 락된 셀 (grid 위쪽 hidden 2줄은 안 그림)
  for (let y = HIDDEN_ROWS; y < TOTAL_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const c = game.state.grid[y][x];
      if (!c) continue;
      const color = c === 'G' ? GARBAGE_COLOR : COLORS[c];
      drawStone(ctx, x, y - HIDDEN_ROWS, color);
    }
  }

  // ghost piece
  const p = game.state.current;
  if (p) {
    const gy = game.ghostY();
    const m = getMatrix(p);
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = p.x + dx;
        const y = gy + dy - HIDDEN_ROWS;
        if (y < 0) continue;
        drawStone(ctx, x, y, COLORS[p.type], true);
      }
    }
    // current piece
    for (let dy = 0; dy < m.length; dy++) {
      for (let dx = 0; dx < m[dy].length; dx++) {
        if (!m[dy][dx]) continue;
        const x = p.x + dx;
        const y = p.y + dy - HIDDEN_ROWS;
        if (y < 0) continue;
        drawStone(ctx, x, y, COLORS[p.type]);
      }
    }
  }

  // 파티클 (셀 위에 그림)
  if (game.particles.length > 0) {
    drawParticles(ctx, game);
  }

  // game over overlay
  if (game.state.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 10);
    ctx.font = '14px sans-serif';
    ctx.fillText('Enter / R 키로 재시작', W / 2, H / 2 + 22);
  } else if (game.state.paused) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('일시정지', W / 2, H / 2);
  }
}

/** 둥근 사각형 path */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 색상 helper — RGB 추출 (#aabbcc) */
function rgbOf(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
function darken(hex: string, amt: number): string {
  const [r, g, b] = rgbOf(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.floor(c * (1 - amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** 돌 모양 셀 */
function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, ghost = false) {
  const px = BOARD_PAD + x * CELL;
  const py = BOARD_PAD + y * CELL;
  const r = 5;

  if (ghost) {
    roundRectPath(ctx, px + 3, py + 3, CELL - 6, CELL - 6, r - 1);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }

  // 본체 (둥근 사각형)
  roundRectPath(ctx, px + 1, py + 1, CELL - 2, CELL - 2, r);

  // 베이스 색
  ctx.fillStyle = color;
  ctx.fill();

  // 라이팅 — 좌상단 밝은 그라디언트
  const grad = ctx.createRadialGradient(
    px + CELL * 0.3, py + CELL * 0.25, 1,
    px + CELL * 0.5, py + CELL * 0.55, CELL * 0.9
  );
  grad.addColorStop(0, 'rgba(255,255,255,0.30)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = grad;
  ctx.fill();

  // 외곽선 (어두운 톤)
  ctx.strokeStyle = darken(color, 0.55);
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 표면 디테일 (deterministic — x,y 기반)
  const seed = (x * 73 + y * 31) | 0;
  const r1 = ((seed * 13) % 5) - 2;
  const r2 = ((seed * 7) % 5) - 2;
  const r3 = ((seed * 17) % 4) - 2;
  // 어두운 작은 점 2개 (돌 표면 패임)
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.arc(px + 8 + r1, py + 10 + r2, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px + CELL - 11 + r3, py + CELL - 9 + r1, 1.2, 0, Math.PI * 2);
  ctx.fill();
  // 밝은 점 1개 (윤기)
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(px + 9 + r2, py + 8 + r3, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticles(ctx: CanvasRenderingContext2D, game: TetrisGame) {
  for (const pt of game.particles) {
    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(pt.rot);
    ctx.fillStyle = pt.color;
    ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
    // 어두운 외곽
    ctx.strokeStyle = darken(pt.color, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function drawPiecePreview(canvas: HTMLCanvasElement, type: PieceType | null, size = 24) {
  const W = 4 * size + 4;
  const H = 4 * size + 4;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a0d11';
  ctx.fillRect(0, 0, W, H);
  if (!type) return;
  const m = SHAPES[type][0];
  const w = m[0].length;
  const h = m.length;
  const offX = (4 - w) / 2;
  const offY = (4 - h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y][x]) continue;
      const px = 2 + (offX + x) * size;
      const py = 2 + (offY + y) * size;
      // 미니 돌
      const r = 3;
      roundRectPath(ctx, px + 1, py + 1, size - 2, size - 2, r);
      ctx.fillStyle = COLORS[type];
      ctx.fill();
      const grad = ctx.createRadialGradient(
        px + size * 0.3, py + size * 0.3, 1,
        px + size * 0.5, py + size * 0.5, size * 0.7
      );
      grad.addColorStop(0, 'rgba(255,255,255,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = darken(COLORS[type], 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
