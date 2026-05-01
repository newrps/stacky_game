export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const COLORS: Record<PieceType, string> = {
  I: '#00f0f0',
  O: '#f0f000',
  T: '#a000f0',
  S: '#00f000',
  Z: '#f00000',
  J: '#1976d2',
  L: '#f0a000'
};

// 4 회전 상태 — SRS 기준 (각 cell 1=차있음, 0=비어있음)
export const SHAPES: Record<PieceType, number[][][]> = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]]
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]]
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]]
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]]
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]]
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]]
  ]
};

export interface Piece {
  type: PieceType;
  rotation: number; // 0..3
  x: number;
  y: number;
}

export function getMatrix(p: Piece): number[][] {
  return SHAPES[p.type][p.rotation];
}

// SRS Wall Kicks — JLSTZ
const KICKS_JLSTZ: Record<string, [number, number][]> = {
  '0->1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '1->0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '1->2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '2->1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '2->3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '3->2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '3->0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '0->3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]]
};
const KICKS_I: Record<string, [number, number][]> = {
  '0->1': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '1->0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '1->2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
  '2->1': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '2->3': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  '3->2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  '3->0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  '0->3': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
};

export function kicks(type: PieceType, from: number, to: number): [number, number][] {
  if (type === 'O') return [[0, 0]];
  const key = `${from}->${to}`;
  return type === 'I' ? KICKS_I[key] ?? [[0, 0]] : KICKS_JLSTZ[key] ?? [[0, 0]];
}

/** 7-bag RNG — seed로 deterministic */
export class BagRng {
  private state: number; // 32-bit Mulberry32
  private bag: PieceType[] = [];
  constructor(seed: number) {
    this.state = (seed | 0) || 1;
  }
  private next32(): number {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }
  private fillBag() {
    const arr: PieceType[] = [...PIECES];
    // Fisher–Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.next32() % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.bag.push(...arr);
  }
  draw(): PieceType {
    if (this.bag.length === 0) this.fillBag();
    return this.bag.shift()!;
  }
  /** N개 미리보기 (앞에서 꺼내지 않음) */
  peek(n: number): PieceType[] {
    while (this.bag.length < n) this.fillBag();
    return this.bag.slice(0, n);
  }
}

export function spawnPosition(type: PieceType): { x: number; y: number } {
  if (type === 'I') return { x: 3, y: 0 };
  if (type === 'O') return { x: 4, y: 0 };
  return { x: 3, y: 0 };
}
