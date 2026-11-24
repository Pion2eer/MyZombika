// Картинки предметов на карте: бочки, ящики, машины, костёр, фонарный столб, забор.
// Любую можно заменить своей: PNG с прозрачным фоном в src/props/<имя>.png (имена и размеры — в src/props/README.md).
// Нарисованные кодом — запасные, в стиле игры: вид сверху-сбоку, тёмный контур, мягкий свет слева сверху.
import Phaser from "phaser";

/** имя → [ширина, высота] картинки в пикселях мира */
export const PROP_ART = {
  barrel: [26, 34], barrel_blue: [26, 34], crate: [34, 36], car_red: [112, 54], car_teal: [112, 54], car_burnt: [112, 54],
  campfire: [40, 34], lamp: [26, 84], fence: [84, 26], sign: [34, 40], tires: [36, 30],
} as const;
export type PropArt = keyof typeof PROP_ART;

const FILES = import.meta.glob("./props/*.png", { eager: true, import: "default" }) as Record<string, string>;
export function loadPropFiles(scene: Phaser.Scene) {
  for (const n of Object.keys(PROP_ART)) { const f = FILES[`./props/${n}.png`]; if (f) scene.load.image("prop_" + n, f); }
}

const OUT = "#1a140e";
const K = 3;
type C = CanvasRenderingContext2D;
const lin = (c: C, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, s] of stops) g.addColorStop(o, s); return g; };
function outline(c: C, w = 1.6) { c.lineWidth = w; c.strokeStyle = OUT; c.lineJoin = "round"; c.lineCap = "round"; c.stroke(); }
/** пятна ржавчины/грязи — детерминированно, чтобы картинка не менялась */
function grime(c: C, seed: number, x: number, y: number, w: number, h: number, col: string, n: number, r: number) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  c.save(); c.fillStyle = col;
  for (let i = 0; i < n; i++) { c.globalAlpha = 0.15 + rnd() * 0.35; c.beginPath(); c.ellipse(x + rnd() * w, y + rnd() * h, r * (0.4 + rnd()), r * (0.3 + rnd() * 0.7), rnd() * 3, 0, Math.PI * 2); c.fill(); }
  c.restore();
}

function barrel(c: C, body: [string, string, string], mark: "hazard" | "none") {
  // корпус-цилиндр: светлый слева, тёмный справа
  c.beginPath(); c.moveTo(3, 9); c.lineTo(3, 29); c.ellipse(13, 29, 10, 3.6, 0, Math.PI, 0, true); c.lineTo(23, 9); c.closePath();
  c.fillStyle = lin(c, 3, 0, 23, 0, [[0, body[0]], [0.35, body[1]], [1, body[2]]]); c.fill(); outline(c);
  // обручи
  c.lineWidth = 1.4; c.strokeStyle = "rgba(0,0,0,.35)";
  for (const y of [14.5, 23.5]) { c.beginPath(); c.ellipse(13, y, 10, 3.2, 0, 0, Math.PI); c.stroke(); }
  c.lineWidth = 0.8; c.strokeStyle = "rgba(255,255,255,.25)";
  for (const y of [13.6, 22.6]) { c.beginPath(); c.ellipse(13, y, 10, 3.2, 0, 0.2, Math.PI - 0.2); c.stroke(); }
  if (mark === "hazard") {
    // знак «огнеопасно»: жёлтый ромб с пламенем
    c.save(); c.translate(11.5, 19); c.rotate(Math.PI / 4);
    c.fillStyle = "#ffd040"; c.fillRect(-3.6, -3.6, 7.2, 7.2); c.lineWidth = 0.8; c.strokeStyle = OUT; c.strokeRect(-3.6, -3.6, 7.2, 7.2); c.restore();
    c.fillStyle = "#c82010"; c.beginPath(); c.moveTo(11.5, 16.2); c.quadraticCurveTo(13.6, 18.6, 12.4, 21); c.quadraticCurveTo(10.2, 21.2, 10.2, 19.4); c.quadraticCurveTo(10.6, 18.6, 11.5, 16.2); c.fill();
  }
  grime(c, 7, 4, 10, 18, 20, "#2a1608", 9, 2);
  // крышка
  c.beginPath(); c.ellipse(13, 9, 10, 4.2, 0, 0, Math.PI * 2); c.fillStyle = lin(c, 3, 5, 23, 13, [[0, body[0]], [1, body[2]]]); c.fill(); outline(c);
  c.beginPath(); c.ellipse(13, 9, 7.6, 2.9, 0, 0, Math.PI * 2); c.lineWidth = 1; c.strokeStyle = "rgba(0,0,0,.4)"; c.stroke();
  c.beginPath(); c.ellipse(17, 8.6, 1.6, 0.9, 0, 0, Math.PI * 2); c.fillStyle = "#2a2018"; c.fill();
  c.save(); c.globalAlpha = 0.35; c.fillStyle = "#fff"; c.beginPath(); c.ellipse(8, 8, 3, 1.2, -0.2, 0, Math.PI * 2); c.fill(); c.restore();
}

function car(c: C, paint: [string, string, string], burnt: boolean) {
  // вид строго сверху, нос вправо. Корпус со скруглёнными углами
  const body = new Path2D(); body.roundRect(4, 5, 104, 44, 12);
  c.save(); c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 0; c.fillStyle = OUT; c.translate(0, 2); c.fill(body); c.restore();
  c.fillStyle = lin(c, 0, 5, 0, 49, [[0, paint[0]], [0.5, paint[1]], [1, paint[2]]]); c.fill(body);
  c.lineWidth = 1.8; c.strokeStyle = OUT; c.stroke(body);
  // колёса торчат по бокам
  c.fillStyle = "#16120e";
  for (const [x, y] of [[20, 2.5], [84, 2.5], [20, 47], [84, 47]]) { c.beginPath(); c.roundRect(x - 8, y, 16, 5, 2); c.fill(); }
  // капот и багажник — линии
  c.lineWidth = 1.2; c.strokeStyle = "rgba(0,0,0,.35)";
  c.beginPath(); c.moveTo(78, 9); c.quadraticCurveTo(82, 27, 78, 45); c.moveTo(22, 9); c.quadraticCurveTo(18, 27, 22, 45); c.stroke();
  c.beginPath(); c.moveTo(90, 18); c.lineTo(104, 18); c.moveTo(90, 36); c.lineTo(104, 36); c.stroke();
  // крыша и стёкла
  const roof = new Path2D(); roof.roundRect(32, 10, 42, 34, 7);
  c.fillStyle = burnt ? "#2a2420" : lin(c, 0, 10, 0, 44, [[0, paint[0]], [1, paint[1]]]); c.fill(roof); c.lineWidth = 1.4; c.strokeStyle = OUT; c.stroke(roof);
  const glass = (p: Path2D, broken: boolean) => {
    c.fillStyle = burnt ? "#0e0c0a" : lin(c, 0, 10, 0, 44, [[0, "#9ec8e0"], [0.5, "#3a5a78"], [1, "#22344a"]]); c.fill(p); c.lineWidth = 1.1; c.strokeStyle = OUT; c.stroke(p);
    if (broken && !burnt) { c.save(); c.clip(p); c.strokeStyle = "rgba(230,240,255,.7)"; c.lineWidth = 0.6; c.beginPath(); for (let i = 0; i < 6; i++) { c.moveTo(70, 27); c.lineTo(70 + Math.cos(i * 1.1) * 12, 27 + Math.sin(i * 1.1) * 14); } c.stroke(); c.restore(); }
  };
  const ws = new Path2D(); ws.moveTo(74, 11); ws.quadraticCurveTo(84, 27, 74, 43); ws.lineTo(66, 40); ws.quadraticCurveTo(70, 27, 66, 14); ws.closePath(); glass(ws, true);
  const rw = new Path2D(); rw.moveTo(32, 12); rw.quadraticCurveTo(25, 27, 32, 42); rw.lineTo(37, 39); rw.quadraticCurveTo(34, 27, 37, 15); rw.closePath(); glass(rw, false);
  // фары и фонари
  c.fillStyle = burnt ? "#2a2018" : "#ffe8a0"; c.beginPath(); c.ellipse(105, 12, 2, 3, 0, 0, 7); c.ellipse(105, 42, 2, 3, 0, 0, 7); c.fill();
  c.fillStyle = burnt ? "#2a2018" : "#c82818"; c.fillRect(4.5, 10, 2.5, 6); c.fillRect(4.5, 38, 2.5, 6);
  // ржавчина, вмятины, блики
  grime(c, burnt ? 31 : 11, 6, 6, 100, 42, burnt ? "#5a2a10" : "#6a3010", burnt ? 40 : 16, burnt ? 5 : 3.2);
  if (burnt) grime(c, 5, 6, 6, 100, 42, "#000", 30, 6);
  c.save(); c.globalAlpha = burnt ? 0.08 : 0.3; c.fillStyle = "#fff"; c.beginPath(); c.roundRect(36, 12, 30, 4, 2); c.fill(); c.beginPath(); c.roundRect(84, 9, 14, 3, 1.5); c.fill(); c.restore();
}

const DRAW: Record<PropArt, (c: C) => void> = {
  barrel: (c) => barrel(c, ["#ff6a4a", "#c8281a", "#6a120a"], "hazard"),
  barrel_blue: (c) => barrel(c, ["#7aa8d8", "#3a6aa0", "#1a3058"], "none"),
  crate(c) {
    // верх
    c.beginPath(); c.moveTo(3, 9); c.lineTo(31, 9); c.lineTo(31, 33); c.lineTo(3, 33); c.closePath();
    c.fillStyle = lin(c, 0, 9, 0, 33, [[0, "#b88a4e"], [1, "#7a5228"]]); c.fill(); outline(c);
    // крышка (вид сверху-сбоку)
    c.beginPath(); c.moveTo(3, 9); c.lineTo(31, 9); c.lineTo(31, 3); c.lineTo(3, 3); c.closePath();
    c.fillStyle = "#d8a868"; c.fill(); outline(c);
    c.lineWidth = 1; c.strokeStyle = "rgba(40,24,10,.6)";
    for (const y of [17, 25]) { c.beginPath(); c.moveTo(4, y); c.lineTo(30, y); c.stroke(); }
    c.beginPath(); c.moveTo(12, 3.5); c.lineTo(12, 8.5); c.moveTo(22, 3.5); c.lineTo(22, 8.5); c.stroke();
    // крестовина
    c.lineWidth = 3.2; c.strokeStyle = OUT; c.beginPath(); c.moveTo(5, 11); c.lineTo(29, 31); c.moveTo(29, 11); c.lineTo(5, 31); c.stroke();
    c.lineWidth = 2; c.strokeStyle = "#c8945a"; c.stroke();
    c.lineWidth = 2.6; c.strokeStyle = OUT; c.strokeRect(4, 10, 26, 22); c.lineWidth = 1.4; c.strokeStyle = "#c8945a"; c.strokeRect(4, 10, 26, 22);
    grime(c, 3, 4, 4, 26, 28, "#3a2210", 10, 2.2);
  },
  car_red: (c) => car(c, ["#e06048", "#a82a1a", "#5a140c"], false),
  car_teal: (c) => car(c, ["#7ac0b0", "#3a8a7a", "#1a4a40"], false),
  car_burnt: (c) => car(c, ["#4a3a30", "#2a2018", "#140e0a"], true),
  campfire(c) {
    // камни по кругу, головешки
    c.save(); c.globalAlpha = 0.5; c.fillStyle = "#000"; c.beginPath(); c.ellipse(20, 21, 15, 9, 0, 0, 7); c.fill(); c.restore();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, x = 20 + Math.cos(a) * 15, y = 20 + Math.sin(a) * 9;
      c.beginPath(); c.ellipse(x, y, 4.2, 3.2, a, 0, 7); c.fillStyle = lin(c, x - 4, y - 3, x + 4, y + 3, [[0, "#b8b0a0"], [1, "#5a5448"]]); c.fill(); outline(c, 1.1);
    }
    c.lineCap = "round";
    for (const [x0, y0, x1, y1] of [[10, 24, 28, 15], [12, 14, 30, 24], [20, 11, 19, 27]]) {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineWidth = 5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 3.4; c.strokeStyle = "#5a3a1e"; c.stroke();
    }
    c.save(); c.globalAlpha = 0.9; const g = c.createRadialGradient(20, 19, 0, 20, 19, 9); g.addColorStop(0, "#ffe080"); g.addColorStop(0.5, "#ff7a20"); g.addColorStop(1, "rgba(200,40,0,0)"); c.fillStyle = g; c.beginPath(); c.arc(20, 19, 9, 0, 7); c.fill(); c.restore();
  },
  lamp(c) {
    // столб с плафоном (основание внизу картинки)
    c.save(); c.globalAlpha = 0.35; c.fillStyle = "#000"; c.beginPath(); c.ellipse(13, 80, 6, 2.5, 0, 0, 7); c.fill(); c.restore();
    c.beginPath(); c.roundRect(10.5, 12, 5, 68, 2); c.fillStyle = lin(c, 10, 0, 16, 0, [[0, "#8a9098"], [1, "#3a3e44"]]); c.fill(); outline(c, 1.3);
    c.beginPath(); c.roundRect(8, 72, 10, 9, 2); c.fillStyle = "#4a4e54"; c.fill(); outline(c, 1.3);
    c.beginPath(); c.moveTo(13, 14); c.quadraticCurveTo(13, 6, 20, 6); c.lineWidth = 3.4; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = "#5a5e64"; c.stroke();
    c.beginPath(); c.moveTo(14, 5); c.lineTo(25, 5); c.lineTo(23, 10); c.lineTo(16, 10); c.closePath(); c.fillStyle = "#3a3e44"; c.fill(); outline(c, 1.2);
    c.beginPath(); c.ellipse(19.5, 10.5, 3.4, 1.6, 0, 0, 7); c.fillStyle = "#fff4c0"; c.fill();
  },
  fence(c) {
    // две жерди и столбики (вдоль длинной стороны), доски местами выломаны
    c.lineCap = "round";
    for (const y of [9, 17]) { c.beginPath(); c.moveTo(4, y); c.lineTo(80, y + (y === 17 ? 1 : 0)); c.lineWidth = 4.6; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 3; c.strokeStyle = y === 9 ? "#b08050" : "#8a6038"; c.stroke(); }
    for (const x of [6, 28, 56, 78]) {
      c.beginPath(); c.roundRect(x - 3, 3, 6, 21, 1.5); c.fillStyle = lin(c, x - 3, 0, x + 3, 0, [[0, "#c8945a"], [1, "#6a4424"]]); c.fill(); outline(c, 1.2);
      c.fillStyle = "#e0b078"; c.fillRect(x - 2, 3.6, 4, 1.6);
    }
    grime(c, 13, 4, 4, 76, 18, "#3a2410", 8, 2);
  },
  sign(c) {
    c.beginPath(); c.roundRect(15, 16, 4, 23, 1); c.fillStyle = "#6a4a2a"; c.fill(); outline(c, 1.2);
    c.beginPath(); c.moveTo(17, 2); c.lineTo(32, 17); c.lineTo(17, 32); c.lineTo(2, 17); c.closePath(); c.fillStyle = "#ffcf30"; c.fill(); outline(c, 1.6);
    c.beginPath(); c.moveTo(17, 5); c.lineTo(29, 17); c.lineTo(17, 29); c.lineTo(5, 17); c.closePath(); c.lineWidth = 1; c.strokeStyle = OUT; c.stroke();
    // силуэт зомби с вытянутыми руками
    c.fillStyle = OUT; c.beginPath(); c.arc(15, 11.5, 2.2, 0, 7); c.fill();
    c.fillRect(13.5, 13.5, 3.2, 7); c.fillRect(16, 14.5, 6, 1.6); c.fillRect(16, 16.8, 5.4, 1.6); c.fillRect(13.6, 20.2, 1.6, 5); c.fillRect(15.4, 20.2, 1.6, 5);
    grime(c, 21, 4, 4, 26, 26, "#6a3010", 7, 2);
  },
  tires(c) {
    for (const [x, y] of [[13, 18], [24, 14], [17, 9]]) {
      c.beginPath(); c.ellipse(x, y, 10, 6.2, 0, 0, 7); c.fillStyle = "#24201c"; c.fill(); outline(c, 1.3);
      c.beginPath(); c.ellipse(x, y, 4.6, 2.8, 0, 0, 7); c.fillStyle = "#0c0a08"; c.fill();
      c.beginPath(); c.ellipse(x - 2, y - 2.5, 6, 2, -0.2, Math.PI * 1.1, Math.PI * 1.9); c.lineWidth = 1; c.strokeStyle = "rgba(255,255,255,.18)"; c.stroke();
    }
  },
};

export function makePropArt(scene: Phaser.Scene) {
  for (const n of Object.keys(PROP_ART) as PropArt[]) {
    const key = "prop_" + n;
    if (scene.textures.exists(key)) continue;
    const [w, h] = PROP_ART[n];
    const cv = document.createElement("canvas"); cv.width = w * K; cv.height = h * K;
    const c = cv.getContext("2d")!;
    c.scale(K, K);
    DRAW[n](c);
    scene.textures.addCanvas(key, cv);
  }
  // язычок пламени для частиц (мягкий, белый — красится тинтом)
  if (!scene.textures.exists("flame")) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 32;
    const c = cv.getContext("2d")!, g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    scene.textures.addCanvas("flame", cv);
  }
}
