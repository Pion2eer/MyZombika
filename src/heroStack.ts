// Герой из горизонтальных срезов (sprite stacking): маленькая воксельная модель,
// срезы которой рисуются друг над другом со сдвигом вверх по экрану — получается псевдо-3D.
// Тело и голова — отдельные стопки: тело поворачивается по ходу, голова — по взгляду.
// Все повороты рисуются один раз при загрузке в атлас кадров, в игре это одна картинка на часть.

/** Воксельная модель: N×N клеток, Z слоёв, цвет 0xRRGGBB или -1 (пусто). */
export interface Vox {
  n: number;
  z: number;
  /** первый слой (слои головы начинаются выше тела) */
  z0: number;
  c: Int32Array;
}

const N = 32;
const C = N / 2;

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(col: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((col >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((col >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((col & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

function newVox(z0: number, z: number): Vox {
  return { n: N, z, z0, c: new Int32Array(N * N * z).fill(-1) };
}

/** Заполнить модель: f(u, v, z) → цвет или -1; u — вперёд, v — вбок (вправо от хода), z — абсолютный слой. */
function fill(m: Vox, f: (u: number, v: number, z: number, x: number, y: number) => number) {
  for (let zi = 0; zi < m.z; zi++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const col = f(x + 0.5 - C, y + 0.5 - C, zi + m.z0, x, y);
        if (col >= 0) m.c[(zi * N + y) * N + x] = col;
      }
}

// палитра: герой по портрету; зомби — перекрашенная та же модель
export interface Palette { FUR: number[]; FUR_DARK: number[]; SKIN: number; SKIN_SH: number; HAIR: number[]; BEARD: number[]; LEATHER: number; BRASS: number; LACE: number; EYE: number; EYE_WHITE: number; LID: number }
export const PAL_HERO: Palette = {
  FUR: [0xe2ab5c, 0xc98c40, 0xa8702f], FUR_DARK: [0x9c6630, 0x86552a, 0x704522], SKIN: 0xe3a37c, SKIN_SH: 0xc2825c,
  HAIR: [0x7a4424, 0x66381c, 0x522c16, 0x8c5230], BEARD: [0x4e2e1a, 0x5c3820, 0x422614], LEATHER: 0x7a4426, BRASS: 0xd6a446, LACE: 0xe8c27a,
  EYE: 0x1b130b, EYE_WHITE: 0xf3e7d2, LID: 0x8a5236,
};
/** зомби: серо-зелёная кожа, рваньё, красные глаза */
export const PAL_ZOMBIE_A: Palette = {
  FUR: [0x5c6272, 0x4e5464, 0x3f4454], FUR_DARK: [0x3a3632, 0x2f2b27, 0x45403a], SKIN: 0x8fae7a, SKIN_SH: 0x6e8c5c,
  HAIR: [0x2e3326, 0x262a1f, 0x3a4030, 0x1f231a], BEARD: [0x3c4430, 0x2e3426, 0x48523a], LEATHER: 0x3a2a20, BRASS: 0x6a6a58, LACE: 0x8a2a24,
  EYE: 0xff3020, EYE_WHITE: 0xffc040, LID: 0x5a6a48,
};
/** зомби-бегун: бледный, в бурых лохмотьях */
export const PAL_ZOMBIE_B: Palette = {
  FUR: [0x6e5a44, 0x5e4c38, 0x7a3a30], FUR_DARK: [0x4a3a2a, 0x3c2e22, 0x5a2a22], SKIN: 0xb4bea6, SKIN_SH: 0x8e9a82,
  HAIR: [0x8a8a7a, 0x6e6e60, 0x9a9688, 0x5a5a4e], BEARD: [0x5a5a4e, 0x4a4a40, 0x6a665a], LEATHER: 0x2a2018, BRASS: 0x555048, LACE: 0x9a2a22,
  EYE: 0xff2a1a, EYE_WHITE: 0xff8a3a, LID: 0x7a8a6a,
};
let FUR = PAL_HERO.FUR, FUR_DARK = PAL_HERO.FUR_DARK, SKIN = PAL_HERO.SKIN, SKIN_SH = PAL_HERO.SKIN_SH, HAIR = PAL_HERO.HAIR, BEARD = PAL_HERO.BEARD;
let LEATHER = PAL_HERO.LEATHER, BRASS = PAL_HERO.BRASS, LACE = PAL_HERO.LACE, EYE = PAL_HERO.EYE, EYE_WHITE = PAL_HERO.EYE_WHITE, LID = PAL_HERO.LID;
/** выбрать палитру для следующих heroBody/heroHead */
export function setPalette(p: Palette) {
  ({ FUR, FUR_DARK, SKIN, SKIN_SH, HAIR, BEARD, LEATHER, BRASS, LACE, EYE, EYE_WHITE, LID } = p);
}

/** плечо: в вокселях от оси тела вбок и слой */
export const ARM_V = 12.4;
export const ARM_Z = 10;

const pick = (a: number[], r: number) => a[Math.min(a.length - 1, Math.floor(r * a.length))];

/** Тело: юбка из меха, ремень, меховая безрукавка со шнуровкой, голые руки, меховой ворот. Слои 0..13. */
export function heroBody(arms = false): Vox {
  const m = newVox(0, 14);
  fill(m, (u, v, z, x, y) => {
    const r = hash(x, y, z);
    const e = (ru: number, rv: number, du = 0) => ((u - du) / ru) ** 2 + (v / rv) ** 2;
    // руки — отдельные стопки (качаются с шагом, см. armLayer); в модели только меховые плечи.
    // arms — руки вдоль тела (для лежачего)
    const rv = 7.8 + Math.max(0, z - 5) * 0.5;
    const armV = Math.min(ARM_V, rv + 1.8);
    if (z >= (arms ? 3 : 10) && z <= 11 && (u - 0.3) ** 2 + (Math.abs(v) - armV) ** 2 < 2.4 ** 2) return z >= 10 ? pick(FUR, r) : shade(SKIN, 0.92 + r * 0.1);
    if (z <= 3) {
      // юбка: рваный низ
      if (e(4.6 + r * 0.6, 7.2 + r * 0.8) < 1) return pick(FUR_DARK, r);
      return -1;
    }
    if (z === 4) {
      if (e(5.0, 7.6) < 1) return u > 3.6 && Math.abs(v) < 1.6 ? BRASS : LEATHER;
      return -1;
    }
    if (z <= 11) {
      const ru = 5 + (z - 5) * 0.12;
      if (e(ru + r * 0.4, rv + r * 0.5) < 1) {
        // грудь в вырезе безрукавки
        if (z >= 9 && u > ru - 2.2 && Math.abs(v + 1) < (z - 8) * 0.9) return SKIN;
        // шнуровка по диагонали спереди
        if (u > ru - 1.6 && Math.abs(v - (8 - z) * 0.9 - 1) < 0.7 && z % 2 === 0) return LACE;
        return pick(FUR, r);
      }
      return -1;
    }
    // плечи и ворот
    if (z === 12 && e(5.8, 12.2) < 1 && !(u > 2 && Math.abs(v) < 2)) return pick(FUR, r * 0.7);
    if (z === 13 && e(5, 9) < 1 && e(3.1, 3.1, 0.3) > 1) return pick(FUR, r * 0.5);
    return -1;
  });
  return m;
}

/** Голова: шея, лицо с бородой, глаза, лохматые волосы и пучок. Слои 14..31. */
export function heroHead(eyesOpen: boolean): Vox {
  const m = newVox(14, 18);
  fill(m, (u, v, z, x, y) => {
    const r = hash(x, y, z);
    if (z === 14) return u * u + v * v < 3.4 ** 2 ? SKIN_SH : -1;
    // пучок на макушке, перехвачен ремешком
    if (z >= 27) {
      const d = (u + 1.5) ** 2 + v * v;
      if (z === 27 && d < 2.4 ** 2) return LEATHER;
      if (z > 27 && d < (2.8 - (z - 28) * 0.5 + r * 0.5) ** 2) return pick(HAIR, r);
      if (z > 27) return -1;
    }
    const zc = 20.6, cu = 0.3;
    const t = (z - zc) / 6;
    if (Math.abs(t) >= 1) return -1;
    const k = Math.sqrt(1 - t * t);
    const ru = 6.1 * k, rv = 5.7 * k;
    const du = u - cu;
    const skull = (du / ru) ** 2 + (v / rv) ** 2;
    const ang = Math.atan2(v, du); // 0 — вперёд
    const front = Math.abs(ang) < 1.0 && du > 0;
    const av = Math.abs(v);
    // пряди: цвет тянется полосами от макушки, а не рябью
    const hr = hash(Math.round(ang * 4 + z * 0.15), Math.floor(Math.hypot(du, v) * 0.7), 7) * 0.7 + r * 0.3;
    // борода: спереди и по щекам, пышная, ниже рта
    if (z <= 19 && Math.abs(ang) < 1.7 && du > -1) {
      const br = 1.25 + r * 0.12 - (z === 19 ? 0.2 : 0);
      if ((du / (ru * br + 0.8)) ** 2 + (v / (rv * br)) ** 2 < 1 && (skull > 0.45 || z <= 16)) return pick(BEARD, r);
    }
    // нос
    if ((z === 19 || z === 20) && av < 1 && du > 0 && du < ru + 1.1 && skull > 0.5) return z === 20 ? SKIN : SKIN_SH;
    if (skull < 1) {
      if (front && z >= 17 && z <= 23) {
        const surf = skull > 0.6;
        if (surf && (z === 21 || z === 20) && av > 1.4 && av < 3.2) {
          if (!eyesOpen) return z === 21 ? LID : SKIN;
          return av < 2.2 && z === 21 ? EYE_WHITE : EYE;
        }
        if (surf && z === 22 && av > 1 && av < 3.6) return BEARD[2]; // брови
        return SKIN;
      }
      if (z >= 19 && z <= 21 && Math.abs(av - rv) < 1.1 && Math.abs(du) < 1.3) return SKIN_SH; // уши
      return pick(HAIR, hr);
    }
    // волосы: шире черепа, лохматые; лицо открыто
    const hairR = 1.22 + r * 0.2;
    const inHair = (du / (ru * hairR)) ** 2 + (v / (rv * hairR)) ** 2 < 1;
    if (inHair && z >= 18 && (z >= 24 || !(Math.abs(ang) < 1.3 && du > 0))) return pick(HAIR, hr);
    return -1;
  });
  return m;
}

/** Срез слоя zi как картинка N×N; нижние слои темнее (затенение). */
function sliceCanvas(m: Vox, zi: number, zTop: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = m.n;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(m.n, m.n);
  const ao = 0.62 + 0.38 * ((zi + m.z0) / zTop);
  for (let i = 0; i < m.n * m.n; i++) {
    const col = m.c[zi * m.n * m.n + i];
    if (col < 0) continue;
    // открытый сверху воксель светлее (верхняя грань), закрытый — бок, темнее
    const top = zi + 1 >= m.z || m.c[(zi + 1) * m.n * m.n + i] < 0;
    const s = shade(col, ao * (top ? 1.06 : 0.84));
    img.data[i * 4] = (s >> 16) & 255;
    img.data[i * 4 + 1] = (s >> 8) & 255;
    img.data[i * 4 + 2] = s & 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export interface StackOpts {
  /** число поворотов (кадров) на полный круг */
  frames: number;
  /** пикселей текстуры на воксель */
  k: number;
  /** сдвиг вверх на слой, в вокселях */
  dz: number;
  /** сглаживание (мягко, как нарисованные спрайты) или чёткие пиксели */
  smooth: boolean;
  /** самый верхний слой всей фигуры (для затенения) */
  zTop: number;
  /** ширина кадра в вокселях (обрезка пустых краёв; фигура должна влезать при любом повороте) */
  w?: number;
}

export interface StackAtlas {
  canvas: HTMLCanvasElement;
  fw: number;
  fh: number;
  cols: number;
  /** точка земли под центром фигуры в кадре (может быть ниже кадра — у головы) */
  ox: number;
  oy: number;
}

/** Атлас кадров: кадр i — поворот на i/frames круга (0 — смотрит вправо, +x), по часовой (как в Phaser). */
export function renderStack(m: Vox, o: StackOpts): StackAtlas {
  const slices = Array.from({ length: m.z }, (_, zi) => sliceCanvas(m, zi, o.zTop));
  const w = o.w ?? m.n;
  const fw = Math.ceil(w * o.k);
  const zLo = m.z0 * o.dz * o.k, zHi = (m.z0 + m.z) * o.dz * o.k;
  const fh = Math.ceil(fw + zHi - zLo);
  const oy = fw / 2 + zHi;
  const cols = Math.ceil(Math.sqrt(o.frames));
  const cv = document.createElement("canvas");
  cv.width = fw * cols;
  cv.height = fh * Math.ceil(o.frames / cols);
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = o.smooth;
  ctx.imageSmoothingQuality = "high";
  // шаг внутри слоя, чтобы не было щелей, когда сдвиг слоя больше пикселя
  const sub = Math.max(1, Math.ceil(o.dz * o.k));
  for (let f = 0; f < o.frames; f++) {
    const a = (f / o.frames) * Math.PI * 2;
    const x0 = (f % cols) * fw, y0 = Math.floor(f / cols) * fh;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, fw, fh);
    ctx.clip();
    for (let zi = 0; zi < m.z; zi++)
      for (let s = 0; s < sub; s++) {
        const zz = zi + m.z0 + s / sub;
        ctx.save();
        ctx.translate(x0 + fw / 2, y0 + oy - zz * o.dz * o.k);
        ctx.rotate(a);
        ctx.drawImage(slices[zi], (-m.n / 2) * o.k, (-m.n / 2) * o.k, m.n * o.k, m.n * o.k);
        ctx.restore();
      }
    ctx.restore();
  }
  outline(ctx, cv.width, cv.height, Math.max(1, Math.round(o.k / 2)));
  return { canvas: cv, fw, fh, cols, ox: fw / 2, oy };
}

/** Спящий: тело с головой (глаза закрыты) кладём на спину — макушка по ходу (+x), лицо вверх.
 *  Слои по высоте в модели толще клеток в плане, поэтому лёжа рост сжимаем (иначе он вдвое длиннее себя стоя). */
export function lying(body: Vox, head: Vox): Vox {
  const H = 16, SQ = 0.62;
  const m = newVox(0, H);
  const top = head.z0 + head.z;
  const x0 = Math.round((N - top * SQ) / 2);
  for (let nx = 0; nx < N; nx++) {
    const zl = Math.floor((nx - x0) / SQ);
    if (zl < 0 || zl >= top) continue;
    const src = zl >= head.z0 ? head : body;
    const zi = zl - src.z0;
    if (zi < 0 || zi >= src.z) continue;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const col = src.c[(zi * N + y) * N + x];
        const nz = x - (C - H / 2); // спереди (лицо, грудь) — вверх
        if (col < 0 || nz < 0 || nz >= H) continue;
        m.c[(nz * N + y) * N + nx] = col;
      }
  }
  return m;
}

/** Тёмный контур по силуэту, как обводка у нарисованных спрайтов. */
function outline(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 96 ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (a[i]) continue;
      let near = false;
      for (let dy = -t; dy <= t && !near; dy++)
        for (let dx = -t; dx <= t; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && a[yy * w + xx] && dx * dx + dy * dy <= t * t + 1) { near = true; break; }
        }
      if (!near) continue;
      const al = d[i * 4 + 3] / 255;
      d[i * 4] = Math.round(d[i * 4] * al + 0x2e * (1 - al));
      d[i * 4 + 1] = Math.round(d[i * 4 + 1] * al + 0x20 * (1 - al));
      d[i * 4 + 2] = Math.round(d[i * 4 + 2] * al + 0x14 * (1 - al));
      d[i * 4 + 3] = Math.max(d[i * 4 + 3], 220);
    }
  ctx.putImageData(img, 0, 0);
}

/** Слой руки (круглый срез, k px на воксель): плечо и предплечье — кожа, запястье — ремешок, внизу кисть. */
export function armLayer(kind: "skin" | "band" | "hand" | "line", k: number): HTMLCanvasElement {
  const r = (kind === "skin" ? 1.75 : kind === "band" ? 1.8 : 2.0) * k + (kind === "line" ? k : 0);
  const col = kind === "band" ? LEATHER : kind === "hand" ? shade(SKIN, 0.96) : SKIN;
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(r * 2 + 4);
  const ctx = cv.getContext("2d")!;
  const c = cv.width / 2;
  const hex = (v: number) => "#" + v.toString(16).padStart(6, "0");
  // "line" — тёмный кружок чуть шире: все они рисуются под цветными и дают общий контур руки
  if (kind === "line") {
    ctx.fillStyle = "#2e2014";
    ctx.beginPath();
    ctx.arc(c, c, 2.0 * k + Math.max(1, k / 2), 0, Math.PI * 2);
    ctx.fill();
    return cv;
  }
  const g = ctx.createRadialGradient(c - r * 0.3, c - r * 0.3, r * 0.2, c, c, r);
  g.addColorStop(0, hex(shade(col, 1.08)));
  g.addColorStop(1, hex(shade(col, 0.8)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  return cv;
}

/** Живая отрисовка стопки (без атласа): срезы готовятся один раз, кадр — любой угол. Для заставки. */
export function stackSlices(m: Vox, zTop: number): HTMLCanvasElement[] {
  return Array.from({ length: m.z }, (_, zi) => sliceCanvas(m, zi, zTop));
}
/** sq — сжатие среза по вертикали: меньше 1 — смотрим сбоку, а не сверху (вместе с большим dz). */
/** drop(z) — сдвиг слоя z вверх в px (слой ещё падает) или null (ещё не появился). */
export function drawStack(ctx: CanvasRenderingContext2D, m: Vox, slices: HTMLCanvasElement[], cx: number, cy: number, a: number, k: number, dz: number, sq = 1, drop?: (z: number) => number | null) {
  const sub = Math.max(1, Math.ceil(dz * k));
  const half = (m.n / 2) * k;
  for (let zi = 0; zi < m.z; zi++) {
    const up = drop ? drop(zi + m.z0) : 0;
    if (up === null) continue;
    for (let s = 0; s < sub; s++) {
      ctx.setTransform(1, 0, 0, sq, cx, cy - (zi + m.z0 + s / sub) * dz * k - up);
      ctx.rotate(a);
      ctx.drawImage(slices[zi], -half, -half, m.n * k, m.n * k);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ───────── предметы ─────────
/** Граната: «ананас» с насечками, запал, рычаг и кольцо. */
export function grenadeVox(): Vox {
  const m = newVox(0, 15);
  const OL = 0x5e6e2c, OLD = 0x3a4718, MET = 0x9a9a92, LEV = 0xb8b8ae, RING = 0xd8c060;
  fill(m, (u, v, z) => {
    // корпус
    const t = (z - 5) / 5.6;
    if (Math.abs(t) < 1 && z <= 10) {
      const r = 4.4 * Math.sqrt(1 - t * t) + 0.3;
      const d = Math.hypot(u, v);
      if (d < r) {
        const ang = Math.atan2(v, u);
        const groove = z % 3 === 0 || Math.abs(Math.sin(ang * 4)) < 0.22;
        return groove && d > r - 1.2 ? OLD : OL;
      }
    }
    // запал
    if (z >= 10 && z <= 12 && Math.hypot(u, v) < 1.8) return MET;
    // рычаг: от верха вниз по боку
    if (Math.abs(v) < 1.1 && z >= 5 && z <= 12) {
      const ru = z >= 11 ? 1 : 4.4 * Math.sqrt(Math.max(0, 1 - ((z - 5) / 5.6) ** 2)) + 0.3;
      if (z === 12 && u > 0 && u < 3) return LEV;
      if (z < 12 && u > ru - 0.2 && u < ru + 1.1 && u > 0) return LEV;
    }
    // кольцо
    if (z === 12) { const d = Math.hypot(u + 2.6, v); if (d > 1.6 && d < 2.8) return RING; }
    return -1;
  });
  return m;
}

/** Аптечка: белый ящик с красными крестами и ручкой. */
export function medkitVox(): Vox {
  const m = newVox(0, 10);
  const WH = 0xeeeae0, ED = 0xc8c2b4, RED = 0xd42020, HD = 0x3a3a3a;
  fill(m, (u, v, z) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (au < 7 && av < 5 && z <= 6) {
      const edge = (au > 6 ? 1 : 0) + (av > 4 ? 1 : 0) + (z === 0 || z === 6 ? 1 : 0) >= 2;
      // крест сверху
      if (z === 6 && ((au < 1.2 && av < 3.6) || (au < 3.6 && av < 1.2))) return RED;
      // кресты по бокам (длинные стороны)
      if (av > 4 && ((au < 1.1 && z >= 1 && z <= 5) || (au < 3 && z >= 3 && z <= 3.9))) return RED;
      // по торцам
      if (au > 6 && ((av < 1.1 && z >= 1 && z <= 5) || (av < 2.6 && z >= 3 && z <= 3.9))) return RED;
      if (z === 3 && au > 6.5 && av < 0.5) return RED;
      return edge ? ED : WH;
    }
    // ручка
    if (av < 0.9 && au < 3.2 && (z === 8 || (z === 7 && au > 2.2))) return HD;
    return -1;
  });
  return m;
}

/** Бронежилет: тёмно-оливковый жилет с пластинами и ремнями (лежит на земле). */
export function armorVox(): Vox {
  const m = newVox(0, 6);
  const CL = 0x4a5530, PL = 0x5f6b3c, ST = 0x2a2a22, BK = 0x8a8a70;
  fill(m, (u, v, z) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (z > 3) return -1;
    // силуэт жилета: туловище, вырез под шею, проймы
    const body = au < 6.5 && av < 7.5 && !(u > 3.5 && av < 2.5) && !(au < 3 && av > 6.2);
    if (!body) return -1;
    if (z === 3) {
      if (av > 6.6 || au > 5.6) return ST; // кант
      if (Math.abs(v) < 0.6 || Math.abs(u + 1) < 0.6) return ST; // ремни
      if (au < 1.2 && av > 3 && av < 5) return BK; // пряжки
      return PL; // пластины
    }
    return CL;
  });
  return m;
}

/** Обрубок: модель без нижних cut слоёв (ног), опущенная на землю — для ползущего зомби. */
export function torsoOf(m: Vox, cut: number): Vox {
  const per = m.n * m.n;
  return { n: m.n, z: m.z - cut, z0: m.z0, c: m.c.slice(cut * per) };
}

/** Ящик патронов (крышка с полосой) или канистра (fuel): для бронебойных, зажигательных, ракет, топлива. */
export function ammoVox(body: number, stripe: number, can = false): Vox {
  const m = newVox(0, can ? 12 : 8);
  const dk = ((body >> 1) & 0x7f7f7f);
  fill(m, (u, v, z) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (can) {
      if (au < 5 && av < 3 && z <= 9) return (au > 4.2 || av > 2.2) && (z === 0 || z === 9) ? dk : z === 5 ? stripe : body;
      if (z >= 10 && z <= 11 && u > 1 && u < 3.5 && av < 1) return 0x2a2a2a; // горлышко
      if (z === 10 && u < 0 && u > -4 && av < 0.8) return dk; // ручка
      return -1;
    }
    if (au < 6.5 && av < 4 && z <= 5) {
      if (z === 5 && au < 4.5 && av < 1.3) return stripe;
      if (z >= 2 && z <= 3 && av > 3.2 && au < 3) return stripe;
      return (au > 5.8 || av > 3.3) && (z === 0 || z === 5) ? dk : body;
    }
    if (z === 6 && av < 0.7 && au < 2.5) return 0x2a2a2a;
    return -1;
  });
  return m;
}
