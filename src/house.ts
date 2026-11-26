// Полуразрушенный дом из срезов (как герой): воксели 2×2 px, слой высотой 2 px сдвигается вверх на 1.6 px.
// Стены режутся на полосы по Y — каждая полоса со своей глубиной, поэтому внутри дома герой оказывается
// перед дальней стеной и за ближней. Крыша — отдельная картинка поверх всего, прозрачнеет, когда ты внутри.
import Phaser from "phaser";

/** стена в координатах дома: прямоугольник (px от левого верхнего угла) и высота, px */
interface LocalBox { x0: number; y0: number; x1: number; y1: number; h: number }
/** стена в мире: повёрнутый прямоугольник — центр, полуразмеры вдоль своих осей, поворот (cos, sin), высота, углы */
export interface WallBox { cx: number; cy: number; ex: number; ey: number; c: number; s: number; h: number; pts: { x: number; y: number }[]; /** нарисованная картинка: тень — её силуэт, а не коробка */ art?: boolean;
  /** высота настоящего объёма для тени от солнца (у нарисованных построек и машин): тень = проекция коробки */ shH?: number;
  /** след по форме картинки (вместо коробки pts) — для тени */ foot?: { x: number; y: number }[] }
export interface House {
  /** центр и поворот дома */
  cx: number; cy: number; c: number; s: number; w: number; h: number;
  /** рамка дома в мире (для расстановки деревьев и появления монстров) */
  bx0: number; by0: number; bx1: number; by1: number;
  walls: WallBox[];
  roof: Phaser.GameObjects.Image;
  parts: Phaser.GameObjects.Image[];
}
/** точка мира → координаты стены (от её центра, вдоль её осей) */
export function wLocal(w: WallBox, x: number, y: number) { const dx = x - w.cx, dy = y - w.cy; return { x: dx * w.c + dy * w.s, y: -dx * w.s + dy * w.c }; }
export function wWorld(w: WallBox, lx: number, ly: number) { return { x: w.cx + lx * w.c - ly * w.s, y: w.cy + lx * w.s + ly * w.c }; }
/** расстояние от точки до стены (0 — внутри) */
export function wDist(w: WallBox, x: number, y: number) { const l = wLocal(w, x, y); return Math.hypot(Math.max(0, Math.abs(l.x) - w.ex), Math.max(0, Math.abs(l.y) - w.ey)); }
/** точка внутри дома (в его координатах, с запасом m) */
export function inHouse(hs: House, x: number, y: number, m = 0) {
  const dx = x - hs.cx, dy = y - hs.cy, lx = dx * hs.c + dy * hs.s, ly = -dx * hs.s + dy * hs.c;
  return Math.abs(lx) < hs.w / 2 + m && Math.abs(ly) < hs.h / 2 + m;
}
/** поворот дома, рад (по часовой: видна ещё и восточная стена) */
const ROT = (25 * Math.PI) / 180;

const V = 2; // px на воксель
const LZ = 2; // высота слоя, px
const DZ = 0.8; // сдвиг вверх на 1 px высоты (как у героя)
const K = 2; // разрешение картинки (пикселей на px мира)
const HW = 150, HH = 110; // размер дома
const NX = HW / V, NY = HH / V;
const WALL_H = 34;

function hash(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function shade(c: number, k: number) {
  const f = (v: number) => Math.min(255, Math.max(0, Math.round(v * k)));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** стены дома (относительно его угла): целые, разрушенные, с дверным проёмом */
const WALLS: LocalBox[] = [
  { x0: 0, y0: 0, x1: HW, y1: 6, h: WALL_H }, // север
  { x0: 0, y0: 0, x1: 6, y1: 66, h: WALL_H }, // запад (нижняя часть обвалилась)
  { x0: HW - 6, y0: 0, x1: HW, y1: HH, h: WALL_H }, // восток
  { x0: 0, y0: HH - 6, x1: 58, y1: HH, h: WALL_H * 0.55 }, // юг слева (осыпался)
  { x0: 86, y0: HH - 6, x1: 122, y1: HH, h: WALL_H }, // юг справа от двери
  { x0: 122, y0: HH - 6, x1: HW, y1: HH, h: WALL_H * 0.6 },
  { x0: 92, y0: 6, x1: 98, y1: 54, h: WALL_H * 0.9 }, // перегородка
];
const SOUTH_LEFT_X0 = 14; // южная стена слева начинается не от угла — угол обвалился

type Cell = { h: number; col: (z: number) => number };

/** что в клетке (i, j): стена (высота в слоях и цвет по слою), обломки или пол */
function cellAt(i: number, j: number): Cell | null {
  const x = i * V + 1, y = j * V + 1;
  for (const w of WALLS) {
    if (x < w.x0 || x > w.x1 || y < w.y0 || y > w.y1) continue;
    if (w.y0 === HH - 6 && w.x0 === 0 && x < SOUTH_LEFT_X0) continue;
    const ruined = w.h < WALL_H;
    // верх: целая стена — ровный, обвалившаяся — рваный
    let top = Math.round(w.h / LZ);
    if (ruined) top = Math.max(2, top - Math.floor(hash(i, j, 7) * 4) - Math.floor(Math.abs(Math.sin(i * 0.7)) * 2));
    else if (hash(i, j, 3) < 0.1) top -= 1;
    // окна: север и восток
    const win = (w.y0 === 0 && w.y1 === 6 && ((x > 20 && x < 40) || (x > 110 && x < 130))) || (w.x0 === HW - 6 && y > 30 && y < 50);
    const post = (w.y1 - w.y0 <= 6 && (x < 7 || x > HW - 7 || Math.abs(x - 58) < 2 || Math.abs(x - 86) < 2)) || (w.x1 - w.x0 <= 6 && (y < 7 || y > HH - 7));
    return {
      h: top,
      col: (z) => {
        if (win && z >= 7 && z <= 11) return -1;
        if (win && z === 6) return 0x8a6a40; // подоконник
        const r = hash(i, j, z);
        if (z < 4) { // каменный цоколь
          const s = [0x77736a, 0x6a665e, 0x837f75, 0x5e5a52][Math.floor(r * 4)];
          return (z === 3 || (i + (z & 1) * 2) % 5 === 0) ? shade(s, 0.82) : s;
        }
        if (post) return shade(0x4a3018, 0.9 + r * 0.15); // столбы
        const plank = [0x6e4a2c, 0x7a5432, 0x664428, 0x5e3e24][Math.floor(hash(Math.floor(i / 9), z, 1) * 4)];
        if (z % 3 === 0) return shade(plank, 0.6); // щели между досками
        return shade(plank, 0.9 + r * 0.2) ;
      },
    };
  }
  return null;
}

/** обломки у обвалившегося угла и пол */
function rubbleAt(i: number, j: number): Cell | null {
  const x = i * V + 1, y = j * V + 1;
  const near = (x < 22 && y > 60) || (x < 30 && y > HH - 16);
  if (!near) return null;
  const r = hash(i, j, 11);
  if (r < 0.5) return null;
  const h = 1 + Math.floor((r - 0.5) * 7);
  return { h, col: (z) => (hash(i, j, z + 20) < 0.5 ? [0x77736a, 0x6a665e, 0x5e5a52][z % 3] : [0x6e4a2c, 0x5e3e24][z % 2]) };
}
function floorAt(i: number, j: number): number {
  const x = i * V + 1, y = j * V + 1;
  if (x < 4 || x > HW - 4 || y < 4 || y > HH - 4) return -1;
  // доски вдоль X, кое-где выломаны (видна трава)
  const row = Math.floor(j / 4), seg = Math.floor((i + row * 7) / 14);
  if (hash(seg, row, 5) < 0.13) return -1;
  if (x < 26 && y > 70 && hash(i, j, 9) < 0.6) return -1; // у обвала пола почти нет
  const base = [0x8a6a44, 0x7e603c, 0x94724a, 0x735634][Math.floor(hash(seg, row, 6) * 4)];
  if (j % 4 === 0) return shade(base, 0.62);
  return shade(base, 0.92 + hash(i, j, 8) * 0.14);
}
/** крыша: двускатная, конёк вдоль X; дыра над обвалом и выпавшая черепица */
function roofAt(i: number, j: number): { z: number; col: number } | null {
  const x = i * V + 1, y = j * V + 1;
  if (x < -4 || x > HW + 4 || y < -4 || y > HH + 4) return null;
  const mid = HH / 2, t = 1 - Math.abs(y - mid) / (mid + 4);
  const z = Math.round(WALL_H / LZ + t * 9);
  // дыры
  const hole = (x < 50 && y > 58 && hash(Math.floor(i / 3), Math.floor(j / 3), 31) < 0.75) || (x < 34 && y > 40) || hash(Math.floor(i / 2), Math.floor(j / 2), 32) < 0.05;
  if (hole) {
    // в дыре видны стропила
    if (i % 6 === 0 && x > 4) return { z, col: shade(0x3e2814, 0.9 + hash(i, j, 33) * 0.2) };
    return null;
  }
  const rowY = Math.floor(Math.abs(y - mid) / 4);
  const tile = [0x6a3a2a, 0x7a4430, 0x5e3424, 0x704030][Math.floor(hash(Math.floor((i + rowY * 2) / 3), rowY, 34) * 4)];
  let c = Math.abs(y - mid) % 4 < 1.2 ? shade(tile, 0.7) : shade(tile, 0.95 + hash(i, j, 35) * 0.12);
  if (Math.abs(y - mid) < 2.5) c = shade(0x4a2a1e, 1); // конёк
  // мох
  if (hash(i, j, 36) < 0.08) c = shade(0x4e5a2a, 0.9 + hash(i, j, 37) * 0.2);
  // южный скат светлее (солнце сверху), северный темнее
  return { z, col: shade(c, y > mid ? 1.05 : 0.85) };
}

/**
 * Нарисовать клетки стопкой срезов в повёрнутом виде: каждый слой — повёрнутые квадраты, сдвинутые вверх по экрану.
 * pick(i, j) — брать ли клетку в эту картинку (полосы по глубине). ox, oy — где в мире левый верх картинки.
 */
function draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, hx: number, hy: number, f: (i: number, j: number) => Cell | null, zMax: number, pick: (i: number, j: number) => boolean) {
  const c = Math.cos(ROT), s = Math.sin(ROT), cx = hx + HW / 2, cy = hy + HH / 2;
  const cells: { i: number; j: number; c: Cell }[] = [];
  for (let j = -3; j < NY + 3; j++) for (let i = -3; i < NX + 3; i++) {
    const cl = f(i, j);
    if (cl && pick(i, j)) cells.push({ i, j, c: cl });
  }
  for (let z = 0; z < zMax; z++) {
    // локальные px дома → px картинки: поворот вокруг центра дома, сдвиг слоя вверх по экрану
    const tx = (cx - ox) * K, ty = (cy - oy - z * LZ * DZ) * K;
    ctx.setTransform(c * K, s * K, -s * K, c * K, tx - (c * HW / 2 - s * HH / 2) * K, ty - (s * HW / 2 + c * HH / 2) * K);
    for (const { i, j, c: cl } of cells) {
      if (z >= cl.h) continue;
      const col = cl.col(z);
      if (col < 0) continue;
      // нижние слои темнее (бок стены), верхний срез светлее — видно, где верх
      const k = (0.72 + 0.28 * (z / zMax)) * (z === cl.h - 1 ? 1.22 : 1);
      ctx.fillStyle = hex(shade(col, k));
      ctx.fillRect(i * V - 0.15, j * V - 0.15, V + 0.3, V + 0.3);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function buildHouse(scene: Phaser.Scene, hx: number, hy: number): House {
  const tex = scene.textures, parts: Phaser.GameObjects.Image[] = [];
  const c = Math.cos(ROT), s = Math.sin(ROT), cx = hx + HW / 2, cy = hy + HH / 2;
  const toW = (lx: number, ly: number) => ({ x: cx + (lx - HW / 2) * c - (ly - HH / 2) * s, y: cy + (lx - HW / 2) * s + (ly - HH / 2) * c });
  // рамка дома в мире (с крышей)
  const corners = [toW(-6, -6), toW(HW + 6, -6), toW(HW + 6, HH + 6), toW(-6, HH + 6)];
  const bx0 = Math.min(...corners.map((q) => q.x)), bx1 = Math.max(...corners.map((q) => q.x));
  const by0 = Math.min(...corners.map((q) => q.y)), by1 = Math.max(...corners.map((q) => q.y));
  const bw = Math.ceil(bx1 - bx0), bh = Math.ceil(by1 - by0);
  const margin = (WALL_H + 2) * DZ; // насколько стены поднимаются над основанием, px
  // мировой Y центра клетки — по нему клетка попадает в полосу глубины
  const wy = (i: number, j: number) => toW(i * V + 1, j * V + 1).y;
  // пол
  if (!tex.exists("house_floor")) {
    const cv = document.createElement("canvas");
    cv.width = bw * K; cv.height = bh * K;
    draw(cv.getContext("2d")!, bx0, by0, hx, hy, (i, j) => { const col = floorAt(i, j); return col < 0 ? null : { h: 1, col: () => col }; }, 1, () => true);
    tex.addCanvas("house_floor", cv);
  }
  parts.push(scene.add.image(bx0, by0, "house_floor").setOrigin(0).setScale(1 / K).setDepth(-4.6));
  // стены полосами по 6 px мира по глубине; обломки — вместе со стенами
  const STRIP = 6;
  const wallCell = (i: number, j: number) => cellAt(i, j) ?? rubbleAt(i, j);
  for (let s0 = Math.floor(by0 / STRIP) * STRIP, n = 0; s0 < by1; s0 += STRIP, n++) {
    const key = `house_wall_${n}`, s1 = s0 + STRIP;
    if (!tex.exists(key)) {
      const cv = document.createElement("canvas");
      cv.width = bw * K; cv.height = Math.ceil((STRIP + margin + 3) * K);
      draw(cv.getContext("2d")!, bx0, s0 - margin, hx, hy, wallCell, Math.ceil(WALL_H / LZ), (i, j) => { const y = wy(i, j); return y >= s0 && y < s1; });
      tex.addCanvas(key, cv);
    }
    parts.push(scene.add.image(bx0, s0 - margin, key).setOrigin(0).setScale(1 / K).setDepth(s1));
  }
  // крыша
  const rz = Math.ceil(WALL_H / LZ) + 10, rMargin = rz * LZ * DZ + 4;
  if (!tex.exists("house_roof")) {
    const cv = document.createElement("canvas");
    cv.width = bw * K; cv.height = Math.ceil((bh + rMargin) * K);
    // только верхняя поверхность ската: каждая клетка на своей высоте
    const cells: { i: number; j: number; z: number; col: number }[] = [];
    for (let j = -3; j < NY + 3; j++) for (let i = -3; i < NX + 3; i++) { const r = roofAt(i, j); if (r) cells.push({ i, j, ...r }); }
    cells.sort((a, b) => a.z - b.z);
    const x = cv.getContext("2d")!;
    for (const q of cells) for (const [dz, k] of [[-1, 0.6], [0, 1]] as const) {
      const tx = (cx - bx0) * K, ty = (cy - by0 + rMargin - (q.z + dz) * LZ * DZ) * K;
      x.setTransform(c * K, s * K, -s * K, c * K, tx - (c * HW / 2 - s * HH / 2) * K, ty - (s * HW / 2 + c * HH / 2) * K);
      x.fillStyle = hex(shade(q.col, k));
      x.fillRect(q.i * V - 0.15, q.j * V - 0.15, V + 0.3, V + 0.3);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    tex.addCanvas("house_roof", cv);
  }
  const roof = scene.add.image(bx0, by0 - rMargin, "house_roof").setOrigin(0).setScale(1 / K).setDepth(1e6 - 3);
  const walls: WallBox[] = WALLS.map((w) => {
    const x0 = w.y0 === HH - 6 && w.x0 === 0 ? SOUTH_LEFT_X0 : w.x0;
    const m = toW((x0 + w.x1) / 2, (w.y0 + w.y1) / 2), ex = (w.x1 - x0) / 2, ey = (w.y1 - w.y0) / 2;
    const pts = [toW(x0, w.y0), toW(w.x1, w.y0), toW(w.x1, w.y1), toW(x0, w.y1)];
    return { cx: m.x, cy: m.y, ex, ey, c, s, h: w.h, pts };
  });
  return { cx, cy, c, s, w: HW, h: HH, bx0, by0, bx1, by1, walls, roof, parts };
}

/** выпуклая оболочка точек (для тени стены от солнца) */
export function hull(p: { x: number; y: number }[]) {
  const s = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: typeof s = [], up: typeof s = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
