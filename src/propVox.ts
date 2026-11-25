// Предметы окружения из срезов (sprite stacking), как герой: маленькая воксельная модель,
// слои рисуются друг над другом со сдвигом вверх — псевдо-3D. Каждая модель рендерится при загрузке
// в 8 поворотов (кадры одной текстуры «sv_<имя>»), на карте ставится картинкой с поворотом по вкусу.
import Phaser from "phaser";

interface PV { nx: number; ny: number; nz: number; c: Int32Array }
type Col = number;

function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function shade(col: number, k: number) {
  const r = Math.min(255, Math.max(0, Math.round(((col >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((col >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((col & 255) * k)));
  return (r << 16) | (g << 8) | b;
}
/** немного шума цвета, чтобы поверхность не была плоской */
const jit = (col: number, x: number, y: number, z: number, a = 0.12) => shade(col, 1 - a / 2 + hash(x, y, z) * a);

class Model {
  m: PV;
  constructor(nx: number, ny: number, nz: number) { this.m = { nx, ny, nz, c: new Int32Array(nx * ny * nz).fill(-1) }; }
  set(x: number, y: number, z: number, col: Col) {
    const { nx, ny, nz } = this.m;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    this.m.c[(z * ny + y) * nx + x] = col;
  }
  get(x: number, y: number, z: number) { const { nx, ny } = this.m; return this.m.c[(z * ny + y) * nx + x]; }
  /** заполнить по функции от центра клетки (u, v от центра модели) */
  each(f: (u: number, v: number, z: number, x: number, y: number) => number | undefined) {
    const { nx, ny, nz } = this.m;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = f(x + 0.5 - nx / 2, y + 0.5 - ny / 2, z, x, y);
      if (c !== undefined && c >= 0) this.set(x, y, z, c);
    }
    return this;
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: Col, j = 0.1) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, jit(col, x, y, z, j));
    return this;
  }
  /** вертикальный цилиндр (cx, cy — в клетках модели) */
  cyl(cx: number, cy: number, r: number, z0: number, z1: number, col: Col | ((d: number, z: number, a: number) => number), j = 0.1) {
    for (let z = z0; z < z1; z++) for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      const c = typeof col === "function" ? col(d, z, Math.atan2(y + 0.5 - cy, x + 0.5 - cx)) : col;
      if (c >= 0) this.set(x, y, z, jit(c, x, y, z, j));
    }
    return this;
  }
  /** лежащий цилиндр вдоль x */
  hcyl(x0: number, x1: number, cy: number, cz: number, r: number, col: Col | ((d: number, x: number) => number), j = 0.1) {
    for (let x = x0; x < x1; x++) for (let z = Math.max(0, Math.floor(cz - r - 1)); z <= cz + r + 1; z++) for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      const d = Math.hypot(y + 0.5 - cy, z + 0.5 - cz);
      if (d > r) continue;
      const c = typeof col === "function" ? col(d, x) : col;
      if (c >= 0) this.set(x, y, z, jit(c, x, y, z, j));
    }
    return this;
  }
}

/** машина: нос в +x. Кузов, кабина со стёклами, колёса, фары; ржавчина пятнами; burnt — обгоревший остов без стёкол */
function car(nx: number, ny: number, paint: number, o: { burnt?: boolean; police?: boolean; van?: boolean; bus?: boolean } = {}) {
  const nz = o.bus ? 26 : o.van ? 24 : 18;
  const m = new Model(nx, ny, nz);
  const L = nx - 4, Wd = ny - 6, x0 = 2, y0 = 3;
  const body = o.burnt ? 0x3a302a : paint, glass = 0x2a3a48, glassL = 0x6a8aa0;
  const rust = (x: number, y: number, z: number, c: number) => (o.burnt ? (hash(x >> 2, y >> 2, z >> 2) < 0.35 ? (hash(x, y, z) < 0.5 ? 0x9a5426 : 0x7a3e1c) : hash(x, y, z) < 0.22 ? 0x1a1816 : hash(x >> 1, y >> 1, 3) < 0.15 ? 0x8a8680 : 0x55504c) : hash(x, y, z) < 0.05 ? 0x8a4a22 : hash(x >> 1, y >> 1, 0) < 0.04 ? 0x6a3a1e : c);
  const capZ0 = 9, capZ1 = o.bus || o.van ? nz - 2 : 16;
  const cab0 = o.bus || o.van ? x0 + 3 : x0 + Math.round(L * 0.3), cab1 = o.bus || o.van ? x0 + L - 6 : x0 + Math.round(L * 0.72);
  const tall = !!(o.bus || o.van);
  m.each((u, v, z, x, y) => {
    const lx = x - x0, ly = y - y0;
    if (lx < 0 || ly < 0 || lx >= L || ly >= Wd) return;
    // скруглённые углы кузова
    const cx = Math.min(lx, L - 1 - lx), cy = Math.min(ly, Wd - 1 - ly);
    if (cx + cy < 3) return;
    if (z >= 2 && z < capZ0) {
      // фары и фонари
      if (z >= 5 && z <= 6 && cy < 4 && lx >= L - 1) return o.burnt ? 0x2a2420 : 0xfff0b0;
      if (z >= 5 && z <= 6 && cy < 4 && lx === 0) return o.burnt ? 0x2a2420 : 0xd02020;
      if (z === 2) return 0x1e1c1a; // низ кузова, тёмный
      if (o.police) return z < 6 ? 0x1a1a1c : rust(x, y, z, WHITE);
      if (o.bus && z === 5) return 0x1a1a1c;
      // шов капота
      if (z === capZ0 - 1 && !tall && (lx === cab0 - x0 - 6 || lx === cab1 - x0 + 4)) return shade(body, 0.7);
      return rust(x, y, z, body);
    }
    // кабина: у легковой — уже кузова и со скошенными стёклами спереди и сзади
    const k = z - capZ0, slope = tall ? 0 : k * 1.2;
    const c0 = cab0 - x0 + slope, c1 = cab1 - x0 - slope * 0.7, inset = tall ? 1 : 3;
    if (z >= capZ0 && z < capZ1 && lx >= c0 && lx < c1 && cy >= inset) {
      const roof = z === capZ1 - 1;
      const edgeX = lx < c0 + (tall ? 1 : 1.3) || lx >= c1 - (tall ? 1 : 1.3), edgeY = cy === inset;
      if (roof) {
        if (o.police && Math.abs(lx - (c0 + c1) / 2) < 2 && cy > Wd / 2 - 6) return ly < Wd / 2 ? 0xe02020 : 0x2040e0;
        return rust(x, y, z, o.police ? 0x1a1a1c : shade(body, 1.04));
      }
      if (edgeX || edgeY) {
        const pillar = tall ? (edgeY && lx % 7 === 0) || (edgeX && cy < inset + 2) : edgeY && Math.abs(lx - (c0 + c1) / 2) < 1;
        if (pillar || z === capZ0) return rust(x, y, z, o.police ? 0x1a1a1c : body);
        if (o.burnt) return -1;
        return hash(x, y, z) < 0.15 ? glassL : glass;
      }
      return o.burnt ? -1 : 0x2a2420; // салон
    }
    return undefined;
  });
  // колёса: цилиндры поперёк (ось по y)
  const wr = o.bus ? 5 : 4, wx = [x0 + 9, x0 + L - 10];
  for (const cxw of wx) for (const yy of [y0 - 1, y0, y0 + Wd - 1, y0 + Wd]) for (let x = cxw - wr - 1; x <= cxw + wr + 1; x++) for (let z = 0; z <= wr * 2; z++) {
    const d = Math.hypot(x + 0.5 - cxw, z + 0.5 - wr);
    if (d < wr) m.set(x, yy, z, d < wr * 0.45 ? (o.burnt ? 0x3a3430 : IRON_L) : o.burnt ? 0x4a3a30 : BLACK);
  }
  return m;
}

// ───────── модели ─────────
const STRAW = 0xd8b050, STRAW_D = 0xa8822c, WOOD = 0x9a6a38, WOOD_D = 0x6a4420, STONE = 0x9a968c, STONE_D = 0x6e6a62, IRON = 0x5a5a58, IRON_L = 0x8a8a86;
const RED = 0xc83828, ORANGE = 0xf08a20, WHITE = 0xeeeae0, GREEN = 0x4a7a34, OLIVE = 0x5e6e2c, BLUE = 0x3a6ab8, YEL = 0xf0c030, BLACK = 0x2a2824;

const MODELS: Record<string, () => Model> = {
  // ── машины ──
  car_red: () => car(64, 30, 0xb83a2a),
  car_teal: () => car(58, 28, 0x3a8a8a),
  car_burnt: () => car(62, 30, 0x3a302a, { burnt: true }),
  car_police: () => car(64, 30, WHITE, { police: true }),
  van: () => car(70, 32, 0xd8d0b8, { van: true }),
  bus: () => car(120, 36, YEL, { bus: true }),
  // ── глава 1: лес и ферма ──
  hay_round: () => new Model(20, 20, 18).hcyl(2, 18, 10, 8.5, 8.5, (d, x) => (x === 6 || x === 13 ? 0x8a6a30 : d > 7.5 ? STRAW_D : STRAW), 0.22),
  hay_block: () => {
    const m = new Model(24, 14, 12).box(1, 23, 1, 13, 0, 10, STRAW, 0.25);
    for (const x of [7, 16]) for (let z = 0; z < 10; z++) { m.set(x, 0.6, z, 0x7a5a28); m.set(x, 13, z, 0x7a5a28); }
    for (const x of [7, 16]) for (let y = 1; y < 13; y++) m.set(x, y, 9, 0x7a5a28);
    return m;
  },
  well: () => {
    const m = new Model(24, 24, 30);
    m.cyl(12, 12, 9.5, 0, 9, (d) => (d > 7 ? STONE : -1), 0.3).cyl(12, 12, 7, 0, 2, 0x203040);
    for (const y of [3, 20]) m.box(11, 13, y, y + 2, 9, 24, WOOD_D);
    m.box(11, 13, 4, 20, 19, 21, WOOD); // ворот
    for (let z = 23; z < 29; z++) { const w = (29 - z) * 2; m.box(4, 20, 12 - w / 2, 12 + w / 2, z, z + 1, z % 2 ? 0x8a3a24 : 0x9a4a2a); }
    m.cyl(12, 12, 2, 13, 18, 0x7a5a30); // ведро
    return m;
  },
  cart: () => {
    const m = new Model(30, 20, 18);
    m.box(3, 25, 4, 16, 6, 7, WOOD).box(3, 25, 4, 5, 7, 12, WOOD_D).box(3, 25, 15, 16, 7, 12, WOOD_D).box(3, 4, 4, 16, 7, 12, WOOD_D).box(24, 25, 4, 16, 7, 12, WOOD_D);
    for (const y of [2, 17]) for (let x = 0; x < 30; x++) for (let z = 0; z < 18; z++) { const d = Math.hypot(x + 0.5 - 14, z + 0.5 - 6); if (d < 6 && d > 4.6) m.set(x, y, z, WOOD_D); if (d < 1.2) m.set(x, y, z, IRON); }
    m.box(25, 30, 9, 11, 6, 7, WOOD_D); // дышло
    m.box(5, 22, 5, 15, 7, 10, STRAW, 0.3); // сено в телеге
    return m;
  },
  stump: () => {
    const m = new Model(16, 16, 14).cyl(8, 8, 6, 0, 6, (d, z) => (z === 5 ? (Math.round(d) % 2 ? 0xd8b080 : 0xb88a58) : d > 5 ? 0x5a3a1e : 0x7a5228), 0.15);
    m.box(7, 9, 7, 8, 5, 13, 0x8a6030).box(5, 11, 7, 8, 11, 13, IRON_L); // топор
    return m;
  },
  pumpkins: () => {
    const m = new Model(24, 20, 10);
    for (const [cx, cy, r] of [[7, 8, 5], [16, 12, 4.5], [10, 15, 3.5]]) {
      m.each((u, v, z, x, y) => { const d = Math.hypot((x + 0.5 - cx) / r, (y + 0.5 - cy) / r, (z + 0.5 - r * 0.8) / (r * 0.8)); if (d < 1) return Math.abs(Math.sin(Math.atan2(y - cy, x - cx) * 4)) < 0.25 ? 0xc85a10 : jit(ORANGE, x, y, z); });
      m.box(cx, cx + 1, cy, cy + 1, Math.round(r * 1.6), Math.round(r * 1.6) + 2, GREEN);
    }
    return m;
  },
  scarecrow: () => {
    const m = new Model(22, 10, 40);
    m.box(10, 12, 4, 6, 0, 34, WOOD_D).box(2, 20, 4, 6, 24, 26, WOOD_D);
    m.box(7, 15, 3, 7, 16, 28, 0x6a5a8a, 0.25).box(3, 19, 3, 7, 24, 27, 0x6a5a8a, 0.25); // рубаха
    m.cyl(11, 5, 3.5, 28, 34, 0xe0c88a).box(5, 17, 1, 9, 34, 35, STRAW_D).cyl(11, 5, 3, 35, 39, STRAW_D); // голова и шляпа
    return m;
  },
  logs: () => {
    const m = new Model(30, 18, 14);
    for (const [y, z] of [[4, 3], [9, 3], [14, 3], [6.5, 7.5], [11.5, 7.5], [9, 11.5]]) m.hcyl(1, 29, y, z, 2.6, (d, x) => (x < 2 || x > 26 ? (d < 1.5 ? 0xd8b080 : 0xb88a58) : d > 2 ? 0x5a3a1e : 0x6a4424), 0.18);
    return m;
  },
  gravestone: () => new Model(14, 8, 18).box(2, 12, 2, 6, 0, 13, STONE, 0.2).each((u, v, z, x, y) => (z >= 13 && z < 16 && Math.hypot(x + 0.5 - 7, z - 13) < 5 && y >= 2 && y < 6 ? jit(STONE, x, y, z, 0.2) : undefined)).box(6, 8, 1.5, 2, 6, 12, STONE_D).box(4, 10, 1.5, 2, 9, 10, STONE_D),
  // ── глава 2: шоссе ──
  cone: () => new Model(12, 12, 16).box(1, 11, 1, 11, 0, 1, BLACK).cyl(6, 6, 5, 1, 15, (d, z) => (d < 4.6 - z * 0.28 ? (z >= 6 && z < 9 ? WHITE : ORANGE) : -1), 0.08),
  barrier: () => {
    const m = new Model(32, 10, 14);
    m.each((u, v, z, x) => { const w = z < 4 ? 4.5 : z < 7 ? 3.5 - (z - 4) * 0.5 : 2; if (Math.abs(v) < w && z < 12) return (Math.floor((x + z) / 4) % 2 ? RED : WHITE); });
    return m;
  },
  fuel_pump: () => {
    const m = new Model(16, 14, 30).box(2, 14, 2, 12, 0, 2, STONE_D).box(3, 13, 3, 11, 2, 26, RED, 0.06).box(4, 12, 2.6, 3, 16, 22, 0x203040).box(3, 13, 3, 11, 26, 28, WHITE);
    m.box(13, 14, 6, 8, 6, 20, BLACK).box(14, 15, 6, 8, 4, 7, IRON); // шланг
    return m;
  },
  sign_post: () => new Model(20, 8, 40).box(9, 11, 3, 5, 0, 30, IRON_L).box(1, 19, 2, 4, 28, 38, 0x2a8a4a, 0.05).box(1, 19, 2, 3, 28, 29, WHITE).box(1, 19, 2, 3, 37, 38, WHITE),
  // ── глава 3: городок ──
  hydrant: () => new Model(12, 12, 16).cyl(6, 6, 3.4, 0, 12, RED, 0.08).cyl(6, 6, 4.2, 0, 2, RED).cyl(6, 6, 2.6, 12, 15, 0xd84a38).box(1, 11, 5, 7, 7, 9, 0xb02a1e),
  bench: () => {
    const m = new Model(30, 12, 16);
    for (const x of [4, 25]) m.box(x, x + 2, 2, 10, 0, 6, IRON).box(x, x + 2, 8, 10, 6, 14, IRON);
    for (const y of [2, 4.5, 7]) m.box(2, 28, y, y + 2, 6, 7, WOOD);
    for (const z of [9, 12]) m.box(2, 28, 9, 10, z, z + 2, WOOD);
    return m;
  },
  trash_bin: () => new Model(14, 14, 18).cyl(7, 7, 5.5, 0, 14, (d, z) => (z % 4 === 0 ? 0x2a5a2a : GREEN), 0.1).cyl(7, 7, 6, 14, 16, 0x3a6a3a).box(5, 9, 6, 8, 16, 17, IRON),
  traffic_light: () => {
    const m = new Model(14, 10, 50).box(6, 8, 4, 6, 0, 38, IRON).box(3, 11, 3, 7, 34, 48, BLACK);
    [[RED, 44], [YEL, 40], [0x30c050, 36]].forEach(([c, z]) => m.box(5, 9, 2, 3, z, z + 3, c));
    return m;
  },
  mailbox: () => new Model(10, 14, 22).box(4, 6, 6, 8, 0, 12, WOOD_D).box(2, 8, 2, 12, 12, 17, BLUE).cyl(5, 7, 3, 17, 19, BLUE).box(8, 9, 9, 10, 14, 20, RED),
  // ── глава 4: завод ──
  pallet: () => {
    const m = new Model(24, 24, 18);
    for (const y of [2, 11, 20]) m.box(2, 22, y, y + 2, 0, 2, WOOD_D);
    for (let x = 2; x < 22; x += 4) m.box(x, x + 3, 2, 22, 2, 3, WOOD);
    m.box(3, 12, 3, 12, 3, 11, 0xb08a58, 0.15).box(12, 21, 4, 12, 3, 9, 0xa07a48, 0.15).box(4, 20, 12, 21, 3, 10, 0xb89060, 0.15).box(5, 14, 5, 12, 11, 16, 0xa88250, 0.15);
    return m;
  },
  gas_cyl: () => { const m = new Model(20, 20, 26); for (const [x, y, c] of [[6, 7, BLUE], [13, 7, 0x3a8a4a], [9.5, 13, BLUE]] as const) m.cyl(x, y, 3.2, 0, 20, c, 0.06).cyl(x, y, 2.2, 20, 22, c).cyl(x, y, 1, 22, 24, IRON_L); return m; },
  toolbox: () => new Model(16, 10, 10).box(1, 15, 1, 9, 0, 6, RED, 0.06).box(1, 15, 1, 9, 5, 6, 0xa02a1e).box(6, 10, 4, 6, 6, 9, BLACK),
  valve: () => { const m = new Model(28, 12, 18).hcyl(0, 28, 6, 6, 4, IRON_L, 0.15); m.cyl(14, 6, 2, 9, 14, IRON).each((u, v, z, x, y) => (z === 14 && Math.abs(Math.hypot(x + 0.5 - 14, y + 0.5 - 6) - 4.5) < 0.9 ? YEL : undefined)); return m; },
  // ── глава 5: плотина ──
  sandbags: () => {
    const m = new Model(30, 12, 12);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
      const cx = 4 + i * 7.5 + (row % 2) * 3.7, cz = 1.8 + row * 3.4;
      m.each((u, v, z, x, y) => { const d = Math.hypot((x + 0.5 - cx) / 3.9, (y + 0.5 - 6) / 4.6, (z + 0.5 - cz) / 1.9); if (d < 1) return jit(0xb8a070, x, y, z, 0.2); });
    }
    return m;
  },
  ammo_crate: () => new Model(22, 14, 12).box(1, 21, 1, 13, 0, 9, OLIVE, 0.12).box(1, 21, 1, 13, 9, 10, 0x4a5822).box(6, 16, 0.6, 1, 3, 6, YEL).box(1, 2, 1, 13, 0, 10, 0x3e4a1c).box(20, 21, 1, 13, 0, 10, 0x3e4a1c),
  searchlight: () => {
    const m = new Model(18, 18, 28);
    for (const a of [0, 2.1, 4.2]) for (let z = 0; z < 14; z++) m.set(9 + Math.cos(a) * (7 - z * 0.45), 9 + Math.sin(a) * (7 - z * 0.45), z, IRON);
    m.hcyl(4, 14, 9, 18, 5, (d, x) => (x === 13 && d < 4 ? 0xfff0b0 : BLACK), 0.08);
    return m;
  },
  car_rust: () => car(62, 30, 0x8a5430, { burnt: true }),
  /** куча металлолома: ржавые листы, трубы, колесо */
  scrap_pile: () => new Model(30, 26, 16).each((u, v, z, x, y) => {
    const d = Math.hypot(u / 14, v / 12) + z / 15 + (hash(x >> 1, y >> 1, z >> 1) - 0.5) * 0.35;
    if (d >= 1) return;
    const h = hash(x >> 2, y >> 2, z >> 1);
    return jit(h < 0.3 ? 0x8a4a22 : h < 0.55 ? 0x6a6a66 : h < 0.7 ? 0x3a5a7a : h < 0.85 ? 0xa86a30 : 0x2a2824, x, y, z, 0.3);
  }),
  /** старый холодильник: лежит на боку или стоит */
  fridge: () => new Model(14, 12, 24).box(1, 13, 1, 11, 0, 23, 0xe8e4d8, 0.06).box(1, 13, 0, 1, 0, 23, 0xd0ccc0, 0.04).box(2, 3, 0, 1, 8, 16, 0x8a8a86).box(1, 13, 0, 1, 15, 16, 0x9a968c).box(1, 13, 1, 11, 0, 2, 0x8a5a30, 0.3),
  /** стиральная машина с круглым люком */
  washer: () => new Model(14, 14, 16).box(1, 13, 1, 13, 0, 15, 0xe0dcd0, 0.06).each((u, v, z, x, y) => (y === 0 && Math.hypot(u, z - 7) < 4 ? (Math.hypot(u, z - 7) < 3 ? 0x5a7a8a : 0x8a8a86) : z === 14 && v < -3 && Math.abs(u) < 4 ? 0x4a4a48 : undefined)),
  /** стопка покрышек */
  tire_stack: () => { const m = new Model(18, 18, 18); for (let k = 0; k < 3; k++) m.cyl(9, 9, 8, k * 6, k * 6 + 5, (d) => (d < 3.5 ? -1 : d > 7.2 ? 0x1a1a18 : 0x2e2c2a), 0.12); return m; },
  /** груда кирпичей и бетона */
  rubble: () => new Model(28, 22, 10).each((u, v, z, x, y) => {
    const d = Math.hypot(u / 13, v / 10) + z / 9 + (hash(x >> 1, y >> 1, z) - 0.5) * 0.4;
    if (d >= 1) return;
    const h = hash(x >> 1, y >> 2, z);
    return jit(h < 0.45 ? 0xa04a30 : h < 0.75 ? 0x9a968c : 0x6e6a62, x, y, z, 0.25);
  }),
  /** бетонный отбойник (туннель, шоссе) */
  jersey: () => new Model(34, 10, 10).each((u, v, z) => (Math.abs(v) < 4.6 - z * 0.25 && Math.abs(u) < 16.5 ? (z % 9 === 4 ? 0xd8c040 : 0xb8b4aa) : undefined)),
  rock_moss: () => new Model(24, 20, 14).each((u, v, z, x, y) => { const d = Math.hypot(u / 11, v / 9, z / 12) + (hash(x >> 2, y >> 2, z >> 2) - 0.5) * 0.25; if (d < 1) return z > 9 && hash(x, y, 7) > 0.4 ? jit(0x6a8a3a, x, y, z, 0.3) : jit(STONE, x, y, z, 0.25); }),
};
export const SLICE_PROPS = Object.keys(MODELS);
/** размер в мире (шаг вокселя 1 px): радиус для столкновений и «низкий» ли предмет (через него летят пули) */
export const SLICE_INFO: Record<string, { r: number; low?: boolean }> = {
  car_red: { r: 14 }, car_teal: { r: 13 }, car_burnt: { r: 14 }, car_police: { r: 14 }, van: { r: 15 }, bus: { r: 17 },
  hay_round: { r: 10 }, hay_block: { r: 11 }, well: { r: 12 }, cart: { r: 13 }, stump: { r: 7, low: true }, pumpkins: { r: 9, low: true }, scarecrow: { r: 5 }, logs: { r: 12 }, gravestone: { r: 6 },
  cone: { r: 5, low: true }, barrier: { r: 12 }, fuel_pump: { r: 8 }, sign_post: { r: 4 },
  hydrant: { r: 5, low: true }, bench: { r: 11, low: true }, trash_bin: { r: 6 }, traffic_light: { r: 5 }, mailbox: { r: 5 },
  pallet: { r: 12 }, gas_cyl: { r: 9 }, toolbox: { r: 7, low: true }, valve: { r: 10, low: true },
  sandbags: { r: 13 }, ammo_crate: { r: 10, low: true }, searchlight: { r: 8 }, rock_moss: { r: 11 },
  car_rust: { r: 14 }, scrap_pile: { r: 13 }, fridge: { r: 7 }, washer: { r: 7 }, tire_stack: { r: 8 }, rubble: { r: 12, low: true }, jersey: { r: 9 },
};

const ROT = 8, PXV = 3, DZV = 0.8;
/** текстуры «sv_<имя>»: кадр i — поворот на i/8 круга. Вызывать в create (один раз на игру). Возвращает точку опоры (доли кадра). */
export function makeSliceProps(scene: Phaser.Scene) {
  const origin: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const name of SLICE_PROPS) {
    const key = "sv_" + name;
    const m = MODELS[name]().m;
    const span = Math.ceil(Math.hypot(m.nx, m.ny)) + 2;
    const fw = span * PXV, zH = m.nz * DZV * PXV, fh = Math.ceil(fw + zH) + 4;
    if (!scene.textures.exists(key)) {
      // срезы
      const slices: HTMLCanvasElement[] = [];
      for (let z = 0; z < m.nz; z++) {
        const cv = document.createElement("canvas"); cv.width = m.nx; cv.height = m.ny;
        const ctx = cv.getContext("2d")!, img = ctx.createImageData(m.nx, m.ny);
        const ao = 0.66 + 0.34 * (z / Math.max(1, m.nz - 1));
        for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
          const col = m.c[(z * m.ny + y) * m.nx + x];
          if (col < 0) continue;
          const top = z + 1 >= m.nz || m.c[((z + 1) * m.ny + y) * m.nx + x] < 0;
          const s = shade(col, ao * (top ? 1.08 : 0.82)), i = (y * m.nx + x) * 4;
          img.data[i] = (s >> 16) & 255; img.data[i + 1] = (s >> 8) & 255; img.data[i + 2] = s & 255; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        slices.push(cv);
      }
      const cv = document.createElement("canvas"); cv.width = fw * ROT; cv.height = fh;
      const ctx = cv.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      const sub = Math.max(1, Math.ceil(DZV * PXV));
      for (let f = 0; f < ROT; f++) {
        const a = (f / ROT) * Math.PI * 2;
        for (let z = 0; z < m.nz; z++) for (let s = 0; s < sub; s++) {
          ctx.setTransform(1, 0, 0, 1, f * fw + fw / 2, fh - fw / 2 - 2 - (z + s / sub) * DZV * PXV);
          ctx.rotate(a);
          ctx.drawImage(slices[z], (-m.nx / 2) * PXV, (-m.ny / 2) * PXV, m.nx * PXV, m.ny * PXV);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // тёмный контур, как у героя и нарисованных предметов
      const out = document.createElement("canvas"); out.width = cv.width; out.height = cv.height;
      const o = out.getContext("2d")!;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]]) o.drawImage(cv, dx, dy);
      o.globalCompositeOperation = "source-in"; o.fillStyle = "#1a140e"; o.fillRect(0, 0, out.width, out.height);
      o.globalCompositeOperation = "source-over"; o.drawImage(cv, 0, 0);
      const t = scene.textures.addCanvas(key, out)!;
      for (let f = 0; f < ROT; f++) t.add(f, 0, f * fw, 0, fw, fh);
    }
    origin[name] = { x: 0.5, y: (fh - fw / 2 - 2) / fh, w: fw / PXV, h: fh / PXV };
  }
  return origin;
}
