// Картинки верхней панели (HUD). Каждую можно заменить своей: положи PNG с прозрачным фоном в src/ui/<имя>.png
// (например src/ui/heart.png) и пересобери игру — нарисованная кодом картинка заменится файлом.
// Нарисованные здесь — запасные: толстый тёмный контур, тёплые цвета, как остальная игра.
import Phaser from "phaser";

/** имя → [ширина, высота] в пикселях экрана (файл лучше делать в 4 раза крупнее, пропорции те же) */
export const HUD_ART = {
  heart: [30, 30], shield: [28, 28], wave: [26, 26], kills: [26, 26], score: [26, 26], sun: [26, 26], moon: [26, 26],
  grenade: [22, 26], medkit: [26, 24], chat: [28, 26], pause: [24, 24], play: [24, 24], bag: [28, 28],
  bullet_rifle: [6, 18], bullet_pistol: [7, 14], shell: [10, 18], bar: [220, 22],
} as const;
export type HudArt = keyof typeof HUD_ART;

// файлы из src/ui/*.png (Vite вшивает их в сборку)
const FILES = import.meta.glob("./ui/*.png", { eager: true, import: "default" }) as Record<string, string>;
const fileOf = (n: string) => FILES[`./ui/${n}.png`];

/** в preload сцены: загрузить картинки-файлы, если они есть */
export function loadHudFiles(scene: Phaser.Scene) {
  for (const n of Object.keys(HUD_ART)) { const f = fileOf(n); if (f) scene.load.image("hud_" + n, f); }
}

const OUT = "#14110d";
type C = CanvasRenderingContext2D;
const K = 4; // рисуем в 4 раза крупнее, показываем уменьшенно — гладкие края

function stroke(c: C, w = 3.2) { c.lineWidth = w; c.strokeStyle = OUT; c.lineJoin = "round"; c.lineCap = "round"; c.stroke(); }
function grad(c: C, y0: number, y1: number, a: string, b: string) { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
function shine(c: C, x: number, y: number, rx: number, ry: number, a = 0.45) { c.save(); c.globalAlpha = a; c.fillStyle = "#fff"; c.beginPath(); c.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2); c.fill(); c.restore(); }

// рисунки в координатах ширины/высоты из HUD_ART
const DRAW: Record<HudArt, (c: C, w: number, h: number) => void> = {
  heart(c) {
    c.beginPath(); c.moveTo(15, 26); c.bezierCurveTo(4, 18, 2, 12, 3.5, 8); c.bezierCurveTo(5, 3, 12, 2, 15, 8); c.bezierCurveTo(18, 2, 25, 3, 26.5, 8); c.bezierCurveTo(28, 12, 26, 18, 15, 26); c.closePath();
    c.fillStyle = grad(c, 3, 26, "#ff6a50", "#a8160e"); c.fill(); stroke(c); shine(c, 9, 9, 3, 2);
  },
  shield(c) {
    c.beginPath(); c.moveTo(14, 2.5); c.lineTo(24.5, 6); c.lineTo(24, 14); c.quadraticCurveTo(23, 22, 14, 26); c.quadraticCurveTo(5, 22, 4, 14); c.lineTo(3.5, 6); c.closePath();
    c.fillStyle = grad(c, 2, 26, "#9ec4ff", "#3a5ca8"); c.fill(); stroke(c);
    c.beginPath(); c.moveTo(14, 5); c.lineTo(14, 23); c.lineWidth = 1.6; c.strokeStyle = "rgba(20,17,13,.45)"; c.stroke(); shine(c, 9, 9, 2.5, 3.5, 0.4);
  },
  wave(c) {
    // череп зомби
    c.beginPath(); c.moveTo(13, 2.5); c.bezierCurveTo(21, 2.5, 24, 8, 23.5, 12.5); c.bezierCurveTo(23, 16, 20.5, 17.5, 19, 18.5); c.lineTo(19, 23); c.lineTo(7, 23); c.lineTo(7, 18.5); c.bezierCurveTo(5.5, 17.5, 3, 16, 2.5, 12.5); c.bezierCurveTo(2, 8, 5, 2.5, 13, 2.5); c.closePath();
    c.fillStyle = grad(c, 2, 23, "#d8ecb0", "#7a9a50"); c.fill(); stroke(c);
    c.fillStyle = OUT; c.beginPath(); c.ellipse(9, 12, 3, 3.4, 0, 0, Math.PI * 2); c.ellipse(17, 12, 3, 3.4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ff4a30"; c.beginPath(); c.arc(9, 12.5, 1.2, 0, Math.PI * 2); c.arc(17, 12.5, 1.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(13, 15.5); c.lineTo(11.5, 18); c.lineTo(14.5, 18); c.closePath(); c.fillStyle = OUT; c.fill();
    c.lineWidth = 1.4; c.strokeStyle = OUT; c.beginPath(); c.moveTo(10.5, 20); c.lineTo(10.5, 23); c.moveTo(13, 20); c.lineTo(13, 23); c.moveTo(15.5, 20); c.lineTo(15.5, 23); c.stroke();
  },
  kills(c) {
    // перекрещенные кости под черепком — счёт убитых
    c.lineCap = "round";
    for (const [a, b, x, y] of [[3, 22, 23, 4], [3, 4, 23, 22]]) { c.beginPath(); c.moveTo(a, b); c.lineTo(x, y); c.lineWidth = 6.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 3.5; c.strokeStyle = "#efe6cc"; c.stroke(); }
    c.beginPath(); c.arc(13, 12, 7.5, 0, Math.PI * 2); c.fillStyle = grad(c, 4, 20, "#fff6dc", "#c8b890"); c.fill(); stroke(c, 2.6);
    c.fillStyle = OUT; c.beginPath(); c.arc(10.3, 11.5, 2, 0, Math.PI * 2); c.arc(15.7, 11.5, 2, 0, Math.PI * 2); c.fill();
  },
  score(c) {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 5 : 11.5; c.lineTo(13 + Math.cos(a) * r, 14 + Math.sin(a) * r); }
    c.closePath(); c.fillStyle = grad(c, 2, 25, "#fff0a0", "#e09a18"); c.fill(); stroke(c); shine(c, 10, 9, 2, 1.5, 0.6);
  },
  sun(c) {
    c.strokeStyle = OUT; c.lineCap = "round";
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; c.beginPath(); c.moveTo(13 + Math.cos(a) * 8, 13 + Math.sin(a) * 8); c.lineTo(13 + Math.cos(a) * 11.5, 13 + Math.sin(a) * 11.5); c.lineWidth = 4.5; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2; c.strokeStyle = "#ffd050"; c.stroke(); }
    c.beginPath(); c.arc(13, 13, 6.5, 0, Math.PI * 2); c.fillStyle = grad(c, 6, 20, "#fff2a0", "#f0a020"); c.fill(); stroke(c, 2.6);
  },
  moon(c) {
    c.beginPath(); c.arc(13, 13, 10, 0.9, Math.PI * 2 - 0.9 + Math.PI * 2, false);
    c.beginPath(); c.arc(13, 13, 10, Math.PI * 0.25, Math.PI * 1.75, false); c.arc(18, 9, 8, Math.PI * 1.45, Math.PI * 0.62, true); c.closePath();
    c.fillStyle = grad(c, 3, 23, "#f4f0ff", "#9aa4d8"); c.fill(); stroke(c, 2.6);
    c.fillStyle = "rgba(20,17,13,.25)"; c.beginPath(); c.arc(8, 15, 1.8, 0, Math.PI * 2); c.arc(11, 20, 1.2, 0, Math.PI * 2); c.fill();
  },
  grenade(c) {
    c.beginPath(); c.ellipse(11, 16, 8, 9, 0, 0, Math.PI * 2); c.fillStyle = grad(c, 7, 25, "#8aa048", "#3e4a1c"); c.fill(); stroke(c, 2.8);
    c.lineWidth = 1.3; c.strokeStyle = "rgba(20,17,13,.6)"; c.beginPath(); c.moveTo(3.5, 16); c.lineTo(18.5, 16); c.moveTo(11, 7.5); c.lineTo(11, 24.5); c.stroke();
    c.beginPath(); c.rect(7.5, 3.5, 7, 5); c.fillStyle = "#b8b4a8"; c.fill(); stroke(c, 2.2);
    c.beginPath(); c.arc(17.5, 4.5, 2.6, 0, Math.PI * 2); c.lineWidth = 1.6; c.strokeStyle = "#d8d4c8"; c.stroke(); shine(c, 7.5, 12, 2, 1.5, 0.35);
  },
  medkit(c) {
    c.beginPath(); c.roundRect(2.5, 5.5, 21, 16, 3); c.fillStyle = grad(c, 5, 22, "#ffffff", "#cfc8b8"); c.fill(); stroke(c, 2.6);
    c.beginPath(); c.roundRect(9, 2, 8, 4.5, 1.5); c.fillStyle = "#cfc8b8"; c.fill(); stroke(c, 2);
    c.fillStyle = "#d8281c"; c.fillRect(11, 8.5, 4, 10); c.fillRect(8, 11.5, 10, 4);
  },
  chat(c) {
    c.beginPath(); c.roundRect(2.5, 3, 23, 15.5, 5); c.moveTo(8, 18); c.lineTo(6, 24); c.lineTo(13, 18.5);
    c.fillStyle = grad(c, 3, 24, "#fff6e0", "#d8ccb0"); c.fill(); stroke(c, 2.6);
    c.fillStyle = OUT; for (const x of [8.5, 14, 19.5]) { c.beginPath(); c.arc(x, 10.8, 1.7, 0, Math.PI * 2); c.fill(); }
  },
  pause(c) {
    for (const x of [5, 14]) { c.beginPath(); c.roundRect(x, 3, 5.5, 18, 2); c.fillStyle = grad(c, 3, 21, "#fff6e0", "#d8ccb0"); c.fill(); stroke(c, 2.4); }
  },
  play(c) {
    c.beginPath(); c.moveTo(6, 3); c.lineTo(21, 12); c.lineTo(6, 21); c.closePath(); c.fillStyle = grad(c, 3, 21, "#fff6e0", "#d8ccb0"); c.fill(); stroke(c, 2.4);
  },
  bag(c) {
    c.beginPath(); c.roundRect(4, 7, 20, 18, 5); c.fillStyle = grad(c, 7, 25, "#b07a44", "#6a4220"); c.fill(); stroke(c, 2.6);
    c.beginPath(); c.moveTo(9, 7.5); c.quadraticCurveTo(9, 2.5, 14, 2.5); c.quadraticCurveTo(19, 2.5, 19, 7.5); c.lineWidth = 2.4; c.strokeStyle = OUT; c.stroke();
    c.beginPath(); c.roundRect(8, 14, 12, 7, 2); c.fillStyle = "#8a5a2c"; c.fill(); stroke(c, 1.8);
  },
  bullet_rifle(c) {
    c.beginPath(); c.moveTo(3, 0.8); c.quadraticCurveTo(5.2, 3, 5.2, 6); c.lineTo(0.8, 6); c.quadraticCurveTo(0.8, 3, 3, 0.8); c.fillStyle = grad(c, 0, 6, "#ffd0a0", "#b06a2a"); c.fill(); stroke(c, 1.1);
    c.beginPath(); c.rect(0.8, 6, 4.4, 11.2); c.fillStyle = grad(c, 6, 17, "#ffe680", "#b88a18"); c.fill(); stroke(c, 1.1);
  },
  bullet_pistol(c) {
    c.beginPath(); c.moveTo(3.5, 0.8); c.quadraticCurveTo(6.2, 2.5, 6.2, 5.5); c.lineTo(0.8, 5.5); c.quadraticCurveTo(0.8, 2.5, 3.5, 0.8); c.fillStyle = grad(c, 0, 6, "#e0e0e0", "#808080"); c.fill(); stroke(c, 1.1);
    c.beginPath(); c.rect(0.8, 5.5, 5.4, 7.7); c.fillStyle = grad(c, 5, 13, "#ffe680", "#b88a18"); c.fill(); stroke(c, 1.1);
  },
  shell(c) {
    c.beginPath(); c.roundRect(1, 1, 8, 11.5, [3, 3, 0, 0]); c.fillStyle = grad(c, 1, 12, "#ff5a40", "#901a10"); c.fill(); stroke(c, 1.2);
    c.beginPath(); c.rect(1, 12.5, 8, 4.5); c.fillStyle = grad(c, 12, 17, "#ffe680", "#a87a10"); c.fill(); stroke(c, 1.2);
  },
  bar(c, w, h) {
    // рамка полоски здоровья: тёмный жёлоб с латунной окантовкой (заливку рисует игра поверх)
    c.beginPath(); c.roundRect(1, 1, w - 2, h - 2, 7); c.fillStyle = "rgba(20,17,13,.82)"; c.fill();
    c.lineWidth = 2.2; c.strokeStyle = "#c8a060"; c.stroke();
    c.beginPath(); c.roundRect(3, 3, w - 6, h - 6, 5); c.lineWidth = 1; c.strokeStyle = "rgba(0,0,0,.8)"; c.stroke();
  },
};

/** в create сцены: недостающие картинки рисуем кодом */
export function makeHudArt(scene: Phaser.Scene) {
  for (const n of Object.keys(HUD_ART) as HudArt[]) {
    const key = "hud_" + n;
    if (scene.textures.exists(key)) continue;
    const [w, h] = HUD_ART[n];
    const cv = document.createElement("canvas"); cv.width = w * K; cv.height = h * K;
    const c = cv.getContext("2d")!;
    c.scale(K, K);
    DRAW[n](c, w, h);
    scene.textures.addCanvas(key, cv);
  }
}

/** картинка HUD нужного размера на экране */
export function hudImg(scene: Phaser.Scene, n: HudArt, scale = 1) {
  const [w, h] = HUD_ART[n];
  return scene.add.image(0, 0, "hud_" + n).setDisplaySize(w * scale, h * scale).setOrigin(0, 0.5);
}
