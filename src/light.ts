import { t as tr } from "./i18n";
// Освещение: смена дня и ночи, тени от солнца и свет героя (фонарь вокруг + луч по прицелу)
// с настоящими тенями от деревьев, камней и врагов (2D-видимость: от каждого круга-препятствия
// строится «теневой клин» от источника света).
import Phaser from "phaser";

/** длина суток, секунд */
export const DAY_LEN = 240;
/** длина тени = высота предмета × SHADOW × (длина от высоты солнца) — одна для всех: деревьев, камней, людей, зверей */
export const SHADOW = 0.8;
export const SHADOW_ALPHA = 0.38;
const TAU = Math.PI * 2;
const SH = 5;
const smooth = (a: number, b: number, x: number) => { const t = Phaser.Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Шейдер освещения: каждый пиксель картинки умножается на цвет карты света (lightmap).
 * 0.5 в карте — «как есть», выше — пересвет (тёплый фонарь), ниже — темнее с оттенком окружения (холодная луна).
 * Ночью вдали от света цвета гаснут (глаз в темноте видит хуже цвета).
 */
const FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uLight;
uniform float uNight;
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec3 l = texture2D(uLight, vec2(outTexCoord.x, 1.0 - outTexCoord.y)).rgb * 2.0;
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lit = clamp(max(l.r, max(l.g, l.b)), 0.0, 1.0);
  vec3 base = mix(vec3(lum), c.rgb, mix(1.0, 0.25 + 0.75 * lit, uNight));
  gl_FragColor = vec4(base * l, c.a);
}`;
export class LightFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  night = 0;
  lightTex: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
  constructor(game: Phaser.Game) { super({ game, name: "LightFX", fragShader: FRAG }); }
  onDraw(target: Phaser.Renderer.WebGL.RenderTarget) {
    if (!this.lightTex) { this.bindAndDraw(target); return; }
    this.set1f("uNight", this.night);
    this.set1i("uLight", 1);
    this.bindTexture(this.lightTex, 1);
    this.bindAndDraw(target);
  }
}

export interface Sun {
  /** 0 — ночь, 1 — день */
  day: number;
  /** куда падают тени от солнца (рад) и во сколько раз тень длиннее высоты */
  ang: number;
  len: number;
  /** 0..1 — тёплый закат/рассвет */
  warm: number;
  /** время суток 0..1 (0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — полночь) */
  t: number;
}

/** круг, отбрасывающий тень; obj — его картинка: сам предмет остаётся освещённым (тень только за ним) */
export interface Circle {
  x: number; y: number; r: number; obj?: Phaser.GameObjects.Image | Phaser.GameObjects.Container; hide?: Phaser.GameObjects.GameObject & { visible: boolean };
  /** движется (монстр, игрок): такие тени можно склеивать и упрощать */
  move?: boolean;
  /** несколько предметов в одной склеенной тени */
  objs?: (Phaser.GameObjects.Image | Phaser.GameObjects.Container)[];
  /** стена: углы многоугольника вместо круга */
  poly?: { x: number; y: number }[];
}

interface Caster { img: Phaser.GameObjects.Image; c: Phaser.GameObjects.Container; sh: Phaser.GameObjects.Image; h: number; size: number }
interface TreeCaster { img: Phaser.GameObjects.Image; c: Phaser.GameObjects.Container; sh: Phaser.GameObjects.Image }

/**
 * Наклон перевёрнутой картинки: ширина остаётся горизонтальной, а высота ложится вдоль тени (угол ang, длина k).
 * Матрица [[1, vx], [0, vy]] раскладывается на поворот · растяжение · поворот (SVD): внешний контейнер (th1, sx, sy) + внутренний (th2).
 */
export function shear(ang: number, k: number) {
  const vx = Math.cos(ang) * k, s = Math.sin(ang) * k, vy = Math.abs(s) < 0.05 ? (s < 0 ? -0.05 : 0.05) : s;
  const E = (1 + vy) / 2, F = (1 - vy) / 2, G = vx / 2, H = -vx / 2;
  const Q = Math.hypot(E, H), R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F), a2 = Math.atan2(H, E);
  return { th1: (a2 + a1) / 2, th2: (a2 - a1) / 2, sx: Q + R, sy: Q - R };
}

export class Lighting {
  /** текущий наклон солнечной тени (тот же для деревьев, людей и зверей) */
  shear = shear(Math.PI / 2, 1);
  t: number;
  sun: Sun = { day: 1, ang: Math.PI / 2, len: 1, warm: 0, t: 0.25 };
  private dark!: Phaser.GameObjects.RenderTexture;
  private light!: Phaser.GameObjects.RenderTexture;
  /** тени в 1/SH разрешения: при растягивании края сами становятся мягкими */
  private shad!: Phaser.GameObjects.RenderTexture;
  /** цветная карта света (только WebGL) — по ней шейдер красит картинку */
  private lmap?: Phaser.GameObjects.RenderTexture;
  private fx?: LightFX;
  /** излучающие сами по себе (глаза зомби) — рисуются в карту света */
  emissive: Phaser.GameObjects.Graphics[] = [];
  /** другие источники света на этот кадр (костры, фонари, взрывы): яркость уже с учётом ночи и мерцания */
  extra: { x: number; y: number; r: number; col: number; a: number }[] = [];
  private glow!: Phaser.GameObjects.Image;
  private flashGlow!: Phaser.GameObjects.Image;
  private tint!: Phaser.GameObjects.Rectangle;
  private lampImg!: Phaser.GameObjects.Image;
  private coneImg!: Phaser.GameObjects.Image;
  private flashImg!: Phaser.GameObjects.Image;
  private occl!: Phaser.GameObjects.Graphics;
  private casters: Caster[] = [];
  private trees: TreeCaster[] = [];
  /** нарисованные постройки и машины: тот же силуэт, сдвинутый от солнца (как тень в рисованных играх) */
  private drops: { img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image; k: number }[] = [];
  /** радиус света вокруг героя и длина луча фонаря */
  R = 210;
  /** яркость пятна вокруг героя (0..1) */
  LAMP = 0.5;
  /** яркость луча фонаря (0..1) */
  BEAM = 0.55;
  CONE = 430;
  /** яркость костров, фонарей и вспышек относительно фонарика */
  EXTRA = 0.6;
  /** тени от фонаря (на низком качестве выключены) */
  shadows = true;
  /** во сколько раз карта света меньше экрана (свет мягкий — на телефоне хватает половины) */
  private ls = 1;
  setRes(n: number) { if (n !== this.ls) { this.ls = n; this.makeRT(); } }

  constructor(private scene: Phaser.Scene, startT: number) {
    this.t = startT;
    const tx = scene.textures;
    if (!tx.exists("lt_lamp")) {
      // мягкое круглое пятно света
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d")!, gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.45, "rgba(255,255,255,0.85)");
      gr.addColorStop(0.8, "rgba(255,255,255,0.3)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 256, 256);
      tx.addCanvas("lt_lamp", c);
      // луч фонаря: клин от левого края по центру
      const k = document.createElement("canvas");
      k.width = 512; k.height = 512;
      const q = k.getContext("2d")!, half = 0.42;
      const rg = q.createRadialGradient(0, 256, 0, 0, 256, 512);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(0.6, "rgba(255,255,255,0.75)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      q.fillStyle = rg;
      q.filter = "blur(10px)";
      q.beginPath();
      q.moveTo(0, 256);
      q.arc(0, 256, 500, -half, half);
      q.closePath();
      q.fill();
      tx.addCanvas("lt_cone", k);
      // тень от солнца у человечков и зверей: вытянутое мягкое пятно, начинается у ног
      const s = document.createElement("canvas");
      s.width = 64; s.height = 24;
      const sg = s.getContext("2d")!;
      sg.filter = "blur(3px)";
      sg.fillStyle = "#000";
      sg.beginPath();
      sg.ellipse(32, 12, 26, 7, 0, 0, TAU);
      sg.fill();
      tx.addCanvas("lt_cast", s);
    }
    this.lampImg = scene.make.image({ key: "lt_lamp" }, false);
    this.flashImg = scene.make.image({ key: "lt_lamp" }, false);
    this.coneImg = scene.make.image({ key: "lt_cone" }, false).setOrigin(0, 0.5);
    this.occl = scene.make.graphics({}, false);
    // тёплое свечение вокруг героя ночью
    this.glow = scene.add.image(0, 0, "lt_lamp").setBlendMode(Phaser.BlendModes.ADD).setTint(0xff9a30).setDepth(1e6 + 0.4);
    // вспышка выстрела — у дула
    this.flashGlow = scene.add.image(0, 0, "lt_lamp").setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd080).setDepth(1e6 + 0.45).setAlpha(0);
    this.tint = scene.add.rectangle(0, 0, 10, 10, 0xff6a20, 0).setOrigin(0).setDepth(1e6 + 0.6);
    // шейдер освещения на камеру (если WebGL)
    const r = scene.game.renderer;
    if (r.type === Phaser.WEBGL) {
      const wr = r as Phaser.Renderer.WebGL.WebGLRenderer;
      if (!wr.pipelines.getPostPipeline("LightFX")) wr.pipelines.addPostPipeline("LightFX", LightFX);
      scene.cameras.main.setPostPipeline("LightFX");
      this.fx = scene.cameras.main.getPostPipeline("LightFX") as LightFX;
      this.glow.setVisible(false);
      this.flashGlow.setVisible(false);
      this.tint.setVisible(false);
    }
    this.makeRT();
    scene.scale.on("resize", this.makeRT, this);
    scene.events.once("shutdown", () => scene.scale.off("resize", this.makeRT, this));
  }

  /** слои тьмы и света размером с видимую часть мира (с запасом под отдаление камеры) */
  private makeRT() {
    const cam = this.scene.cameras.main, z = Math.min(cam.zoom || 1, 0.75);
    const w = Math.ceil(this.scene.scale.width / z) + 64, h = Math.ceil(this.scene.scale.height / z) + 64;
    this.dark?.destroy();
    this.light?.destroy();
    this.shad?.destroy();
    this.dark = this.scene.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(1e6 + 0.5);

    const ls = this.fx ? this.ls : 1;
    this.light = this.scene.make.renderTexture({ x: 0, y: 0, width: Math.ceil(w / ls), height: Math.ceil(h / ls) }, false).setOrigin(0).setScale(ls);
    this.light.camera.setOrigin(0, 0).setZoom(1 / ls);
    this.shad = this.scene.make.renderTexture({ x: 0, y: 0, width: Math.ceil(w / SH), height: Math.ceil(h / SH) }, false).setOrigin(0).setScale(SH);
    // сглаживание при растягивании (иначе края тени — лесенкой из крупных пикселей)
    this.shad.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    if (this.fx) {
      // карта света — ровно по видимой части мира, чтобы её пиксели совпадали с экраном
      const cam = this.scene.cameras.main;
      this.lmap?.destroy();
      this.lmap = this.scene.make.renderTexture({ x: 0, y: 0, width: Math.ceil(this.scene.scale.width / cam.zoom / ls), height: Math.ceil(this.scene.scale.height / cam.zoom / ls) }, false).setOrigin(0);
      this.lmap.camera.setOrigin(0, 0).setZoom(1 / ls);
      this.dark.setVisible(false);
    }
  }

  /**
   * Тень от солнца для дерева/камня: та же картинка, чёрная, вытянутая от основания в сторону от солнца
   * на высоту × длину (контейнер повёрнут по солнцу и растянут вдоль него).
   */
  addCaster(img: Phaser.GameObjects.Image, height: number) {
    const sh = this.scene.make.image({ key: img.texture.key }, false).setDisplaySize(img.displayWidth, img.displayHeight).setTintFill(0x000000);
    const c = this.scene.add.container(img.x, img.y, [sh]).setDepth(-3.6);
    this.casters.push({ img, c, sh, h: height, size: img.displayWidth * 0.7 });
  }

  /**
   * Тень дерева: картинка дерева, «положенная на землю» от основания ствола в сторону от солнца
   * (верх картинки уходит по направлению тени), длина — по высоте солнца.
   */
  /** убрать тень предмета (бочку взорвали, ящик разбили) */
  addDrop(img: Phaser.GameObjects.Image, k = 1) {
    const sh = this.scene.add.image(img.x, img.y, img.texture.key).setOrigin(img.originX, img.originY)
      .setDisplaySize(img.displayWidth, img.displayHeight).setFlipX(img.flipX).setRotation(img.rotation).setTintFill(0x000000).setDepth(-3.6);
    this.drops.push({ img, sh, k });
  }
  removeShadow(img: Phaser.GameObjects.Image) {
    for (const d of this.drops) if (d.img === img) d.sh.destroy();
    this.drops = this.drops.filter((d) => d.img !== img);
    for (const t of this.trees) if (t.img === img) t.c.destroy();
    for (const c of this.casters) if (c.img === img) c.c.destroy();
    this.trees = this.trees.filter((t) => t.img !== img);
    this.casters = this.casters.filter((c) => c.img !== img);
  }
  addTree(img: Phaser.GameObjects.Image, sq = 1) {
    // картинка перевёрнута по вертикали (верхушка уходит «вниз» от ствола), а сдвиг/наклон задаёт контейнер.
    // У нарисованных построек/предметов тень крепим к самому нижнему непрозрачному ряду (колёса, фундамент), а не к точке опоры
    const b = artBase(img), oy = b ?? img.originY;
    const sh = this.scene.make.image({ key: img.texture.key }, false).setOrigin(img.originX, 1 - oy)
      .setDisplaySize(img.displayWidth, img.displayHeight * sq).setFlipY(true).setFlipX(img.flipX).setTintFill(0x000000);
    const c = this.scene.add.container(img.x, img.y + (oy - img.originY) * img.displayHeight, [sh]).setDepth(-3.6);
    this.trees.push({ img, c, sh });
  }

  /** солнце по времени суток */
  private calcSun() {
    const t = ((this.t % 1) + 1) % 1;
    const e = Math.sin(t * TAU); // высота солнца: >0 день
    const day = smooth(-0.18, 0.22, e);
    const warm = Math.exp(-(((e - 0.02) / 0.22) ** 2));
    // утром тени влево-вниз, в полдень вниз, вечером вправо-вниз
    const dayT = Phaser.Math.Clamp(t / 0.5, 0, 1);
    const ang = Math.PI * 0.88 - dayT * Math.PI * 0.76;
    const len = Phaser.Math.Clamp(0.55 / Math.max(0.12, e), 0.5, 3.2);
    this.sun = { day, ang, len, warm, t };
  }

  /**
   * px, py — герой (источник света), aim — куда светит фонарь, flash — вспышка выстрела (0..1),
   * occ — круги, отбрасывающие тень от фонаря (стволы, камни, враги).
   */
  update(dt: number, px: number, py: number, aim: number, flash: number, muzzle: { x: number; y: number }, occ: Circle[]) {
    this.t += dt / DAY_LEN;
    this.calcSun();
    const { day, ang, len, warm } = this.sun;

    // тени от солнца у деревьев и камней
    const shA = SHADOW_ALPHA * day;
    const k = Phaser.Math.Clamp(len * SHADOW, 0.3, 2.6);
    // наклон (сдвиг) картинки: ширина остаётся горизонтальной, а высота дерева ложится вдоль тени.
    // Матрица [[1, vx], [0, vy]] раскладывается на поворот · растяжение · поворот (SVD) — это контейнер + картинка.
    const m = shear(ang, k);
    this.shear = m;
    for (const t of this.trees) {
      if (shA <= 0.01) { t.c.setVisible(false); continue; }
      t.c.setVisible(true).setRotation(m.th1).setScale(m.sx, m.sy).setAlpha(shA);
      t.sh.setRotation(m.th2);
    }
    for (const d of this.drops) {
      if (shA <= 0.01) { d.sh.setVisible(false); continue; }
      const off = d.img.displayHeight * d.k * 0.16 * Phaser.Math.Clamp(len, 0.5, 2);
      d.sh.setVisible(true).setAlpha(shA * 0.85).setPosition(d.img.x + Math.cos(ang) * off, d.img.y + Math.sin(ang) * off);
    }
    for (const c of this.casters) {
      if (shA <= 0.01) { c.c.setVisible(false); continue; }
      const d = c.h * len * SHADOW, k = 1 + d / c.size;
      c.c.setVisible(true).setRotation(ang).setScale(k, 1).setAlpha(shA);
      c.sh.setPosition(d / 2 / k, 0).setRotation(c.img.rotation - ang);
    }

    if (this.fx && this.lmap) this.shaderLight(px, py, aim, flash, muzzle, occ);
    else this.overlayLight(px, py, aim, flash, muzzle, occ);
  }

  /**
   * Подробность теней фонаря: 2 — полутень в три слоя и силуэты вблизи, 1 — один клин и круглые «просветы»,
   * 0 — тени только от неподвижного (деревья, камни, стены). Снижается сама, если кадров мало (см. adapt).
   */
  detail = 2;
  private fpsLow = 0; private fpsHigh = 0;
  /** пул мягких кругов для «вырезания» освещённых предметов из тени одним проходом */
  private dots: Phaser.GameObjects.Image[] = [];
  /** подстройка подробности по времени кадра: долго медленно — проще, долго быстро — подробнее */
  adapt(dtMs: number, max: number) {
    const night = 1 - this.sun.day;
    if (night < 0.3) return;
    if (dtMs > 26) { this.fpsLow += dtMs; this.fpsHigh = 0; } else if (dtMs < 19) { this.fpsHigh += dtMs; this.fpsLow = 0; }
    if (this.fpsLow > 2500 && this.detail > 0) { this.detail--; this.fpsLow = 0; }
    if (this.fpsHigh > 8000 && this.detail < max) { this.detail++; this.fpsHigh = 0; }
    if (this.detail > max) this.detail = max;
  }

  /** тени от фонаря: клин за каждым кругом (в маленькой текстуре — края мягкие); сами предметы из тени вырезаны */
  private shadowMask(lx: number, ly: number, px: number, py: number, ox: number, oy: number, occ: Circle[], aim: number) {
    const g = this.occl.clear().setScale(1 / SH);
    const far = this.CONE + 60;
    // 1) только то, что в свету: в пятне вокруг героя или в луче фонаря
    type O = Circle & { d: number; th: number };
    let list: O[] = [];
    for (const o of occ) {
      if (this.detail === 0 && o.move) continue;
      const dx = o.x - px, dy = o.y - py;
      if (o.poly) {
        const d = Math.min(...o.poly.map((q) => Math.hypot(q.x - px, q.y - py)));
        if (d > far || Math.hypot(dx, dy) < 4) continue;
        list.push({ ...o, d, th: Math.atan2(dy, dx) });
        continue;
      }
      const d = Math.hypot(dx, dy);
      if (d <= o.r + 2 || d - o.r > far) continue;
      const th = Math.atan2(dy, dx);
      if (d - o.r > this.R * 0.9 && Math.abs(Phaser.Math.Angle.Wrap(th - aim)) > 0.5 + Math.asin(Math.min(1, o.r / d))) continue;
      list.push({ ...o, d, th });
    }
    // 2) монстры вплотную друг к другу — одна общая тень (круг, охватывающий обоих)
    const mov = list.filter((o) => o.move && !o.poly), rest = list.filter((o) => !o.move || o.poly);
    for (let i = 0; i < mov.length; i++) {
      const a = mov[i];
      for (let j = i + 1; j < mov.length; j++) {
        const b = mov[j], dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (dd > a.r + b.r + 5) continue;
        // охватывающий круг
        const R = (dd + a.r + b.r) / 2, t = dd > 0.01 ? (R - a.r) / dd : 0;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const objs = [...(a.objs ?? (a.obj ? [a.obj] : [])), ...(b.objs ?? (b.obj ? [b.obj] : []))];
        mov[i] = { ...a, x, y, r: Math.max(R, a.r, b.r), objs, obj: undefined, d: Math.hypot(x - px, y - py), th: Math.atan2(y - py, x - px) };
        mov.splice(j, 1);
        j = i; // круг вырос — проверяем остальных заново
      }
    }
    list = rest.concat(mov);
    const layers = this.detail >= 2 ? ([[0.06, 0.3], [0.03, 0.45], [0, 1]] as const) : ([[0.02, 1]] as const);
    for (const o of list) {
      if (o.poly) {
        // стена: клин от двух крайних (по углу от света) углов
        let lo = Infinity, hi = -Infinity, cl = { x: 0, y: 0 }, ch = { x: 0, y: 0 };
        for (const c of o.poly) {
          const a = Phaser.Math.Angle.Wrap(Math.atan2(c.y - py, c.x - px) - o.th);
          if (a < lo) { lo = a; cl = c; }
          if (a > hi) { hi = a; ch = c; }
        }
        const A = o.th + lo, B = o.th + hi, F = far * 1.5;
        g.fillStyle(0xffffff, 1).fillPoints([
          { x: cl.x - ox, y: cl.y - oy }, { x: lx + Math.cos(A) * F, y: ly + Math.sin(A) * F },
          { x: lx + Math.cos(o.th) * F, y: ly + Math.sin(o.th) * F },
          { x: lx + Math.cos(B) * F, y: ly + Math.sin(B) * F }, { x: ch.x - ox, y: ch.y - oy },
        ], true);
        continue;
      }
      const { d, th } = o, dx = o.x - px, dy = o.y - py;
      const al0 = Math.asin(Math.min(1, o.r / d)), tl = Math.sqrt(Math.max(0, d * d - o.r * o.r));
      // полутень: ядро и два более широких слоя послабее
      for (const [wid, alpha] of layers) {
        const al = Math.max(0.01, al0 - 0.02 + wid);
        const a1 = th - al, a2 = th + al;
        g.fillStyle(0xffffff, alpha);
        g.fillPoints([
          { x: lx + Math.cos(a1) * tl, y: ly + Math.sin(a1) * tl },
          { x: lx + Math.cos(a1) * far * 1.4, y: ly + Math.sin(a1) * far * 1.4 },
          { x: lx + Math.cos(th) * far * 1.5, y: ly + Math.sin(th) * far * 1.5 },
          { x: lx + Math.cos(a2) * far * 1.4, y: ly + Math.sin(a2) * far * 1.4 },
          { x: lx + Math.cos(a2) * tl, y: ly + Math.sin(a2) * tl },
          { x: lx + dx, y: ly + dy },
        ], true);
      }
    }
    const S = this.shad.clear().draw(g);
    // все освещённые предметы стираются из тени одним проходом (раньше — по проходу на предмет:
    // на телефоне каждый проход RenderTexture — это очистка и копия на весь экран, ночью FPS падал в разы)
    S.beginDraw();
    // предмет сам освещён: вырезаем его из тени. Вблизи (и при полной подробности) — точный силуэт,
    // остальное — мягкий круг; круги вырезаются все разом одним проходом
    const dots: Phaser.GameObjects.Image[] = [];
    const dot = (x: number, y: number, r: number) => {
      const im = this.dots[dots.length] ?? (this.dots[dots.length] = this.scene.make.image({ key: "lt_lamp" }, false));
      dots.push(im.setPosition((x - ox) / SH, (y - oy) / SH).setDisplaySize((r * 2.1) / SH, (r * 2.1) / SH));
    };
    for (const o of list) {
      if (o.poly) continue;
      const objs = o.objs ?? (o.obj ? [o.obj] : []);
      for (const ob of objs) {
        const exact = this.detail >= 2 && (!o.move || o.d < 260);
        if (!exact) { dot(ob.x, ob.y - (o.move ? 8 : 0), o.move ? 11 : o.r); continue; }
        const hv = o.hide?.visible;
        if (o.hide) o.hide.visible = false;
        const sx = ob.scaleX, sy = ob.scaleY;
        // силуэт чуть меньше настоящего: размытый край уходит внутрь предмета, а не светится ореолом вокруг
        const w = ob instanceof Phaser.GameObjects.Image ? ob.displayWidth : 30;
        const shrink = Math.max(0.6, 1 - (SH * 2.4) / Math.max(20, w));
        ob.setScale((sx * shrink) / SH, (sy * shrink) / SH);
        S.batchDraw(ob, (ob.x - ox) / SH, (ob.y - oy) / SH);
        ob.setScale(sx, sy);
        if (o.hide) o.hide.visible = !!hv;
      }
    }
    for (const d of dots) S.batchDraw(d);
    S.endDraw(true);
    return S;
  }

  /** WebGL: цветная карта света → шейдер умножает на неё картинку */
  /** чистое сложение света (ONE, ONE): встроенный ADD в Phaser — (ONE, DST_ALPHA), он гасит уже нарисованное */
  private plus = -1;
  private shaderLight(px: number, py: number, aim: number, flash: number, muzzle: { x: number; y: number }, occ: Circle[]) {
    const { day, warm } = this.sun, night = 1 - day;
    // карта света должна совпадать с видимой частью мира. При повороте телефона / входе в полный экран
    // размер окна и зум камеры меняются в разных обработчиках, и карта могла остаться от старого зума —
    // тогда свет «съезжал» от героя. Сверяем каждый кадр и пересоздаём при расхождении.
    const cam = this.scene.cameras.main;
    const ls = this.ls, needW = Math.ceil(this.scene.scale.width / cam.zoom / ls), needH = Math.ceil(this.scene.scale.height / cam.zoom / ls);
    if (!this.lmap || Math.abs(this.lmap.width - needW) > 2 || Math.abs(this.lmap.height - needH) > 2 || this.light.width < needW || this.light.height < needH) this.makeRT();
    const v = cam.worldView, M = this.lmap!;
    const ox = v.x, oy = v.y;
    const r = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (this.plus < 0) this.plus = r.addBlendMode([r.gl.ONE, r.gl.ONE], r.gl.FUNC_ADD);
    const PLUS = this.plus;
    // окружающий свет: день — нейтральный (0.5 = без изменений), закат — тёплый, ночь — тёмно-синяя луна
    const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
    let amb = mix([20, 26, 50], [128, 128, 128], day);
    amb = mix(amb, [150, 112, 86], warm * 0.75);
    M.clear().fill(Phaser.Display.Color.GetColor(amb[0], amb[1], amb[2]), 1);
    const lx = px - ox, ly = py - oy, k = Math.max(night, 0);
    const lit = this.extra.filter((e) => !(e.a < 0.01 || e.x + e.r < ox || e.y + e.r < oy || e.x - e.r > ox + M.width * ls || e.y - e.r > oy + M.height * ls));
    const glow = night > 0.1 ? this.emissive : [];
    // Весь свет кадра — одним проходом в каждую текстуру. Раньше каждый источник был отдельным draw у RenderTexture,
    // а это в Phaser целый проход (свой буфер, очистка и копия на весь экран): на телефоне ночью FPS падал в разы.
    if (k > 0.02 || lit.length || flash > 0) {
      const mask = k > 0.02 && this.shadows ? this.shadowMask(lx, ly, px, py, ox, oy, occ, aim) : null;
      const L = this.light.clear();
      L.beginDraw();
      if (k > 0.02) {
        L.batchDraw(this.lampImg.setPosition(lx, ly).setDisplaySize(this.R * 2, this.R * 2).setTint(0xe08a3c).setAlpha(this.LAMP * k * 0.45).setBlendMode(PLUS));
        L.batchDraw(this.coneImg.setPosition(lx, ly).setRotation(aim).setDisplaySize(this.CONE, this.CONE).setTint(0xfff2dc).setAlpha(this.BEAM * k).setBlendMode(PLUS));
        // тени от фонаря стираем только из его света (костры и фонари ниже — без теней)
        if (mask) { const b = mask.blendMode; mask.setBlendMode(Phaser.BlendModes.ERASE); L.batchDraw(mask, 0, 0); mask.setBlendMode(b); }
      }
      for (const e of lit) L.batchDraw(this.lampImg.setPosition(e.x - ox, e.y - oy).setDisplaySize(e.r * 2, e.r * 2).setTint(e.col).setAlpha(Math.min(1, e.a) * this.EXTRA).setBlendMode(PLUS));
      // вспышка выстрела — тёплая, у дула
      if (flash > 0) L.batchDraw(this.flashImg.setPosition(muzzle.x - ox, muzzle.y - oy).setDisplaySize(this.R * 1.6, this.R * 1.6).setTint(0xffb050).setAlpha(flash * (0.25 + 0.5 * night) * this.EXTRA).setBlendMode(PLUS));
      r.setBlendMode(PLUS);
      L.endDraw();
      M.beginDraw();
      M.batchDraw(this.light.setBlendMode(PLUS), 0, 0);
    } else if (glow.length) M.beginDraw();
    // светящееся само (глаза, трассеры, прицел) рисуется в карту света
    for (const e of glow) { const b = e.blendMode; M.batchDraw(e.setBlendMode(PLUS), -ox, -oy); e.setBlendMode(b); }
    if ((M.texture as Phaser.Textures.DynamicTexture).isDrawing) { r.setBlendMode(PLUS); M.endDraw(); }
    this.fx!.night = night;
    this.fx!.lightTex = (M.texture.source[0] as unknown as { glTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper }).glTexture;
  }

  /** без WebGL: старый способ — тёмный слой с дырами света */
  private overlayLight(px: number, py: number, aim: number, flash: number, muzzle: { x: number; y: number }, occ: Circle[]) {
    const { day, warm } = this.sun;
    const cam = this.scene.cameras.main, v = cam.worldView;
    const ox = Math.floor(v.x - 32), oy = Math.floor(v.y - 32);
    const night = 1 - day;
    this.tint.setPosition(ox, oy).setSize(this.dark.width, this.dark.height).setFillStyle(0xff6a20, warm * 0.16);
    this.glow.setPosition(px, py - 8).setDisplaySize(this.R * 1.7, this.R * 1.7).setAlpha(night * 0.45);
    this.flashGlow.setPosition(muzzle.x, muzzle.y).setDisplaySize(this.R * 1.1, this.R * 1.1).setAlpha(flash * (0.05 + night * 0.1));
    if (night < 0.02 && flash <= 0) { this.dark.setVisible(false); return; }
    this.dark.setVisible(true).setPosition(ox, oy);

    // 1) свет: пятно вокруг героя + луч фонаря + вспышка выстрела
    const L = this.light;
    L.clear();
    const lx = px - ox, ly = py - oy;
    // пятно вокруг героя — приглушённое (тёплый оттенок даёт glow), луч фонаря — полный
    L.draw(this.lampImg.setPosition(lx, ly).setDisplaySize(this.R * 2, this.R * 2).setAlpha(this.LAMP));
    L.draw(this.coneImg.setPosition(lx, ly).setRotation(aim).setDisplaySize(this.CONE, this.CONE).setAlpha(1));
    // 2) тени: клин за каждым кругом, вырезаем из света
    if (this.shadows) L.erase(this.shadowMask(lx, ly, px, py, ox, oy, occ, aim));
    // сами предметы и враги освещены со стороны фонаря: рисуем их силуэт светом нужной яркости
    for (const o of occ) {
      if (!o.obj) continue;
      const I = this.intensity(o.x - px, o.y - py, aim);
      if (I < 0.03) continue;
      const a0 = o.obj.alpha, hv = o.hide?.visible;
      if (o.hide) o.hide.visible = false;
      o.obj.setAlpha(I);
      L.draw(o.obj, o.obj.x - ox, o.obj.y - oy);
      o.obj.setAlpha(a0);
      if (o.hide) o.hide.visible = !!hv;
    }
    for (const e of this.extra) if (e.a > 0.01) L.draw(this.lampImg.setPosition(e.x - ox, e.y - oy).setDisplaySize(e.r * 2, e.r * 2).setAlpha(Math.min(1, e.a)));
    // вспышка выстрела освещает всё вокруг на миг (без теней — она короткая)
    if (flash > 0) L.draw(this.flashImg.setPosition(muzzle.x - ox, muzzle.y - oy).setDisplaySize(this.R * 1.8, this.R * 1.8).setAlpha(flash * 0.6));

    // 3) тьма: заливка ночным цветом, свет вырезает в ней дыру
    const D = this.dark;
    D.clear();
    const col = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x3a1a30), Phaser.Display.Color.ValueToColor(0x040818), 100, Math.round(100 * smooth(0.2, 0.9, night)));
    D.fill(Phaser.Display.Color.GetColor(col.r, col.g, col.b), 0.9 * night);
    D.erase(L);
  }

  /** яркость света фонаря в точке (dx, dy от героя): пятно вокруг + луч */
  intensity(dx: number, dy: number, aim: number) {
    const d = Math.hypot(dx, dy);
    const lamp = Phaser.Math.Clamp(1 - (d / this.R) ** 2, 0, 1) * this.LAMP;
    const da = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - aim));
    const cone = d < this.CONE ? (1 - (d / this.CONE) ** 1.6) * smooth(0.44, 0.3, da) : 0;
    return Math.max(lamp, cone);
  }

  /** доля темноты 0..1 */
  get night() { return 1 - this.sun.day; }
  /** время суток текстом */
  label() {
    const t = this.sun.t;
    return tr(t < 0.06 || t > 0.95 ? "dawn" : t < 0.44 ? "day" : t < 0.56 ? "dusk" : "night");
  }
}

/** нижний край нарисованной картинки (доля высоты): последний ряд, где заметно много непрозрачных пикселей */
const BASE = new Map<string, number | null>();
function artBase(img: Phaser.GameObjects.Image): number | null {
  const key = img.texture.key;
  if (!/^(ob|bd|hs)_/.test(key)) return null;
  if (BASE.has(key)) return BASE.get(key)!;
  let res: number | null = null;
  try {
    const src = img.texture.getSourceImage() as HTMLImageElement, w = src.width, h = src.height;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d")!; c.drawImage(src, 0, 0);
    const d = c.getImageData(0, 0, w, h).data;
    for (let y = h - 1; y >= 0 && res === null; y--) {
      let n = 0;
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 140) n++;
      if (n > w * 0.04) res = (y + 1) / h;
    }
  } catch { res = null; }
  BASE.set(key, res);
  return res;
}
