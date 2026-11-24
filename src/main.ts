// MyZombika — прототип бродилки-стрелялки с видом сверху.
// Герой и зомби — псевдо-3D из срезов (sprite stacking, см. heroStack.ts), графика окружения — из LLM Survival.
// Управление: WASD/стрелки — ходьба, мышь — прицел, ЛКМ — стрельба, R — перезарядка, 1–4/колесо — оружие, Q — аптечка, I/Tab — снаряжение.
// Тачскрин: левая половина экрана — стик ходьбы, правая — стик прицела (тянешь — стреляет).
import Phaser from "phaser";
import { sfx, setSound, toggleMute, unlockAudio } from "./sfx";
import { t, type Key } from "./i18n";
import { settings, openMenu, closeMenu } from "./menu";
import { buildHouse, hull, type House, type WallBox } from "./house";
import { NET, host as netHost, join as netJoin, send, leave as netLeave, drop as netDrop } from "./net";
import { Lighting, SHADOW, SHADOW_ALPHA, type Circle } from "./light";
import { ARM_V, ARM_Z, PAL_HERO, PAL_ZOMBIE_A, PAL_ZOMBIE_B, armorVox, grenadeVox, medkitVox, heroBody, heroHead, renderStack, torsoOf, setPalette, type Palette } from "./heroStack";

const W = 3000, H = 3000; // размер мира, px
const VOX = 1.0, K = 3, DZ = 0.8, FRAMES = 64; // воксель = 1 px мира; атлас 64 поворота
const lift = (z: number) => -z * DZ * VOX;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const SPRITES = import.meta.glob("./sprites/*.png", { eager: true, query: "?inline", import: "default" }) as Record<string, string>;
/** ?wave=5 — начать с пятой волны (для проверки) */
/** ?time=night / ?time=0.7 — время суток на старте (0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — полночь) */
const TQ = new URLSearchParams(location.search).get("time");
const START_T = TQ === "night" ? 0.7 : TQ === "day" ? 0.2 : TQ === "evening" ? 0.45 : TQ !== null && !isNaN(Number(TQ)) ? Number(TQ) : 0.3;
const START_WAVE = Math.max(1, Number(new URLSearchParams(location.search).get("wave")) || 1);

// ───────── оружие ─────────
// Таблица оружия — данные, а не код: в будущем «сюжете» оружие и улучшения находятся по пути (S.owned, поля таблицы).
export type WeaponId = "rifle" | "shotgun" | "pistol" | "grenade";
export interface WeaponDef {
  id: WeaponId; name: string; short: string;
  /** магазин, выстрелов в секунду (пауза между), перезарядка, с */
  mag: number; rate: number; reload: number;
  /** дробин за выстрел, разброс (рад), дальность (время жизни пули, с), урон дробины, отброс */
  pellets: number; spread: number; life: number; dmg: number; kb: number;
  sound: "shot" | "shotgun" | "pistol"; shake: number;
}
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: { id: "rifle", name: "Автомат", short: "Автомат", mag: 30, rate: 0.1, reload: 1.3, pellets: 1, spread: 0.06, life: 0.6, dmg: 1, kb: 90, sound: "shot", shake: 0.0004 },
  shotgun: { id: "shotgun", name: "Дробовик", short: "Дробовик", mag: 6, rate: 0.8, reload: 2.0, pellets: 8, spread: 0.34, life: 0.22, dmg: 1, kb: 55, sound: "shotgun", shake: 0.0022 },
  pistol: { id: "pistol", name: "Пистолет", short: "Пистолет", mag: 12, rate: 0.25, reload: 0.9, pellets: 1, spread: 0.03, life: 0.5, dmg: 1.5, kb: 110, sound: "pistol", shake: 0.0005 },
  grenade: { id: "grenade", name: "Гранаты", short: "Гранаты", mag: 0, rate: 0.8, reload: 0, pellets: 0, spread: 0, life: 0, dmg: 0, kb: 0, sound: "shot", shake: 0 },
};
/** название оружия на текущем языке */
export const wname = (id: WeaponId) => t(`w_${id}` as Key);
/** ячейки 1–4 */
export const SLOTS: WeaponId[] = ["rifle", "shotgun", "pistol", "grenade"];
const MAX_MED = 5, MAX_GREN = 9, MED_HEAL = 35, ARMOR_ABSORB = 0.6;
const fullClips = () => ({ rifle: WEAPONS.rifle.mag, shotgun: WEAPONS.shotgun.mag, pistol: WEAPONS.pistol.mag, grenade: 0 }) as Record<WeaponId, number>;
/** горячая точка на экране (кнопки HUD и снаряжения), x/y/w/h — в пикселях экрана */
interface Hit { x: number; y: number; w: number; h: number; fn: () => void }

// ───────── общее состояние для HUD ─────────
interface Stick { id: number; ox: number; oy: number; x: number; y: number }
export const S = (window as any).S = {
  hp: 100, maxHp: 100, grenades: 1, reload: 0, wave: 0, kills: 0, score: 0, over: false,
  /** оружие: выбранная ячейка (0..3), патроны в магазинах, какое оружие есть (в «волнах» — всё) */
  weapon: 0, clip: fullClips(), owned: [true, true, true, true],
  armor: 0, medkits: 0, inv: false, hits: [] as Hit[],
  /** открыт главный экран */
  menu: false,
  msg: "", msgT: 0, daytime: "", net: "", chatOpen: false, chat: [] as { who: string; text: string; t: number; me: boolean }[], myName: "Player 1", paused: false, touch: false, move: null as Stick | null, aim: null as Stick | null,
};

// ───────── стопки срезов ─────────
const origins: Record<string, { x: number; y: number }> = {};
/** слоёв ног у обрубка (ползущий зомби) */
const CUT = 5;
function makeStack(scene: Phaser.Scene, key: string, pal: Palette, part: "body" | "head" | "torso") {
  if (scene.textures.exists(key)) return;
  setPalette(pal);
  const m = part === "body" ? heroBody() : part === "torso" ? torsoOf(heroBody(), CUT) : heroHead(true);
  const A = renderStack(m, { frames: FRAMES, k: K, dz: DZ, smooth: true, zTop: part === "torso" ? 32 - CUT : 32, w: part === "head" ? 21 : 31 });
  const t = scene.textures.addCanvas(key, A.canvas)!;
  for (let f = 0; f < FRAMES; f++) t.add(f, 0, (f % A.cols) * A.fw, Math.floor(f / A.cols) * A.fh, A.fw, A.fh);
  origins[key] = { x: A.ox / A.fw, y: A.oy / A.fh };
}
/** предмет из срезов (крутится на месте): кадры поворотов, как у героя */
function makeItem(scene: Phaser.Scene, key: string, m: ReturnType<typeof grenadeVox>, w: number, dz: number) {
  if (scene.textures.exists(key)) return;
  const A = renderStack(m, { frames: FRAMES, k: K, dz, smooth: true, zTop: m.z0 + m.z, w });
  const t = scene.textures.addCanvas(key, A.canvas)!;
  for (let f = 0; f < FRAMES; f++) t.add(f, 0, (f % A.cols) * A.fw, Math.floor(f / A.cols) * A.fh, A.fw, A.fh);
  origins[key] = { x: A.ox / A.fw, y: A.oy / A.fh };
}
/** напарник: тот же герой, но тёмные волосы и синяя одежда */
const recolor = (c: number, r: number, g: number, b: number) =>
  (Math.min(255, Math.round(((c >> 16) & 255) * r)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * g)) << 8) | Math.min(255, Math.round((c & 255) * b));
const PAL_MATE: Palette = {
  ...PAL_HERO,
  HAIR: PAL_HERO.HAIR.map((c) => recolor(c, 0.35, 0.3, 0.3)), BEARD: PAL_HERO.BEARD.map((c) => recolor(c, 0.35, 0.3, 0.3)),
  FUR: PAL_HERO.FUR.map((c) => recolor(c, 0.5, 0.75, 1.6)), FUR_DARK: PAL_HERO.FUR_DARK.map((c) => recolor(c, 0.5, 0.75, 1.6)),
};
/** в бронежилете: безрукавка становится оливковым жилетом с тёмными ремнями */
const withVest = (p: Palette): Palette => ({ ...p, FUR: [0x56613a, 0x4a5530, 0x3f482b], LACE: 0x22221c, BRASS: 0x8a8a70 });
/** метатель: раздутый, желтушная кожа, лиловое тряпьё */
const PAL_ZOMBIE_C: Palette = {
  ...PAL_ZOMBIE_A,
  SKIN: 0xb0b25a, SKIN_SH: 0x8a8c40, FUR: [0x6a4a6e, 0x5a3e5e, 0x4a3250], FUR_DARK: [0x3e2a40, 0x342236, 0x4a3046], LACE: 0x8a2a24, EYE: 0xffd030, EYE_WHITE: 0xff8020,
};
const frameOf = (a: number) => ((Math.round((a / TAU) * FRAMES) % FRAMES) + FRAMES) % FRAMES;

/** Человечек из срезов: тень, ступни, руки, тело, голова (+ оружие у героя). */
class Humanoid {
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  head: Phaser.GameObjects.Image;
  back: Phaser.GameObjects.Graphics; // руки/оружие за телом
  front: Phaser.GameObjects.Graphics; // руки/оружие перед телом
  feet: Phaser.GameObjects.Ellipse[];
  /** руки на месте (0 — левая, 1 — правая); оторванная — культя у плеча */
  armsOn = [true, true];
  /** отдача: 1 — сразу после выстрела, быстро спадает до 0 (автомат и руки дёргаются назад и вверх) */
  recoil = 0;
  /** длинная тень: перевёрнутый чёрный силуэт (тело, голова, руки), наклонённый как у деревьев */
  cast: Phaser.GameObjects.Container;
  castIn: Phaser.GameObjects.Container;
  sBody: Phaser.GameObjects.Image;
  sHead: Phaser.GameObjects.Image;
  sArms: Phaser.GameObjects.Graphics;
  /** мягкое пятно под ногами */
  contact: Phaser.GameObjects.Image;
  /** что в руках (у людей) */
  weapon: WeaponId = "rifle";
  armored = false;
  /** ползёт без ног: тело опущено на CUT слоёв */
  crawl = false;
  constructor(scene: Phaser.Scene, x: number, y: number, public skin: string, public pal: Palette, public gun: boolean) {
    const bk = `${skin}_body`, hk = `${skin}_head`;
    // тень под ногами — мягкая, того же вида, что и длинная (одна тень, а не две разные)
    const shadow = (this.contact = scene.add.image(0, 2, "lt_cast").setDisplaySize(22, 11).setAlpha(0.25));
    // силуэт для тени — не в сцене, рисуется в общую текстуру теней (без двойного затемнения на стыках)
    this.sBody = scene.make.image({ key: bk, frame: 0 }, false).setOrigin(origins[bk].x, 1 - origins[bk].y).setScale(VOX / K).setFlipY(true).setTintFill(0x000000);
    this.sHead = scene.make.image({ key: hk, frame: 0 }, false).setOrigin(origins[hk].x, 1 - origins[hk].y).setScale(VOX / K).setFlipY(true).setTintFill(0x000000);
    this.sArms = scene.make.graphics({}, false).setScale(1, -1);
    this.castIn = scene.make.container({}, false).add([this.sArms, this.sBody, this.sHead]);
    this.cast = scene.make.container({}, false).add(this.castIn);
    this.feet = [-1, 1].map(() => scene.add.ellipse(0, 0, 7, 5, 0x4a3020).setStrokeStyle(1, 0x22160c));
    this.back = scene.add.graphics();
    this.body = scene.add.image(0, 0, bk, 0).setOrigin(origins[bk].x, origins[bk].y).setScale(VOX / K);
    this.front = scene.add.graphics();
    this.head = scene.add.image(0, 0, hk, 0).setOrigin(origins[hk].x, origins[hk].y).setScale(VOX / K);
    this.c = scene.add.container(x, y, [shadow, ...this.feet, this.back, this.body, this.front, this.head]);
  }
  /** a — куда смотрит тело/голова, ma — куда идёт, ph — фаза шага, moving — идёт ли; muzzle — вспышка. */
  pose(a: number, ma: number, ph: number, moving: number, muzzle = false, sway = 0) {
    this.body.setFrame(frameOf(a + sway * 0.12));
    this.head.setFrame(frameOf(a - sway * 0.2));
    this.sBody.setFrame(this.body.frame.name);
    this.sHead.setFrame(this.head.frame.name);
    this.sHead.visible = this.head.visible;
    const sg = this.sArms.clear().lineStyle(5, 0x000000).fillStyle(0x000000);
    // ступни: попеременно вперёд-назад по ходу
    const fa = moving > 0.05 ? ma : a;
    this.feet.forEach((f, i) => {
      const side = i ? 1 : -1, st = Math.sin(ph) * 5.5 * side * moving;
      f.setPosition(Math.cos(fa) * st - Math.sin(fa) * side * 4.5, Math.sin(fa) * st + Math.cos(fa) * side * 4.5 + 1).setRotation(fa);
    });
    const drop = this.crawl ? CUT : 0;
    const P = (u: number, v: number, z: number) => ({ x: u * Math.cos(a) - v * Math.sin(a), y: u * Math.sin(a) + v * Math.cos(a) + lift(z - drop) });
    this.back.clear();
    this.front.clear();
    const skin = this.pal.SKIN;
    const arm = (side: number, hu: number, hv: number, hz: number) => {
      const s = P(0.3, side * ARM_V * VOX, ARM_Z), h = P(hu, hv, hz);
      const g = s.y < lift(ARM_Z - drop) - 0.5 ? this.back : this.front; // дальнее плечо — за телом
      if (!this.armsOn[side > 0 ? 1 : 0]) {
        g.fillStyle(0x2e1410).fillCircle(s.x, s.y, 3.2).fillStyle(0x8a1a14).fillCircle(s.x, s.y, 2.2);
        return;
      }
      sg.lineBetween(s.x, s.y, h.x, h.y).fillCircle(h.x, h.y, 2.9);
      g.lineStyle(5.2, 0x2e2014).lineBetween(s.x, s.y, h.x, h.y);
      g.lineStyle(3.4, skin).lineBetween(s.x, s.y, h.x, h.y);
      g.fillStyle(0x2e2014).fillCircle(h.x, h.y, 2.9).fillStyle(skin).fillCircle(h.x, h.y, 2.1);
    };
    if (this.gun && this.weapon === "grenade") {
      // граната: правая рука занесена с гранатой, левая вытянута вперёд; бросок — рука уходит вперёд
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const rk = this.recoil;
      arm(-1, 12, -3, 9.5);
      arm(1, 4 + 14 * rk, 6 - 4 * rk, 14 - 4 * rk);
      if (rk < 0.3) {
        const n = P(4 + 14 * rk, 6.5, 15.2);
        g.fillStyle(0x1e2410).fillCircle(n.x, n.y, 3.4).fillStyle(0x5e6e2c).fillCircle(n.x, n.y, 2.5).fillStyle(0x9a9a92).fillRect(n.x - 1, n.y - 4.5, 2, 2);
        sg.fillCircle(n.x, n.y, 3);
      }
    } else if (this.gun && this.weapon === "pistol") {
      // пистолет: обе руки вытянуты вперёд, кисти вместе; отдача — ствол задирается
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const rk = this.recoil * this.recoil * (3 - 2 * this.recoil);
      const Pg = (u: number, v: number, z: number) => P(u - 2.5 * rk, v, z + 2.2 * rk * ((u - 12) / 8));
      const b0 = Pg(12, 0.6, 9.6), b1 = Pg(20, 0.6, 9.8);
      arm(1, 13 - 2.5 * rk, 1.8, 9.2);
      arm(-1, 13.5 - 2.5 * rk, -0.6, 9.2);
      g.lineStyle(4.6, 0x111111).lineBetween(b0.x, b0.y, b1.x, b1.y);
      g.lineStyle(2.4, 0x5a5e66).lineBetween(b0.x, b0.y, b1.x, b1.y);
      const hg = Pg(13.5, 0.6, 8.4);
      g.fillStyle(0x2a2420).fillCircle(hg.x, hg.y, 1.8); // рукоять
      sg.lineBetween(b0.x, b0.y, b1.x, b1.y);
      if (muzzle) {
        const f = Pg(23, 0.6, 9.8);
        g.fillStyle(0xffd060, 0.9).fillCircle(f.x, f.y, 4).fillStyle(0xffffff, 0.95).fillCircle(f.x, f.y, 2);
      }
    } else if (this.gun && this.weapon === "shotgun") {
      // дробовик: длинный толстый ствол, деревянный приклад и цевьё
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const rk = this.recoil * this.recoil * (3 - 2 * this.recoil);
      const Pg = (u: number, v: number, z: number) => P(u - 6 * rk, v, z + 2 * rk * (u / 28));
      const s0 = Pg(0, 2, 8), s1 = Pg(9, 2, 8.6), b0 = Pg(8, 1.6, 9), b1 = Pg(29, 1, 9.2);
      g.lineStyle(7, 0x1a120a).lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(5, 0x7a4a22).lineBetween(s0.x, s0.y, s1.x, s1.y); // приклад
      g.lineStyle(6, 0x111111).lineBetween(b0.x, b0.y, b1.x, b1.y);
      g.lineStyle(3.4, 0x3c4046).lineBetween(b0.x, b0.y, b1.x, b1.y); // ствол
      const f0 = Pg(15, 1.3, 8.6), f1 = Pg(21, 1.2, 8.7);
      g.lineStyle(6.4, 0x1a120a).lineBetween(f0.x, f0.y, f1.x, f1.y);
      g.lineStyle(4.4, 0x8a5428).lineBetween(f0.x, f0.y, f1.x, f1.y); // цевьё
      sg.lineBetween(s0.x, s0.y, s1.x, s1.y).lineBetween(b0.x, b0.y, b1.x, b1.y);
      if (muzzle) {
        const f = Pg(33, 1, 9.2);
        g.fillStyle(0xffb040, 0.9).fillCircle(f.x, f.y, 7.5).fillStyle(0xffe080, 0.95).fillCircle(f.x, f.y, 4).fillStyle(0xffffff).fillCircle(f.x, f.y, 2);
      }
      arm(1, 8 - 6 * rk, 2.6, 8.4 + 0.3 * rk);
      arm(-1, 18 - 6 * rk, 1.2, 8.8 + 1 * rk);
    } else if (this.gun) {
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      // отдача: оружие уходит назад и чуть задирается, кисти — вместе с ним
      const rk = this.recoil * this.recoil * (3 - 2 * this.recoil);
      const Pg = (u: number, v: number, z: number) => P(u - 4.5 * rk, v, z + 1.2 * rk * (u / 26));
      const s0 = Pg(1, 2, 8.2), s1 = Pg(8, 2, 8.6), b0 = Pg(7, 1.6, 9), b1 = Pg(26, 1, 9);
      g.lineStyle(6, 0x1a120a).lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(4, 0x6a4424).lineBetween(s0.x, s0.y, s1.x, s1.y); // приклад
      g.lineStyle(5, 0x111111).lineBetween(b0.x, b0.y, b1.x, b1.y);
      g.lineStyle(2.6, 0x4a4e54).lineBetween(b0.x, b0.y, b1.x, b1.y); // ствол
      sg.lineBetween(s0.x, s0.y, s1.x, s1.y).lineBetween(b0.x, b0.y, b1.x, b1.y);
      const m = Pg(12, 2.6, 8.2);
      g.fillStyle(0x222222).fillRect(m.x - 1.5, m.y - 1.5, 3, 3); // магазин
      if (muzzle) {
        const f = Pg(30, 1, 9);
        g.fillStyle(0xffd060, 0.9).fillCircle(f.x, f.y, 5).fillStyle(0xffffff, 0.95).fillCircle(f.x, f.y, 2.5);
      }
      arm(1, 7 - 4.5 * rk, 2.6, 8.2 + 0.3 * rk);
      arm(-1, 17 - 4.5 * rk, 1.2, 9 + 0.8 * rk);
    } else if (this.crawl) {
      // ползёт: руки по очереди тянутся вперёд и подтягивают обрубок
      const k = Math.sin(ph * 0.6);
      arm(-1, 13 + k * 6, -7, CUT + 1.5 + Math.max(0, k) * 2);
      arm(1, 13 - k * 6, 7, CUT + 1.5 + Math.max(0, -k) * 2);
    } else if (this.recoil > 0) {
      // замах: правая рука с куском над головой уходит вперёд
      const r = this.recoil;
      arm(-1, 13, -5, 10);
      arm(1, 2 + 16 * (1 - r), 6, 16 - 5 * (1 - r));
    } else {
      // зомби: руки вытянуты вперёд, слегка болтаются
      arm(-1, 15 + Math.sin(ph) * 1.5, -5 + sway * 2, 10);
      arm(1, 15 - Math.sin(ph) * 1.5, 5 + sway * 2, 10);
    }
  }
  flash(on: boolean) {
    for (const im of [this.body, this.head]) on ? im.setTintFill(0xffffff) : im.clearTint();
  }
  /** надеть/снять бронежилет (другая стопка тела) */
  /** ноги оторваны: тело-обрубок на земле, голова ниже, ступней нет */
  setCrawl() {
    if (this.crawl) return;
    const key = `${this.skin}T_body`;
    if (!this.body.scene.textures.exists(key)) return;
    this.crawl = true;
    const f = this.body.frame.name;
    this.body.setTexture(key, f).setOrigin(origins[key].x, origins[key].y);
    this.sBody.setTexture(key, f).setOrigin(origins[key].x, 1 - origins[key].y);
    const dy = -lift(CUT);
    this.head.setY(dy); this.sHead.setY(-dy);
    for (const ft of this.feet) ft.setVisible(false);
    this.contact.setDisplaySize(30, 14);
  }
  setArmor(on: boolean) {
    if (on === this.armored) return;
    const key = on ? `${this.skin}A_body` : `${this.skin}_body`;
    if (!this.body.scene.textures.exists(key)) return;
    this.armored = on;
    const f = this.body.frame.name;
    this.body.setTexture(key, f);
  }
}

// ───────── враги ─────────
type Kind = "zombie" | "runner" | "rat" | "hyena" | "panther" | "bear" | "spitter";
const KINDS: Record<Kind, { hp: number; speed: number; r: number; dmg: number; score: number; sprite?: string; size?: number; mass: number; blood: number }> = {
  zombie: { hp: 4, speed: 50, r: 11, dmg: 12, score: 10, mass: 1, blood: 0x5a7a2a },
  runner: { hp: 3, speed: 92, r: 11, dmg: 10, score: 15, mass: 1, blood: 0x5a7a2a },
  rat: { hp: 1, speed: 125, r: 7, dmg: 5, score: 5, sprite: "rodent", size: 34, mass: 0.5, blood: 0x8a1010 },
  hyena: { hp: 3, speed: 150, r: 11, dmg: 8, score: 15, sprite: "scavenger", size: 58, mass: 1, blood: 0x8a1010 },
  panther: { hp: 5, speed: 185, r: 12, dmg: 12, score: 25, sprite: "shadowcat", size: 66, mass: 1.2, blood: 0x6a0c0c },
  bear: { hp: 30, speed: 62, r: 28, dmg: 30, score: 100, sprite: "giant", size: 120, mass: 6, blood: 0x6a0c0c },
  /** метатель: медленный, держится поодаль и кидается кусками своего тела */
  spitter: { hp: 8, speed: 34, r: 12, dmg: 10, score: 30, mass: 1.5, blood: 0x7a1010 },
};
interface Enemy {
  kind: Kind; x: number; y: number; kx: number; ky: number; hp: number; a: number; ph: number; cool: number; hitT: number;
  hum?: Humanoid; img?: Phaser.GameObjects.Image; c: Phaser.GameObjects.Container; dead: boolean;
  /** через сколько секунд подать голос */
  voice: number;
  cast: Phaser.GameObjects.Image | Phaser.GameObjects.Container;
  id: number;
  /** у гостя: куда двигать (из снимка хозяина) */
  tx: number; ty: number;
  /** откуда плавно идём к (tx, ty) и сколько пройдено (0..1) */
  fx?: number; fy?: number; iu?: number;
  /** текущее направление хода (плавно поворачивается к нужному) */
  hx: number; hy: number;
  /** метатель: через сколько бросок */
  throwT?: number;
  /** проверка «застрял»: где был и сколько ждать до проверки */
  sx: number; sy: number; st: number; side: number; sideT: number;
}
/** шанс выпадения: [граната, аптечка, бронежилет] */
const DROP: Record<Kind, [number, number, number]> = { zombie: [0.07, 0.06, 0.025], runner: [0.09, 0.07, 0.035], rat: [0.03, 0.05, 0], hyena: [0.1, 0.08, 0.05], panther: [0.15, 0.1, 0.1], bear: [0.8, 0.8, 0.6], spitter: [0.12, 0.1, 0.06] };
type ItemKind = "grenade" | "medkit" | "armor";
const ITEM_KINDS: ItemKind[] = ["grenade", "medkit", "armor"];
interface Item { id: number; kind: ItemKind; x: number; y: number; z: number; vz: number; t: number; life: number; img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image }
interface Nade { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; spin: number; img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image }
/** высота для длины тени, px */
const HEIGHT: Record<Kind, number> = { zombie: 30, runner: 30, rat: 6, hyena: 14, panther: 16, bear: 36, spitter: 30 };
/** отлетевший кусок: летит по дуге (z — высота), подпрыгивает, остаётся лежать и тает */
interface Gib {
  o: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Ellipse; x: number; y: number; z: number; vx: number; vy: number; vz: number; vr: number;
  life: number; rest: boolean; blood: number | null; casing: boolean; trail: number;
}
const MEAT = [0x6a1a14, 0x8a2a20, 0x4a0e0a, 0xa0443a];
const VOICE: Record<Kind, "groan" | "growl" | "squeak" | "roar"> = { zombie: "groan", runner: "groan", rat: "squeak", hyena: "growl", panther: "growl", bear: "roar", spitter: "groan" };
interface Ob { x: number; y: number; r: number; img: Phaser.GameObjects.Image; canopy: number; size: number }
/** где у дерева на картинке основание ствола (доля высоты): картинка ставится основанием в точку ствола */
const TREE_BASE: Record<string, number> = { tree_1: 0.87, tree_2: 0.845, tree_3: 0.8, tree_5: 0.84, tree_6: 0.825, pine_1: 0.91, pine_2: 0.88, dead_tree_1: 0.93, dead_tree_2: 0.91 };
interface Bullet { x: number; y: number; dx: number; dy: number; life: number; d: number; bounces: number; dmg: number; kb: number; /** длина трассера */ tr: number; /** только для вида (у гостя): не ранит */ vis?: boolean }
/** пули одного выстрела (дробь — веером) */
function shotBullets(w: WeaponDef, x: number, y: number, as: number[], vis: boolean): Bullet[] {
  return as.map((a) => ({ x, y, dx: Math.cos(a), dy: Math.sin(a), life: w.life * (w.pellets > 1 ? rand(0.85, 1.15) : 1), d: 0, bounces: 0, dmg: w.dmg, kb: w.kb, tr: w.pellets > 1 ? 9 : 16, vis }));
}
/** другой игрок (у хозяина — гости, у гостя — хозяин и остальные) */
interface Mate { id: string; name: string; label: Phaser.GameObjects.Text; hum: Humanoid; x: number; y: number; tx: number; ty: number; fx?: number; fy?: number; iu?: number; gap: number; last: number; aimA: number; moveA: number; ph: number; moving: number; muzzle: number; hp: number; dead: boolean; gren: number; seen: number; w: number; armor: number; med: number }
const KIND_LIST: Kind[] = ["zombie", "runner", "rat", "hyena", "panther", "bear", "spitter"];
/** летящий кусок плоти (от метателя): дуга, за ним капает кровь */
interface Spit { x: number; y: number; z: number; vx: number; vy: number; vz: number; drip: number; img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image; vis: boolean }
const JOIN = new URLSearchParams(location.search).get("join");
let autoJoined = false;
/** роль и код в этой вкладке — чтобы после обновления страницы вернуться в ту же игру */
const SAVE_KEY = "myzombika-net";
const saveNet = (v: { role: "host" | "client"; code: string } | null) => { try { v ? sessionStorage.setItem(SAVE_KEY, JSON.stringify(v)) : sessionStorage.removeItem(SAVE_KEY); } catch { /* нет хранилища */ } };
const loadNet = (): { role: "host" | "client"; code: string } | null => { try { return JSON.parse(sessionStorage.getItem(SAVE_KEY) || "null"); } catch { return null; } };
/** при запуске (и после «Главное меню») — показать главный экран; после обновления страницы в сетевой игре — сразу в игру */
let menuOnStart = !loadNet();
const SITE = "https://myzombika.pion.ltd/";
/** ссылка-приглашение: на сайте — его адрес, из файла на диске — адрес сайта */
const inviteLink = (code: string) => `${location.protocol.startsWith("http") ? location.origin + location.pathname : SITE}?join=${code}`;
/** скопировать текст в буфер обмена (с запасным способом для старых браузеров и file://) */
function copyText(text: string) {
  const old = () => {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* ничего */ }
    ta.remove();
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(old); else old();
}
function copyInvite(what: "code" | "link") {
  if (NET.role !== "host") return;
  copyText(what === "code" ? NET.code : inviteLink(NET.code));
  S.msg = what === "code" ? t("copied_code", { c: NET.code }) : t("copied_link"); S.msgT = 1.8;
}
/** у гостя: где хозяин поставил героя (запоминаем — сцена могла перезапуститься) */
let pendingHi: Record<string, any> | null = null;

class Game extends Phaser.Scene {
  player!: Humanoid;
  px = W / 2; py = H / 2; aimA = 0; moveA = 0; ph = 0; moving = 0;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  enemies: Enemy[] = [];
  obs: Ob[] = [];
  /** дом и его стены (прямоугольники) */
  house?: House;
  walls: WallBox[] = [];
  bullets: Bullet[] = [];
  bg!: Phaser.GameObjects.Graphics;
  aimG!: Phaser.GameObjects.Graphics;
  blood!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** скорость своего героя (для упреждения бросков) */
  pvx = 0; pvy = 0;
  fireT = 0; muzzleT = 0; invul = 0; hurtT = 0; emptyT = 0;
  gibs: Gib[] = [];
  light!: Lighting;
  eyes!: Phaser.GameObjects.Graphics;
  items: Item[] = [];
  nades: Nade[] = [];
  spits: Spit[] = [];
  booms: { x: number; y: number; t: number }[] = [];
  /** вспышки взрывов и свечение предметов (светятся и ночью) */
  boomG!: Phaser.GameObjects.Graphics;
  /** общая текстура длинных теней людей и зверей (рисуется целиком одной прозрачностью, как у деревьев) */
  actSh!: Phaser.GameObjects.RenderTexture;
  wallShG?: Phaser.GameObjects.Graphics;
  splats: Phaser.GameObjects.Ellipse[] = [];
  spawnQ: Kind[] = []; spawnT = 0; waveT = 2;
  mouse = { x: 0, y: 0 };
  mates = new Map<string, Mate>();
  eid = 0; iid = 0; snapT = 0; inT = 0;
  /** промежуток между снимками хозяина (сглаженный), сек — за это время монстр проходит путь между точками */
  snapGap = 0.05; lastSnap = 0;
  /** гость ждёт возвращения хозяина: своих монстров не заводим */
  waitHost = false; waitUntil = 0;
  /** свой герой выбыл (в кооперативе — до следующей волны) */
  dead = false;
  netNades: Phaser.GameObjects.Image[] = [];
  constructor() { super("game"); }

  preload() {
    // картинки встроены прямо в сборку (data URI) — игра открывается двойным кликом по html без сервера
    for (const [path, url] of Object.entries(SPRITES)) this.load.image(path.split("/").pop()!.replace(".png", ""), url);
  }

  create() {
    Object.assign(S, { paused: false, inv: false, hp: 100, armor: 0, medkits: 0, weapon: 0, clip: fullClips(), grenades: 1, reload: 0, wave: START_WAVE - 1, kills: 0, score: 0, over: false, msg: "", msgT: 0, move: null, aim: null });
    this.lastSnap = 0; this.waitHost = false; this.wallShG = undefined;
    this.mates = new Map(); this.dead = false; this.netNades = []; this.items = []; this.nades = []; this.spits = []; this.booms = []; this.flowCell = -1;
    this.enemies = []; this.obs = []; this.bullets = []; this.gibs = []; this.splats = []; this.spawnQ = []; this.waveT = 1.5; this.px = W / 2; this.py = H / 2;
    makeStack(this, "hero_body", PAL_HERO, "body");
    makeStack(this, "hero_head", PAL_HERO, "head");
    makeStack(this, "zA_body", PAL_ZOMBIE_A, "body");
    makeStack(this, "zA_head", PAL_ZOMBIE_A, "head");
    makeStack(this, "zB_body", PAL_ZOMBIE_B, "body");
    makeStack(this, "zB_head", PAL_ZOMBIE_B, "head");
    makeStack(this, "mate_body", PAL_MATE, "body");
    makeStack(this, "mate_head", PAL_MATE, "head");
    makeStack(this, "zC_body", PAL_ZOMBIE_C, "body");
    makeStack(this, "zC_head", PAL_ZOMBIE_C, "head");
    makeStack(this, "zAT_body", PAL_ZOMBIE_A, "torso");
    makeStack(this, "zBT_body", PAL_ZOMBIE_B, "torso");
    makeStack(this, "heroA_body", withVest(PAL_HERO), "body");
    makeStack(this, "mateA_body", withVest(PAL_MATE), "body");
    makeItem(this, "it_armor", armorVox(), 18, 0.6);
    makeItem(this, "it_grenade", grenadeVox(), 16, 0.75);
    makeItem(this, "it_medkit", medkitVox(), 20, 0.55);
    if (!this.textures.exists("dot")) {
      const g = this.make.graphics({}, false).fillStyle(0xffffff).fillCircle(4, 4, 4);
      g.generateTexture("dot", 8, 8);
      g.destroy();
    }
    // куски (белые, красятся tint'ом): ошмёток, оторванная рука, гильза
    if (!this.textures.exists("gib_chunk")) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0x777777).fillRoundedRect(0, 0, 9, 8, 2).fillStyle(0xffffff).fillRoundedRect(1, 1, 7, 5, 2);
      g.generateTexture("gib_chunk", 9, 8);
      g.clear().fillStyle(0x3a3a3a).fillRoundedRect(0, 0, 20, 7, 3.5).fillStyle(0xffffff).fillRoundedRect(1, 1, 18, 5, 2.5)
        .fillStyle(0x9a2a20).fillRect(1, 1, 3, 5); // рваный край
      g.generateTexture("gib_arm", 20, 7);
      g.clear().fillStyle(0x8a6a20).fillRect(0, 0, 5, 3).fillStyle(0xf0c860).fillRect(0, 0, 4, 2);
      g.generateTexture("gib_casing", 5, 3);
      g.destroy();
    }
    this.buildWorld();
    this.bg = this.add.graphics().setDepth(1e6); // пули
    this.aimG = this.add.graphics().setDepth(1e6 + 1); // прицел
    this.blood = this.add.particles(0, 0, "dot", {
      speed: { min: 40, max: 180 }, lifespan: { min: 250, max: 600 }, scale: { start: 0.8, end: 0.2 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(1e6 - 1);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    const fit = () => cam.setZoom(Phaser.Math.Clamp(Math.min(this.scale.width, this.scale.height) / 430, 0.75, 2.3));
    fit();
    cam.centerOn(this.px, this.py);
    this.buildGrid();
    this.buildFlow();
    // свет и тени: тени от деревьев и камней
    this.light = new Lighting(this, START_T);
    for (const o of this.obs) o.canopy ? this.light.addTree(o.img) : this.light.addCaster(o.img, o.r * 0.55);
    this.player = new Humanoid(this, this.px, this.py, "hero", PAL_HERO, true);
    cam.startFollow(this.player.c, true, 0.15, 0.15);
    this.actSh = this.add.renderTexture(0, 0, 8, 8).setOrigin(0).setDepth(-3.55);
    this.eyes = this.add.graphics().setDepth(1e6 + 0.7).setBlendMode(Phaser.BlendModes.ADD);
    this.boomG = this.add.graphics().setDepth(1e6 + 0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.light.emissive = [this.eyes, this.bg, this.aimG, this.boomG];
    this.scale.on("resize", fit);
    this.events.once("shutdown", () => this.scale.off("resize", fit));

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,R,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on("keydown-R", () => this.startReload());
    (["ONE", "TWO", "THREE", "FOUR"] as const).forEach((k, i) => { kb.on(`keydown-${k}`, () => this.selectWeapon(i)); kb.on(`keydown-NUMPAD_${k}`, () => this.selectWeapon(i)); });
    kb.on("keydown-Q", () => this.useMedkit());
    kb.on("keydown-I", () => this.toggleInv());
    kb.on("keydown-TAB", () => this.toggleInv());
    kb.addCapture("TAB");
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => { if (!S.paused && !S.over && dy) this.cycleWeapon(dy > 0 ? 1 : -1); });
    kb.on("keydown-G", () => this.throwNade());
    kb.on("keydown-SPACE", () => S.over && this.restartGame());
    kb.on("keydown-H", () => this.hostGame());
    kb.on("keydown-J", () => this.joinGame());
    kb.on("keydown-C", () => copyInvite("link"));
    kb.on("keydown-ENTER", () => this.openChat());
    kb.on("keydown-T", () => this.openChat());
    kb.on("keydown-ESC", () => this.togglePause());
    kb.on("keydown-P", () => this.togglePause());
    kb.on("keydown-M", () => { settings.mute = toggleMute(); settings.save(); S.msg = settings.mute ? t("sound_off") : t("sound_on"); S.msgT = 1.2; });
    kb.on("keydown", unlockAudio);
    this.input.addPointer(3);
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      unlockAudio();
      if (S.over) { this.time.delayedCall(50, () => this.restartGame()); return; }
      if (S.paused) {
        // на паузе: кнопки кооператива (для тачскрина)
        const w = this.scale.width, h = this.scale.height;
        if (p.y > h * 0.68 && p.y < h * 0.68 + 54 && NET.role !== "client") {
          const left = Math.abs(p.x - (w / 2 - 120)) < 110, right = Math.abs(p.x - (w / 2 + 120)) < 110;
          if (NET.role === "host") { if (left) { copyInvite("code"); return; } if (right) { copyInvite("link"); return; } }
          else { if (left) { this.hostGame(); return; } if (right) { this.joinGame(); return; } }
        }
        // «Главное меню»
        if (p.y > h * 0.68 + 64 && p.y < h * 0.68 + 114 && Math.abs(p.x - w / 2) < 120) { this.toMenu(); return; }
        this.togglePause(); return;
      }
      // кнопки HUD и снаряжения (рисует сцена UI)
      for (const h of S.hits) if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) { S.touch = p.wasTouch; h.fn(); return; }
      // кнопка паузы в правом верхнем углу (для тачскрина)
      if (NET.role === "solo" && p.x > this.scale.width - 64 && p.y < 64) { this.togglePause(); return; }
      // в кооперативе там же — кнопка чата
      if (NET.role !== "solo" && p.x > this.scale.width - 64 && p.y < 64) { this.openChat(); return; }
      // надпись с кодом вверху — копирует ссылку
      if (NET.role === "host" && p.y < 40 && Math.abs(p.x - this.scale.width / 2) < 220) { copyInvite("link"); return; }
      S.touch = p.wasTouch;
      if (!p.wasTouch) { if (p.rightButtonDown()) this.throwNade(); return; }
      // кнопка гранаты над правым стиком
      if (Math.hypot(p.x - (this.scale.width - 110), p.y - (this.scale.height - 235)) < 38) { this.throwNade(); return; }
      const st = { id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
      if (p.x < this.scale.width / 2) { if (!S.move) S.move = st; } else if (!S.aim) S.aim = st;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) { S.touch = false; this.mouse = { x: p.x, y: p.y }; return; }
      for (const st of [S.move, S.aim]) if (st && st.id === p.id) { st.x = p.x; st.y = p.y; }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (S.move?.id === p.id) S.move = null;
      if (S.aim?.id === p.id) S.aim = null;
    };
    this.input.on("pointerup", up);
    this.input.on("pointerupoutside", up);
    // тряска экрана — по настройке
    const shake = cam.shake.bind(cam);
    cam.shake = ((d?: number, i?: number) => (settings.shake ? shake(d, i) : cam)) as typeof cam.shake;
    this.applySettings();
    S.menu = false;
    if (menuOnStart) { menuOnStart = false; this.showMenu(); }
    this.setupNet();
    if (!this.scene.isActive("ui")) this.scene.launch("ui");
  }

  // ───────── главный экран и настройки ─────────
  applySettings() {
    setSound(settings.volume, settings.mute);
    if (NET.role !== "client") S.myName = settings.name || `${t("player")} 1`;
  }
  showMenu() {
    S.menu = true;
    const kb = this.input.keyboard!;
    kb.enabled = false; kb.disableGlobalCapture(); kb.resetKeys();
    const code = JOIN && !autoJoined ? (JOIN.match(/[A-Za-z0-9]{5}/)?.[0] ?? "").toUpperCase() : "";
    autoJoined = true; // ссылку-приглашение предлагаем кнопкой в меню
    openMenu({
      waves: () => this.startPlay(),
      host: () => { this.startPlay(); this.hostGame(); },
      join: (c) => { this.startPlay(); this.joinGame(c); },
      changed: () => this.applySettings(),
    }, code);
  }
  startPlay() {
    closeMenu();
    S.menu = false;
    unlockAudio();
    const kb = this.input.keyboard!;
    kb.enabled = true; kb.enableGlobalCapture(); kb.resetKeys();
  }
  /** из паузы — в главное меню (сетевая игра закрывается) */
  toMenu() {
    if (NET.role !== "solo") { saveNet(null); netLeave(); }
    S.paused = false; S.inv = false;
    this.tweens.resumeAll();
    menuOnStart = true;
    this.scene.restart();
  }

  buildWorld() {
    const ground = this.add.tileSprite(0, 0, W, H, "ground_meadow").setOrigin(0).setTileScale(0.4).setDepth(-10);
    void ground;
    const rnd = new Phaser.Math.RandomDataGenerator(["zombika"]);
    // полуразрушенный дом недалеко от старта
    this.house = buildHouse(this, W / 2 + 110, H / 2 - 250);
    this.walls = this.house.walls;
    const hs = this.house;
    const free = (x: number, y: number, r: number) =>
      Math.hypot(x - W / 2, y - H / 2) > 220 && this.obs.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 40) &&
      !(x > hs.x - r - 50 && x < hs.x + hs.w + r + 50 && y > hs.y - r - 60 && y < hs.y + hs.h + r + 40);
    const place = (key: string, x: number, y: number, size: number, r: number, canopy: number) => {
      const img = this.add.image(x, y, key).setDisplaySize(size, size).setDepth(y);
      // дерево нарисовано «вид сверху-сбоку»: ставим картинку основанием ствола в точку (x, y)
      if (canopy) img.setOrigin(0.5, TREE_BASE[key] ?? 0.85);
      else img.setRotation(rnd.realInRange(0, TAU));
      this.obs.push({ x, y, r, img, canopy, size });
    };
    // край мира — стена из ёлок
    for (let t = 0; t < W; t += 70) {
      for (const [x, y] of [[t, 10], [t, H - 10], [10, t], [W - 10, t]]) place(rnd.pick(["pine_1", "pine_2"]), x + rnd.between(-15, 15), y + rnd.between(-15, 15), rnd.between(110, 140), 26, 50);
    }
    for (let n = 0, tries = 0; n < 140 && tries < 3000; tries++) {
      const x = rnd.between(80, W - 80), y = rnd.between(80, H - 80);
      const kind = rnd.frac();
      if (kind < 0.45) { if (free(x, y, 18)) { const s = rnd.between(110, 150); place(rnd.pick(["tree_1", "tree_2", "tree_3", "tree_5", "tree_6", "pine_1", "pine_2"]), x, y, s, 15, s * 0.42); n++; } }
      else if (kind < 0.85) { const s = rnd.between(55, 110); if (free(x, y, s * 0.38)) { place(rnd.pick(["boulder_1", "boulder_2", "boulder_3"]), x, y, s, s * 0.38, 0); n++; } }
      else if (free(x, y, 14)) { place(rnd.pick(["dead_tree_1", "dead_tree_2"]), x, y, rnd.between(100, 130), 12, 45); n++; }
    }
    // мелочь без столкновений
    for (let i = 0; i < 420; i++) {
      const dx = rnd.between(0, W), dy = rnd.between(0, H);
      if (dx > hs.x - 10 && dx < hs.x + hs.w + 10 && dy > hs.y - 10 && dy < hs.y + hs.h + 10) continue;
      const key = rnd.pick(["grass_1", "grass_2", "grass_1", "flowers_1", "flowers_2", "flowers_3", "bush_red_full", "bush_blue_full", "stone", "stone_2", "grass_2", "flowers_1"]);
      const s = key.startsWith("bush") ? rnd.between(40, 60) : rnd.between(22, 40);
      this.add.image(dx, dy, key).setDisplaySize(s, s).setRotation(key.startsWith("grass") || key.startsWith("bush") ? 0 : rnd.realInRange(0, TAU)).setDepth(-5);
    }
  }

  // ── поиск пути: сетка по миру, от героя волной расходятся расстояния (обход деревьев и камней) ──
  static CELL = 24;
  gn = Math.ceil(W / Game.CELL);
  blocked = new Uint8Array(this.gn * this.gn);
  dist = new Float32Array(this.gn * this.gn);
  flowT = 0;
  flowCell = -1;
  buildGrid() {
    const C = Game.CELL, n = this.gn;
    this.blocked.fill(0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * C, y = (j + 0.5) * C;
      if (x < 40 || y < 40 || x > W - 40 || y > H - 40) this.blocked[j * n + i] = 1;
    }
    // препятствие + запас на тело монстра
    for (const o of this.obs) {
      const R = o.r + 13;
      for (let j = Math.max(0, Math.floor((o.y - R) / C)); j <= Math.min(n - 1, Math.floor((o.y + R) / C)); j++)
        for (let i = Math.max(0, Math.floor((o.x - R) / C)); i <= Math.min(n - 1, Math.floor((o.x + R) / C)); i++)
          if (Math.hypot((i + 0.5) * C - o.x, (j + 0.5) * C - o.y) < R) this.blocked[j * n + i] = 1;
    }
    // стены дома (с тем же запасом)
    for (const w of this.walls) {
      for (let j = Math.max(0, Math.floor((w.y0 - 13) / C)); j <= Math.min(n - 1, Math.floor((w.y1 + 13) / C)); j++)
        for (let i = Math.max(0, Math.floor((w.x0 - 13) / C)); i <= Math.min(n - 1, Math.floor((w.x1 + 13) / C)); i++) {
          const cx = (i + 0.5) * C, cy = (j + 0.5) * C;
          if (Math.hypot(cx - Phaser.Math.Clamp(cx, w.x0, w.x1), cy - Phaser.Math.Clamp(cy, w.y0, w.y1)) < 13) this.blocked[j * n + i] = 1;
        }
    }
  }
  /** Дейкстра от клетки героя (8 соседей, без срезания углов у препятствий) */
  /** живые игроки — цели монстров (свой герой и напарники) */
  targets() {
    const t: { x: number; y: number; mate?: Mate }[] = [];
    if (!this.dead && !S.over) t.push({ x: this.px, y: this.py });
    for (const m of this.mates.values()) if (!m.dead) t.push({ x: m.x, y: m.y, mate: m });
    return t;
  }
  buildFlow() {
    const C = Game.CELL, n = this.gn, D = this.dist, B = this.blocked;
    const T = this.targets();
    if (!T.length) return;
    const src = T.map((p) => Phaser.Math.Clamp(Math.floor(p.y / C), 0, n - 1) * n + Phaser.Math.Clamp(Math.floor(p.x / C), 0, n - 1));
    const key = src.reduce((a, b) => a * 31 + b, 7);
    if (key === this.flowCell) return; // игроки в тех же клетках — расстояния те же
    this.flowCell = key;
    D.fill(Infinity);
    // считаем только окно вокруг игроков (монстры появляются сразу за краем экрана)
    const WIN = 48;
    let i0 = n, i1 = 0, j0 = n, j1 = 0;
    for (const k of src) { const ci = k % n, cj = (k / n) | 0; i0 = Math.min(i0, ci - WIN); i1 = Math.max(i1, ci + WIN); j0 = Math.min(j0, cj - WIN); j1 = Math.max(j1, cj + WIN); }
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(n - 1, i1); j1 = Math.min(n - 1, j1);
    const hk: number[] = [], hv: number[] = [];
    const push = (k: number, v: number) => {
      let i = hk.length; hk.push(k); hv.push(v);
      while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = k; hv[i] = v;
    };
    const pop = () => {
      const k = hk[0], lk = hk.pop()!, lv = hv.pop()!;
      if (hk.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= hk.length) break;
          if (c + 1 < hk.length && hv[c + 1] < hv[c]) c++;
          if (hv[c] >= lv) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = lk; hv[i] = lv;
      }
      return k;
    };
    for (const k of src) { D[k] = 0; push(k, 0); }
    while (hk.length) {
      const v0 = hv[0], k = pop();
      if (v0 > D[k]) continue;
      const i = k % n, j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj;
        if (a < i0 || b < j0 || a > i1 || b > j1) continue;
        const q = b * n + a;
        if (B[q]) continue;
        if (di && dj && (B[j * n + a] || B[b * n + i])) continue;
        const nd = v0 + (di && dj ? 1.414 : 1);
        if (nd < D[q]) { D[q] = nd; push(q, nd); }
      }
    }
  }
  /** путь к герою свободен (ни одно препятствие не перекрывает отрезок с запасом r) */
  clearLine(x: number, y: number, r: number, tx: number, ty: number) {
    const dx = tx - x, dy = ty - y, L2 = dx * dx + dy * dy || 1;
    for (const o of this.obs) {
      const m = o.r + r + 3;
      if (o.x < Math.min(x, tx) - m || o.x > Math.max(x, tx) + m || o.y < Math.min(y, ty) - m || o.y > Math.max(y, ty) + m) continue;
      const t = Phaser.Math.Clamp(((o.x - x) * dx + (o.y - y) * dy) / L2, 0, 1);
      if (Math.hypot(x + dx * t - o.x, y + dy * t - o.y) < m) return false;
    }
    // стены: отрезок против прямоугольника, раздутого на r
    for (const w of this.walls) {
      const m = r + 3;
      let t0 = 0, t1 = 1;
      const ok = ([[-dx, x - (w.x0 - m)], [dx, w.x1 + m - x], [-dy, y - (w.y0 - m)], [dy, w.y1 + m - y]] as const).every(([pp, q]) => {
        if (pp === 0) return q >= 0;
        const tt = q / pp;
        if (pp < 0) t0 = Math.max(t0, tt); else t1 = Math.min(t1, tt);
        return t0 <= t1;
      });
      if (ok && t0 <= t1) return false;
    }
    return true;
  }
  /** куда идти по сетке: точка на 2–3 клетки вперёд по убыванию расстояния */
  pathDir(x: number, y: number) {
    const C = Game.CELL, n = this.gn, D = this.dist, B = this.blocked;
    let i = Phaser.Math.Clamp(Math.floor(x / C), 0, n - 1), j = Phaser.Math.Clamp(Math.floor(y / C), 0, n - 1);
    if (!isFinite(D[j * n + i])) {
      // стоим в «запасной» зоне у препятствия — ближайшая доступная клетка рядом
      let best = Infinity, bi = i, bj = j;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const v = D[b * n + a] + Math.hypot(di, dj);
        if (v < best) { best = v; bi = a; bj = b; }
      }
      if (!isFinite(best)) return null;
      i = bi; j = bj;
    }
    for (let step = 0; step < 3; step++) {
      let best = D[j * n + i], bi = i, bj = j;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n || B[b * n + a]) continue;
        if (di && dj && (B[j * n + a] || B[b * n + i])) continue;
        if (D[b * n + a] < best) { best = D[b * n + a]; bi = a; bj = b; }
      }
      if (bi === i && bj === j) break;
      i = bi; j = bj;
    }
    const tx = (i + 0.5) * C - x, ty = (j + 0.5) * C - y, d = Math.hypot(tx, ty);
    return d < 1 ? null : { x: tx / d, y: ty / d };
  }

  /** вытолкнуть круг из препятствий и за край мира */
  collide(x: number, y: number, r: number) {
    for (const o of this.obs) {
      const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy), m = o.r + r;
      if (d < m && d > 0.01) { x = o.x + (dx / d) * m; y = o.y + (dy / d) * m; }
    }
    for (const w of this.walls) {
      const cx = Phaser.Math.Clamp(x, w.x0, w.x1), cy = Phaser.Math.Clamp(y, w.y0, w.y1);
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 0.01) { x = cx + (dx / d) * r; y = cy + (dy / d) * r; continue; }
      // центр внутри стены: выталкиваем к ближайшему краю
      const e = [x - w.x0, w.x1 - x, y - w.y0, w.y1 - y], k = e.indexOf(Math.min(...e));
      if (k === 0) x = w.x0 - r; else if (k === 1) x = w.x1 + r; else if (k === 2) y = w.y0 - r; else y = w.y1 + r;
    }
    return { x: Phaser.Math.Clamp(x, 40, W - 40), y: Phaser.Math.Clamp(y, 40, H - 40) };
  }

  /** текущее оружие */
  get cur() { return WEAPONS[SLOTS[S.weapon]]; }
  startReload() {
    const w = this.cur;
    if (S.reload > 0 || !w.mag || S.clip[w.id] === w.mag || S.over || this.dead) return;
    S.reload = w.reload;
    sfx("reload");
  }
  selectWeapon(i: number) {
    if (S.over || S.chatOpen || this.dead || i === S.weapon || !S.owned[i]) return;
    S.weapon = i;
    S.reload = 0; // перезарядка прерывается
    this.fireT = Math.max(this.fireT, 0.22);
    this.player.weapon = SLOTS[i];
    this.player.recoil = 0;
    sfx("swap");
    const w = this.cur;
    S.msg = w.id === "grenade" ? t("grenades_n", { n: S.grenades }) : wname(w.id); S.msgT = 0.8;
    if (w.mag && S.clip[w.id] === 0) this.startReload();
  }
  cycleWeapon(d: number) {
    for (let k = 1; k <= SLOTS.length; k++) { const i = (S.weapon + d * k + SLOTS.length * 4) % SLOTS.length; if (S.owned[i]) { this.selectWeapon(i); return; } }
  }
  useMedkit() {
    if (S.over || this.dead || S.chatOpen) return;
    if (S.medkits <= 0) { S.msg = t("no_meds"); S.msgT = 0.8; sfx("empty"); return; }
    if (S.hp >= S.maxHp) { S.msg = t("hp_full"); S.msgT = 0.8; return; }
    S.medkits--;
    // у гостя здоровье считает хозяин — просим его
    if (NET.role === "client") send({ t: "heal" });
    else S.hp = Math.min(S.maxHp, S.hp + MED_HEAL);
    sfx("heal"); S.msg = t("heal", { n: MED_HEAL }); S.msgT = 0.9;
  }
  toggleInv() {
    if (S.over || S.chatOpen || S.paused) return;
    S.inv = !S.inv;
    sfx("swap", 0.6);
    // в одиночной игре мир на время снаряжения стоит
    if (NET.role === "solo") { S.inv ? this.tweens.pauseAll() : this.tweens.resumeAll(); S.inv ? this.blood.pause() : this.blood.resume(); }
  }

  nextWave() {
    S.wave++;
    // в кооперативе выбывшие оживают
    this.revive();
    for (const m of this.mates.values()) if (m.dead) { m.dead = false; m.hp = 50; m.hum.body.clearTint(); m.hum.head.clearTint(); }
    const n = S.wave;
    const q: Kind[] = [];
    for (let i = 0; i < 5 + n * 3; i++) q.push(n >= 2 && i % 3 === 2 ? "runner" : "zombie");
    if (n >= 2) for (let i = 0; i < n * 2; i++) q.push("rat");
    if (n >= 3) for (let i = 0; i < n - 1; i++) q.push("hyena");
    if (n >= 4) for (let i = 0; i < n - 3; i++) q.push("panther");
    if (n >= 5) for (let i = 0; i < Math.floor((n - 3) / 2); i++) q.push("bear");
    if (n >= 3) for (let i = 0; i < Math.floor(n / 2); i++) q.push("spitter");
    Phaser.Utils.Array.Shuffle(q);
    this.spawnQ = q;
    S.msg = t("wave_n", { n });
    S.msgT = 2.2;
    sfx("wave", 0.8);
  }

  spawn(kind: Kind) {
    const K_ = KINDS[kind];
    let x = 0, y = 0;
    for (let t = 0; t < 30; t++) {
      // сразу за краем экрана
      const v = this.cameras.main.worldView, a = Math.random() * TAU, d = Math.hypot(v.width, v.height) / 2 + 40 + Math.random() * 150;
      x = Phaser.Math.Clamp(this.px + Math.cos(a) * d, 60, W - 60);
      y = Phaser.Math.Clamp(this.py + Math.sin(a) * d, 60, H - 60);
      const hs = this.house!;
      const inHouse = x > hs.x - 30 && x < hs.x + hs.w + 30 && y > hs.y - 30 && y < hs.y + hs.h + 30;
      if (!inHouse && Math.hypot(x - this.px, y - this.py) > 300 && this.obs.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + K_.r + 4)) break;
    }
    this.addEnemy(kind, x, y, this.eid++);
  }

  addEnemy(kind: Kind, x: number, y: number, id: number): Enemy {
    const K_ = KINDS[kind];
    const e: Enemy = { id, tx: x, ty: y, kind, x, y, kx: 0, ky: 0, hp: K_.hp, a: 0, ph: Math.random() * TAU, cool: 0, hitT: 0, dead: false, voice: rand(0.5, 4), hx: 0, hy: 0, sx: x, sy: y, st: 0.6, side: 0, sideT: 0 } as Enemy;
    if (K_.sprite) {
      const sh = this.add.image(2, 3, "lt_cast").setDisplaySize(K_.size! * 0.6, K_.size! * 0.42).setAlpha(0.35);
      e.cast = this.make.image({ key: K_.sprite }, false).setDisplaySize(K_.size!, K_.size!).setTintFill(0x000000);
      e.img = this.add.image(0, 0, K_.sprite).setDisplaySize(K_.size!, K_.size!).setTint(0xd8e0c8);
      e.c = this.add.container(x, y, [sh, e.img]);
    } else {
      const [sk, pal] = kind === "zombie" ? ["zA", PAL_ZOMBIE_A] as const : kind === "spitter" ? ["zC", PAL_ZOMBIE_C] as const : ["zB", PAL_ZOMBIE_B] as const;
      e.hum = new Humanoid(this, x, y, sk, pal, false);
      if (kind === "spitter") e.throwT = rand(1.5, 3);
      e.c = e.hum.c;
      e.cast = e.hum.cast;
    }
    this.enemies.push(e);
    if (kind === "bear") sfx("roar", this.near(x, y) + 0.3);
    return e;
  }

  togglePause() {
    if (S.inv) { this.toggleInv(); return; }
    if (S.over || S.chatOpen) return;
    S.paused = !S.paused;
    if (NET.role !== "solo") return; // в кооперативе мир не останавливается
    S.paused ? this.tweens.pauseAll() : this.tweens.resumeAll();
    this.blood.pause();
    if (!S.paused) this.blood.resume();
  }

  /** громкость по расстоянию до героя */
  near(x: number, y: number) { return Phaser.Math.Clamp(1.15 - Math.hypot(x - this.px, y - this.py) / 650, 0, 1); }

  /** кровавое пятно на земле */
  splat(x: number, y: number, col: number, r: number) {
    const e = this.add.ellipse(x, y, r * rand(1.6, 2.4), r * rand(1.1, 1.6), col, rand(0.45, 0.7)).setDepth(-4).setRotation(rand(0, TAU));
    this.splats.push(e);
    if (this.splats.length > 260) this.splats.shift()!.destroy();
  }

  /** отлетающий кусок: из точки (x, y) на высоте z, в направлении a со скоростью spd, вверх vz */
  gib(key: string, tint: number, x: number, y: number, z: number, a: number, spd: number, vz: number, opts: { frame?: number; scale?: number; blood?: number | null; casing?: boolean; life?: number } = {}) {
    const o = this.add.image(x, y - z, key, opts.frame).setTint(tint).setRotation(rand(0, TAU));
    if (opts.scale) o.setScale(opts.scale);
    const sh = this.add.ellipse(x, y, Math.max(4, o.displayWidth * 0.7), Math.max(3, o.displayHeight * 0.45), 0x101808, 0.25).setDepth(-3.5);
    this.gibs.push({ o, sh, x, y, z, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, vz, vr: rand(-14, 14), life: (opts.life ?? rand(9, 13)) * (settings.quality === "low" ? 0.4 : settings.quality === "med" ? 0.7 : 1), rest: false, blood: opts.blood ?? null, casing: !!opts.casing, trail: 0 });
    if (this.gibs.length > (settings.quality === "low" ? 100 : settings.quality === "med" ? 200 : 300)) { const g = this.gibs.shift()!; g.o.destroy(); g.sh.destroy(); }
  }

  /** куски летят от попадания: dir — куда летела пуля */
  chunks(e: Enemy, dir: number, n: number, force: number) {
    const K_ = KINDS[e.kind];
    const cols = e.hum ? [e.hum.pal.SKIN, e.hum.pal.FUR[0], e.hum.pal.FUR_DARK[0], ...MEAT] : [0x7a5a3a, 0x5a3a2a, ...MEAT, ...MEAT];
    for (let i = 0; i < n; i++) {
      const sz = rand(0.6, 1.3) * (e.kind === "bear" ? 1.6 : e.kind === "rat" ? 0.6 : 1);
      this.gib("gib_chunk", Phaser.Utils.Array.GetRandom(cols), e.x, e.y, rand(6, 14), dir + rand(-0.9, 0.9), rand(40, 140) * force, rand(80, 230) * force, { scale: sz, blood: K_.blood });
    }
  }

  /** оторвать руку зомби */
  tearArm(e: Enemy, side: number, dir: number, force = 1) {
    const h = e.hum!;
    if (!h.armsOn[side]) return;
    h.armsOn[side] = false;
    const v = (side ? 1 : -1) * ARM_V;
    const sx = e.x + Math.cos(e.a) * 0.3 - Math.sin(e.a) * v, sy = e.y + Math.sin(e.a) * 0.3 + Math.cos(e.a) * v;
    this.gib("gib_arm", h.pal.SKIN, sx, sy, -lift(ARM_Z), dir + rand(-0.7, 0.7), rand(90, 170) * force, rand(140, 240), { blood: KINDS[e.kind].blood });
    this.blood.setParticleTint(KINDS[e.kind].blood);
    this.blood.explode(8, sx, sy + lift(ARM_Z));
    sfx("splat", this.near(e.x, e.y));
  }

  /** свет, тени героя и врагов, горящие в темноте глаза */
  updateLight(dt: number) {
    const L = this.light, gunZ = lift(9);
    const ca = Math.cos(this.aimA), sa = Math.sin(this.aimA);
    const occ: Circle[] = [];
    const reach = L.CONE + 80;
    for (const o of this.obs) if (Math.abs(o.x - this.px) < reach + o.r && Math.abs(o.y - this.py) < reach + o.r) occ.push({ x: o.x, y: o.y, r: o.r, obj: o.img });
    for (const e of this.enemies) if (!e.dead) occ.push({ x: e.x, y: e.y, r: KINDS[e.kind].r * 0.8, obj: e.c });
    for (const m of this.mates.values()) occ.push({ x: m.x, y: m.y, r: 9, obj: m.hum.c });
    // стены дома для фонаря — цепочки кругов
    for (const w of this.walls) {
      if (w.x1 < this.px - reach || w.x0 > this.px + reach || w.y1 < this.py - reach || w.y0 > this.py + reach) continue;
      const len = Math.max(w.x1 - w.x0, w.y1 - w.y0), n = Math.max(1, Math.round(len / 7));
      for (let i = 0; i <= n; i++) occ.push({ x: w.x0 + ((w.x1 - w.x0) * i) / n, y: w.y0 + ((w.y1 - w.y0) * i) / n, r: 4.5 });
    }
    const alive = !S.over;
    // время суток из настроек (у гостя — как у хозяина)
    if (NET.role !== "client" && settings.daynight !== "cycle") L.t = Math.floor(L.t) + (settings.daynight === "day" ? 0.25 : 0.72);
    L.shadows = settings.quality !== "low";
    L.update(dt, this.px, this.py, this.aimA, alive && this.muzzleT > 0 ? 1 : 0, { x: this.px + ca * 30, y: this.py + sa * 30 + gunZ }, alive ? occ : []);
    S.daytime = L.label();
    const sun = L.sun, night = L.night;
    // длинные тени людей и зверей — чёткие силуэты по той же проекции, что у деревьев (ночью тени дают лучи фонаря)
    const v = this.cameras.main.worldView;
    let rt = this.actSh;
    const rw = Math.ceil(v.width) + 4, rh = Math.ceil(v.height) + 4;
    if (Math.abs(rt.width - rw) > 2 || Math.abs(rt.height - rh) > 2) {
      rt.destroy(); // resize у RenderTexture не меняет видимый размер — пересоздаём
      rt = this.actSh = this.add.renderTexture(0, 0, rw, rh).setOrigin(0).setDepth(-3.55);
    }
    rt.setPosition(v.x - 2, v.y - 2).clear();
    const ox = v.x - 2, oy = v.y - 2;
    let shA = SHADOW_ALPHA * sun.day;
    const k = Phaser.Math.Clamp(sun.len * SHADOW, 0.3, 2.6), m = L.shear;
    const onView = (x: number, y: number) => x > v.x - 150 && x < v.right + 150 && y > v.y - 150 && y < v.bottom + 150;
    const hum = (h: Humanoid, x: number, y: number, mm = m) => {
      h.cast.setRotation(mm.th1).setScale(mm.sx, mm.sy);
      h.castIn.setRotation(mm.th2);
      rt.batchDraw(h.cast, x - ox, y - oy);
    };
    // от точечного света (вспышка у дула) силуэт ложится лучом прочь от источника
    const humPoint = (h: Humanoid, x: number, y: number, dir: number, len: number) => {
      h.cast.setRotation(dir - Math.PI / 2).setScale(1, len);
      h.castIn.setRotation(0);
      rt.batchDraw(h.cast, x - ox, y - oy);
    };
    // вспышка выстрела ночью: тень героя падает назад, от дула (днём солнце сильнее вспышки)
    const flashSh = alive && this.muzzleT > 0 && night > 0.4;
    rt.beginDraw(); // все силуэты одним проходом в текстуру
    if (settings.quality === "low") shA = 0; // низкое качество: без длинных теней людей и зверей
    else if (flashSh) {
      shA = 0.25 + night * 0.4;
      humPoint(this.player, this.px, this.py, this.aimA + Math.PI, 1.6 + night);
    } else if (shA > 0.01) {
      if (alive) hum(this.player, this.px, this.py);
      for (const m of this.mates.values()) hum(m.hum, m.x, m.y);
      if (settings.quality === "high") for (const e of this.enemies) {
        if (e.dead || !onView(e.x, e.y)) continue;
        if (e.hum) hum(e.hum, e.x, e.y);
        else {
          // зверь плоский: его же силуэт, сдвинутый по солнцу на высоту
          const d = HEIGHT[e.kind] * k * 0.6, im = e.cast as Phaser.GameObjects.Image;
          im.setRotation(e.img!.rotation);
          rt.batchDraw(im, e.x + Math.cos(sun.ang) * d - ox, e.y + Math.sin(sun.ang) * d - oy);
        }
      }
    }
    rt.endDraw();
    // тени стен дома от солнца: прямоугольник + он же, сдвинутый по солнцу на высоту стены
    if (settings.quality !== "low" && !flashSh && SHADOW_ALPHA * sun.day > 0.01 && this.walls.length) {
      const g = (this.wallShG ??= this.make.graphics({}, false)).clear().fillStyle(0x000000);
      for (const w of this.walls) {
        if (!onView((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2)) continue;
        const d = w.h * sun.len * SHADOW, sx = Math.cos(sun.ang) * d, sy = Math.sin(sun.ang) * d;
        const pts = [{ x: w.x0, y: w.y0 }, { x: w.x1, y: w.y0 }, { x: w.x1, y: w.y1 }, { x: w.x0, y: w.y1 }];
        g.fillPoints(hull([...pts, ...pts.map((q) => ({ x: q.x + sx, y: q.y + sy }))]).map((q) => ({ x: q.x - ox, y: q.y - oy })), true);
      }
      rt.draw(g);
    }
    rt.setAlpha(shA).setVisible(shA > 0.01);
    // пятно под ногами: ночью заметнее (днём есть длинная тень)
    const ct = 0.14 + 0.16 * night;
    this.player.contact.setAlpha(ct);
    for (const m of this.mates.values()) m.hum.contact.setAlpha(ct);
    for (const e of this.enemies) if (e.hum) e.hum.contact.setAlpha(ct);
    const g = this.eyes.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (night < 0.15) continue;
      // глаза светятся в темноте
      const c = Math.cos(e.a), s = Math.sin(e.a);
      const eye = (u: number, v: number, z: number, col: number, r: number) => {
        const x = e.x + u * c - v * s, y = e.y + u * s + v * c + lift(z);
        g.fillStyle(col, 0.25 * night).fillCircle(x, y, r * 2.6).fillStyle(col, 0.9 * night).fillCircle(x, y, r);
      };
      if (e.hum) { if (e.hum.head.visible) { eye(5.2, -2.2, 21, 0xff2a10, 1.1); eye(5.2, 2.2, 21, 0xff2a10, 1.1); } }
      else {
        const k = KINDS[e.kind].size! * 0.36, w = KINDS[e.kind].size! * 0.07, col = e.kind === "rat" ? 0xff4030 : 0xffd040;
        eye(k, -w, 0, col, e.kind === "bear" ? 1.8 : 1.1); eye(k, w, 0, col, e.kind === "bear" ? 1.8 : 1.1);
      }
    }
  }

  updateGibs(dt: number) {
    for (const g of this.gibs) {
      if (!g.rest) {
        g.vz -= 720 * dt;
        g.z += g.vz * dt; g.x += g.vx * dt; g.y += g.vy * dt;
        g.o.rotation += g.vr * dt;
        // летящий кусок роняет капли
        g.trail -= dt;
        if (g.blood !== null && g.trail <= 0 && g.z > 2) { g.trail = 0.06; this.splat(g.x, g.y, g.blood, rand(1.2, 2.2)); }
        if (g.x < 20 || g.x > W - 20) g.vx *= -0.5;
        if (g.y < 20 || g.y > H - 20) g.vy *= -0.5;
        if (g.z <= 0) {
          g.z = 0;
          if (g.vz < -80) {
            // отскок
            g.vz *= -0.32; g.vx *= 0.5; g.vy *= 0.5; g.vr *= 0.5;
            if (g.blood !== null) this.splat(g.x, g.y, g.blood, rand(3, 6));
            sfx(g.casing ? "casing" : "splat", this.near(g.x, g.y) * (g.casing ? 0.8 : 0.6));
          } else {
            g.rest = true;
            g.o.setDepth(-3);
          }
        }
        if (!g.rest) g.o.setDepth(g.y + 2);
        g.o.setPosition(g.x, g.y - g.z);
        g.sh.setPosition(g.x, g.y).setAlpha(0.25 * Math.max(0.2, 1 - g.z / 80));
      }
      g.life -= dt;
      if (g.life < 1.5) { g.o.setAlpha(Math.max(0, g.life / 1.5)); g.sh.setAlpha(Math.max(0, g.life / 6)); }
    }
    this.gibs = this.gibs.filter((g) => {
      if (g.life > 0) return true;
      g.o.destroy(); g.sh.destroy();
      return false;
    });
  }

  /** fxOnly — у гостя: здоровье считает хозяин, здесь только тряска и звук */
  hurtPlayer(dmg: number, fxOnly = false) {
    if (S.over || this.dead) return;
    if (!fxOnly) { const ab = Math.min(S.armor, Math.round(dmg * ARMOR_ABSORB)); S.armor -= ab; S.hp -= dmg - ab; }
    this.invul = 0.3; this.hurtT = 0.12;
    this.cameras.main.shake(100, 0.0025);
    this.cameras.main.flash(90, 140, 0, 0);
    sfx("hurt");
    if (!fxOnly && S.hp <= 0) this.die();
  }

  die() {
    S.hp = 0;
    this.player.flash(false);
    this.player.body.setTint(0x777777); this.player.head.setTint(0x777777);
    this.player.back.clear(); this.player.front.clear();
    this.aimG.clear();
    if (NET.role === "solo") { S.over = true; sfx("over"); return; }
    // в кооперативе — выбыл до следующей волны, игра идёт, пока жив хоть кто-то
    this.dead = true;
    sfx("hurt");
    S.msg = t("you_died"); S.msgT = 3;
    this.checkAllDead();
  }

  revive() {
    if (!this.dead) return;
    this.dead = false;
    S.hp = Math.max(S.hp, 50);
    this.player.body.clearTint(); this.player.head.clearTint();
    S.msg = t("revived"); S.msgT = 2;
  }

  /** хозяин: все выбыли — конец игры */
  checkAllDead() {
    if (NET.role === "client" || S.over) return;
    if (!this.dead) return;
    for (const m of this.mates.values()) if (!m.dead) return;
    S.over = true;
    sfx("over");
  }

  hurtMate(m: Mate, dmg: number) {
    if (m.dead) return;
    const ab = Math.min(m.armor, Math.round(dmg * ARMOR_ABSORB));
    m.armor -= ab; m.hp -= dmg - ab;
    send({ t: "hurt", dmg }, m.id);
    if (m.hp <= 0) { m.hp = 0; m.dead = true; m.hum.body.setTint(0x777777); m.hum.head.setTint(0x777777); m.hum.back.clear(); m.hum.front.clear(); this.checkAllDead(); }
  }

  /** ранение монстра без смерти: ошмётки, иногда отрывает руку; хозяин рассылает гостям */
  hitFx(e: Enemy, dir: number, n: number, force: number, arm: number, legs = false) {
    this.chunks(e, dir, n, force);
    if (arm >= 0 && e.hum) this.tearArm(e, arm, dir, force > 1 ? 1.5 : 1);
    if (legs && e.hum && !e.hum.crawl) this.makeCrawler(e, dir);
    if (NET.role === "host") send({ t: "hit", id: e.id, dir, n, f: force, arm, legs: legs ? 1 : 0 });
  }

  // ───────── предметы и гранаты ─────────
  dropItem(kind: ItemKind, x: number, y: number, id = this.iid++) {
    const key = `it_${kind}`;
    const img = this.add.image(x, y, key, 0).setOrigin(origins[key].x, origins[key].y).setScale(0.6);
    const sh = this.add.image(x, y + 1, "lt_cast").setDisplaySize(kind === "grenade" ? 13 : 22, kind === "grenade" ? 8 : 11).setAlpha(0.35).setDepth(-3.5);
    this.items.push({ id, kind, x, y, z: 0, vz: 200, t: Math.random() * 5, life: 30, img, sh });
  }

  updateItems(dt: number) {
    for (const it of this.items) {
      it.life -= dt; it.t += dt;
      if (it.z > 0 || it.vz !== 0) {
        it.vz -= 600 * dt; it.z += it.vz * dt;
        if (it.z <= 0) { it.z = 0; it.vz = it.vz < -90 ? -it.vz * 0.3 : 0; }
      }
      // крутится на месте и чуть покачивается над землёй
      const bob = it.vz === 0 ? 2.5 + Math.sin(it.t * 3) * 1.5 : 0;
      it.img.setPosition(it.x, it.y - it.z - bob).setFrame(frameOf(it.t * 1.8)).setDepth(it.y);
      it.img.setVisible(it.life > 5 || Math.sin(it.life * 16) > -0.3); // скоро исчезнет — мигает
      // подбирают: свой герой; у хозяина ещё и гости (им отправляется подарок)
      if (NET.role !== "client" && it.vz === 0 && it.life > 0) for (const m of this.mates.values()) {
        if (m.dead || Math.hypot(it.x - m.x, it.y - m.y) > 24) continue;
        if (it.kind === "medkit" && m.med < MAX_MED) { m.med++; send({ t: "give", k: "medkit" }, m.id); it.life = 0; break; }
        if (it.kind === "grenade" && m.gren < MAX_GREN) { m.gren++; send({ t: "give", k: "grenade" }, m.id); it.life = 0; break; }
        if (it.kind === "armor" && m.armor < 100) { m.armor = Math.min(100, m.armor + 50); send({ t: "give", k: "armor" }, m.id); it.life = 0; break; }
      }
      if (NET.role !== "client" && !S.over && !this.dead && it.life > 0 && Math.hypot(it.x - this.px, it.y - this.py) < 24 && it.vz === 0) {
        if (it.kind === "medkit" && S.medkits < MAX_MED) {
          S.medkits++;
          sfx("pickup"); S.msg = t("got_med"); S.msgT = 0.9; it.life = 0;
        } else if (it.kind === "armor" && S.armor < 100) {
          S.armor = Math.min(100, S.armor + 50);
          sfx("armor"); S.msg = t("got_armor"); S.msgT = 0.9; it.life = 0;
        } else if (it.kind === "grenade" && S.grenades < MAX_GREN) {
          S.grenades++;
          sfx("pickup"); S.msg = t("got_nade"); S.msgT = 0.9; it.life = 0;
        }
      }
      if (it.life <= 0) { it.img.destroy(); it.sh.destroy(); }
    }
    this.items = this.items.filter((it) => it.life > 0);
  }

  throwNade() {
    if (S.over || S.paused || this.dead) return;
    if (S.grenades <= 0) { S.msg = t("no_nades"); S.msgT = 0.8; sfx("empty"); return; }
    S.grenades--;
    this.player.recoil = 1;
    let dist = 230;
    if (!S.touch) { const w = this.cameras.main.getWorldPoint(this.mouse.x, this.mouse.y); dist = Math.hypot(w.x - this.px, w.y - this.py); }
    dist = Phaser.Math.Clamp(dist, 40, 330);
    const T = 0.45 + dist / 900, z0 = 18, a = this.aimA;
    const n = { x: this.px + Math.cos(a) * 8, y: this.py + Math.sin(a) * 8, z: z0, vx: (Math.cos(a) * dist) / T, vy: (Math.sin(a) * dist) / T, vz: (0.5 * 600 * T * T - z0) / T };
    // гость бросает «у хозяина»: полёт и взрыв считает он
    if (NET.role === "client") send({ t: "nade", ...n });
    else this.spawnNade(n.x, n.y, n.z, n.vx, n.vy, n.vz);
    sfx("pin");
  }

  spawnNade(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    const img = this.add.image(x, y, "it_grenade", 0).setOrigin(origins.it_grenade.x, origins.it_grenade.y).setScale(0.45);
    const sh = this.add.image(x, y, "lt_cast").setDisplaySize(10, 6).setAlpha(0.35).setDepth(-3.5);
    this.nades.push({ x, y, z, vx, vy, vz, t: 1.8, spin: Math.atan2(vy, vx), img, sh });
  }

  updateNades(dt: number) {
    for (const n of this.nades) {
      n.t -= dt;
      n.vz -= 600 * dt; n.z += n.vz * dt;
      const nx = n.x + n.vx * dt, ny = n.y + n.vy * dt;
      if (n.z < 24) {
        // отскок от стволов и камней
        const q = this.collide(nx, ny, 3), ox = q.x - nx, oy = q.y - ny, l = Math.hypot(ox, oy);
        if (l > 0.3) {
          const ux = ox / l, uy = oy / l, dot = n.vx * ux + n.vy * uy;
          if (dot < 0) { n.vx -= 1.6 * dot * ux; n.vy -= 1.6 * dot * uy; sfx("bounce", this.near(n.x, n.y)); }
        }
        n.x = q.x; n.y = q.y;
      } else { n.x = nx; n.y = ny; }
      if (n.z <= 0) {
        n.z = 0;
        if (n.vz < -70) { n.vz = -n.vz * 0.35; n.vx *= 0.55; n.vy *= 0.55; sfx("bounce", this.near(n.x, n.y)); }
        else { n.vz = 0; const f = Math.max(0, 1 - 5 * dt); n.vx *= f; n.vy *= f; }
      }
      n.spin += dt * Math.hypot(n.vx, n.vy) * 0.06;
      n.img.setPosition(n.x, n.y - n.z).setFrame(frameOf(n.spin)).setDepth(n.y);
      // перед взрывом мигает красным
      if (n.t < 0.7 && Math.sin(n.t * 40) > 0) n.img.setTintFill(0xff3020); else n.img.clearTint();
      n.sh.setPosition(n.x, n.y + 1).setAlpha(0.35 * Math.max(0.3, 1 - n.z / 80));
      if (n.t <= 0) { this.explode(n.x, n.y); n.img.destroy(); n.sh.destroy(); }
    }
    this.nades = this.nades.filter((n) => n.t > 0);
  }

  /** метатель бросает кусок плоти по дуге в точку (tx, ty); хозяин рассылает бросок гостям */
  throwSpit(id: number, x: number, y: number, tx: number, ty: number) {
    const d = Math.hypot(tx - x, ty - y), T = 0.55 + d / 700, z0 = 16;
    const m = { x, y, z: z0, vx: (tx - x) / T, vy: (ty - y) / T, vz: (0.5 * 600 * T * T - z0) / T };
    if (NET.role === "host") send({ t: "spit", id, ...m });
    this.spawnSpit(m.x, m.y, m.z, m.vx, m.vy, m.vz, false);
    sfx("splat", this.near(x, y) * 0.8);
  }
  spawnSpit(x: number, y: number, z: number, vx: number, vy: number, vz: number, vis: boolean) {
    const img = this.add.image(x, y - z, "gib_chunk").setTint(Phaser.Utils.Array.GetRandom(MEAT)).setScale(1.5).setDepth(1e6 - 2);
    const sh = this.add.image(x, y, "lt_cast").setDisplaySize(12, 7).setAlpha(0.3).setDepth(-3.5);
    this.spits.push({ x, y, z, vx, vy, vz, drip: 0, img, sh, vis });
  }
  updateSpits(dt: number) {
    for (const s of this.spits) {
      s.vz -= 600 * dt; s.z += s.vz * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      s.img.setPosition(s.x, s.y - s.z).setRotation(s.img.rotation + dt * 9);
      s.sh.setPosition(s.x, s.y + 1).setAlpha(0.3 * Math.max(0.3, 1 - s.z / 90));
      // капли крови по пути: падают на землю пятнышками
      s.drip -= dt;
      if (s.drip <= 0) {
        s.drip = 0.035;
        this.blood.setParticleTint(0x8a1010);
        this.blood.emitParticleAt(s.x, s.y - s.z, 1);
        if (Math.random() < 0.55) this.splat(s.x + rand(-3, 3), s.y + rand(-3, 3), 0x7a1010, rand(1, 2.2));
      }
      if (s.z <= 0) {
        // шлепок: лужица, брызги, урон тем, кто рядом (считает хозяин)
        this.blood.setParticleTint(0x8a1010);
        this.blood.explode(14, s.x, s.y - 3);
        for (let i = 0; i < 4; i++) this.splat(s.x + rand(-9, 9), s.y + rand(-6, 6), 0x7a1010, rand(2.5, 5));
        this.gib("gib_chunk", Phaser.Utils.Array.GetRandom(MEAT), s.x, s.y, 2, rand(0, TAU), rand(20, 60), rand(40, 90), { scale: 0.9, blood: 0x7a1010 });
        sfx("splat", this.near(s.x, s.y));
        if (!s.vis && NET.role !== "client") {
          if (!this.dead && Math.hypot(this.px - s.x, this.py - s.y) < 24 && this.invul <= 0) this.hurtPlayer(KINDS.spitter.dmg);
          for (const m of this.mates.values()) if (!m.dead && Math.hypot(m.x - s.x, m.y - s.y) < 24) this.hurtMate(m, KINDS.spitter.dmg);
        }
        s.img.destroy(); s.sh.destroy();
      }
    }
    this.spits = this.spits.filter((s) => s.z > 0);
  }

  /** зомби теряет ноги и дальше ползёт (ноги отлетают с кровью) */
  makeCrawler(e: Enemy, dir: number) {
    const h = e.hum;
    if (!h || h.crawl) return;
    h.setCrawl();
    const K_ = KINDS[e.kind];
    this.blood.setParticleTint(K_.blood);
    this.blood.explode(18, e.x, e.y - 3);
    for (const side of [-1, 1]) {
      const c = h.pal.FUR_DARK[0];
      this.gib("gib_arm", c, e.x - Math.sin(e.a) * side * 4, e.y + Math.cos(e.a) * side * 4, 4, dir + side * rand(0.4, 1.1), rand(90, 170), rand(140, 220), { blood: K_.blood, life: rand(10, 14) });
    }
    for (let i = 0; i < 4; i++) this.splat(e.x + rand(-10, 10), e.y + rand(-8, 8), K_.blood, rand(3, 6));
    sfx("gore", this.near(e.x, e.y));
  }

  explode(x: number, y: number) {
    if (NET.role === "host") send({ t: "boom", x, y });
    sfx("boom", Math.max(0.6, this.near(x, y)));
    this.cameras.main.shake(220, 0.004);
    this.booms.push({ x, y, t: 0 });
    const R = 125;
    // урон считает хозяин (у гостя — только вид)
    if (NET.role !== "client") for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy), K_ = KINDS[e.kind];
      if (d > R + K_.r) continue;
      const f = 1 - Math.min(1, Math.max(0, d - K_.r) / R), a = Math.atan2(dy, dx);
      e.hp -= 1 + 11 * f; e.hitT = 0.1;
      e.kx += (Math.cos(a) * 500 * f) / K_.mass; e.ky += (Math.sin(a) * 500 * f) / K_.mass;
      if (e.hp <= 0) { this.kill(e, a); this.chunks(e, a, 4, 1.6); }
      else this.hitFx(e, a, 2, 1.3, e.hum && Math.random() < 0.6 ? (Math.random() < 0.5 ? 0 : 1) : -1);
    }
    if (NET.role !== "client") {
      const pd = Math.hypot(this.px - x, this.py - y);
      if (pd < 95) this.hurtPlayer(Math.round(5 + 30 * (1 - pd / 95)));
      for (const m of this.mates.values()) { const md = Math.hypot(m.x - x, m.y - y); if (md < 95) this.hurtMate(m, Math.round(5 + 30 * (1 - md / 95))); }
    }
    // искры, земля, воронка
    this.blood.setParticleTint(0xffb040);
    this.blood.explode(40, x, y - 6);
    for (let i = 0; i < 12; i++) this.gib("gib_chunk", Phaser.Utils.Array.GetRandom([0x5a4a30, 0x4a3a24, 0x6a5a3a, 0x3a3020]), x, y, 3, rand(0, TAU), rand(80, 280), rand(160, 340), { scale: rand(0.5, 1.1) });
    const scorch = this.add.ellipse(x, y, 74, 50, 0x16120a, 0.6).setDepth(-4.2);
    this.tweens.add({ targets: scorch, alpha: 0, delay: 12000, duration: 4000, onComplete: () => scorch.destroy() });
  }

  /** вспышки взрывов и свечение предметов ночью */
  drawFx(dt: number) {
    const g = this.boomG.clear();
    for (const b of this.booms) {
      b.t += dt;
      const k = 1 - b.t / 0.55;
      if (k <= 0) continue;
      // мягкое свечение: стопка кругов, к центру ярче
      const R = 50 + 100 * (1 - k);
      for (let i = 0; i < 7; i++) g.fillStyle(0xff7a20, 0.09 * k).fillCircle(b.x, b.y - 8, R * (1 - i / 8));
      for (let i = 0; i < 4; i++) g.fillStyle(0xffd27a, 0.22 * k * k).fillCircle(b.x, b.y - 10, (22 + 30 * (1 - k)) * (1 - i / 5));
    }
    this.booms = this.booms.filter((b) => b.t < 0.55);
    const night = this.light.night;
    if (night > 0.15) for (const it of this.items) {
      const p = 0.75 + Math.sin(it.t * 4) * 0.25;
      for (let i = 0; i < 4; i++) g.fillStyle(it.kind === "medkit" ? 0xff5050 : it.kind === "armor" ? 0x80b0ff : 0x9aff60, 0.045 * night * p).fillCircle(it.x, it.y - 4, 20 * (1 - i / 5));
    }
  }

  kill(e: Enemy, dir: number) {
    if (NET.role === "host") send({ t: "kill", id: e.id, dir });
    e.dead = true;
    S.kills++;
    S.score += KINDS[e.kind].score;
    const vol = this.near(e.x, e.y);
    sfx("gore", vol);
    if (e.kind === "rat") sfx("squeak", vol);
    this.blood.setParticleTint(KINDS[e.kind].blood);
    this.blood.explode(24, e.x, e.y - 6);
    // разлёт: голова, руки, ошмётки
    const big = e.kind === "bear" ? 2.2 : e.kind === "rat" ? 0.5 : 1;
    if (e.hum) {
      const h = e.hum;
      this.gib(h.head.texture.key, 0xffffff, e.x, e.y, 16, dir + rand(-0.5, 0.5), rand(120, 220), rand(220, 340), { frame: Number(h.head.frame.name), scale: VOX / K, blood: KINDS[e.kind].blood, life: rand(12, 16) });
      this.gibs[this.gibs.length - 1].o.setOrigin(0.5, 0.62);
      h.head.setVisible(false);
      for (const side of [0, 1]) if (h.armsOn[side]) this.tearArm(e, side, dir, 1.3);
    }
    this.chunks(e, dir, Math.round((e.hum ? 9 : 7) * Math.sqrt(big)), 1.2);
    for (let i = 0; i < 5; i++) this.splat(e.x + rand(-14, 14) * big, e.y + rand(-10, 10) * big, KINDS[e.kind].blood, rand(3, 7) * big);
    // лужа и останки
    const pool = this.add.ellipse(e.x, e.y, KINDS[e.kind].r * 3, KINDS[e.kind].r * 2, KINDS[e.kind].blood, 0.55).setDepth(-4);
    e.c.setDepth(-3);
    if (e.hum) { e.hum.back.clear(); e.hum.front.clear(); e.hum.flash(false); e.hum.body.setTint(0x6a6a6a); }
    if (e.img) e.img.setTint(0x555555);
    const [pg, pm, pa] = NET.role === "client" ? [0, 0, 0] : DROP[e.kind];
    if (Math.random() < pg) this.dropItem("grenade", e.x - 5, e.y);
    if (Math.random() < pm) this.dropItem("medkit", e.x + 6, e.y + 4);
    if (Math.random() < pa) this.dropItem("armor", e.x, e.y - 7);
    this.tweens.add({ targets: e.c, alpha: 0, scale: 0.85, delay: 6000, duration: 2000, onComplete: () => e.c.destroy() });
    this.tweens.add({ targets: pool, alpha: 0, delay: 8000, duration: 3000, onComplete: () => pool.destroy() });
  }

  update(_t: number, dtMs: number) {
    if ((S.paused || S.inv) && NET.role === "solo") return;
    const dt = Math.min(0.05, dtMs / 1000);
    if (S.menu) {
      // за главным экраном — живой мир: герой стоит, свет меняется
      if (!document.hidden) this.updateLight(dt);
      this.player.pose(this.aimA, this.moveA, 0, 0);
      this.aimG.clear();
      return;
    }
    const cam = this.cameras.main;
    if (S.msgT > 0) S.msgT -= dt;
    // гость ждёт хозяина; не вернулся за 25 с — играем одни
    if (this.waitHost && performance.now() > this.waitUntil) { this.waitHost = false; saveNet(null); netLeave(); NET.status = t("host_gone"); this.scene.restart(); return; }
    this.updateGibs(dt);
    this.updateNades(dt);
    this.updateSpits(dt);
    this.updateItems(dt);
    this.drawFx(dt);
    // скрытая вкладка (кооператив в фоне): свет и тени не нужны, только логика и сеть
    if (!document.hidden) this.updateLight(dt);
    if (S.over) { this.aimG.clear(); this.updateMates(dt); this.netTick(dt); return; }

    // ── ходьба ──
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.A.isDown || k.LEFT.isDown) mx--;
    if (k.D.isDown || k.RIGHT.isDown) mx++;
    if (k.W.isDown || k.UP.isDown) my--;
    if (k.S.isDown || k.DOWN.isDown) my++;
    if (S.move) {
      const dx = S.move.x - S.move.ox, dy = S.move.y - S.move.oy, d = Math.hypot(dx, dy);
      if (d > 8) { const m = Math.min(1, d / 55); mx = (dx / d) * m; my = (dy / d) * m; }
    }
    if (this.dead || S.paused || S.chatOpen) { mx = 0; my = 0; }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const spd = 175;
    const p = this.collide(this.px + mx * spd * dt, this.py + my * spd * dt, 10);
    const went = Math.hypot(p.x - this.px, p.y - this.py);
    this.pvx = (p.x - this.px) / dt; this.pvy = (p.y - this.py) / dt;
    this.px = p.x; this.py = p.y;
    this.moving = Phaser.Math.Linear(this.moving, Math.min(1, went / (spd * dt + 1e-6)), 0.25);
    if (ml > 0.1) this.moveA = Math.atan2(my, mx);
    const ph0 = this.ph;
    this.ph += went * 0.12;
    if (Math.floor(this.ph / Math.PI) !== Math.floor(ph0 / Math.PI)) sfx("step", 0.8);

    // ── прицел ──
    const gunZ = lift(9);
    let firing = false, aimDist = 260;
    if (S.touch) {
      if (S.aim) {
        const dx = S.aim.x - S.aim.ox, dy = S.aim.y - S.aim.oy, d = Math.hypot(dx, dy);
        if (d > 10) { this.aimA = Math.atan2(dy, dx); firing = d > 18; }
      } else if (ml > 0.1) this.aimA = Phaser.Math.Angle.RotateTo(this.aimA, this.moveA, 6 * dt);
    } else {
      const w = cam.getWorldPoint(this.mouse.x, this.mouse.y);
      this.aimA = Math.atan2(w.y - (this.py + gunZ), w.x - this.px);
      aimDist = Math.hypot(w.y - (this.py + gunZ), w.x - this.px);
      firing = this.input.activePointer.leftButtonDown() && !this.input.activePointer.wasTouch;
    }

    if (this.dead || S.paused || S.chatOpen || S.inv) firing = false;
    // ── стрельба ──
    this.player.recoil = Math.max(0, this.player.recoil - dt * 11);
    this.fireT -= dt; this.emptyT -= dt; this.muzzleT -= dt; this.invul -= dt; this.hurtT -= dt;
    const W_ = this.cur;
    this.player.weapon = W_.id;
    if (S.reload > 0) { S.reload -= dt; if (S.reload <= 0) { S.reload = 0; S.clip[W_.id] = W_.mag; } }
    if (W_.id === "grenade") {
      // ячейка 4: огонь — бросок гранаты
      if (firing && this.fireT <= 0) { this.fireT = W_.rate; this.throwNade(); }
    } else {
      if (firing && S.reload > 0 && this.emptyT <= 0) { this.emptyT = 0.35; sfx("empty", 0.7); }
      if (firing && this.fireT <= 0 && S.reload <= 0) {
        if (S.clip[W_.id] <= 0) this.startReload();
        else {
          S.clip[W_.id]--;
          this.fireT = W_.rate;
          this.muzzleT = W_.pellets > 1 ? 0.07 : 0.05;
          this.player.recoil = 1;
          const ca = Math.cos(this.aimA), sa = Math.sin(this.aimA);
          // дробь — веером, одиночная пуля — с небольшим разбросом
          const as: number[] = [];
          for (let i = 0; i < W_.pellets; i++) as.push(Math.round((this.aimA + (W_.pellets > 1 ? ((i + Math.random()) / W_.pellets - 0.5) : Math.random() - 0.5) * W_.spread) * 1000) / 1000);
          // пуля летит от героя (чтобы попадать и в упор), видна от дула; высота добавляется при отрисовке
          const bx = Math.round(this.px + ca * 6), by = Math.round(this.py + sa * 6);
          this.bullets.push(...shotBullets(W_, bx, by, as, NET.role === "client"));
          // гость: пуля у него только для вида, попадания считает хозяин
          if (NET.role === "client") send({ t: "shot", x: bx, y: by, as, w: W_.id });
          else if (NET.role === "host") send({ t: "fx", k: "shot", who: "host", x: bx, y: by, as, w: W_.id });
          cam.shake(W_.pellets > 1 ? 90 : 30, W_.shake);
          sfx(W_.sound);
          // гильза вылетает вправо от ствола (у дробовика — когда передёрнул цевьё)
          const casing = () => this.gib("gib_casing", W_.pellets > 1 ? 0xff6050 : 0xffffff, this.px + ca * 12 - sa * 3, this.py + sa * 12 + ca * 3, 9, this.aimA + Math.PI / 2 + rand(-0.4, 0.4), rand(70, 120), rand(90, 160), { casing: true, life: rand(4, 6), scale: W_.pellets > 1 ? 1.4 : 1 });
          if (W_.pellets > 1) this.time.delayedCall(330, () => { if (!this.dead) { sfx("pump", 0.9); casing(); } });
          else casing();
          if (S.clip[W_.id] === 0) this.time.delayedCall(W_.pellets > 1 ? 500 : 0, () => SLOTS[S.weapon] === W_.id && this.startReload());
        }
      }
    }

    // ── пули ──
    const BS = 1500;
    this.bg.clear();
    for (const b of this.bullets) {
      const step = BS * dt;
      let hit = false;
      // стены дома: пуля застревает в досках
      if (b.d > 0) for (const w of this.walls) if (b.x > w.x0 && b.x < w.x1 && b.y > w.y0 && b.y < w.y1) {
        hit = true;
        sfx("thunk", this.near(b.x, b.y) * 0.8);
        this.blood.setParticleTint(0x7a5432);
        this.blood.explode(4, b.x - b.dx * 3, b.y - b.dy * 3 + gunZ);
        break;
      }
      for (const o of this.obs) if (!hit && b.d > 0 && Math.hypot(b.x - o.x, b.y - o.y) < o.r * 0.9) {
        if (!o.canopy && b.bounces < 2) {
          // камень: рикошет — отражаем от поверхности, с разбросом, пуля теряет скорость жизни
          const nx = (b.x - o.x) / (Math.hypot(b.x - o.x, b.y - o.y) || 1), ny = (b.y - o.y) / (Math.hypot(b.x - o.x, b.y - o.y) || 1);
          const dot = b.dx * nx + b.dy * ny;
          const ra = Math.atan2(b.dy - 2 * dot * ny, b.dx - 2 * dot * nx) + rand(-0.25, 0.25);
          b.dx = Math.cos(ra); b.dy = Math.sin(ra);
          b.x = o.x + nx * (o.r * 0.9 + 1); b.y = o.y + ny * (o.r * 0.9 + 1);
          b.bounces++; b.life = Math.min(b.life, 0.35);
          sfx("ricochet", this.near(b.x, b.y));
          this.blood.setParticleTint(0xffe080);
          this.blood.explode(5, b.x, b.y + gunZ);
          break;
        }
        hit = true;
        sfx(o.canopy ? "thunk" : "ricochet", this.near(b.x, b.y) * 0.8);
        this.blood.setParticleTint(o.canopy ? 0x6a4a2a : 0x9a9a90);
        this.blood.explode(4, b.x - b.dx * 4, b.y - b.dy * 4 + gunZ);
      }
      if (!hit) for (const e of this.enemies) {
        if (e.dead) continue;
        // отрезок пули за кадр против круга врага
        const rx = e.x - b.x, ry = e.y - b.y, t = Phaser.Math.Clamp(rx * b.dx + ry * b.dy, 0, step);
        if (Math.hypot(rx - b.dx * t, ry - b.dy * t) < KINDS[e.kind].r + 3) {
          hit = true;
          if (b.vis) break;
          e.hp -= b.dmg;
          e.hitT = 0.07;
          const kb = b.kb / KINDS[e.kind].mass;
          e.kx += b.dx * kb; e.ky += b.dy * kb;
          this.blood.setParticleTint(KINDS[e.kind].blood);
          this.blood.explode(5, e.x - b.dx * 6, e.y - b.dy * 6 - 8);
          sfx("hit", this.near(e.x, e.y));
          const dir = Math.atan2(b.dy, b.dx);
          if (e.hp <= 0) this.kill(e, dir);
          else {
            // иногда пули перебивают ноги — дальше ползёт
            const legs = (e.kind === "zombie" || e.kind === "runner") && !e.hum!.crawl && e.hp <= KINDS[e.kind].hp * 0.6 && Math.random() < 0.3;
            if (legs) this.makeCrawler(e, dir);
            this.hitFx(e, dir, e.kind === "bear" ? 2 : 1, 0.8, e.hum && Math.random() < 0.3 ? (Math.random() < 0.5 ? 0 : 1) : -1, legs);
          }
          break;
        }
      }
      if (hit) { b.life = 0; continue; }
      b.x += b.dx * step; b.y += b.dy * step; b.life -= dt; b.d += step;
      if (b.d > 36) this.bg.lineStyle(b.tr < 16 ? 1.8 : 2.2, 0xffe080, 0.95).lineBetween(b.x - b.dx * b.tr, b.y - b.dy * b.tr + gunZ, b.x, b.y + gunZ);
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // ── враги ──
    if (this.waitHost) { /* ждём хозяина (см. начало update) */ }
    else if (NET.role === "client") this.clientEnemies(dt);
    else this.hostEnemies(dt, cam);
    this.enemies = this.enemies.filter((e) => !e.dead);

    // ── крыша дома: прозрачная, пока ты внутри ──
    if (this.house) {
      const hs = this.house, inside = this.px > hs.x && this.px < hs.x + hs.w && this.py > hs.y && this.py < hs.y + hs.h + 4;
      hs.roof.setAlpha(Phaser.Math.Linear(hs.roof.alpha, inside ? 0.1 : 1, 0.15));
    }
    // ── кроны деревьев: прозрачные, если под ними кто-то есть ──
    for (const o of this.obs) {
      if (!o.canopy) continue;
      // герой за кроной (выше основания ствола на экране) — крона полупрозрачная
      const under = Math.abs(o.x - this.px) < o.size * 0.42 && this.py < o.y - 4 && this.py > o.y - o.size * 0.85;
      o.img.setAlpha(Phaser.Math.Linear(o.img.alpha, under ? 0.4 : 1, 0.15));
    }

    // ── герой ──
    this.player.c.setPosition(this.px, this.py).setDepth(this.py);
    this.player.setArmor(S.armor > 0);
    if (!this.dead) this.player.pose(this.aimA, this.moveA, this.ph, this.moving, this.muzzleT > 0);
    if (!S.over && !this.dead) this.player.flash(this.hurtT > 0);
    this.updateMates(dt);
    this.netTick(dt);

    // ── линия прицела ──
    const g = this.aimG.clear();
    if (this.dead) return;
    const ca = Math.cos(this.aimA), sa = Math.sin(this.aimA);
    const sx = this.px + ca * 30, sy = this.py + sa * 30 + gunZ;
    let L = Math.max(40, (S.touch ? 260 : aimDist) - 30);
    if (W_.id === "grenade") {
      // куда упадёт граната (бросок не дальше 330)
      const d = Phaser.Math.Clamp(S.touch ? 230 : aimDist, 40, 330);
      L = Math.max(10, d - 30);
      g.lineStyle(1.5, 0x9aff60, 0.6).strokeCircle(this.px + ca * d, this.py + sa * d, 18).lineStyle(1, 0x9aff60, 0.25).strokeCircle(this.px + ca * d, this.py + sa * d, 95);
    }
    if (settings.aim) for (let t = 0; t < L; t += 14) {
      const t2 = Math.min(L, t + 7);
      g.lineStyle(1.6, 0xff4030, 0.55 * (1 - t / (L + 60))).lineBetween(sx + ca * t, sy + sa * t, sx + ca * t2, sy + sa * t2);
    }
    if (!S.touch) {
      const w = cam.getWorldPoint(this.mouse.x, this.mouse.y);
      g.lineStyle(2, 0xffffff, 0.9).strokeCircle(w.x, w.y, 7);
      g.lineBetween(w.x - 12, w.y, w.x - 4, w.y).lineBetween(w.x + 4, w.y, w.x + 12, w.y).lineBetween(w.x, w.y - 12, w.x, w.y - 4).lineBetween(w.x, w.y + 4, w.x, w.y + 12);
    }
  }

  /** хозяин (и одиночная игра): волны, ход монстров, укусы */
  hostEnemies(dt: number, cam: Phaser.Cameras.Scene2D.Camera) {
    void cam;
    if (this.spawnQ.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(this.spawnQ.pop()!); this.spawnT = Math.max(0.15, 0.6 - S.wave * 0.04); }
    } else if (!this.enemies.some((e) => !e.dead)) {
      this.waveT -= dt;
      if (this.waveT <= 0) { this.waveT = 3; this.nextWave(); }
    }
    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.2; this.buildFlow(); }
    const live = this.enemies.filter((e) => !e.dead);
    const T = this.targets();
    for (const e of live) {
      const K_ = KINDS[e.kind];
      // цель — ближайший живой игрок (если все выбыли — бредут к своему месту)
      let tg = T[0] ?? { x: this.px, y: this.py }, best = Infinity;
      for (const p of T) { const q = (p.x - e.x) ** 2 + (p.y - e.y) ** 2; if (q < best) { best = q; tg = p; } }
      const dx = tg.x - e.x, dy = tg.y - e.y, d = Math.hypot(dx, dy) || 1;
      // куда идти: прямо, если путь свободен, иначе по сетке в обход препятствий
      let ux = dx / d, uy = dy / d;
      const direct = this.clearLine(e.x, e.y, K_.r, tg.x, tg.y);
      if (!direct) { const p = this.pathDir(e.x, e.y); if (p) { ux = p.x; uy = p.y; } }
      // зомби шатаются (только на открытом месте, чтобы не тыкаться в стволы)
      if (e.hum && direct) { const w = Math.sin(e.ph * 0.5) * 0.35; const c = Math.cos(w), s = Math.sin(w); [ux, uy] = [ux * c - uy * s, ux * s + uy * c]; }
      // мягкое огибание: у самого препятствия убираем составляющую «в него» и добавляем касательную
      for (const o of this.obs) {
        const ox = e.x - o.x, oy = e.y - o.y, m = o.r + K_.r + 10;
        if (ox > m || ox < -m || oy > m || oy < -m) continue;
        const od = Math.hypot(ox, oy);
        if (od >= m || od < 0.01) continue;
        const nx_ = ox / od, ny_ = oy / od, into = ux * nx_ + uy * ny_;
        if (into < 0) {
          const k = 1 - (od - o.r - K_.r) / 10;
          ux -= nx_ * into * Phaser.Math.Clamp(k, 0, 1); uy -= ny_ * into * Phaser.Math.Clamp(k, 0, 1);
        }
      }
      // застрял надолго — пробуем обойти в сторону
      if (e.sideT > 0) {
        e.sideT -= dt;
        [ux, uy] = [ux * 0.4 - uy * e.side, uy * 0.4 + ux * e.side];
      }
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      // направление поворачивает плавно — без дёрганья на поворотах
      const turn = Math.min(1, dt * (e.hx || e.hy ? 7 : 100));
      e.hx += (ux - e.hx) * turn; e.hy += (uy - e.hy) * turn;
      const hl = Math.hypot(e.hx, e.hy) || 1;
      // ползущий — медленно; метатель на дистанции броска почти стоит
      const throwing = e.kind === "spitter" && d < 300 && d > 110 && direct;
      const spd = K_.speed * (e.hum?.crawl ? 0.4 : 1) * (throwing ? 0.15 : 1);
      let vx = (e.hx / hl) * spd, vy = (e.hy / hl) * spd;
      // не слипаться друг с другом
      for (const o of live) {
        if (o === e) continue;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy), m = K_.r + KINDS[o.kind].r;
        if (od < m && od > 0.01) { vx += (ox / od) * 120 * (1 - od / m) * 3; vy += (oy / od) * 120 * (1 - od / m) * 3; }
      }
      const nx = e.x + (vx + e.kx) * dt, ny = e.y + (vy + e.ky) * dt;
      e.kx *= 0.85; e.ky *= 0.85;
      const q = this.collide(nx, ny, K_.r);
      e.st -= dt;
      if (e.st <= 0) {
        // за 0.6 с прошёл меньше трети положенного (и герой не рядом) — застрял
        if (Math.hypot(e.x - e.sx, e.y - e.sy) < spd * 0.6 * 0.3 && d > K_.r + 30 && !throwing && e.sideT <= 0) { e.side = Math.random() < 0.5 ? 1 : -1; e.sideT = 0.7; }
        e.sx = e.x; e.sy = e.y; e.st = 0.6;
      }
      const moved = Math.hypot(q.x - e.x, q.y - e.y);
      e.x = q.x; e.y = q.y;
      e.ph += moved * (e.hum ? (e.hum.crawl ? 0.3 : 0.12) : 0.25);
      // ползущий оставляет кровавый след
      if (e.hum?.crawl && Math.random() < moved * 0.08) this.splat(e.x - Math.cos(e.a) * 8, e.y - Math.sin(e.a) * 8, K_.blood, rand(2, 3.5));
      // метатель: бросок куском в цель
      if (e.kind === "spitter" && T.length) {
        e.throwT = (e.throwT ?? 2) - dt;
        if (e.hum) e.hum.recoil = Math.max(0, e.hum.recoil - dt * 2.5);
        if (e.throwT <= 0.4 && e.hum && e.hum.recoil === 0 && throwing) e.hum.recoil = 1; // замах
        if (e.throwT <= 0) {
          e.throwT = rand(2.4, 3.4);
          if (throwing) {
            // с упреждением: туда, где цель будет к падению
            const m = tg.mate, tv = m ? { x: (m.tx - (m.fx ?? m.tx)) / m.gap, y: (m.ty - (m.fy ?? m.ty)) / m.gap } : { x: this.pvx, y: this.pvy };
            const Tf = 0.55 + d / 700;
            this.throwSpit(e.id, e.x + Math.cos(e.a) * 6, e.y + Math.sin(e.a) * 6, tg.x + tv.x * Tf * 0.6 + rand(-14, 14), tg.y + tv.y * Tf * 0.6 + rand(-14, 14));
          }
        }
      }
      e.a = Phaser.Math.Angle.RotateTo(e.a, Math.atan2(dy, dx), 8 * dt);
      e.c.setPosition(e.x, e.y).setDepth(e.y);
      e.hitT -= dt;
      if (e.hum) {
        e.hum.pose(e.a, e.a, e.ph, 1, false, Math.sin(e.ph * 0.5));
        e.hum.flash(e.hitT > 0);
      } else if (e.img) {
        // спрайт смотрит вверх — поворачиваем; походка — лёгкое покачивание
        e.img.setRotation(e.a + Math.PI / 2 + Math.sin(e.ph) * 0.08);
        e.hitT > 0 ? e.img.setTintFill(0xffffff) : e.img.setTint(0xd8e0c8);
      }
      // голоса
      e.voice -= dt;
      if (e.voice <= 0) {
        e.voice = e.kind === "bear" ? rand(4, 7) : e.kind === "rat" ? rand(1.5, 4) : rand(3, 8);
        sfx(VOICE[e.kind], this.near(e.x, e.y) * (e.kind === "rat" ? 0.7 : 1));
      }
      // укус
      e.cool -= dt;
      if (T.length && d < K_.r + 13 && e.cool <= 0) {
        e.cool = 0.8;
        if (tg.mate) this.hurtMate(tg.mate, K_.dmg);
        else if (this.invul <= 0) {
          const p2 = this.collide(this.px + (dx / d) * 14, this.py + (dy / d) * 14, 10);
          this.px = p2.x; this.py = p2.y;
          this.hurtPlayer(K_.dmg);
        }
      }
    }
  }

  // ───────── кооператив ─────────
  restartGame() {
    if (NET.role === "client") { S.msg = t("wait_restart"); S.msgT = 2; return; }
    if (NET.role === "host") send({ t: "restart" });
    this.scene.restart();
  }

  hostGame(again?: string) {
    if (NET.role !== "solo") return;
    S.msg = again ? t("restoring") : t("creating"); S.msgT = 3;
    netHost(again).then((code) => {
      saveNet({ role: "host", code });
      if (again) { S.msg = t("reopened", { c: code }); S.msgT = 4; return; }
      copyText(inviteLink(code));
      S.msg = t("code_for_friend", { c: code }); S.msgT = 6;
      if (S.paused) this.togglePause();
    }).catch(() => { S.msg = NET.status || t("host_fail"); S.msgT = 4; });
  }

  /** retry — сколько ещё попыток (хозяин мог обновить страницу и вот-вот вернётся) */
  joinGame(code?: string | null, retry = 0) {
    if (NET.role !== "solo") return;
    code = code ?? window.prompt(t("join_prompt"));
    if (!code) return;
    // можно вставить ссылку целиком — берём код из неё
    code = (code.match(/join=([A-Za-z0-9]{5})/)?.[1] ?? code).replace(/[^A-Za-z0-9]/g, "").slice(-5);
    S.msg = retry && this.waitHost ? t("host_wait") : t("connecting"); S.msgT = 3;
    NET.status = "";
    const c = code;
    netJoin(c).then(() => {
      this.waitHost = false;
      saveNet({ role: "client", code: c });
      // мир теперь у хозяина: свои монстры и предметы убираем
      for (const e of this.enemies) e.c.destroy();
      for (const it of this.items) { it.img.destroy(); it.sh.destroy(); }
      for (const n of this.nades) { n.img.destroy(); n.sh.destroy(); }
      for (const q of this.spits) { q.img.destroy(); q.sh.destroy(); }
      this.enemies = []; this.items = []; this.nades = []; this.spits = []; this.spawnQ = [];
      if (this.dead) this.revive();
      Object.assign(S, { hp: 100, armor: 0, medkits: 0, grenades: 1, wave: 0, kills: 0, score: 0, over: false });
      S.msg = t("joined"); S.msgT = 2.5;
      if (settings.name) send({ t: "name", name: settings.name });
      if (S.paused) this.togglePause();
    }).catch(() => {
      if (retry > 0 && (!this.waitHost || performance.now() < this.waitUntil)) { this.time.delayedCall(2000, () => this.joinGame(c, retry - 1)); return; }
      if (this.waitHost) { this.waitHost = false; saveNet(null); this.scene.restart(); S.msg = t("host_gone"); S.msgT = 4; return; }
      saveNet(null);
      NET.status = t("not_found", { c });
      S.msg = NET.status; S.msgT = 4;
    });
  }

  setupNet() {
    NET.onMsg = (from, m) => this.onNet(from, m);
    NET.onJoin = (id) => { this.sendHi(id); S.msg = t("friend_joined"); S.msgT = 2; };
    NET.onLeave = (id) => {
      if (NET.role === "client") { this.hostLost(); return; }
      const m = this.mates.get(id);
      if (m) { m.hum.c.destroy(); m.label.destroy(); this.mates.delete(id); }
      S.msg = t("friend_left"); S.msgT = 2;
      this.checkAllDead();
    };
    if (NET.role === "host") for (const id of NET.conns.keys()) this.sendHi(id);
    if (NET.role === "client" && pendingHi) this.applyHi(pendingHi);
    // после обновления страницы — обратно в ту же игру; ссылка-приглашение — войти
    if (!autoJoined && NET.role === "solo") {
      autoJoined = true;
      const saved = loadNet();
      if (saved?.role === "host") this.time.delayedCall(300, () => this.hostGame(saved.code));
      else if (saved?.role === "client") this.time.delayedCall(300, () => this.joinGame(saved.code, 10));
      else if (JOIN && !S.menu) this.time.delayedCall(300, () => this.joinGame(JOIN, 1));
    }
  }

  /** гость потерял хозяина (закрыл или обновляет страницу): ждём его ~20 с с тем же кодом */
  hostLost() {
    if (this.waitHost) return;
    const code = NET.code;
    netLeave();
    this.waitHost = true;
    // монстры хозяина замирают и исчезают
    for (const e of this.enemies) e.c.destroy();
    for (const it of this.items) { it.img.destroy(); it.sh.destroy(); }
    for (const m of this.mates.values()) { m.hum.c.destroy(); m.label.destroy(); }
    for (const n of this.netNades) n.destroy();
    this.enemies = []; this.items = []; this.mates.clear(); this.netNades = [];
    this.waitUntil = performance.now() + 25000;
    this.joinGame(code, 10);
  }

  sendHi(id: string) {
    // имя гостю: то же, что у его фигурки здесь (фигурка заводится сразу, чтобы имя не поменялось)
    const mt = this.mate(id, this.px + 40, this.py + 20);
    send({ t: "hi", x: Math.round(this.px + 40), y: Math.round(this.py + 20), lt: this.light.t, name: mt.name }, id);
  }
  applyHi(m: Record<string, any>) {
    const p = this.collide(m.x, m.y, 10);
    this.px = p.x; this.py = p.y;
    this.light.t = m.lt;
    this.player.c.setPosition(this.px, this.py);
    this.cameras.main.centerOn(this.px, this.py);
  }

  mate(id: string, x: number, y: number) {
    let m = this.mates.get(id);
    if (!m) {
      const name = NET.role === "host" ? this.freeName() : t("player");
      const label = this.add.text(x, y, name, { fontFamily: "system-ui, Segoe UI, Roboto, sans-serif", fontSize: "11px", fontStyle: "700", color: "#bfe0ff", stroke: "#14110d", strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(1e6 + 2);
      m = { id, name, label, hum: new Humanoid(this, x, y, "mate", PAL_MATE, true), x, y, tx: x, ty: y, gap: 0.05, last: 0, aimA: 0, moveA: 0, ph: 0, moving: 0, muzzle: 0, hp: 100, dead: false, gren: 1, seen: performance.now(), w: 0, armor: 0, med: 0 };
      this.mates.set(id, m);
    }
    return m;
  }

  /** хозяин: свободное имя для нового игрока («Игрок 2», «Игрок 3»…) */
  freeName() {
    const used = new Set([...this.mates.values()].map((m) => m.name));
    used.add(S.myName);
    for (let i = 2; ; i++) if (!used.has(`${t("player")} ${i}`)) return `${t("player")} ${i}`;
  }

  // ───────── чат ─────────
  chatEl?: HTMLInputElement;
  openChat() {
    if (NET.role === "solo") { S.msg = t("chat_solo"); S.msgT = 1.5; return; }
    if (S.chatOpen) return;
    if (!this.chatEl) {
      const el = (this.chatEl = document.createElement("input"));
      el.maxLength = 120;
      el.placeholder = t("chat_ph");
      Object.assign(el.style, { position: "fixed", left: "16px", bottom: "64px", width: "min(420px, calc(100vw - 32px))", padding: "8px 10px", font: "15px system-ui, Segoe UI, Roboto, sans-serif", color: "#f2ead8", background: "rgba(20,17,13,0.85)", border: "1px solid #bfe0ff", borderRadius: "8px", outline: "none", zIndex: "10", display: "none", cursor: "text" });
      el.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") { this.sendChat(el.value); this.closeChat(); }
        else if (ev.key === "Escape") this.closeChat();
      });
      el.addEventListener("keyup", (ev) => ev.stopPropagation());
      el.addEventListener("blur", () => this.closeChat());
      document.body.appendChild(el);
    }
    S.chatOpen = true;
    const kb = this.input.keyboard!;
    kb.enabled = false; kb.disableGlobalCapture(); kb.resetKeys();
    this.chatEl.value = "";
    this.chatEl.style.display = "block";
    setTimeout(() => this.chatEl?.focus(), 0);
  }
  closeChat() {
    if (!S.chatOpen || !this.chatEl) return;
    S.chatOpen = false;
    this.chatEl.style.display = "none";
    this.chatEl.blur();
    const kb = this.input.keyboard!;
    kb.enabled = true; kb.enableGlobalCapture(); kb.resetKeys();
  }
  sendChat(raw: string) {
    const text = raw.trim().slice(0, 120);
    if (!text) return;
    this.addChat(S.myName, text, true);
    if (NET.role === "host") send({ t: "chat", who: S.myName, text });
    else if (NET.role === "client") send({ t: "chat", text });
  }
  addChat(who: string, text: string, me = false) {
    S.chat.push({ who, text, t: performance.now(), me });
    if (S.chat.length > 30) S.chat.shift();
    if (!me) sfx("pickup", 0.35);
  }

  onNet(from: string, m: Record<string, any>) {
    if (NET.role === "host") {
      if (m.t === "in") {
        const mt = this.mate(from, m.x, m.y);
        this.mateTarget(mt, m.x, m.y);
        Object.assign(mt, { aimA: m.aimA, moveA: m.moveA, ph: m.ph, moving: m.moving, gren: m.gren, w: (m.w | 0) % SLOTS.length, med: m.med | 0, seen: performance.now() });
      } else if (m.t === "shot") {
        const mt = this.mates.get(from);
        const w = WEAPONS[m.w as WeaponId];
        if (!mt || mt.dead || !w || !w.pellets || !Array.isArray(m.as)) return;
        mt.muzzle = 0.06; mt.hum.recoil = 1;
        const as = (m.as as number[]).slice(0, w.pellets).map(Number);
        this.bullets.push(...shotBullets(w, m.x, m.y, as, false));
        sfx(w.sound, this.near(m.x, m.y) * 0.8);
        send({ t: "fx", k: "shot", who: from, x: m.x, y: m.y, as, w: w.id }, undefined, from);
      } else if (m.t === "name") {
        const mt = this.mates.get(from);
        const nm = String(m.name ?? "").replace(/[<>]/g, "").trim().slice(0, 16);
        if (mt && nm) { mt.name = nm; mt.label.setText(nm); }
      } else if (m.t === "heal") {
        const mt = this.mates.get(from);
        if (mt && !mt.dead) mt.hp = Math.min(S.maxHp, mt.hp + MED_HEAL);
      } else if (m.t === "chat") {
        const who = this.mates.get(from)?.name ?? t("player");
        const text = String(m.text ?? "").slice(0, 120);
        if (!text) return;
        this.addChat(who, text);
        send({ t: "chat", who, text }, undefined, from);
      } else if (m.t === "nade") {
        const mt = this.mates.get(from);
        if (mt?.dead) return;
        if (mt) mt.hum.recoil = 1;
        this.spawnNade(m.x, m.y, m.z, m.vx, m.vy, m.vz);
      }
      return;
    }
    // ── гость ──
    switch (m.t) {
      case "snap": this.applySnap(m); break;
      case "hi": pendingHi = m; this.applyHi(m); if (m.name) S.myName = m.name; break;
      case "chat": this.addChat(String(m.who), String(m.text).slice(0, 120)); break;
      case "kill": { const e = this.enemies.find((q) => q.id === m.id); if (e && !e.dead) this.kill(e, m.dir); break; }
      case "hit": { const e = this.enemies.find((q) => q.id === m.id); if (e && !e.dead) { e.hitT = 0.07; this.hitFx(e, m.dir, m.n, m.f, m.arm, !!m.legs); sfx("hit", this.near(e.x, e.y)); } break; }
      case "boom": this.explode(m.x, m.y); break;
      case "spit": { this.spawnSpit(m.x, m.y, m.z, m.vx, m.vy, m.vz, true); const e = this.enemies.find((q) => q.id === m.id); if (e?.hum) e.hum.recoil = 0.25; sfx("splat", this.near(m.x, m.y) * 0.8); break; }
      case "hurt": this.hurtPlayer(m.dmg, true); break;
      case "give":
        if (m.k === "grenade") { S.grenades++; sfx("pickup"); S.msg = t("got_nade"); }
        else if (m.k === "armor") { sfx("armor"); S.msg = t("got_armor"); }
        else { S.medkits = Math.min(MAX_MED, S.medkits + 1); sfx("pickup"); S.msg = t("got_med"); }
        S.msgT = 0.9;
        break;
      case "fx":
        if (m.k === "shot") {
          const w = WEAPONS[m.w as WeaponId] ?? WEAPONS.rifle;
          this.bullets.push(...shotBullets(w, m.x, m.y, Array.isArray(m.as) ? m.as : [m.a], true));
          const mt = this.mates.get(m.who);
          if (mt) { mt.muzzle = 0.06; mt.hum.recoil = 1; }
          sfx(w.sound, this.near(m.x, m.y) * 0.8);
        }
        break;
      case "restart": this.scene.restart(); break;
    }
  }

  /** хозяин рассылает снимок мира, гость — свои движения */
  netTick(dt: number) {
    const now = performance.now();
    // пропал без «до свидания» (закрыл вкладку, отвалилась сеть) — через 6 с считаем ушедшим
    if (NET.role === "host") for (const m of [...this.mates.values()]) if (now - m.seen > 6000) { netDrop(m.id); NET.onLeave(m.id); }
    if (NET.role === "client" && this.lastSnap && now - this.lastSnap > 6000) { this.lastSnap = 0; this.hostLost(); return; }
    if (NET.role === "host" && NET.conns.size) {
      this.snapT -= dt;
      if (this.snapT > 0) return;
      this.snapT = 1 / 20;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const P: unknown[] = [["host", this.px | 0, this.py | 0, r2(this.aimA), r2(this.moveA), r2(this.moving), r2(this.ph), this.muzzleT > 0 ? 1 : 0, Math.ceil(S.hp), this.dead ? 1 : 0, S.myName, S.weapon, Math.ceil(S.armor)]];
      for (const mt of this.mates.values()) P.push([mt.id, mt.x | 0, mt.y | 0, r2(mt.aimA), r2(mt.moveA), r2(mt.moving), r2(mt.ph), mt.muzzle > 0 ? 1 : 0, Math.ceil(mt.hp), mt.dead ? 1 : 0, mt.name, mt.w, Math.ceil(mt.armor)]);
      const E = this.enemies.filter((e) => !e.dead).map((e) => [e.id, KIND_LIST.indexOf(e.kind), e.x | 0, e.y | 0, r2(e.a), r2(e.ph), e.hitT > 0 ? 1 : 0, e.hum ? (e.hum.armsOn[0] ? 1 : 0) | (e.hum.armsOn[1] ? 2 : 0) | (e.hum.crawl ? 4 : 0) : 3]);
      const I = this.items.map((it) => [it.id, ITEM_KINDS.indexOf(it.kind), it.x | 0, it.y | 0]);
      const N = this.nades.map((n) => [n.x | 0, n.y | 0, n.z | 0, r2(n.spin), n.t < 0.7 && Math.sin(n.t * 40) > 0 ? 1 : 0]);
      send({ t: "snap", P, E, I, N, w: S.wave, k: S.kills, s: S.score, lt: Math.round(this.light.t * 1e4) / 1e4, o: S.over ? 1 : 0 });
    } else if (NET.role === "client") {
      this.inT -= dt;
      if (this.inT > 0) return;
      this.inT = 1 / 30;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      send({ t: "in", x: this.px | 0, y: this.py | 0, aimA: r2(this.aimA), moveA: r2(this.moveA), ph: r2(this.ph), moving: r2(this.moving), gren: S.grenades, w: S.weapon, med: S.medkits });
    }
  }

  /** новая точка напарника: идём к ней от текущего места за время между сообщениями */
  mateTarget(mt: Mate, x: number, y: number) {
    const now = performance.now();
    if (mt.last) mt.gap = Phaser.Math.Clamp(mt.gap * 0.8 + ((now - mt.last) / 1000) * 0.2, 0.02, 0.3);
    mt.last = now;
    mt.fx = mt.x; mt.fy = mt.y; mt.tx = x; mt.ty = y; mt.iu = 0;
  }

  applySnap(m: Record<string, any>) {
    const now = performance.now();
    if (this.lastSnap) this.snapGap = Phaser.Math.Clamp(this.snapGap * 0.8 + ((now - this.lastSnap) / 1000) * 0.2, 0.02, 0.3);
    this.lastSnap = now;
    S.wave = m.w; S.kills = m.k; S.score = m.s;
    if (Math.abs(this.light.t - m.lt) > 0.003) this.light.t = m.lt;
    if (m.o && !S.over) { S.over = true; sfx("over"); }
    // игроки
    const seen = new Set<string>();
    for (const p of m.P as any[]) {
      const [id, x, y, aimA, moveA, moving, ph, muz, hp, dead, name, w, armor] = p;
      if (id === NET.me && name) S.myName = name;
      if (id === NET.me) {
        S.hp = hp; S.armor = armor ?? 0;
        if (dead && !this.dead) this.die();
        else if (!dead && this.dead) this.revive();
        continue;
      }
      seen.add(id);
      const mt = this.mate(id, x, y);
      this.mateTarget(mt, x, y);
      Object.assign(mt, { aimA, moveA, moving, ph, hp, w: w ?? 0, armor: armor ?? 0 });
      if (name && mt.name !== name) { mt.name = name; mt.label.setText(name); }
      if (muz) mt.muzzle = Math.max(mt.muzzle, 0.05);
      if (dead && !mt.dead) { mt.hum.body.setTint(0x777777); mt.hum.head.setTint(0x777777); mt.hum.back.clear(); mt.hum.front.clear(); }
      if (!dead && mt.dead) { mt.hum.body.clearTint(); mt.hum.head.clearTint(); }
      mt.dead = !!dead;
    }
    for (const [id, mt] of this.mates) if (!seen.has(id)) { mt.hum.c.destroy(); mt.label.destroy(); this.mates.delete(id); }
    // монстры
    const byId = new Map(this.enemies.map((e) => [e.id, e]));
    const here = new Set<number>();
    for (const q of m.E as any[]) {
      const [id, k, x, y, a, ph, hit, arms] = q;
      here.add(id);
      let e = byId.get(id);
      if (!e) { e = this.addEnemy(KIND_LIST[k], x, y, id); e.a = a; }
      if (e.dead) continue;
      e.fx = e.x; e.fy = e.y; e.iu = 0;
      e.tx = x; e.ty = y; e.a = a; e.ph = ph;
      if (hit) e.hitT = 0.07;
      if (e.hum) for (const side of [0, 1]) if (e.hum.armsOn[side] && !(arms & (1 << side))) e.hum.armsOn[side] = false;
      if (e.hum && arms & 4 && !e.hum.crawl) e.hum.setCrawl();
    }
    for (const e of this.enemies) if (!e.dead && !here.has(e.id)) { e.dead = true; e.c.destroy(); }
    // предметы
    const items = new Set<number>();
    for (const [id, k, x, y] of m.I as any[]) {
      items.add(id);
      if (!this.items.some((it) => it.id === id)) this.dropItem(ITEM_KINDS[k] ?? "grenade", x, y, id);
    }
    for (const it of this.items) if (!items.has(it.id)) it.life = 0;
    // летящие гранаты
    const N = m.N as any[];
    while (this.netNades.length < N.length) this.netNades.push(this.add.image(0, 0, "it_grenade", 0).setOrigin(origins.it_grenade.x, origins.it_grenade.y).setScale(0.45));
    while (this.netNades.length > N.length) this.netNades.pop()!.destroy();
    N.forEach(([x, y, z, spin, blink], i) => {
      const im = this.netNades[i].setPosition(x, y - z).setFrame(frameOf(spin)).setDepth(y);
      if (blink) im.setTintFill(0xff3020); else im.clearTint();
    });
  }

  /** гость: монстры двигаются к присланным хозяином точкам */
  clientEnemies(dt: number) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      // ровное движение между двумя последними точками хозяина (без рывков)
      e.iu = (e.iu ?? 1) + dt / this.snapGap;
      const u = Math.min(1, e.iu), fx = e.fx ?? e.tx, fy = e.fy ?? e.ty;
      e.x = fx + (e.tx - fx) * u; e.y = fy + (e.ty - fy) * u;
      if (Math.hypot(e.tx - fx, e.ty - fy) > 200) { e.x = e.tx; e.y = e.ty; }
      e.c.setPosition(e.x, e.y).setDepth(e.y);
      e.hitT -= dt;
      if (e.hum) { e.hum.recoil = Math.max(0, e.hum.recoil - dt * 2.5); e.hum.pose(e.a, e.a, e.ph, 1, false, Math.sin(e.ph * 0.5)); e.hum.flash(e.hitT > 0); }
      else if (e.img) {
        e.img.setRotation(e.a + Math.PI / 2 + Math.sin(e.ph) * 0.08);
        e.hitT > 0 ? e.img.setTintFill(0xffffff) : e.img.setTint(0xd8e0c8);
      }
      e.voice -= dt;
      if (e.voice <= 0) {
        e.voice = e.kind === "bear" ? rand(4, 7) : e.kind === "rat" ? rand(1.5, 4) : rand(3, 8);
        sfx(VOICE[e.kind], this.near(e.x, e.y) * (e.kind === "rat" ? 0.7 : 1));
      }
    }
  }

  /** напарники: плавно к последней присланной точке */
  updateMates(dt: number) {
    for (const m of this.mates.values()) {
      m.iu = (m.iu ?? 1) + dt / m.gap;
      const u = Math.min(1, m.iu), fx = m.fx ?? m.tx, fy = m.fy ?? m.ty;
      m.x = fx + (m.tx - fx) * u; m.y = fy + (m.ty - fy) * u;
      if (Math.hypot(m.tx - fx, m.ty - fy) > 200) { m.x = m.tx; m.y = m.ty; }
      m.muzzle -= dt;
      m.hum.recoil = Math.max(0, m.hum.recoil - dt * 11);
      m.hum.c.setPosition(m.x, m.y).setDepth(m.y);
      m.label.setPosition(m.x, m.y - 36);
      m.hum.weapon = SLOTS[m.w] ?? "rifle";
      m.hum.setArmor(m.armor > 0);
      if (!m.dead) m.hum.pose(m.aimA, m.moveA, m.ph, m.moving, m.muzzle > 0);
    }
  }
}

// ───────── HUD и стики (отдельная сцена без масштаба) ─────────
class UI extends Phaser.Scene {
  g!: Phaser.GameObjects.Graphics;
  info!: Phaser.GameObjects.Text;
  big!: Phaser.GameObjects.Text;
  help!: Phaser.GameObjects.Text;
  net!: Phaser.GameObjects.Text;
  btn: Phaser.GameObjects.Text[] = [];
  chatT!: Phaser.GameObjects.Text;
  /** ячейки оружия внизу (цифра, название, патроны) */
  slotT: Phaser.GameObjects.Text[] = [];
  /** окно снаряжения: герой крутится, надписи */
  doll!: Humanoid;
  invT: Phaser.GameObjects.Text[] = [];
  bagT!: Phaser.GameObjects.Text;
  constructor() { super("ui"); }
  get gm() { return this.scene.get("game") as Game; }
  create() {
    const font = "system-ui, Segoe UI, Roboto, sans-serif";
    this.g = this.add.graphics();
    this.info = this.add.text(16, 40, "", { fontFamily: font, fontSize: "16px", fontStyle: "700", color: "#f2ead8", stroke: "#14110d", strokeThickness: 4 });
    this.big = this.add.text(0, 0, "", { fontFamily: font, fontSize: "40px", fontStyle: "800", color: "#ffe2a0", stroke: "#14110d", strokeThickness: 6, align: "center" }).setOrigin(0.5);
    this.chatT = this.add.text(16, 0, "", { fontFamily: font, fontSize: "15px", color: "#f2ead8", stroke: "#14110d", strokeThickness: 4, lineSpacing: 2 }).setOrigin(0, 1);
    this.net = this.add.text(0, 0, "", { fontFamily: font, fontSize: "15px", fontStyle: "700", color: "#bfe0ff", stroke: "#14110d", strokeThickness: 4 }).setOrigin(0.5, 0);
    this.btn = [0, 1, 2].map(() => this.add.text(0, 0, "", { fontFamily: font, fontSize: "17px", fontStyle: "700", color: "#ffe2a0" }).setOrigin(0.5).setDepth(2).setVisible(false));
    this.help = this.add.text(0, 0, "", { fontFamily: font, fontSize: "13px", color: "#e8e0cc", stroke: "#14110d", strokeThickness: 3, align: "right" }).setOrigin(1, 1);
    this.slotT = SLOTS.map(() => this.add.text(0, 0, "", { fontFamily: font, fontSize: "12px", fontStyle: "700", color: "#f2ead8", align: "center", lineSpacing: 1 }).setOrigin(0.5).setDepth(1));
    this.bagT = this.add.text(0, 0, "", { fontFamily: font, fontSize: "11px", fontStyle: "700", color: "#f2ead8" }).setOrigin(0.5).setDepth(1);
    // окно снаряжения
    this.doll = new Humanoid(this, 0, 0, "hero", PAL_HERO, true);
    this.doll.c.setScale(3.6).setDepth(4).setVisible(false);
    this.doll.contact.setAlpha(0.4);
    this.invT = Array.from({ length: 14 }, () => this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", fontStyle: "700", color: "#f2ead8", align: "center", lineSpacing: 2 }).setOrigin(0.5).setDepth(5).setVisible(false));
  }

  /** окно снаряжения: герой, здоровье и броня, оружие (клик — взять), гранаты, аптечки (клик — лечиться) */
  drawInv(g: Phaser.GameObjects.Graphics, w: number, h: number, hits: Hit[]) {
    const gm = this.gm;
    const pw = Math.min(640, w - 20), ph = Math.min(420, h - 20), x0 = (w - pw) / 2, y0 = (h - ph) / 2;
    const T = this.invT; let ti = 0;
    const text = (x: number, y: number, s: string, size = 14, color = "#f2ead8", ox = 0.5) => T[ti++].setPosition(x, y).setText(s).setFontSize(size).setColor(color).setOrigin(ox, 0.5).setVisible(true);
    g.fillStyle(0x000000, 0.45).fillRect(0, 0, w, h);
    g.fillStyle(0x1c1812, 0.96).fillRoundedRect(x0, y0, pw, ph, 14).lineStyle(2, 0xffe2a0, 0.6).strokeRoundedRect(x0, y0, pw, ph, 14);
    text(x0 + 18, y0 + 24, `${t("inv_title")} · ${S.myName}`, 18, "#ffe2a0", 0);
    // закрыть
    g.lineStyle(3, 0xf2ead8, 0.8).lineBetween(x0 + pw - 34, y0 + 14, x0 + pw - 18, y0 + 30).lineBetween(x0 + pw - 18, y0 + 14, x0 + pw - 34, y0 + 30);
    hits.push({ x: x0 + pw - 44, y: y0 + 4, w: 40, h: 40, fn: () => gm.toggleInv() });
    // герой крутится на подставке
    const narrow = pw < 520;
    const dw = narrow ? 0 : 200, dx = x0 + 18 + dw / 2, dy = y0 + ph * 0.55;
    if (!narrow) {
      g.fillStyle(0x2a241a, 1).fillRoundedRect(x0 + 18, y0 + 46, dw, ph - 64, 10);
      const d = this.doll, a = performance.now() / 1000 * 0.9;
      d.c.setPosition(dx, dy + 40).setVisible(true);
      d.weapon = SLOTS[S.weapon];
      d.setArmor(S.armor > 0);
      d.recoil = Math.max(0, d.recoil - 0.05);
      d.pose(a, a, 0, 0, false);
      if (gm.dead) { d.body.setTint(0x777777); d.head.setTint(0x777777); } else { d.body.clearTint(); d.head.clearTint(); }
    } else this.doll.c.setVisible(false);
    // полоски здоровья и брони
    const rx = x0 + 36 + dw, rw = pw - dw - 54;
    const bar = (y: number, label: string, v: number, max: number, col: number) => {
      text(rx, y, `${label}: ${Math.ceil(v)}/${max}`, 14, "#f2ead8", 0);
      g.fillStyle(0x0c0a07, 1).fillRoundedRect(rx, y + 12, rw, 12, 4); if (v > 0) g.fillStyle(col).fillRoundedRect(rx + 1, y + 13, Math.max(6, (rw - 2) * Math.min(1, v / max)), 10, 3);
    };
    bar(y0 + 62, t("health"), S.hp, S.maxHp, S.hp / S.maxHp > 0.5 ? 0x6cc04a : S.hp / S.maxHp > 0.25 ? 0xe0b030 : 0xd83a2a);
    bar(y0 + 104, t("armor"), S.armor, 100, 0x6a8ac8);
    // оружие
    text(rx, y0 + 150, t("weapons_click"), 13, "#c8bfa8", 0);
    const sw = (rw - 3 * 8) / 4, sy = y0 + 166, sh = 66;
    SLOTS.forEach((id, i) => {
      const W_ = WEAPONS[id], sx = rx + i * (sw + 8), sel = S.weapon === i, own = S.owned[i];
      g.fillStyle(sel ? 0x4a3c1c : 0x2a241a, 1).fillRoundedRect(sx, sy, sw, sh, 8).lineStyle(2, sel ? 0xffe2a0 : 0x5a5040, sel ? 1 : 0.8).strokeRoundedRect(sx, sy, sw, sh, 8);
      const am = id === "grenade" ? `${S.grenades}` : `${S.clip[id]}/${W_.mag}`;
      text(sx + sw / 2, sy + sh / 2, own ? `${i + 1}\n${wname(id)}\n${am}` : `${i + 1}\n—`, 13, sel ? "#ffe2a0" : "#f2ead8");
      if (own) hits.push({ x: sx, y: sy, w: sw, h: sh, fn: () => gm.selectWeapon(i) });
    });
    // предметы
    text(rx, y0 + 256, t("items"), 13, "#c8bfa8", 0);
    const iy = y0 + 272, iw = (rw - 8) / 2, ih = 52;
    g.fillStyle(0x2a241a, 1).fillRoundedRect(rx, iy, iw, ih, 8).lineStyle(2, 0x5a5040, 0.8).strokeRoundedRect(rx, iy, iw, ih, 8);
    g.fillStyle(0x5e6e2c).fillEllipse(rx + 24, iy + 28, 16, 20).fillStyle(0x9a9a92).fillRect(rx + 21, iy + 13, 6, 5);
    text(rx + 42, iy + ih / 2, `${t("grenades")}: ${S.grenades}\n${S.touch ? t("tap_take") : t("throw_keys")}`, 12, "#f2ead8", 0);
    hits.push({ x: rx, y: iy, w: iw, h: ih, fn: () => gm.selectWeapon(3) });
    const mx = rx + iw + 8;
    g.fillStyle(S.medkits ? 0x4a1c1c : 0x2a241a, 1).fillRoundedRect(mx, iy, iw, ih, 8).lineStyle(2, S.medkits ? 0xff7060 : 0x5a5040, 0.8).strokeRoundedRect(mx, iy, iw, ih, 8);
    g.fillStyle(0xeeeeee).fillRoundedRect(mx + 12, iy + 16, 24, 20, 3).fillStyle(0xd83a2a).fillRect(mx + 21, iy + 19, 6, 14).fillRect(mx + 17, iy + 23, 14, 6);
    text(mx + 44, iy + ih / 2, `${t("meds")}: ${S.medkits}/${MAX_MED}\n${t("med_use", { n: MED_HEAL })}`, 12, "#f2ead8", 0);
    hits.push({ x: mx, y: iy, w: iw, h: ih, fn: () => gm.useMedkit() });
    text(narrow ? x0 + pw / 2 : rx + rw / 2, y0 + ph - 22, S.touch ? t("inv_close_touch") : `${t("inv_close_key")}${NET.role === "solo" ? t("paused_note") : ""}`, 12, "#a89f88");
    // клик мимо окна — закрыть
    hits.push({ x: 0, y: 0, w, h: y0, fn: () => gm.toggleInv() }, { x: 0, y: y0 + ph, w, h: h - y0 - ph, fn: () => gm.toggleInv() }, { x: 0, y: 0, w: x0, h, fn: () => gm.toggleInv() }, { x: x0 + pw, y: 0, w: w - x0 - pw, h, fn: () => gm.toggleInv() });
    // внутри окна клик по пустому месту — ничего
    hits.push({ x: x0, y: y0, w: pw, h: ph, fn: () => {} });
  }
  update() {
    const w = this.scale.width, h = this.scale.height, g = this.g.clear();
    if (S.menu) {
      for (const o of [this.info, this.big, this.help, this.net, this.chatT, this.bagT, ...this.btn, ...this.slotT, ...this.invT]) o.setVisible(false);
      this.doll.c.setVisible(false);
      S.hits = [];
      return;
    }
    for (const o of [this.info, this.big, this.help, this.net, this.chatT]) o.setVisible(true);
    for (const b of this.btn) b.setVisible(false);
    for (const t of this.invT) t.setVisible(false);
    for (const t of this.slotT) t.setVisible(false);
    this.bagT.setVisible(false);
    this.doll.c.setVisible(false);
    const hits: Hit[] = [];
    const gm = this.gm;
    // на паузе и после смерти нужен обычный курсор (нажимать кнопки), в игре — только прицел
    const want = S.paused || S.over || S.inv ? "default" : "none";
    const el = document.getElementById("game");
    if (el && el.style.cursor !== want) { el.style.cursor = want; this.game.canvas.style.cursor = want; }
    // полоска здоровья
    g.fillStyle(0x14110d, 0.8).fillRoundedRect(14, 14, 204, 18, 5);
    const f = S.hp / S.maxHp;
    g.fillStyle(f > 0.5 ? 0x6cc04a : f > 0.25 ? 0xe0b030 : 0xd83a2a).fillRoundedRect(16, 16, 200 * f, 14, 4);
    // броня — синяя полоска под здоровьем
    if (S.armor > 0) g.fillStyle(0x14110d, 0.8).fillRoundedRect(14, 33, 204, 9, 4).fillStyle(0x6a8ac8).fillRoundedRect(16, 35, 200 * Math.min(1, S.armor / 100), 5, 2);
    const cw = WEAPONS[SLOTS[S.weapon]];
    const ammo = cw.id === "grenade" ? `${S.grenades}` : S.reload > 0 ? t("reloading") : `${S.clip[cw.id]}/${cw.mag}`;
    this.info.setPosition(16, 46).setText(`${wname(cw.id)}: ${ammo}   ${t("grenades")}: ${S.grenades}   ${t("meds")}: ${S.medkits}${S.armor > 0 ? `   ${t("armor")}: ${Math.ceil(S.armor)}` : ""}\n${t("wave")}: ${S.wave}   ${t("killed")}: ${S.kills}   ${t("score")}: ${S.score}\n${S.daytime}`);
    this.help.setPosition(w - 14, h - 12).setWordWrapWidth(w - 28).setText(S.touch ? "" : t("help"));
    // ячейки оружия и рюкзак: внизу по центру (на тачскрине — между стиками, а если тесно — над кнопками справа)
    if (!S.over && !S.inv) {
      const gap = 6, sh = 44, bag = 44;
      let sw = 80, bx: number, by: number;
      const tot = () => SLOTS.length * sw + SLOTS.length * gap + (S.touch ? bag : 0) - (S.touch ? 0 : gap);
      if (!S.touch) { bx = (w - tot()) / 2; by = h - sh - this.help.height - 16; }
      else if (tot() <= w - 350) { bx = (w - tot()) / 2; by = h - sh - 10; }
      else { sw = Math.min(80, (w - 24 - bag - SLOTS.length * gap) / SLOTS.length); bx = (w - tot()) / 2; by = h - 300 - sh; }
      SLOTS.forEach((id, i) => {
        if (!S.owned[i]) return;
        const x = bx + i * (sw + gap), sel = S.weapon === i, W_ = WEAPONS[id];
        g.fillStyle(0x14110d, sel ? 0.8 : 0.5).fillRoundedRect(x, by, sw, sh, 7).lineStyle(2, sel ? 0xffe2a0 : 0xf2ead8, sel ? 0.95 : 0.25).strokeRoundedRect(x, by, sw, sh, 7);
        const am = id === "grenade" ? `×${S.grenades}` : sel && S.reload > 0 ? "…" : `${S.clip[id]}/${W_.mag}`;
        this.slotT[i].setPosition(x + sw / 2, by + sh / 2).setText(`${S.touch ? "" : `${i + 1} `}${wname(id)}\n${am}`).setFontSize(sw < 70 ? 10 : 12).setColor(sel ? "#ffe2a0" : "#d8d0bc").setVisible(true);
        hits.push({ x, y: by, w: sw, h: sh, fn: () => gm.selectWeapon(i) });
      });
      // кнопка «снаряжение» (рюкзак): на компьютере — слева от паузы/чата, на тачскрине — в конце ряда ячеек
      const kx = S.touch ? bx + SLOTS.length * (sw + gap) : w - 104, ky = S.touch ? by + 1 : 12;
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(kx, ky, 42, 42, 8);
      g.fillStyle(0x8a6a3a, 0.95).fillRoundedRect(kx + 10, ky + 12, 22, 22, 5).lineStyle(2.5, 0x8a6a3a, 0.95).strokeRoundedRect(kx + 15, ky + 6, 12, 10, 4);
      g.fillStyle(0x5a4426, 1).fillRoundedRect(kx + 14, ky + 21, 14, 8, 2);
      if (!S.touch) this.bagT.setPosition(kx + 21, ky + 50).setText("I").setVisible(true);
      hits.push({ x: kx, y: ky, w: 42, h: 42, fn: () => gm.toggleInv() });
    }
    // кооператив: код и число игроков
    const n = NET.conns.size + 1;
    this.net.setPosition(w / 2, 14).setDepth(1).setText(NET.role === "host" ? `${t("coop_host", { c: NET.code, n })}   [${t("copy_link_small")}${S.touch ? "" : " — C"}]` : NET.role === "client" ? t("coop_client", { c: NET.code }) : NET.status);
    if (NET.role === "host") g.fillStyle(0x14110d, 0.6).fillRoundedRect(w / 2 - this.net.width / 2 - 10, 8, this.net.width + 20, 30, 8).lineStyle(1.5, 0xbfe0ff, 0.6).strokeRoundedRect(w / 2 - this.net.width / 2 - 10, 8, this.net.width + 20, 30, 8);
    if (S.paused) {
      g.fillStyle(0x000000, 0.5).fillRect(0, 0, w, h);
      this.big.setPosition(w / 2, h / 2).setText(`${t("pause")}\n\n${S.touch ? t("pause_touch") : t("pause_key")}`).setFontSize(Math.min(34, w / 22)).setAlpha(1);
      // кнопки кооператива
      if (NET.role !== "client") {
        const labels = NET.role === "host" ? [t("copy_code", { c: NET.code }), t("copy_link")] : [t("invite"), t("join_code")];
        for (const [i, label] of labels.entries()) {
          const bx = w / 2 + (i ? 120 : -120), by = h * 0.68;
          g.fillStyle(0x14110d, 0.85).fillRoundedRect(bx - 105, by, 210, 50, 10).lineStyle(2, 0xffe2a0, 0.7).strokeRoundedRect(bx - 105, by, 210, 50, 10);
          this.btn[i].setPosition(bx, by + 25).setText(label).setVisible(true);
        }
      }
      const my = h * 0.68 + 64;
      g.fillStyle(0x14110d, 0.85).fillRoundedRect(w / 2 - 105, my, 210, 50, 10).lineStyle(2, 0xffe2a0, 0.7).strokeRoundedRect(w / 2 - 105, my, 210, 50, 10);
      this.btn[2].setPosition(w / 2, my + 25).setText(t("main_menu")).setVisible(true);
    } else if (S.inv && !S.over) {
      this.big.setAlpha(0);
      this.drawInv(g, w, h, hits);
    } else if (S.over) {
      g.fillStyle(0x000000, 0.55).fillRect(0, 0, w, h);
      this.big.setPosition(w / 2, h / 2).setText(`${t("over_title")}\n${t("over_stats", { w: S.wave, k: S.kills, s: S.score })}\n\n${S.touch ? t("over_touch") : t("over_key")}${NET.role === "client" ? t("host_decides") : ""}`).setFontSize(Math.min(34, w / 22)).setAlpha(1);
    } else {
      this.big.setPosition(w / 2, h * 0.28).setText(S.msg).setFontSize(42).setAlpha(Phaser.Math.Clamp(S.msgT, 0, 1));
    }
    // кнопка паузы (в кооперативе мир не останавливается — кнопки нет)
    if (!S.over && NET.role === "solo") {
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(w - 54, 12, 42, 42, 8);
      g.fillStyle(0xf2ead8, 0.9);
      if (S.paused) g.fillTriangle(w - 41, 22, w - 41, 44, w - 22, 33);
      else g.fillRect(w - 42, 22, 6, 22).fillRect(w - 30, 22, 6, 22);
    }
    // кнопка чата (в кооперативе — на месте паузы)
    if (NET.role !== "solo") {
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(w - 54, 12, 42, 42, 8).fillStyle(0xf2ead8, 0.9);
      g.fillRoundedRect(w - 45, 21, 24, 16, 4).fillTriangle(w - 41, 36, w - 35, 36, w - 42, 43);
    }
    // чат: последние сообщения слева внизу, гаснут через 12 с (пока пишешь — видны все)
    const now = performance.now();
    const lines = S.chat.filter((c) => S.chatOpen || now - c.t < 12000).slice(-7);
    this.chatT.setPosition(16, h - (S.touch ? 190 : 112)).setText(lines.map((c) => `${c.who}: ${c.text}`)).setWordWrapWidth(Math.min(460, w - 32))
      .setAlpha(lines.length && !S.chatOpen ? Phaser.Math.Clamp((12000 - (now - lines[lines.length - 1].t)) / 1500, 0.35, 1) : 1);
    // стики на тачскрине
    if (S.touch && !S.over && !S.inv) {
      const stick = (st: Stick | null, label: string, col: number, defX: number) => {
        const ox = st ? st.ox : defX, oy = st ? st.oy : h - 110;
        g.lineStyle(3, 0xffffff, st ? 0.5 : 0.25).strokeCircle(ox, oy, 55).fillStyle(0xffffff, 0.08).fillCircle(ox, oy, 55);
        let kx = ox, ky = oy;
        if (st) { const dx = st.x - ox, dy = st.y - oy, d = Math.hypot(dx, dy), m = Math.min(d, 55); if (d > 0) { kx = ox + (dx / d) * m; ky = oy + (dy / d) * m; } }
        g.fillStyle(col, st ? 0.7 : 0.35).fillCircle(kx, ky, 24);
        void label;
      };
      stick(S.move, "ход", 0xe8e0cc, 110);
      stick(S.aim, "огонь", 0xff6040, w - 110);
      // кнопка гранаты
      const bx = w - 110, by = h - 235;
      g.fillStyle(0x14110d, 0.45).fillCircle(bx, by, 30).lineStyle(3, 0xffffff, S.grenades ? 0.5 : 0.2).strokeCircle(bx, by, 30);
      g.fillStyle(0x5e6e2c, S.grenades ? 0.95 : 0.35).fillEllipse(bx, by + 3, 18, 22).fillStyle(0x9a9a92, S.grenades ? 0.95 : 0.35).fillRect(bx - 3, by - 13, 6, 6);
      // кнопка аптечки — левее гранаты
      if (!S.inv) {
        const hx = w - 190, hy = h - 215, on = S.medkits > 0;
        g.fillStyle(0x14110d, 0.45).fillCircle(hx, hy, 26).lineStyle(3, 0xffffff, on ? 0.5 : 0.2).strokeCircle(hx, hy, 26);
        g.fillStyle(0xeeeeee, on ? 0.95 : 0.3).fillRoundedRect(hx - 11, hy - 9, 22, 18, 3).fillStyle(0xd83a2a, on ? 1 : 0.35).fillRect(hx - 2.5, hy - 7, 5, 14).fillRect(hx - 7, hy - 2.5, 14, 5);
        hits.push({ x: hx - 28, y: hy - 28, w: 56, h: 56, fn: () => gm.useMedkit() });
      }
    }
    // горячие точки (в окне снаряжения — только его кнопки и «мимо окна»)
    S.hits = S.paused || S.over ? [] : hits;
  }
}

const game = ((window as any).G = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#2a3020",
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 4 },
  render: { antialias: true },
  scene: [Game, UI],
}));

// Фоновая вкладка: браузер останавливает requestAnimationFrame, и игра замирает. В кооперативе это ломает связь
// (хозяин перестаёт рассылать мир, гость — свои движения), поэтому, пока вкладка скрыта, шагаем игру сами
// по таймеру из воркера (таймеры воркера браузер почти не притормаживает).
{
  let last = performance.now();
  const step = () => {
    const now = performance.now();
    if (!document.hidden || NET.role === "solo") { last = now; return; }
    game.headlessStep(now, Math.min(100, now - last));
    last = now;
  };
  try {
    const w = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 50);"], { type: "text/javascript" })));
    w.onmessage = step;
  } catch {
    setInterval(step, 50);
  }
}

// ───────── телефоны и планшеты: полный экран ─────────
// Браузер даёт включить полный экран только по жесту пользователя — включаем на первое (и каждое следующее) касание,
// пока игра не в полном экране. iPhone полноэкранный режим страницам не даёт: там — «На экран «Домой»» (манифест и
// мета-теги apple-mobile-web-app-capable открывают игру без панелей браузера), подсказка показывается один раз.
{
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches);
  const standalone = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches || (navigator as any).standalone === true;
  if (mobile && !standalone) {
    const d = document as any, el = document.documentElement as any;
    const req: ((o?: object) => Promise<void> | void) | undefined = el.requestFullscreen ?? el.webkitRequestFullscreen;
    let hinted = false;
    const go = () => {
      if (!settings.fs || d.fullscreenElement || d.webkitFullscreenElement) return;
      if (req) {
        try { const r = req.call(el, { navigationUI: "hide" }); if (r && (r as Promise<void>).catch) (r as Promise<void>).catch(() => {}); } catch { /* не дали */ }
      } else if (!hinted && /iPhone|iPod/i.test(ua)) {
        hinted = true;
        try { if (localStorage.getItem("myzombika-ios-hint")) return; localStorage.setItem("myzombika-ios-hint", "1"); } catch { /* нет хранилища */ }
        S.msg = t("ios_hint"); S.msgT = 5;
      }
    };
    // touchend и click — жесты, по которым браузер разрешает полный экран
    window.addEventListener("touchend", go, { capture: true, passive: true });
    window.addEventListener("click", go, true);
  }
  // манифест (установка на экран «Домой» — сразу на весь экран): адреса — от текущей страницы, значок — голова героя
  const addManifest = () => {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 512;
      const x = c.getContext("2d")!;
      x.fillStyle = "#2a3020"; x.fillRect(0, 0, 512, 512);
      const t = game.textures.get("hero_head"), f = t.get(8);
      const src = f.source.image as CanvasImageSource, k = 300 / Math.max(f.cutWidth, f.cutHeight);
      x.drawImage(src, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 256 - (f.cutWidth * k) / 2, 270 - (f.cutHeight * k) / 2, f.cutWidth * k, f.cutHeight * k);
      const icon = c.toDataURL("image/png");
      const here = location.protocol.startsWith("http") ? location.origin + location.pathname : SITE;
      const man = { name: "MyZombika", short_name: "MyZombika", start_url: here, scope: here.replace(/[^/]*$/, ""), display: "fullscreen", orientation: "any", background_color: "#1a1d14", theme_color: "#1a1d14",
        icons: [{ src: icon, sizes: "512x512", type: "image/png" }, { src: icon, sizes: "192x192", type: "image/png" }] };
      const link = document.createElement("link"); link.rel = "manifest";
      link.href = "data:application/manifest+json;charset=utf-8," + encodeURIComponent(JSON.stringify(man));
      document.head.appendChild(link);
      const ap = document.createElement("link"); ap.rel = "apple-touch-icon"; ap.href = icon; document.head.appendChild(ap);
    } catch { /* без значка */ }
  };
  game.events.once("ready", () => setTimeout(addManifest, 500));
}
