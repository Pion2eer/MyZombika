// Полуразрушенный дом из срезов (как герой): воксели 2×2 px, слой высотой 2 px сдвигается вверх на 1.6 px.
// Стены режутся на полосы по Y — каждая полоса со своей глубиной, поэтому внутри дома герой оказывается
// перед дальней стеной и за ближней. Крыша — отдельная картинка поверх всего, прозрачнеет, когда ты внутри.
import Phaser from "phaser";

/** стена: прямоугольник в мировых px (от левого верхнего угла дома) и высота, px */
export interface WallBox { x0: number; y0: number; x1: number; y1: number; h: number }
export interface House {
  x: number; y: number; w: number; h: number;
  /** стены в мировых координатах (для столкновений, пуль, пути и теней) */
  walls: WallBox[];
  roof: Phaser.GameObjects.Image;
  parts: Phaser.GameObjects.Image[];
}

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
const WALLS: WallBox[] = [
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

/** нарисовать набор клеток стопкой срезов; rows — какие ряды j; маска возвращает цвет по (i, j, z) или -1 */
function draw(ctx: CanvasRenderingContext2D, oy: number, j0: number, j1: number, f: (i: number, j: number) => Cell | null, zMax: number) {
  for (let z = 0; z < zMax; z++)
    for (let j = j0; j < j1; j++)
      for (let i = 0; i < NX; i++) {
        const c = f(i, j);
        if (!c || z >= c.h) continue;
        const col = c.col(z);
        if (col < 0) continue;
        // верхний срез стены светлее — видно, что это верх, а не бок
        const k = (0.78 + 0.22 * (z / zMax)) * (z === c.h - 1 ? 1.22 : 1);
        const px = i * V * K, py = (j * V - z * LZ * DZ) * K + oy;
        ctx.fillStyle = hex(shade(col, k * 0.72)); // боковая грань
        ctx.fillRect(px, py + V * K, V * K, LZ * DZ * K + 0.5);
        ctx.fillStyle = hex(shade(col, k));
        ctx.fillRect(px, py, V * K, V * K + 0.5);
      }
}

export function buildHouse(scene: Phaser.Scene, hx: number, hy: number): House {
  const tex = scene.textures, parts: Phaser.GameObjects.Image[] = [];
  const margin = (WALL_H + 2) * DZ; // насколько стены поднимаются над основанием, px
  // пол
  if (!tex.exists("house_floor")) {
    const c = document.createElement("canvas");
    c.width = HW * K; c.height = HH * K;
    const x = c.getContext("2d")!;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const col = floorAt(i, j);
      if (col < 0) continue;
      x.fillStyle = hex(col); x.fillRect(i * V * K, j * V * K, V * K, V * K);
    }
    tex.addCanvas("house_floor", c);
  }
  parts.push(scene.add.image(hx, hy, "house_floor").setOrigin(0).setScale(1 / K).setDepth(-4.6));
  // стены полосами по 6 px (3 ряда клеток); обломки — вместе со стенами
  const STRIP = 3;
  for (let s = 0; s * STRIP < NY; s++) {
    const key = `house_wall_${s}`, j0 = s * STRIP, j1 = Math.min(NY, j0 + STRIP);
    if (!tex.exists(key)) {
      const c = document.createElement("canvas");
      c.width = HW * K; c.height = Math.ceil((STRIP * V + margin + 2) * K);
      const x = c.getContext("2d")!;
      const oy = margin * K - j0 * V * K;
      draw(x, oy, j0, j1, (i, j) => cellAt(i, j) ?? rubbleAt(i, j), Math.ceil(WALL_H / LZ));
      tex.addCanvas(key, c);
    }
    parts.push(scene.add.image(hx, hy + j0 * V - margin, key).setOrigin(0).setScale(1 / K).setDepth(hy + j1 * V));
  }
  // крыша
  const rz = Math.ceil(WALL_H / LZ) + 10, rMargin = rz * LZ * DZ + 4;
  if (!tex.exists("house_roof")) {
    const c = document.createElement("canvas");
    c.width = (HW + 12) * K; c.height = Math.ceil((HH + 12 + rMargin) * K);
    const x = c.getContext("2d")!;
    // только верхняя поверхность ската: по слою на клетку + торцы
    for (let j = -3; j < NY + 3; j++) for (let i = -3; i < NX + 3; i++) {
      const r = roofAt(i, j);
      if (!r) continue;
      const px = (i * V + 6) * K, py = (j * V + 6 - r.z * LZ * DZ) * K + rMargin * K;
      x.fillStyle = hex(shade(r.col, 0.6)); x.fillRect(px, py + V * K, V * K, LZ * DZ * K * 2);
      x.fillStyle = hex(r.col); x.fillRect(px, py, V * K, V * K + 0.5);
    }
    tex.addCanvas("house_roof", c);
  }
  const roof = scene.add.image(hx - 6, hy - 6 - rMargin, "house_roof").setOrigin(0).setScale(1 / K).setDepth(1e6 - 3);
  const walls = WALLS.map((w) => ({ x0: hx + (w.y0 === HH - 6 && w.x0 === 0 ? SOUTH_LEFT_X0 : w.x0), y0: hy + w.y0, x1: hx + w.x1, y1: hy + w.y1, h: w.h }));
  return { x: hx, y: hy, w: HW, h: HH, walls, roof, parts };
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
