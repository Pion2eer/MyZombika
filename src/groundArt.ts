// Земля глав сюжета: асфальт, брусчатка, бетон, пашня, вода. Любую плитку можно заменить своей:
// бесшовный PNG 512×512 в src/tiles/<имя>.png (t_asphalt, t_town, t_factory, t_dam, t_water, t_farm, t_waste, t_junk, t_tunnel) — пересобрать игру.
// Нарисованные кодом — запасные: шум и швы, чтобы главы заметно отличались и без картинок.
import Phaser from "phaser";

export const GROUND = ["t_asphalt", "t_town", "t_factory", "t_dam", "t_water", "t_farm", "t_waste", "t_junk", "t_tunnel"] as const;
const FILES = import.meta.glob("./tiles/*.png", { eager: true, import: "default" }) as Record<string, string>;

export function loadGroundFiles(scene: Phaser.Scene) {
  for (const n of GROUND) { const f = FILES[`./tiles/${n}.png`]; if (f) scene.load.image(n, f); }
}

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
