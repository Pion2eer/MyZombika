// Земля глав сюжета: асфальт, брусчатка, бетон, пашня, вода. Любую плитку можно заменить своей:
// бесшовный PNG 512×512 в src/tiles/<имя>.png (t_asphalt, t_town, t_factory, t_dam, t_water, t_farm, t_waste, t_junk, t_tunnel) — пересобрать игру.
// Нарисованные кодом — запасные: шум и швы, чтобы главы заметно отличались и без картинок.
import Phaser from "phaser";

export const GROUND = ["t_asphalt", "t_town", "t_factory", "t_dam", "t_water", "t_farm", "t_waste", "t_junk", "t_tunnel"] as const;
const FILES = import.meta.glob("./tiles/*.png", { eager: true, import: "default" }) as Record<string, string>;

export function loadGroundFiles(scene: Phaser.Scene) {
  if (FILES["./tiles/t_grass.png"]) scene.load.image("t_grass", FILES["./tiles/t_grass.png"]);
  for (const n of GROUND) { const f = FILES[`./tiles/${n}.png`]; if (f) scene.load.image(n, f); }
}

/** своя трава (src/tiles/t_grass.png) — основа земли вместо нарисованного луга */
export const HAS_GRASS = !!FILES["./tiles/t_grass.png"];

const S = 256;
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
/** зернистость: много мелких пятнышек светлее/темнее основы (бесшовно — рисуем с переносом по краям) */
function grain(c: CanvasRenderingContext2D, r: () => number, n: number, light: string, dark: string, size: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, s = size * (0.4 + r());
    c.fillStyle = r() < 0.5 ? light : dark;
    c.globalAlpha = 0.08 + r() * 0.18;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) c.fillRect(x + dx, y + dy, s, s);
  }
  c.globalAlpha = 1;
}
function blot(c: CanvasRenderingContext2D, r: () => number, n: number, col: string, rad: number, a: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, rx = rad * (0.5 + r()), ry = rx * (0.4 + r() * 0.6);
    c.fillStyle = col; c.globalAlpha = a * (0.5 + r() * 0.5);
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { c.beginPath(); c.ellipse(x + dx, y + dy, rx, ry, r() * 3, 0, Math.PI * 2); c.fill(); }
  }
  c.globalAlpha = 1;
}

const DRAW: Record<(typeof GROUND)[number], (c: CanvasRenderingContext2D, r: () => number) => void> = {
  t_asphalt(c, r) {
    c.fillStyle = "#4a4a4c"; c.fillRect(0, 0, S, S);
    grain(c, r, 2600, "#7a7a78", "#262628", 2.2);
    blot(c, r, 5, "#2e2e30", 26, 0.35);
    // трещины
    c.strokeStyle = "#232324"; c.lineWidth = 1.4; c.globalAlpha = 0.7;
    for (let i = 0; i < 4; i++) { let x = r() * S, y = r() * S; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
    c.globalAlpha = 1;
  },
  t_town(c, r) {
    c.fillStyle = "#8a8680"; c.fillRect(0, 0, S, S);
    // плиты 64×64 вперемешку, швы тёмные
    for (let y = 0; y < S; y += 64) for (let x = 0; x < S; x += 64) {
      const k = 0.88 + r() * 0.2;
      c.fillStyle = `rgb(${Math.round(138 * k)},${Math.round(134 * k)},${Math.round(126 * k)})`; c.fillRect(x + 1, y + 1, 62, 62);
    }
    grain(c, r, 1800, "#b8b4aa", "#5a5650", 1.8);
    c.strokeStyle = "#4a4640"; c.lineWidth = 2;
    for (let i = 0; i <= S; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
    blot(c, r, 4, "#5a6a3a", 10, 0.5); // трава в щелях
  },
  t_factory(c, r) {
    c.fillStyle = "#9a958a"; c.fillRect(0, 0, S, S);
    grain(c, r, 2200, "#c0bcb0", "#6a665e", 2);
    blot(c, r, 6, "#2a2620", 22, 0.35); // масляные пятна
    blot(c, r, 4, "#8a4a20", 14, 0.3); // ржавчина
    c.strokeStyle = "#5e5a52"; c.lineWidth = 2.5;
    for (let i = 0; i <= S; i += 128) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
  },
  t_dam(c, r) {
    c.fillStyle = "#8c9490"; c.fillRect(0, 0, S, S);
    grain(c, r, 2400, "#b8c0ba", "#5a625e", 2.2);
    blot(c, r, 7, "#4e6a3a", 18, 0.35); // мох
    blot(c, r, 4, "#5a7088", 20, 0.3); // лужи
    c.strokeStyle = "#62686a"; c.lineWidth = 2;
    for (let i = 0; i <= S; i += 128) { c.beginPath(); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
  },
  t_water(c, r) {
    const g = c.createLinearGradient(0, 0, S, S); g.addColorStop(0, "#2a5a78"); g.addColorStop(1, "#23506c"); c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.strokeStyle = "#7ab0c8"; c.lineWidth = 1.6;
    for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, w = 10 + r() * 22; c.globalAlpha = 0.25 + r() * 0.35; for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { c.beginPath(); c.moveTo(x + dx - w, y + dy); c.quadraticCurveTo(x + dx, y + dy - 4, x + dx + w, y + dy); c.stroke(); } }
    c.globalAlpha = 1;
  },
  t_farm(c, r) {
    c.fillStyle = "#7a5a36"; c.fillRect(0, 0, S, S);
    // борозды
    for (let y = 0; y < S; y += 16) { c.fillStyle = "#5e4428"; c.fillRect(0, y, S, 6); c.fillStyle = "#94704a"; c.fillRect(0, y + 8, S, 3); }
    grain(c, r, 1400, "#a8845a", "#4a3420", 2);
    blot(c, r, 10, "#c8a050", 6, 0.5); // солома
  },
  t_waste(c, r) {
    // сухая потрескавшаяся земля, пыль, клочья мёртвой травы
    c.fillStyle = "#a08a5e"; c.fillRect(0, 0, S, S);
    grain(c, r, 2400, "#c8b48a", "#6a5838", 2.2);
    blot(c, r, 12, "#8a744a", 18, 0.22);
    blot(c, r, 10, "#b8a070", 14, 0.2);
    c.strokeStyle = "#5e4c30"; c.lineWidth = 1.2; c.globalAlpha = 0.55;
    for (let i = 0; i < 14; i++) { let x = r() * S, y = r() * S; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 34; y += (r() - 0.5) * 34; c.lineTo(x, y); } c.stroke(); }
    c.globalAlpha = 1;
    blot(c, r, 9, "#8a8a4a", 6, 0.55);
  },
  t_junk(c, r) {
    // утоптанная грязь в мазуте, ржавые обрезки, осколки
    c.fillStyle = "#6a5a44"; c.fillRect(0, 0, S, S);
    grain(c, r, 2600, "#8a7a60", "#3a3024", 2.4);
    blot(c, r, 22, "#2a241c", 9, 0.11); // мазут
    blot(c, r, 12, "#8a4a22", 4, 0.35); // ржавчина
    grain(c, r, 260, "#a8a8a0", "#5a7a8a", 3.2); // железки и стекло
  },
  t_tunnel(c, r) {
    // тёмный асфальт туннеля, следы шин
    c.fillStyle = "#38383c"; c.fillRect(0, 0, S, S);
    grain(c, r, 2600, "#5a5a5e", "#1e1e22", 2);
    blot(c, r, 16, "#26262a", 10, 0.1);
    c.fillStyle = "#222226"; c.globalAlpha = 0.35; c.fillRect(S * 0.18, 0, 22, S); c.fillRect(S * 0.66, 0, 22, S); c.globalAlpha = 1;
  },
};

/** в create: недостающие плитки рисуем кодом */
export function makeGround(scene: Phaser.Scene) {
  GROUND.forEach((n, i) => {
    if (scene.textures.exists(n)) return;
    const cv = document.createElement("canvas"); cv.width = cv.height = S;
    DRAW[n](cv.getContext("2d")!, rng(97 + i * 31));
    scene.textures.addCanvas(n, cv);
  });
}

// ---- пятна на траве: проплешины земли (под домами и кострами, просто так), тёмная/сухая трава, кучки цветов ----
const P = 256;
/** неровная мягкая клякса: сумма кругов, затем порог с шумом по краю (альфа 0…1 на пиксель) */
function blobMask(r: () => number, lumpy: number): Float32Array {
  const cv = document.createElement("canvas"); cv.width = cv.height = P;
  const c = cv.getContext("2d")!;
  const n = 7 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = r() * P * 0.2, x = P / 2 + Math.cos(a) * d, y = P / 2 + Math.sin(a) * d * 0.8, rad = P * (0.16 + r() * 0.16);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, P, P);
  }
  const src = c.getImageData(0, 0, P, P).data, m = new Float32Array(P * P);
  // шум для рваного края: несколько синусов (дёшево и без швов не нужно — клякса одна)
  const ph = [r() * 9, r() * 9, r() * 9, r() * 9];
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const nz = (Math.sin(x * 0.11 + ph[0]) * Math.sin(y * 0.13 + ph[1]) + Math.sin(x * 0.37 + y * 0.29 + ph[2]) * 0.5 + Math.sin(x * 0.9 - y * 0.7 + ph[3]) * 0.25) * lumpy;
    const v = src[(y * P + x) * 4 + 3] / 255 + nz * 0.12 + (r() - 0.5) * 0.06;
    const t = Math.min(1, Math.max(0, (v - 0.32) / 0.22));
    m[y * P + x] = t * t * (3 - 2 * t);
  }
  return m;
}
function applyMask(cv: HTMLCanvasElement, m: Float32Array, k = 1) {
  const c = cv.getContext("2d")!, d = c.getImageData(0, 0, P, P);
  for (let i = 0; i < P * P; i++) d.data[i * 4 + 3] = Math.round(d.data[i * 4 + 3] * m[i] * k);
  c.putImageData(d, 0, 0);
}
function dirtCanvas(r: () => number) {
  const cv = document.createElement("canvas"); cv.width = cv.height = P;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#8b6b46"; c.fillRect(0, 0, P, P);
  // пятна потемнее/посветлее, зерно, камешки, травинки
  for (let i = 0; i < 26; i++) { c.fillStyle = r() < 0.5 ? "#6e5236" : "#a08058"; c.globalAlpha = 0.18 + r() * 0.2; c.beginPath(); c.ellipse(r() * P, r() * P, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2); c.fill(); }
  for (let i = 0; i < 1400; i++) { c.fillStyle = r() < 0.5 ? "#5a4230" : "#b8986a"; c.globalAlpha = 0.15 + r() * 0.3; const s = 1 + r() * 2.2; c.fillRect(r() * P, r() * P, s, s); }
  for (let i = 0; i < 40; i++) {
    const x = r() * P, y = r() * P, rx = 1.5 + r() * 3.5;
    c.globalAlpha = 0.5; c.fillStyle = "#4a3828"; c.beginPath(); c.ellipse(x + 1, y + 1.2, rx, rx * 0.7, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.9; c.fillStyle = r() < 0.5 ? "#a39a8c" : "#8c8478"; c.beginPath(); c.ellipse(x, y, rx, rx * 0.7, 0, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = "#5f8a2e"; c.lineWidth = 1.4;
  for (let i = 0; i < 50; i++) { const x = r() * P, y = r() * P; c.globalAlpha = 0.6; for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(x + j * 2, y); c.lineTo(x + j * 2 + (r() - 0.5) * 6, y - 4 - r() * 6); c.stroke(); } }
  c.globalAlpha = 1;
  return cv;
}
function tintCanvas(r: () => number, col: string, spots: string) {
  const cv = document.createElement("canvas"); cv.width = cv.height = P;
  const c = cv.getContext("2d")!;
  c.fillStyle = col; c.fillRect(0, 0, P, P);
  for (let i = 0; i < 300; i++) { c.fillStyle = spots; c.globalAlpha = 0.3 + r() * 0.4; c.fillRect(r() * P, r() * P, 2 + r() * 4, 1 + r() * 2); }
  c.globalAlpha = 1;
  return cv;
}
function flowersCanvas(r: () => number) {
  const cv = document.createElement("canvas"); cv.width = cv.height = P;
  const c = cv.getContext("2d")!;
  const cols = [["#ffffff", "#f2c230"], ["#f6d23a", "#d08a1a"], ["#b89ae0", "#f4e070"]];
  const main = Math.floor(r() * 3), n = 14 + Math.floor(r() * 18);
  for (let i = 0; i < n; i++) {
    // гуще к середине
    const a = r() * Math.PI * 2, d = Math.pow(r(), 1.6) * P * 0.36, x = P / 2 + Math.cos(a) * d, y = P / 2 + Math.sin(a) * d * 0.75;
    const [pc, cc] = cols[r() < 0.75 ? main : Math.floor(r() * 3)], s = 3 + r() * 2.5;
    c.globalAlpha = 0.35; c.fillStyle = "#1f4a12"; c.beginPath(); c.ellipse(x + 1.5, y + 2, s * 1.4, s, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1; c.fillStyle = pc;
    for (let k = 0; k < 5; k++) { const t = (k / 5) * Math.PI * 2 + i; c.beginPath(); c.ellipse(x + Math.cos(t) * s * 0.75, y + Math.sin(t) * s * 0.6, s * 0.6, s * 0.48, t, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = cc; c.beginPath(); c.arc(x, y, s * 0.42, 0, Math.PI * 2); c.fill();
  }
  return cv;
}
/** текстуры пятен: gp_dirt0..3, gp_dark0..1, gp_dry0..1, gp_flow0..2 */
export function makeGroundPatches(scene: Phaser.Scene) {
  if (scene.textures.exists("gp_dirt0")) return;
  const r = rng(4242);
  const add = (key: string, cv: HTMLCanvasElement, m: Float32Array | null, k = 1) => { if (m) applyMask(cv, m, k); scene.textures.addCanvas(key, cv); };
  for (let i = 0; i < 4; i++) add("gp_dirt" + i, dirtCanvas(r), blobMask(r, 1.4));
  for (let i = 0; i < 2; i++) add("gp_dark" + i, tintCanvas(r, "#1d4a14", "#0f300a"), blobMask(r, 0.8), 0.32);
  for (let i = 0; i < 2; i++) add("gp_dry" + i, tintCanvas(r, "#b8a848", "#8a7a30"), blobMask(r, 1), 0.38);
  for (let i = 0; i < 3; i++) add("gp_flow" + i, flowersCanvas(r), null);
}

/** пятна крови/копоти: неровная клякса с брызгами вокруг (белая — красим tint), splat0..3 */
export function makeSplats(scene: Phaser.Scene) {
  if (scene.textures.exists("splat0")) return;
  const r = rng(777);
  for (let i = 0; i < 4; i++) {
    const cv = document.createElement("canvas"); cv.width = cv.height = P;
    const c = cv.getContext("2d")!;
    c.fillStyle = "#fff"; c.fillRect(0, 0, P, P);
    const m = blobMask(r, 1.8);
    // брызги вокруг кляксы
    const d = c.getImageData(0, 0, P, P);
    for (let k = 0; k < P * P; k++) d.data[k * 4 + 3] = Math.round(255 * m[k]);
    c.putImageData(d, 0, 0);
    c.fillStyle = "#fff";
    for (let k = 0; k < 14; k++) { const a = r() * Math.PI * 2, dd = P * (0.3 + r() * 0.17), s = 2 + r() * 6; c.beginPath(); c.arc(P / 2 + Math.cos(a) * dd, P / 2 + Math.sin(a) * dd, s, 0, Math.PI * 2); c.fill(); }
    scene.textures.addCanvas("splat" + i, cv);
  }
}
