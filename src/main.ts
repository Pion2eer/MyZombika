// MyZombika — прототип бродилки-стрелялки с видом сверху.
// Герой и зомби — псевдо-3D из срезов (sprite stacking, см. heroStack.ts), графика окружения — из LLM Survival.
// Управление: WASD/стрелки — ходьба, мышь — прицел, ЛКМ — стрельба, R — перезарядка, 1–4/колесо — оружие, Q — аптечка, I/Tab — снаряжение.
// Тачскрин: левая половина экрана — стик ходьбы, правая — стик прицела (тянешь — стреляет).
import Phaser from "phaser";
import { sfx, setRain, setSound, toggleMute, unlockAudio } from "./sfx";
import { t, type Key } from "./i18n";
// на телефоне подсказки без названий клавиш: «Позвать друга (H)» → «Позвать друга»
const tk = (k: Key, p?: Record<string, string | number>) => (S.touch ? t(k, p).replace(/\s*\([A-Z]\)/g, "") : t(k, p));
import { settings, openMenu, closeMenu, openOver } from "./menu";
import { startRun } from "./scores";
import { STORY_W, STORY_H, GATES, CAMPS, START, EXIT_Y, GROUPS, WEAPON_CRATES, CH, CHAPTERS, SEGS, LANE, TUNNEL_Y, setChapter, loadStory, saveStory, unlockChapter, loadHero, saveHero, type StorySave } from "./story";
import { makeSliceProps, SLICE_INFO } from "./propVox";
import { loadGroundFiles, makeGround, makeGroundPatches, makeSplats, HAS_GRASS } from "./groundArt";
import { loadArtFiles, objArt, HOUSE_NAMES, ART_K, OBJ_K, BUILD_NAMES, buildK } from "./artFiles";
const BUILD_K_SMALL = (n: string) => buildK(n) !== ART_K;
import { HUD_ART, HUD_FILE, loadHudFiles, makeHudArt, type HudArt } from "./hudArt";
import { PROP_ART, loadPropFiles, makePropArt, type PropArt } from "./propArt";
import { buildHouse, hull, inHouse, wDist, wLocal, wWorld, type House, type WallBox } from "./house";
import { NET, host as netHost, join as netJoin, send, leave as netLeave, drop as netDrop } from "./net";
import { Lighting, SHADOW, SHADOW_ALPHA, artFootprint, silTex, type Circle } from "./light";
import { ARM_V, ARM_Z, PAL_HERO, PAL_ZOMBIE_A, PAL_ZOMBIE_B, armorVox, ammoVox, grenadeVox, medkitVox, heroBody, heroHead, renderStack, torsoOf, setPalette, type Palette } from "./heroStack";

let W = 3000, H = 3000; // размер мира, px (в сюжете — длинная вертикальная полоса)
/** в сюжете не ставим деревья и камни на заслоны, в лагеря и у ящиков с оружием */
/** туннель: скала по бокам прохода (внутрь не ставим ничего) */
const inRock = (x: number, y: number, r = 0) => !!LANE && y < TUNNEL_Y + r && (x < LANE[0] + r || x > LANE[1] - r);
/** пашни фермы: на них ничего не ставим (вокруг — заборчик) */
let FIELDS: { x: number; y: number; w: number; h: number }[] = [];
/** главная тропа сюжета: x по y (фаза своя у главы) */
let TRAIL_PH = 0;
const trailX = (y: number) => W / 2 + Math.sin(y * 0.0021 + TRAIL_PH) * 110 + Math.sin(y * 0.0061 + TRAIL_PH * 2) * 45;
const onTrail = (x: number, y: number, r: number) => S.story && ["farm", "waste", "junk"].includes(CHAPTERS[CH].theme) && Math.abs(x - trailX(y)) < r + 34;
/** твёрдое покрытие главы (асфальт, плиты, бетон): деревья и валуны там не растут */
const onPave = (th: string, x: number) => S.story && ((th === "road" && Math.abs(x - W / 2) < 330) || (th === "town" && x > 215 && x < W - 215) || (th === "factory" && x > 160 && x < W - 160) || (th === "dam" && x > 250 && x < W - 250));
const inField = (x: number, y: number, r: number) => FIELDS.some((f) => x > f.x - r - 34 && x < f.x + f.w + r + 34 && y > f.y - r - 40 && y < f.y + f.h + r + 30);
function storyFree(x: number, y: number, r: number) {
  if (inRock(x, y, r + 10) || inField(x, y, r)) return false;
  if (CH === CHAPTERS.length - 1 && Math.hypot(x - W / 2, y - EXIT_Y) < r + 240) return false; // вертолётная площадка
  if (CHAPTERS[CH]?.theme === "factory" && x > W / 2 + 140 - r && x < W / 2 + 230 + r) return false; // рельсы
  if (GATES.some((g) => Math.abs(y - g) < r + 70)) return false;
  if (CAMPS.some((c) => Math.hypot(x - c.x, y - c.y) < r + 170)) return false;
  if (WEAPON_CRATES.some((c) => Math.hypot(x - c.x, y - c.y) < r + 90)) return false;
  return true;
}
/** режим: волны или сюжет (выбирается в меню, мир строится заново) */
let MODE: "waves" | "story" = "waves";
/** сюжет: какая глава идёт (0..4) — у хозяина из сохранения, у гостя из «hi» хозяина */
let storyCh = 0;
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
export type WeaponId = "rifle" | "shotgun" | "pistol" | "grenade" | "bazooka" | "flamer" | "saw";
export interface WeaponDef {
  id: WeaponId; name: string; short: string;
  /** магазин, выстрелов в секунду (пауза между), перезарядка, с */
  mag: number; rate: number; reload: number;
  /** дробин за выстрел, разброс (рад), дальность (время жизни пули, с), урон дробины, отброс */
  pellets: number; spread: number; life: number; dmg: number; kb: number;
  sound: "shot" | "shotgun" | "pistol" | "rocket" | "flame" | "saw"; shake: number;
  /** чем стреляет: ракета (взрыв), огонь (поджигает, проходит насквозь); скорость снаряда, px/с */
  shell?: "rocket" | "flame"; speed?: number;
  /** запас патронов вне магазина (ракеты, топливо) — подбирается */
  stock?: boolean;
}
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: { id: "rifle", name: "Автомат", short: "Автомат", mag: 30, rate: 0.1, reload: 1.3, pellets: 1, spread: 0.06, life: 0.6, dmg: 1, kb: 90, sound: "shot", shake: 0.0004 },
  shotgun: { id: "shotgun", name: "Дробовик", short: "Дробовик", mag: 6, rate: 0.8, reload: 2.0, pellets: 8, spread: 0.34, life: 0.22, dmg: 1, kb: 55, sound: "shotgun", shake: 0.0022 },
  pistol: { id: "pistol", name: "Пистолет", short: "Пистолет", mag: 12, rate: 0.25, reload: 0.9, pellets: 1, spread: 0.03, life: 0.5, dmg: 1.5, kb: 110, sound: "pistol", shake: 0.0005 },
  grenade: { id: "grenade", name: "Гранаты", short: "Гранаты", mag: 0, rate: 0.8, reload: 0, pellets: 0, spread: 0, life: 0, dmg: 0, kb: 0, sound: "shot", shake: 0 },
  bazooka: { id: "bazooka", name: "Базука", short: "Базука", mag: 1, rate: 0.9, reload: 2.1, pellets: 1, spread: 0.02, life: 1.3, dmg: 1, kb: 0, sound: "rocket", shake: 0.003, shell: "rocket", speed: 640, stock: true },
  flamer: { id: "flamer", name: "Огнемёт", short: "Огнемёт", mag: 50, rate: 0.06, reload: 2.2, pellets: 1, spread: 0.22, life: 0.42, dmg: 0.3, kb: 10, sound: "flame", shake: 0, shell: "flame", speed: 480, stock: true },
  saw: { id: "saw", name: "Бензопила", short: "Бензопила", mag: 0, rate: 0.1, reload: 0, pellets: 0, spread: 0, life: 0, dmg: 0.8, kb: 40, sound: "saw", shake: 0.0006 },
};
/** запас ракет и топлива: сколько даёт находка и предел */
const STOCK_MAX: Partial<Record<WeaponId, number>> = { bazooka: 8, flamer: 250 };
/** патроны для автомата, дробовика, пистолета: обычные, бронебойные (сквозь броню), зажигательные (поджигают) */
export const AMMO_MAX = 90;
/** название текущей главы */
const chTitle = () => t("st_chn", { n: CH + 1, name: t(`st_th_${CHAPTERS[CH].theme}` as Key) });
/** название оружия на текущем языке */
export const wname = (id: WeaponId) => t(`w_${id}` as Key);
/** ячейки 1–4 */
export const SLOTS: WeaponId[] = ["rifle", "shotgun", "pistol", "grenade", "bazooka", "flamer", "saw"];
/** с этим оружием можно бронебойные и зажигательные */
const BULLET_GUN = (id: WeaponId) => id === "rifle" || id === "shotgun" || id === "pistol";
/** граната: ближний и дальний бросок (px) и сколько секунд держать до полной силы */
const NADE_MIN = 60, NADE_MAX = 340, NADE_FULL = 0.9;
const MAX_MED = 5, MAX_GREN = 9, MED_HEAL = 35, ARMOR_ABSORB = 0.6;
const fullClips = () => Object.fromEntries(SLOTS.map((id) => [id, wstat(id).mag])) as Record<WeaponId, number>;
const baseClips = () => Object.fromEntries(SLOTS.map((id) => [id, WEAPONS[id].mag])) as Record<WeaponId, number>;
const ALL_OWNED = () => SLOTS.map(() => true);
/** в сюжете сначала только пистолет и гранаты */
const STORY_OWNED = () => SLOTS.map((id) => id === "pistol" || id === "grenade");

// ───────── прокачка: уровни героя и улучшения оружия ─────────
/** ступени улучшения оружия — по порядку, цена в деталях */
export const UPG: { key: Key; cost: number }[] = [
  { key: "up_dmg", cost: 10 }, { key: "up_mag", cost: 15 }, { key: "up_rel", cost: 20 }, { key: "up_acc", cost: 25 }, { key: "up_pierce", cost: 40 },
];
export const MAX_LV = 15;
/** сколько опыта до следующего уровня */
export const xpNeed = (lv: number) => 40 + 60 * lv;
/** бонусы уровней идут по кругу: 2 — здоровье, 3 — урон, 4 — перезарядка, 5 — скорость и граната, 6 — снова здоровье… */
export const lvBonus = (r: number, lv = S.level) => { let n = 0; for (let l = 2; l <= lv; l++) if ((l - 2) % 4 === r) n++; return n; };
export type WStat = WeaponDef & { pierce: number };
const wcache = new Map<string, WStat>();
/** оружие с улучшениями и бонусами уровня */
export function wstat(id: WeaponId): WStat {
  const u = S.up[id] ?? 0, key = `${id}${u}/${S.level}`;
  let r = wcache.get(key);
  if (!r) {
    const b = WEAPONS[id];
    r = { ...b, dmg: b.dmg * (u >= 1 ? 1.2 : 1) * (1 + 0.08 * lvBonus(1)), mag: Math.round(b.mag * (u >= 2 ? 1.5 : 1)), reload: b.reload * (u >= 3 ? 0.7 : 1) * (1 - 0.1 * lvBonus(2)), spread: b.spread * (u >= 4 ? 0.55 : 1), pierce: u >= 5 ? 1 : 0 };
    wcache.set(key, r);
  }
  return r;
}
export const heroSpeed = () => 1 + 0.04 * lvBonus(3);
export const heroMaxHp = () => 100 + 10 * lvBonus(0);
/** горячая точка на экране (кнопки HUD и снаряжения), x/y/w/h — в пикселях экрана */
interface Hit { x: number; y: number; w: number; h: number; fn: () => void }

// ───────── общее состояние для HUD ─────────
interface Stick { id: number; ox: number; oy: number; x: number; y: number }
export const S = (window as any).S = {
  hp: 100, maxHp: 100, grenades: 1, reload: 0, wave: 0, kills: 0, score: 0, over: false, time: 0, hurtV: 0,
  /** оружие: выбранная ячейка (0..3), патроны в магазинах, какое оружие есть (в «волнах» — всё) */
  weapon: 0, clip: baseClips(), owned: ALL_OWNED(),
  /** спецпатроны: выбранные (0 — обычные, 1 — бронебойные, 2 — зажигательные) и сколько есть; запас ракет и топлива */
  ammoK: 0, ap: 0, inc: 0, stock: { bazooka: 2, flamer: 50 } as Partial<Record<WeaponId, number>>,
  /** прокачка: уровень, опыт, детали, ступени улучшения оружия; верстак рядом (в «волнах» — всегда) */
  /** имя героя сюжета — как назвался хозяин игры */
  hero: "",
  level: 1, xp: 0, parts: 0, up: Object.fromEntries(SLOTS.map((id) => [id, 0])) as Record<WeaponId, number>, bench: true, invTab: 0,
  armor: 0, medkits: 0, inv: false, hits: [] as Hit[],
  /** открыт главный экран */
  menu: false,
  /** на узком тачскрине (вертикально) ячейки оружия под стиками — стики и кнопки подняты на столько px */
  lift: 0,
  /** сюжет: идёт сюжетная глава; bannerText — надпись заставки вместо «Волна N», bannerN — показать заставку ещё раз */
  story: false, bannerText: "", bannerN: 0,
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
/** броня на герое: стальной бронежилет (цвет как у полоски брони) и каска — видно издалека */
const withVest = (p: Palette): Palette => ({ ...p, FUR: [0x6e82a0, 0x5a6c88, 0x485870], FUR_DARK: [0x3a4658, 0x323c4c, 0x2a3240], LACE: 0x1e242e, BRASS: 0xc8d2e0 });
const withHelmet = (p: Palette): Palette => ({ ...p, HAIR: [0x6a7a92, 0x5a6a80, 0x7c8ca4, 0x4a586c] });
/** метатель: раздутый, желтушная кожа, лиловое тряпьё */
const PAL_ZOMBIE_C: Palette = {
  ...PAL_ZOMBIE_A,
  SKIN: 0xb0b25a, SKIN_SH: 0x8a8c40, FUR: [0x6a4a6e, 0x5a3e5e, 0x4a3250], FUR_DARK: [0x3e2a40, 0x342236, 0x4a3046], LACE: 0x8a2a24, EYE: 0xffd030, EYE_WHITE: 0xff8020,
};
/** в броне: стальной шлем (волосы) и латы на груди (жилет — вторая стопка, слетает, когда броню сбили) */
const PAL_ZOMBIE_D: Palette = { ...PAL_ZOMBIE_A, HAIR: [0x8a9098, 0x767c84, 0x9aa0a8, 0x62686e], BEARD: [0x3c4430, 0x2e3426, 0x48523a] };
const PAL_PLATE: Palette = { ...PAL_ZOMBIE_D, FUR: [0x9aa2ac, 0x828a94, 0x6a727c], LACE: 0x2a2c30, BRASS: 0xc0c8d0 };
/** громила: тёмно-багровая кожа, рваная спецовка */
const PAL_ZOMBIE_E: Palette = { ...PAL_ZOMBIE_A, SKIN: 0x9a6a5a, SKIN_SH: 0x7a4a3e, FUR: [0x3a4a5a, 0x2e3e4e, 0x26323e], FUR_DARK: [0x2a2420, 0x221e1a, 0x34302a], HAIR: [0x1a1612, 0x221c16, 0x2a2218, 0x14100c], EYE: 0xffd020 };
/** раздутый: болотно-зелёный, гнойные пятна */
const PAL_ZOMBIE_F: Palette = { ...PAL_ZOMBIE_A, SKIN: 0x8ab048, SKIN_SH: 0x6a8a30, FUR: [0x9ab04a, 0x7a9a3a, 0xb0c060], FUR_DARK: [0x5a6a2a, 0x4a5a22, 0x6a7a30], HAIR: [0x4a5a22, 0x3a4a1a, 0x5a6a2a, 0x2e3a14], EYE: 0xfff060, EYE_WHITE: 0xc0ff40 };
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
      // локоть: рука сгибается наружу и чуть вниз, тем сильнее, чем ближе кисть к плечу
      const su = 0.3, sv = side * ARM_V * VOX, du = hu - su, dv = hv - sv, dz = hz - ARM_Z, d = Math.hypot(du, dv, dz);
      const bend = Math.min(4.2, Math.sqrt(Math.max(0, 8.2 ** 2 - (d / 2) ** 2)));
      const e = P((su + hu) / 2 - 0.6, (sv + hv) / 2 + side * bend * 0.85, (ARM_Z + hz) / 2 - 1 - bend * 0.35);
      const OUT = 0x2e2014, sleeve = this.armored ? 0x5e6e82 : this.pal.FUR[1], cuff = this.armored ? 0x3a4452 : this.pal.FUR[2];
      sg.lineBetween(s.x, s.y, e.x, e.y).lineBetween(e.x, e.y, h.x, h.y).fillCircle(h.x, h.y, 2.9);
      // контур
      g.lineStyle(6.2, OUT).lineBetween(s.x, s.y, e.x, e.y).lineStyle(5, OUT).lineBetween(e.x, e.y, h.x, h.y);
      g.fillStyle(OUT).fillCircle(s.x, s.y, 3.3).fillCircle(e.x, e.y, 2.7);
      // плечо в рукаве, предплечье — кожа, сужается к запястью
      g.lineStyle(4.4, sleeve).lineBetween(s.x, s.y, e.x, e.y).fillStyle(sleeve).fillCircle(s.x, s.y, 2.4);
      g.lineStyle(1.2, cuff).lineBetween(s.x + (e.x - s.x) * 0.82, s.y + (e.y - s.y) * 0.82, e.x, e.y);
      g.fillStyle(skin).fillCircle(e.x, e.y, 1.75);
      const wx = e.x + (h.x - e.x) * 0.78, wy = e.y + (h.y - e.y) * 0.78;
      g.lineStyle(3.3, skin).lineBetween(e.x, e.y, wx, wy);
      // кисть: ладонь, пальцы вперёд по ходу предплечья и большой палец
      const fl = Math.max(0.01, Math.hypot(h.x - e.x, h.y - e.y)), fx = (h.x - e.x) / fl, fy = (h.y - e.y) / fl;
      g.fillStyle(OUT).fillCircle(h.x, h.y, 3).fillCircle(h.x + fx * 1.6, h.y + fy * 1.6, 2.4);
      g.fillStyle(skin).fillCircle(h.x, h.y, 2.2).fillCircle(h.x + fx * 1.6, h.y + fy * 1.6, 1.6);
      g.fillStyle(OUT).fillCircle(h.x - fy * side * 1.9, h.y + fx * side * 1.9, 1.3).fillStyle(skin).fillCircle(h.x - fy * side * 1.9, h.y + fx * side * 1.9, 0.75);
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
    } else if (this.gun && this.weapon === "bazooka") {
      // базука: толстая зелёная труба на правом плече
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const rk = this.recoil * this.recoil * (3 - 2 * this.recoil);
      const Pg = (u: number, v: number, z: number) => P(u - 5 * rk, v, z);
      const t0 = Pg(-11, 4.5, 14), t1 = Pg(22, 4.5, 14.6), m0 = Pg(19, 4.5, 14.5), m1 = Pg(24, 4.5, 14.7), r0 = Pg(-12, 4.5, 14), r1 = Pg(-8, 4.5, 14);
      g.lineStyle(9.5, 0x1a1c10).lineBetween(t0.x, t0.y, t1.x, t1.y);
      g.lineStyle(6.6, 0x5a6a30).lineBetween(t0.x, t0.y, t1.x, t1.y);
      g.lineStyle(2, 0x7a8a48).lineBetween(t0.x, t0.y - 1.5, t1.x, t1.y - 1.5);
      g.lineStyle(10.5, 0x1a1c10).lineBetween(m0.x, m0.y, m1.x, m1.y).lineStyle(7.5, 0x3a4420).lineBetween(m0.x, m0.y, m1.x, m1.y);
      g.lineStyle(10, 0x1a1c10).lineBetween(r0.x, r0.y, r1.x, r1.y).lineStyle(7, 0x3a4420).lineBetween(r0.x, r0.y, r1.x, r1.y);
      const sgt = Pg(8, 1.5, 17);
      g.fillStyle(0x1a1c10).fillRect(sgt.x - 2, sgt.y - 2, 4, 4).fillStyle(0x8a8a80).fillRect(sgt.x - 1, sgt.y - 1, 2, 2); // прицел
      sg.lineStyle(7, 0x000000).lineBetween(t0.x, t0.y, t1.x, t1.y).lineStyle(5, 0x000000);
      if (muzzle) {
        const f = Pg(28, 4.5, 14.7), bb = Pg(-17, 4.5, 14);
        g.fillStyle(0xff9a30, 0.9).fillCircle(f.x, f.y, 8).fillStyle(0xfff0a0, 0.95).fillCircle(f.x, f.y, 4);
        g.fillStyle(0xd8d0c0, 0.7).fillCircle(bb.x, bb.y, 9).fillStyle(0xffffff, 0.5).fillCircle(bb.x, bb.y, 5);
      }
      arm(1, 3 - 5 * rk, 4.2, 12.5);
      arm(-1, 11 - 5 * rk, 2.4, 13);
    } else if (this.gun && this.weapon === "flamer") {
      // огнемёт: красный бак под стволом, длинное сопло, синий огонёк запальника
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const rk = this.recoil * 0.5;
      const Pg = (u: number, v: number, z: number) => P(u - 2 * rk, v, z);
      const k0 = Pg(1, 2, 7.6), k1 = Pg(14, 2, 7.8), b0 = Pg(5, 1.4, 9.2), b1 = Pg(28, 1, 9.4);
      g.lineStyle(9, 0x1a120a).lineBetween(k0.x, k0.y, k1.x, k1.y);
      g.lineStyle(6.6, 0xb02a1a).lineBetween(k0.x, k0.y, k1.x, k1.y);
      g.lineStyle(2, 0xe05a40).lineBetween(k0.x, k0.y - 1.6, k1.x, k1.y - 1.6);
      g.lineStyle(5, 0x111111).lineBetween(b0.x, b0.y, b1.x, b1.y);
      g.lineStyle(2.6, 0x9a9a90).lineBetween(b0.x, b0.y, b1.x, b1.y);
      sg.lineBetween(k0.x, k0.y, k1.x, k1.y).lineBetween(b0.x, b0.y, b1.x, b1.y);
      const pl = Pg(29, 1, 9.4);
      g.fillStyle(0x60a0ff, 0.9).fillCircle(pl.x, pl.y, 1.8 + Math.random() * 0.6);
      if (muzzle) g.fillStyle(0xff7a20, 0.85).fillCircle(pl.x, pl.y, 6).fillStyle(0xffe080, 0.95).fillCircle(pl.x, pl.y, 3);
      arm(1, 7 - 2 * rk, 2.6, 8.4);
      arm(-1, 17 - 2 * rk, 1.2, 9.2);
    } else if (this.gun && this.weapon === "saw") {
      // бензопила: оранжевый мотор, длинная шина с цепью; работает — дрожит
      const g = Math.sin(a) < -0.25 ? this.back : this.front;
      const j = muzzle ? (Math.random() - 0.5) * 1.2 : 0;
      const Pg = (u: number, v: number, z: number) => P(u + j, v + j * 0.5, z);
      const e0 = Pg(3, 2, 8.4), e1 = Pg(12, 2, 8.6), s0 = Pg(12, 1.6, 8.8), s1 = Pg(33, 1.2, 9);
      g.lineStyle(10, 0x1a120a).lineBetween(e0.x, e0.y, e1.x, e1.y);
      g.lineStyle(7.4, 0xe07a20).lineBetween(e0.x, e0.y, e1.x, e1.y);
      g.lineStyle(2, 0x2a2a2a).lineBetween(e0.x, e0.y - 2, e1.x, e1.y - 2);
      g.lineStyle(6, 0x1a1a1a).lineBetween(s0.x, s0.y, s1.x, s1.y);
      g.lineStyle(3.4, 0xb8b8b0).lineBetween(s0.x, s0.y, s1.x, s1.y);
      // цепь: зубья бегут, пока пила работает
      const off = muzzle ? (performance.now() / 30) % 3 : 0;
      g.fillStyle(0x3a3a3a);
      for (let u = 13 + off; u < 33; u += 3) { const q = Pg(u, 1.4, 9.9); g.fillRect(q.x - 0.8, q.y - 0.8, 1.6, 1.6); }
      sg.lineBetween(e0.x, e0.y, e1.x, e1.y).lineBetween(s0.x, s0.y, s1.x, s1.y);
      if (muzzle) { const sm = Pg(1, 3, 10); g.fillStyle(0x9a9a90, 0.35).fillCircle(sm.x - 2, sm.y - 3, 3 + Math.random() * 2); }
      arm(1, 5, 2.8, 8.6);
      arm(-1, 10, -1, 10.4);
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
    // каска — только у героев (у зомби в латах свой шлем в палитре)
    const hk = on ? `${this.skin}A_head` : `${this.skin}_head`;
    if (this.body.scene.textures.exists(hk) && this.body.scene.textures.exists(`${this.skin}A_head`)) this.head.setTexture(hk, this.head.frame.name);
  }
}

// ───────── враги ─────────
export type Kind = "zombie" | "runner" | "rat" | "hyena" | "panther" | "bear" | "spitter" | "armored" | "brute" | "bloater";
const KINDS: Record<Kind, { hp: number; speed: number; r: number; dmg: number; score: number; sprite?: string; size?: number; mass: number; blood: number }> = {
  zombie: { hp: 4, speed: 50, r: 11, dmg: 12, score: 10, mass: 1, blood: 0x4a3a1c },
  runner: { hp: 3, speed: 92, r: 11, dmg: 10, score: 15, mass: 1, blood: 0x4a3a1c },
  rat: { hp: 1, speed: 125, r: 7, dmg: 5, score: 5, sprite: "rodent", size: 34, mass: 0.5, blood: 0x8a1010 },
  hyena: { hp: 3, speed: 150, r: 11, dmg: 8, score: 15, sprite: "scavenger", size: 58, mass: 1, blood: 0x8a1010 },
  panther: { hp: 5, speed: 185, r: 12, dmg: 12, score: 25, sprite: "shadowcat", size: 66, mass: 1.2, blood: 0x6a0c0c },
  bear: { hp: 30, speed: 62, r: 28, dmg: 30, score: 100, sprite: "giant", size: 120, mass: 6, blood: 0x6a0c0c },
  /** метатель: медленный, держится поодаль и кидается кусками своего тела */
  spitter: { hp: 8, speed: 34, r: 12, dmg: 10, score: 30, mass: 1.5, blood: 0x7a1010 },
  /** в броне: спереди пули отскакивают (броня понемногу сбивается); сзади, бронебойными, огнём, взрывом и пилой — как обычный */
  armored: { hp: 7, speed: 46, r: 12, dmg: 14, score: 40, mass: 2.2, blood: 0x4a3a1c },
  /** громила: огромный, много здоровья, бьёт сильно */
  brute: { hp: 30, speed: 44, r: 19, dmg: 26, score: 70, mass: 5, blood: 0x6a1a10 },
  /** раздутый: подходит вплотную и лопается — взрыв ранит всех рядом (и монстров) */
  bloater: { hp: 6, speed: 42, r: 15, dmg: 10, score: 30, mass: 2, blood: 0x7a9a2a },
};
/** сколько ударов по броне выдерживает броня «в броне» */
const ARMOR_PTS = 14;
/** масштаб фигуры (громила и раздутый — крупнее) */
const KIND_SCALE: Partial<Record<Kind, number>> = { brute: 1.6, bloater: 1.3 };
interface Enemy {
  kind: Kind; x: number; y: number; kx: number; ky: number; hp: number; a: number; ph: number; cool: number; hitT: number;
  /** сюжет: с какого участка (-1 — бродячий); финальный босс */ seg?: number; boss?: boolean;
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
  /** броня (у «в броне»), горит ещё столько секунд, когда следующий ожог */
  arm?: number; burn?: number; burnT?: number;
}
/** детали с врага: [шанс, от, до] */
const PARTS: Record<Kind, [number, number, number]> = { zombie: [0.05, 1, 1], runner: [0.07, 1, 1], rat: [0.02, 1, 1], hyena: [0.08, 1, 1], panther: [0.3, 1, 2], bear: [1, 4, 6], spitter: [0.35, 1, 2], armored: [0.5, 1, 3], brute: [0.8, 2, 4], bloater: [0.2, 1, 2] };
/** шанс выпадения: [граната, аптечка, бронежилет] */
const DROP: Record<Kind, [number, number, number]> = { zombie: [0.03, 0.03, 0.01], runner: [0.04, 0.035, 0.015], rat: [0.01, 0.02, 0], hyena: [0.05, 0.04, 0.02], panther: [0.08, 0.06, 0.05], bear: [0.6, 0.6, 0.4], spitter: [0.06, 0.05, 0.03], armored: [0.08, 0.06, 0.12], brute: [0.4, 0.5, 0.3], bloater: [0.06, 0.04, 0] };
/** шанс, что с монстра выпадут патроны (бронебойные / зажигательные / ракеты / топливо — что пригодится) */
const AMMO_DROP: Record<Kind, number> = { zombie: 0.04, runner: 0.05, rat: 0.01, hyena: 0.05, panther: 0.1, bear: 0.8, spitter: 0.1, armored: 0.25, brute: 0.6, bloater: 0.1 };
type ItemKind = "grenade" | "medkit" | "armor" | "ap" | "inc" | "rocket" | "fuel";
const ITEM_KINDS: ItemKind[] = ["grenade", "medkit", "armor", "ap", "inc", "rocket", "fuel"];
/** сколько даёт находка патронов */
const AMMO_GIVE: Partial<Record<ItemKind, number>> = { ap: 24, inc: 24, rocket: 2, fuel: 60 };
/** свечение находки ночью и точка на мини-карте */
const ITEM_COL: Record<ItemKind, number> = { grenade: 0x9aff60, medkit: 0xff5050, armor: 0x80b0ff, ap: 0x80e8ff, inc: 0xff8a30, rocket: 0xffd040, fuel: 0xff5030 };
interface Item { id: number; kind: ItemKind; x: number; y: number; z: number; vz: number; t: number; life: number; img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image }
interface Nade { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; spin: number; img: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Image }
/** высота для длины тени, px */
const HEIGHT: Record<Kind, number> = { zombie: 30, runner: 30, rat: 6, hyena: 14, panther: 16, bear: 36, spitter: 30, armored: 30, brute: 48, bloater: 38 };
/** отлетевший кусок: летит по дуге (z — высота), подпрыгивает, остаётся лежать и тает */
interface Gib {
  o: Phaser.GameObjects.Image; sh: Phaser.GameObjects.Ellipse; x: number; y: number; z: number; vx: number; vy: number; vz: number; vr: number;
  life: number; rest: boolean; blood: number | null; casing: boolean; trail: number;
}
const MEAT = [0x6a1a14, 0x8a2a20, 0x4a0e0a, 0xa0443a];
const VOICE: Record<Kind, "groan" | "growl" | "squeak" | "roar"> = { zombie: "groan", runner: "groan", rat: "squeak", hyena: "growl", panther: "growl", bear: "roar", spitter: "groan", armored: "groan", brute: "roar", bloater: "groan" };
interface Ob { x: number; y: number; r: number; img: Phaser.GameObjects.Image; canopy: number; size: number; /** предмет (бочка, ящик…) */ prop?: Prop; /** стоит «вертикально» (тень как у дерева) */ upright?: boolean; /** низкий — пули летят над ним */ low?: boolean; /** тень рисуется отдельно (нарисованные постройки) */ noSh?: boolean }
type PropKind = "barrel" | "drum" | "crate" | "car" | "fire" | "lamp" | "fence" | "sign" | "tires" | "deco";
/** предмет на карте. Разрушаемые: бочка (взрывается), ящик (ломается, иногда с находкой) */
interface Prop { id: number; kind: PropKind; x: number; y: number; hp: number; img: Phaser.GameObjects.Image; ob?: Ob; wall?: WallBox; dead: boolean;
  /** сюжет: в ящике оружие (номер ячейки) */ loot?: number; star?: Phaser.GameObjects.Image;
  /** свет: костёр — всегда (ночью ярче), фонарь — ночью; flick — сила мерцания */
  light?: { dx: number; dy: number; r: number; col: number; a: number; flick: number; night: boolean }; fire?: Phaser.GameObjects.Particles.ParticleEmitter }
/** горящее пятно после взрыва бочки: жжёт, светится, гаснет */
interface Burn { x: number; y: number; t: number; fire: Phaser.GameObjects.Particles.ParticleEmitter; tick: number }
/** где у дерева на картинке основание ствола (доля высоты): картинка ставится основанием в точку ствола */
const TREE_BASE: Record<string, number> = { tree_1: 0.87, tree_2: 0.845, tree_3: 0.8, tree_5: 0.84, tree_6: 0.825, pine_1: 0.91, pine_2: 0.88, dead_tree_1: 0.93, dead_tree_2: 0.91 };
/** вид снаряда: ракета, огонь, бронебойная, зажигательная (без — обычная пуля) */
type Shell = "rocket" | "flame" | "ap" | "fire";
interface Bullet { x: number; y: number; dx: number; dy: number; life: number; d: number; bounces: number; dmg: number; kb: number; /** пробивает ещё стольких врагов */ pierce?: number; last?: Enemy; /** длина трассера */ tr: number; /** только для вида (у гостя): не ранит */ vis?: boolean;
  kind?: Shell; /** скорость, px/с */ v?: number }
/** пули одного выстрела (дробь — веером); ak — спецпатроны (1 бронебойные, 2 зажигательные) */
function shotBullets(w: WeaponDef, x: number, y: number, as: number[], vis: boolean, ak = 0): Bullet[] {
  const kind: Shell | undefined = w.shell ?? (ak === 1 ? "ap" : ak === 2 ? "fire" : undefined);
  return as.map((a) => ({ x, y, dx: Math.cos(a), dy: Math.sin(a), life: w.life * (w.pellets > 1 || w.shell === "flame" ? rand(0.85, 1.15) : 1), d: 0, bounces: 0, dmg: w.dmg, kb: w.kb, pierce: w.shell === "flame" ? 99 : (w as WStat).pierce ?? 0, tr: w.pellets > 1 ? 9 : 16, vis, kind, v: w.speed }));
}
/** другой игрок (у хозяина — гости, у гостя — хозяин и остальные) */
interface Mate { id: string; name: string; label: Phaser.GameObjects.Text; hum: Humanoid; x: number; y: number; tx: number; ty: number; fx?: number; fy?: number; iu?: number; gap: number; last: number; aimA: number; moveA: number; ph: number; moving: number; muzzle: number; hp: number; dead: boolean; gren: number; seen: number; w: number; armor: number; med: number;
  /** макс. здоровье гостя (с бонусами уровня), сколько секунд лежит (сюжет), бот-напарник */
  mh?: number; deadT?: number; bot?: Bot }
/** мозги бота-напарника (у хозяина или в одиночной игре) */
interface Bot { idx: number; think: number; tgt?: Enemy; fireT: number; rel: number; clip: number; stuckT: number }
const BOT_GUN: WeaponDef = { ...WEAPONS.rifle, dmg: 0.8 };
const KIND_LIST: Kind[] = ["zombie", "runner", "rat", "hyena", "panther", "bear", "spitter", "armored", "brute", "bloater"];
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
/** предметы из срезов: точка опоры и размер в мире */
let SV: ReturnType<typeof makeSliceProps> = {};
const SV_SCALE = 1.6;
/** гость в сюжете: по какому «hi» хозяина уже перезапущен мир (новый «hi» — хозяин начал заново с лагеря) */
let syncedHi: Record<string, any> | null = null;

class Game extends Phaser.Scene {
  player!: Humanoid;
  px = W / 2; py = H / 2; aimA = 0; moveA = 0; ph = 0; moving = 0;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  enemies: Enemy[] = [];
  obs: Ob[] = [];
  /** дом и его стены (прямоугольники) */
  house?: House;
  walls: WallBox[] = [];
  /** тени нарисованных построек и машин: картинка и сплющенность силуэта */
  artSh: [Phaser.GameObjects.Image, number, number?][] = [];
  yards: { x: number; y: number; w: number; h: number; path: boolean }[] = [];
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
  splats: Phaser.GameObjects.Image[] = [];
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
  props: Prop[] = [];
  /** сюжет: заслоны, лагеря, проснувшиеся группы */
  gates: { y: number; open: boolean; walls: WallBox[]; imgs: Phaser.GameObjects.GameObject[]; seg: number }[] = [];
  deco?: (name: string, x: number, y: number, rot?: number) => void;
  /** какие предметы из срезов ставить (тема места) */
  decoSet(): string[] {
    const th = S.story ? CHAPTERS[CH].theme : "farm";
    return {
      farm: ["hay_round", "hay_block", "well", "cart", "stump", "pumpkins", "scarecrow", "logs", "gravestone", "hay_round", "logs"],
      road: ["cone", "cone", "barrier", "barrier", "tire_stack", "sign_post", "sign_post", "logs", "stump", "trash_bin"],
      town: ["hydrant", "bench", "trash_bin", "traffic_light", "mailbox", "bench", "hydrant", "cone", "sign_post", "trash_bin"],
      factory: ["pallet", "pallet", "gas_cyl", "toolbox", "valve", "valve", "barrier", "cone", "trash_bin", "ammo_crate"],
      dam: ["sandbags", "sandbags", "ammo_crate", "searchlight", "rock_moss", "rock_moss", "barrier", "gas_cyl", "sign_post"],
      waste: ["rubble", "rubble", "tire_stack", "stump", "rock_moss", "sign_post", "trash_bin", "logs", "gravestone", "rubble"],
      junk: ["scrap_pile", "scrap_pile", "scrap_pile", "fridge", "washer", "tire_stack", "tire_stack", "pallet", "gas_cyl", "trash_bin", "rubble"],
      tunnel: ["jersey", "jersey", "cone", "cone", "barrier", "rubble", "trash_bin", "gas_cyl", "sign_post", "tire_stack"],
    }[th];
  }
  seg = 0; deadT = 0; woke: boolean[] = []; campDone: boolean[] = []; strT = 8; gateMsgT = 0; storyEnd = false;
  burns: Burn[] = [];
  lookX = 0; lookY = 0; beatT = 0; ambT = 4;
  constructor() { super("game"); }

  preload() {
    // картинки встроены прямо в сборку (data URI) — игра открывается двойным кликом по html без сервера
    for (const [path, url] of Object.entries(SPRITES)) this.load.image(path.split("/").pop()!.replace(".png", ""), url);
    loadPropFiles(this);
    loadGroundFiles(this);
    loadArtFiles(this);
  }

  create() {
    if (MODE === "story") setChapter(storyCh);
    [W, H] = MODE === "story" ? [STORY_W, STORY_H] : [3000, 3000];
    this.gn = Math.ceil(Math.max(W, H) / Game.CELL);
    this.blocked = new Uint8Array(this.gn * this.gn); this.dist = new Float32Array(this.gn * this.gn);
    Object.assign(S, { level: 1, xp: 0, parts: 0, up: { rifle: 0, shotgun: 0, pistol: 0, grenade: 0 }, maxHp: 100, bench: MODE !== "story", invTab: 0 });
    Object.assign(S, { paused: false, inv: false, hp: 100, armor: 0, medkits: 0, weapon: 0, clip: fullClips(), grenades: 1, reload: 0, wave: START_WAVE - 1, kills: 0, score: 0, time: 0, hurtV: 0, over: false, msg: "", msgT: 0, move: null, aim: null, story: MODE === "story", bannerText: "", owned: ALL_OWNED(), ammoK: 0, ap: 0, inc: 0, stock: { bazooka: 2, flamer: 50 } });
    this.lastSnap = 0; this.waitHost = false; this.wallShG = undefined;
    this.mates = new Map(); this.dead = false; this.netNades = []; this.items = []; this.nades = []; this.spits = []; this.booms = []; this.flowCell = -1;
    this.props = []; this.burns = [];
    makePropArt(this);
    SV = makeSliceProps(this);
    makeGround(this);
    makeGroundPatches(this); makeSplats(this);
    this.enemies = []; this.obs = []; this.artSh = []; this.bullets = []; this.gibs = []; this.splats = []; this.spawnQ = []; this.waveT = 1.5; this.px = W / 2; this.py = H / 2;
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
    makeStack(this, "zD_body", PAL_ZOMBIE_D, "body");
    makeStack(this, "zD_head", PAL_ZOMBIE_D, "head");
    makeStack(this, "zDA_body", PAL_PLATE, "body");
    makeStack(this, "zE_body", PAL_ZOMBIE_E, "body");
    makeStack(this, "zE_head", PAL_ZOMBIE_E, "head");
    makeStack(this, "zF_body", PAL_ZOMBIE_F, "body");
    makeStack(this, "zF_head", PAL_ZOMBIE_F, "head");
    makeItem(this, "it_ap", ammoVox(0x3a5a6a, 0x80e8ff), 18, 0.7);
    makeItem(this, "it_inc", ammoVox(0x5a3a22, 0xff7a20), 18, 0.7);
    makeItem(this, "it_rocket", ammoVox(0x4a5a2a, 0xffd040), 18, 0.7);
    makeItem(this, "it_fuel", ammoVox(0xb02a1a, 0xe8d8a0, true), 16, 0.7);
    makeStack(this, "heroA_body", withVest(PAL_HERO), "body");
    makeStack(this, "mateA_body", withVest(PAL_MATE), "body");
    makeStack(this, "heroA_head", withHelmet(PAL_HERO), "head");
    makeStack(this, "mateA_head", withHelmet(PAL_MATE), "head");
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
    if (S.story) this.storyStart();
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
    // нарисованные предметы (колодец, сено…) — силуэт сразу за ними: «деревянная» тень от них отрывается
    for (const o of this.obs) if (!o.noSh && o.img.texture.key.startsWith("ob_")) this.light.addTree(o.img, 0.35, 0.1);
    for (const o of this.obs) if (!o.low && !o.noSh && !o.img.texture.key.startsWith("ob_")) o.canopy || o.upright ? this.light.addTree(o.img) : this.light.addCaster(o.img, o.r * 0.55);
    // высокие (k < 0) — тень как у дерева, от основания; широкие постройки и машины — силуэт сразу за ними
    // k > 0 — тень лежит на земле от основания (сплющена в k раз), k < 0 — заборы: силуэт со сдвигом (они повёрнуты)
    for (const [im, k, lift] of this.artSh) k > 0 ? this.light.addTree(im, k, lift ?? 0.2) : this.light.addDrop(im, -k);
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
    kb.on("keydown-B", () => this.cycleAmmo());
    (["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN"] as const).forEach((k, i) => { kb.on(`keydown-${k}`, () => this.selectWeapon(i)); kb.on(`keydown-NUMPAD_${k}`, () => this.selectWeapon(i)); });
    kb.on("keydown-Q", () => this.useMedkit());
    kb.on("keydown-I", () => this.toggleInv());
    kb.on("keydown-TAB", () => this.toggleInv());
    kb.on("keydown-U", () => { if (!S.inv) { S.invTab = 1; this.toggleInv(); } else S.invTab = S.invTab ? 0 : 1; });
    kb.addCapture("TAB");
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => { if (!S.paused && !S.over && dy) this.cycleWeapon(dy > 0 ? 1 : -1); });
    // граната: чем дольше держишь, тем дальше бросок (отпустил — полетела)
    kb.on("keydown-G", (e: KeyboardEvent) => { if (!e.repeat) this.chargeNade("key"); });
    kb.on("keyup-G", () => this.releaseNade("key"));
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
      if (!p.wasTouch) { if (p.rightButtonDown()) this.chargeNade("mouse"); return; }
      // кнопка гранаты над правым стиком
      if (Math.hypot(p.x - (this.scale.width - 110), p.y - (this.scale.height - 235 - S.lift)) < 38) { this.chargeNade("touch", p.id); return; }
      const st = { id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y };
      if (p.x < this.scale.width / 2) { if (!S.move) S.move = st; } else if (!S.aim) S.aim = st;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) { S.touch = false; this.mouse = { x: p.x, y: p.y }; return; }
      for (const st of [S.move, S.aim]) if (st && st.id === p.id) { st.x = p.x; st.y = p.y; }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (this.charge && (this.charge.src === "mouse" ? !p.wasTouch && !p.rightButtonDown() : this.charge.src === "touch" && this.charge.pid === p.id)) this.releaseNade(this.charge.src);
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
    this.overShown = false;
    if (menuOnStart) { menuOnStart = false; this.showMenu(); } else { closeMenu(); if (!S.story) startRun(); }
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
    this.menuStart();
    const kb = this.input.keyboard!;
    kb.enabled = false; kb.disableGlobalCapture(); kb.resetKeys();
    const code = JOIN && !autoJoined ? (JOIN.match(/[A-Za-z0-9]{5}/)?.[0] ?? "").toUpperCase() : "";
    autoJoined = true; // ссылку-приглашение предлагаем кнопкой в меню
    openMenu({
      waves: () => this.startPlay(),
      story: (fresh, ch) => this.startStory(fresh, ch),
      host: () => { this.startPlay(); this.hostGame(); },
      join: (c) => { this.startPlay(); this.joinGame(c); },
      changed: () => this.applySettings(),
    }, code);
  }
  /** точка, над которой висит камера главного экрана (медленная восьмёрка по карте) */
  menuSpot(t: number) {
    return { x: W / 2 + Math.sin(t * 0.045) * 700, y: H / 2 + Math.sin(t * 0.07 + 1) * 520 };
  }
  menuT = 0;
  /** главный экран: зомби для фона, герой спрятан */
  menuStart() {
    this.menuT = Math.random() * 100;
    this.cameras.main.stopFollow();
    this.player.c.setVisible(false);
    const p = this.menuSpot(this.menuT);
    this.px = p.x; this.py = p.y;
    const kinds: Kind[] = ["zombie", "zombie", "zombie", "spitter", "zombie", "runner", "zombie", "rat", "zombie", "spitter", "zombie", "zombie", "rat", "zombie"];
    kinds.forEach((k, i) => {
      const a = rand(0, TAU), d = rand(60, 520);
      const q = this.collide(Phaser.Math.Clamp(p.x + Math.cos(a) * d, 80, W - 80), Phaser.Math.Clamp(p.y + Math.sin(a) * d, 80, H - 80), KINDS[k].r);
      const e = this.addEnemy(k, q.x, q.y, -1 - i);
      e.a = rand(0, TAU); e.tx = e.x; e.ty = e.y; e.st = rand(0, 3);
    });
  }
  menuWorld(dt: number) {
    this.menuT += dt;
    const p = this.menuSpot(this.menuT), cam = this.cameras.main;
    this.px = p.x; this.py = p.y;
    cam.centerOn(p.x, p.y);
    this.aimA = this.menuT * 0.15;
    for (const e of this.enemies) {
      if (e.dead) continue;
      // бредёт к случайной точке рядом с камерой, иногда стоит и качается
      e.st -= dt;
      if (e.st <= 0 || Math.hypot(e.tx - e.x, e.ty - e.y) < 12) {
        e.st = rand(4, 9);
        const a = rand(0, TAU), d = rand(80, 420);
        e.tx = Phaser.Math.Clamp(p.x + Math.cos(a) * d, 80, W - 80); e.ty = Phaser.Math.Clamp(p.y + Math.sin(a) * d, 80, H - 80);
      }
      const far = Math.hypot(p.x - e.x, p.y - e.y) > 650; // отстал от камеры — догоняет
      const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy) || 1;
      const idle = e.st > 7.5 && !far;
      const spd = idle ? 0 : (e.kind === "rat" ? 70 : e.kind === "runner" ? 45 : 22) * (far ? 2.5 : 1);
      if (spd) {
        const want = Math.atan2(dy, dx);
        e.a += Phaser.Math.Angle.Wrap(want - e.a) * Math.min(1, dt * 2.5);
        const q = this.collide(e.x + Math.cos(e.a) * spd * dt, e.y + Math.sin(e.a) * spd * dt, KINDS[e.kind].r);
        if (Math.hypot(q.x - e.x, q.y - e.y) < spd * dt * 0.3) e.st = 0; // упёрся — другая цель
        e.x = q.x; e.y = q.y;
        e.ph += dt * spd * 0.12;
      }
      e.c.setPosition(e.x, e.y).setDepth(e.y);
      if (e.hum) e.hum.pose(e.a, e.a, e.ph, spd ? 1 : 0, false, Math.sin(this.menuT * 0.8 + e.id));
      else if (e.img) e.img.setRotation(e.a + Math.PI / 2 + Math.sin(e.ph) * 0.08);
    }
  }
  overShown = false;
  /** экран смерти (DOM поверх игры): итоги, рекорд, место в топе */
  showOver() {
    const kb = this.input.keyboard!;
    kb.resetKeys();
    openOver({
      waves: () => {}, host: () => {}, join: () => {},
      changed: () => this.applySettings(),
      again: () => this.restartGame(),
      menu: () => this.toMenu(),
    }, { score: S.score, wave: S.wave, kills: S.kills, time: Math.round(S.time), co: NET.role === "solo" ? 1 : NET.role === "host" ? NET.conns.size + 1 : 2 }, NET.role === "client");
  }
  startPlay() {
    // зомби главного экрана уходят, игра начинается с героя в центре
    for (const e of this.enemies) e.c.destroy();
    this.enemies = [];
    this.px = W / 2; this.py = H / 2;
    this.player.c.setPosition(this.px, this.py).setVisible(true);
    this.cameras.main.startFollow(this.player.c, true, 0.15, 0.15);
    this.cameras.main.centerOn(this.px, this.py);
    closeMenu();
    S.menu = false;
    startRun();
    unlockAudio();
    const kb = this.input.keyboard!;
    kb.enabled = true; kb.enableGlobalCapture(); kb.resetKeys();
  }

  // ───────── сюжет ─────────
  /** из меню: новая игра или продолжение с последнего лагеря */
  startStory(fresh: boolean, pick?: number) {
    if (pick !== undefined && pick > 0) {
      // выбранная глава: начало главы, прокачка из сохранения, оружие из прошлых глав
      const old = loadStory();
      const owned = STORY_OWNED().map((v, k) => v || !!old?.owned?.[k] || CHAPTERS.slice(0, pick).some((c) => c.weapons?.some((w) => w.slot === k)));
      const has = (id: WeaponId) => owned[SLOTS.indexOf(id)];
      saveStory({ ch: pick + 1, camp: 0, hp: 999, armor: 0, medkits: 1, grenades: 2, owned, clip: {}, weapon: has("rifle") ? 0 : has("shotgun") ? 1 : 2, kills: 0, score: 0, time: 0,
        ap: 0, inc: 0, stock: { bazooka: has("bazooka") ? 4 : 0, flamer: has("flamer") ? 120 : 0 }, level: old?.level, xp: old?.xp, parts: old?.parts, up: old?.up });
      fresh = false;
    }
    if (fresh) saveStory(null);
    storyCh = fresh ? 0 : Math.max(0, (loadStory()?.ch ?? 1) - 1);
    MODE = "story";
    menuOnStart = false;
    closeMenu();
    S.menu = false;
    unlockAudio();
    const kb = this.input.keyboard!;
    kb.enabled = true; kb.enableGlobalCapture(); kb.resetKeys();
    this.scene.restart();
  }
  /** начало главы (или продолжение): герой у дома или в последнем лагере, всё из сохранения */
  storyStart() {
    if (!S.hero) S.hero = S.myName;
    if (NET.role === "client") {
      // гость: мир и участок — от хозяина (в «hi»), своя прокачка — из своего сохранения
      this.seg = 0; this.storyEnd = false; this.strT = 1e9; this.gateMsgT = 0;
      this.woke = GROUPS.map(() => true); this.campDone = CAMPS.map(() => false);
      S.owned = STORY_OWNED(); S.weapon = 2; S.grenades = 1; S.stock = { bazooka: 0, flamer: 0 };
      const hv = loadHero();
      if (hv) Object.assign(S, { level: hv.level, xp: hv.xp, parts: hv.parts, up: { ...S.up, ...hv.up } });
      S.maxHp = heroMaxHp(); S.hp = S.maxHp; S.clip = fullClips();
      return;
    }
    const sv0 = loadStory(), sv = sv0 && sv0.ch - 1 === CH ? sv0 : null;
    const camp = sv ? Math.min(sv.camp, CAMPS.length) : 0;
    this.seg = camp; this.storyEnd = false; this.strT = 8; this.gateMsgT = 0;
    this.woke = GROUPS.map((g) => g.seg < camp);
    this.campDone = CAMPS.map((_, k) => k < camp);
    for (let k = 0; k < camp; k++) this.openGate(k, false);
    S.owned = STORY_OWNED();
    S.weapon = 2; S.grenades = 1; S.stock = { bazooka: 0, flamer: 0 };
    if (sv) {
      Object.assign(S, { hp: sv.hp, armor: sv.armor, medkits: sv.medkits, grenades: sv.grenades, owned: SLOTS.map((_, k) => !!sv.owned[k]), ap: sv.ap ?? 0, inc: sv.inc ?? 0, stock: { bazooka: 0, flamer: 0, ...(sv.stock ?? {}) }, clip: { ...fullClips(), ...sv.clip }, weapon: sv.weapon, kills: sv.kills, score: sv.score, time: sv.time });
      Object.assign(S, { level: sv.level ?? 1, xp: sv.xp ?? 0, parts: sv.parts ?? 0, up: { ...S.up, ...(sv.up ?? {}) } });
      S.maxHp = heroMaxHp(); S.clip = { ...fullClips(), ...sv.clip }; S.hp = Math.min(S.hp, S.maxHp);
      // ящик с оружием, которое уже есть, не нужен
      for (const p of this.props) if (p.loot !== undefined && S.owned[p.loot]) { p.loot = undefined; p.light = undefined; p.star?.destroy(); }
    }
    const at = camp > 0 ? { x: CAMPS[camp - 1].x, y: CAMPS[camp - 1].y + 70 } : START;
    this.px = at.x; this.py = at.y;
    S.wave = camp + 1;
    S.bannerText = camp > 0 ? t("st_seg", { n: camp + 1, m: SEGS }) : chTitle();
    S.bannerN++;
    S.msg = camp > 0 ? t("st_go") : CH === 0 ? t("st_radio") : t(`st_in_${CHAPTERS[CH].theme}` as Key, { name: S.hero || t("player") }); S.msgT = camp > 0 ? 3 : 6;
    if (camp === 0 && CH === 0) this.time.delayedCall(6500, () => { if (!S.msgT || S.msg === t("st_radio")) { S.msg = t("st_intro", { name: S.hero || t("player") }); S.msgT = 4; } });
    this.fitBots();
  }
  /** боты-напарники: отряд до 4 — сколько выбрано в меню, но не больше свободных мест */
  fitBots() {
    if (NET.role === "client" || !S.story) return;
    const humans = [...this.mates.values()].filter((m) => !m.bot).length;
    const want = Math.max(0, Math.min(settings.bots ?? 0, 3 - humans));
    const bots = [...this.mates.values()].filter((m) => m.bot);
    while (bots.length > want) { const m = bots.pop()!; m.hum.c.destroy(); m.label.destroy(); this.mates.delete(m.id); }
    const names = t("bot_names").split(",");
    for (let i = 0; bots.length < want && i < 3; i++) {
      const id = `bot${i}`;
      if (this.mates.has(id)) continue;
      const q = this.collide(this.px - 50 + i * 50, this.py + 50, 10);
      const m = this.mate(id, q.x, q.y);
      m.name = names[i] ?? `Bot ${i + 1}`; m.label.setText(m.name).setColor("#c8f0a0");
      m.bot = { idx: i, think: 0, fireT: 0, rel: 0, clip: 30, stuckT: 0 };
      m.w = 0; m.mh = 100; m.hp = 100;
      bots.push(m);
    }
  }
  /** бот: держится за ведущим, стреляет в ближайшего монстра, отходит от тех, кто подошёл вплотную */
  updateBots(dt: number) {
    if (NET.role === "client") return;
    const bots = [...this.mates.values()].filter((m) => m.bot);
    if (!bots.length) return;
    const now = performance.now();
    const alive = [...this.mates.values()].find((q) => !q.dead && !q.bot) ?? bots.find((q) => !q.dead);
    const lead = !this.dead ? { x: this.px, y: this.py, a: this.moveA } : alive ? { x: alive.x, y: alive.y, a: alive.moveA } : null;
    bots.forEach((m, i) => {
      const b = m.bot!; m.seen = now;
      if (m.dead || !lead) return;
      b.think -= dt;
      if (b.think <= 0 || b.tgt?.dead) {
        b.think = rand(0.18, 0.3);
        let best: Enemy | undefined, bd = 400;
        for (const e of this.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - m.x, e.y - m.y); if (d < bd) { bd = d; best = e; } }
        b.tgt = best;
      }
      // место в строю: позади ведущего, веером
      const side = i - (bots.length - 1) / 2, back = lead.a + Math.PI;
      let gx = lead.x + Math.cos(back) * 62 + Math.cos(back + Math.PI / 2) * side * 50, gy = lead.y + Math.sin(back) * 62 + Math.sin(back + Math.PI / 2) * side * 50;
      const dl = Math.hypot(lead.x - m.x, lead.y - m.y);
      if (b.tgt) { const d = Math.hypot(b.tgt.x - m.x, b.tgt.y - m.y); if (d < 110 && d > 1) { gx = m.x - ((b.tgt.x - m.x) / d) * 90; gy = m.y - ((b.tgt.y - m.y) / d) * 90; } }
      const dx = gx - m.x, dy = gy - m.y, d = Math.hypot(dx, dy);
      let mv = 0;
      if (d > 16) {
        const sp = 165 * (dl > 220 ? 1.3 : 1), st = Math.min(d, sp * dt);
        const q = this.collide(m.x + (dx / d) * st, m.y + (dy / d) * st, 10);
        const went = Math.hypot(q.x - m.x, q.y - m.y);
        mv = went / (sp * dt + 1e-6);
        m.x = q.x; m.y = q.y; m.moveA = Math.atan2(dy, dx); m.ph += went * 0.12;
        b.stuckT = mv < 0.25 && d > 80 ? b.stuckT + dt : 0;
      }
      // отстал или застрял — догоняет (перебегает к ведущему)
      if (dl > 560 || b.stuckT > 1.6) { const q = this.collide(lead.x + Math.cos(back) * 50 + side * 30, lead.y + Math.sin(back) * 50, 10); m.x = q.x; m.y = q.y; b.stuckT = 0; }
      m.moving = Phaser.Math.Linear(m.moving, Math.min(1, mv), 0.25);
      m.tx = m.fx = m.x; m.ty = m.fy = m.y;
      // стрельба
      b.fireT -= dt; b.rel -= dt;
      if (b.tgt) {
        m.aimA = Math.atan2(b.tgt.y - m.y, b.tgt.x - m.x);
        if (b.rel <= 0 && b.fireT <= 0) {
          if (b.clip <= 0) { b.rel = 1.8; b.clip = 30; }
          else {
            b.clip--; b.fireT = rand(0.13, 0.24);
            const a = Math.round((m.aimA + (Math.random() - 0.5) * 0.12) * 1000) / 1000;
            const bx = Math.round(m.x + Math.cos(a) * 6), by = Math.round(m.y + Math.sin(a) * 6);
            this.bullets.push(...shotBullets(BOT_GUN, bx, by, [a], false));
            m.muzzle = 0.06; m.hum.recoil = 1;
            sfx("shot", this.near(m.x, m.y) * 0.55);
            if (NET.role === "host") send({ t: "fx", k: "shot", who: m.id, x: bx, y: by, as: [a], w: "rifle" });
          }
        }
      } else {
        m.aimA = m.moveA;
        if (m.hp < 100) m.hp = Math.min(100, m.hp + dt * 2); // без боя понемногу лечится
      }
    });
  }
  /** проход в заслоне открывается: доски разлетаются */
  openGate(k: number, fx: boolean) {
    const g = this.gates[k];
    if (!g || g.open) return;
    g.open = true;
    this.walls = this.walls.filter((w) => !g.walls.includes(w));
    for (const p of this.props) if (p.wall && g.walls.includes(p.wall)) p.dead = true;
    for (const im of g.imgs) {
      const i = im as Phaser.GameObjects.Image;
      if (fx) for (let n = 0; n < 4; n++) this.gib("gib_arm", Phaser.Utils.Array.GetRandom([0xc8945a, 0xa8743a, 0x7a5228]), i.x, i.y, 8, rand(-Math.PI, 0), rand(80, 200), rand(120, 240), { scale: rand(0.5, 0.9), life: rand(5, 8) });
      const p = this.props.find((q) => q.img === i);
      if (p?.ob) { this.obs = this.obs.filter((o) => o !== p.ob); this.light.removeShadow(i); p.dead = true; }
      i.destroy();
    }
    if (fx) { sfx("crate", 1); this.cameras.main.shake(160, 0.004); S.msg = t("st_gate_open"); S.msgT = 2.5; }
    if (NET.role === "host") send({ t: "gate", k });
    this.buildGrid(); this.flowCell = -1;
  }
  /** сколько врагов осталось на участке (живые + ещё спящие группы) */
  segLeft(k: number) {
    let n = 0;
    GROUPS.forEach((g, i) => { if (g.seg === k && !this.woke[i]) n += g.kinds.length; });
    for (const e of this.enemies) if (!e.dead && e.seg === k) n++;
    return n;
  }
  /** куда идти: закрытый заслон, следующий лагерь или выход */
  storyGoal(): { x: number; y: number } | null {
    if (!S.story || this.storyEnd) return null;
    const k = this.seg;
    if (k < GATES.length) {
      const g = this.gates[k];
      if (g && !g.open) return { x: W / 2, y: g.y };
      return CAMPS[k];
    }
    return { x: W / 2, y: EXIT_Y };
  }
  storyTick(dt: number) {
    if (this.storyEnd) return;
    // группы просыпаются, когда герой подходит снизу
    const all = this.targets(), humans = this.humans();
    GROUPS.forEach((g, i) => {
      if (this.woke[i] || !all.some((p) => p.y - g.y < 760)) return;
      this.woke[i] = true;
      g.kinds.forEach((k, j) => {
        const a = (j / g.kinds.length) * TAU, d = 30 + (j % 3) * 26;
        const q = this.collide(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, KINDS[k].r);
        const e = this.addEnemy(k, q.x, q.y, this.eid++);
        e.seg = g.seg;
        // «Хозяин»: огромный медведь-мутант, финал главы 5
        if (g.boss && j === 0) { e.hp = 360; e.boss = true; e.c.setScale(1.45); S.bannerText = t("st_boss"); S.bannerN++; sfx("thunder", 1); }
      });
    });
    // бродячие снизу — стоять на месте нельзя
    this.strT -= dt;
    if (this.strT <= 0) {
      this.strT = rand(8, 13);
      const v = this.cameras.main.worldView, y = v.bottom + 90;
      if (y < H - 60 && this.enemies.filter((e) => !e.dead).length < 12) {
        const q = this.collide(LANE ? rand(LANE[0] + 70, LANE[1] - 70) : rand(220, W - 220), y, 11);
        this.addEnemy(Math.random() < 0.25 ? "runner" : "zombie", q.x, q.y, this.eid++).seg = -1;
      }
    }
    // заслон открывается, когда участок перед ним зачищен
    const k = this.seg;
    if (k < this.gates.length && !this.gates[k].open) {
      const left = this.segLeft(k);
      if (left === 0) this.openGate(k, true);
      else if (this.py < this.gates[k].y + 220) {
        this.gateMsgT -= dt;
        if (this.gateMsgT <= 0) { this.gateMsgT = 3; S.msg = t("st_gate", { n: left }); S.msgT = 2.4; }
      }
    }
    this.storyBench();
    // лагерь: сохранение, лечение, патроны (дошёл хоть один человек из отряда)
    CAMPS.forEach((c, i) => {
      if (this.campDone[i] || !humans.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 140)) return;
      this.campDone[i] = true;
      this.seg = Math.max(this.seg, i + 1);
      // выбывшие встают, у всех полное здоровье
      if (this.dead) { const q = this.collide(c.x, c.y + 70, 10); this.px = q.x; this.py = q.y; this.revive(); }
      for (const m of this.mates.values()) {
        if (m.dead) { this.reviveMate(m, c.x + rand(-40, 40), c.y + 70); }
        m.hp = m.mh ?? 100;
      }
      if (NET.role === "host") send({ t: "camp", i });
      this.campReached(i);
      this.saveCamp(i + 1);
    });
    // выход наверху — глава пройдена
    if (this.seg >= GATES.length && humans.some((p) => p.y < EXIT_Y + 140) && this.segLeft(GATES.length) === 0) {
      if (NET.role === "host") send({ t: "stend" });
      this.storyDone();
    }
    // сюжет в отряде: выбывший встаёт рядом с живым через 8 с
    if (!S.over) {
      const near = () => { const a = this.targets(); return a.length ? a[Math.floor(Math.random() * a.length)] : null; };
      if (this.dead) {
        this.deadT += dt;
        const p = this.deadT > 8 ? near() : null;
        if (p) { const q = this.collide(p.x + rand(-40, 40), p.y + 40, 10); this.px = q.x; this.py = q.y; this.revive(); this.deadT = 0; }
      } else this.deadT = 0;
      for (const m of this.mates.values()) {
        if (!m.dead) { m.deadT = 0; continue; }
        m.deadT = (m.deadT ?? 0) + dt;
        const p = m.deadT > 8 ? near() : null;
        if (p) this.reviveMate(m, p.x + rand(-40, 40), p.y + 40);
      }
    }
  }
  /** живые люди отряда (без ботов) */
  humans() {
    const r: { x: number; y: number }[] = [];
    if (!this.dead) r.push({ x: this.px, y: this.py });
    for (const m of this.mates.values()) if (!m.dead && !m.bot) r.push(m);
    return r;
  }
  reviveMate(m: Mate, x: number, y: number) {
    const q = this.collide(x, y, 10);
    m.dead = false; m.deadT = 0; m.hp = Math.round((m.mh ?? 100) * 0.6);
    m.hum.body.clearTint(); m.hum.head.clearTint();
    if (m.bot) { m.x = m.tx = m.fx = q.x; m.y = m.ty = m.fy = q.y; }
    else send({ t: "tp", x: Math.round(q.x), y: Math.round(q.y) }, m.id);
  }
  /** верстак — в пройденном лагере */
  storyBench() {
    S.bench = CAMPS.some((c, i) => this.campDone[i] && Math.hypot(this.px - c.x, this.py - c.y) < 190);
  }
  /** лагерь взят (у хозяина и у гостей): лечение, патроны, баннер */
  campReached(i: number) {
    const c = CAMPS[i];
    this.campDone[i] = true;
    this.seg = Math.max(this.seg, i + 1);
    S.hp = S.maxHp; S.clip = fullClips(); S.grenades = Math.max(S.grenades, 2);
    sfx("heal");
    S.msg = t("st_camp"); S.msgT = 4;
    this.popup(c.x, c.y - 40, "+" + S.maxHp, "#8ae05a");
    S.wave = i + 2; S.bannerText = t("st_seg", { n: i + 2, m: SEGS }); S.bannerN++;
    if (NET.role === "client") this.saveHeroNow();
  }
  storyDone() {
    this.storyEnd = true;
    const last = CH >= CHAPTERS.length - 1;
    S.bannerText = last ? t("st_win") : t("st_done", { n: CH + 1 }); S.bannerN++;
    S.msg = last ? t("st_win_d", { name: S.hero || t("player") }) : t("st_next", { n: CH + 2 }); S.msgT = 6;
    sfx("wave", 0.9);
    unlockChapter(last ? CHAPTERS.length : CH + 2);
    if (NET.role === "client") { this.saveHeroNow(); if (last) this.time.delayedCall(9000, () => this.toMenu()); return; }
    if (last) { saveStory(null); this.time.delayedCall(9000, () => this.toMenu()); return; }
    // следующая глава: сохраняемся в её начале и перестраиваем мир (гости перестроятся по новому «hi»)
    storyCh = CH + 1;
    saveStory({ ch: storyCh + 1, camp: 0, hp: S.maxHp, armor: S.armor, medkits: S.medkits, grenades: Math.max(S.grenades, 2), owned: [...S.owned], ap: S.ap, inc: S.inc, stock: { ...S.stock }, clip: fullClips(), weapon: S.weapon, kills: S.kills, score: S.score, time: Math.round(S.time), level: S.level, xp: S.xp, parts: S.parts, up: { ...S.up } });
    this.time.delayedCall(6000, () => this.scene.restart());
  }
  saveHeroNow() { saveHero({ level: S.level, xp: S.xp, parts: S.parts, up: { ...S.up } }); }
  saveCamp(camp: number) {
    const sv: StorySave = { ch: CH + 1, camp, hp: S.hp, armor: S.armor, medkits: S.medkits, grenades: S.grenades, owned: [...S.owned], ap: S.ap, inc: S.inc, stock: { ...S.stock }, clip: { ...S.clip }, weapon: S.weapon, kills: S.kills, score: S.score, time: Math.round(S.time), level: S.level, xp: S.xp, parts: S.parts, up: { ...S.up } };
    saveStory(sv);
  }
  /** сюжет: погиб — назад в последний лагерь (или к дому) */
  storyDeath() {
    S.msg = t("st_dead"); S.msgT = 3;
    if (NET.role === "client") return; // гостя вернёт хозяин (пришлёт новый «hi»)
    this.time.delayedCall(2600, () => this.scene.restart());
  }
  /** из паузы — в главное меню (сетевая игра закрывается) */
  toMenu() {
    if (NET.role !== "solo") { saveNet(null); netLeave(); }
    MODE = "waves";
    S.paused = false; S.inv = false;
    this.tweens.resumeAll();
    menuOnStart = true;
    this.scene.restart();
  }

  buildWorld() {
    const ground = this.add.tileSprite(0, 0, W, H, HAS_GRASS ? "t_grass" : "ground_meadow").setOrigin(0).setTileScale(HAS_GRASS ? 0.5 : 0.4).setDepth(-10);
    const th = S.story ? CHAPTERS[CH].theme : "farm";
    if (S.story) ground.setTint(CHAPTERS[CH].tint);
    /** деревья по местности: ферма — лиственные, шоссе — сосны, городок — редкие, завод — сухие, плотина — сосны и камни */
    const TREES: Record<string, string[]> = { waste: ["dead_tree_1", "dead_tree_2", "dead_tree_1", "tree_5"], junk: ["dead_tree_1", "dead_tree_2", "tree_6"], tunnel: ["pine_1", "pine_2"], farm: ["tree_1", "tree_2", "tree_3", "tree_5", "tree_6", "pine_1", "pine_2"], road: ["pine_1", "pine_2", "pine_1", "tree_5", "dead_tree_1"], town: ["tree_1", "tree_2", "tree_6"], factory: ["dead_tree_1", "dead_tree_2", "pine_2"], dam: ["pine_1", "pine_2", "pine_1", "pine_2", "tree_5"] };
    const BAND: Record<string, string[]> = { waste: ["dead_tree_1", "dead_tree_2", "pine_2"], junk: ["pine_1", "dead_tree_2", "pine_2"], tunnel: ["pine_1", "pine_2"], farm: ["pine_1", "pine_2", "tree_1", "tree_5", "pine_1"], road: ["pine_1", "pine_2"], town: ["tree_1", "tree_2", "tree_6", "pine_1"], factory: ["dead_tree_1", "dead_tree_2", "pine_2", "pine_1"], dam: ["pine_1", "pine_2"] };
    /** доли: дерево / камень / сухое дерево */
    const MIX: Record<string, [number, number]> = { waste: [0.2, 0.75], junk: [0.15, 0.4], tunnel: [0.5, 0.9], farm: [0.45, 0.85], road: [0.4, 0.8], town: [0.25, 0.55], factory: [0.15, 0.7], dam: [0.35, 0.9] };
    const rnd = new Phaser.Math.RandomDataGenerator(["zombika"]);
    FIELDS = [];
    TRAIL_PH = rnd.realInRange(0, 9);
    if (S.story) this.themeGround(th, rnd);
    // полуразрушенный дом недалеко от старта
    const st = S.story ? START : { x: W / 2, y: H / 2 };
    this.house = buildHouse(this, st.x + 110, st.y - 250);
    this.walls = this.house.walls;
    const hs = this.house;
    const free = (x: number, y: number, r: number) =>
      Math.hypot(x - st.x, y - st.y) > 220 && (!S.story || (storyFree(x, y, r) && !onTrail(x, y, r))) && this.obs.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 40) &&
      !(x > hs.bx0 - r - 40 && x < hs.bx1 + r + 40 && y > hs.by0 - r - 50 && y < hs.by1 + r + 30);
    /** дворы: дома, постройки, костры — под ними проплешина земли, к ним ведут тропинки */
    const yards = this.yards = [{ x: hs.cx, y: hs.by1 + 10, w: hs.bx1 - hs.bx0 + 60, h: 90, path: true as boolean }];
    const place = (key: string, x: number, y: number, size: number, r: number, canopy: number) => {
      const img = this.add.image(x, y, key).setDisplaySize(size, size).setDepth(y);
      // дерево нарисовано «вид сверху-сбоку»: ставим картинку основанием ствола в точку (x, y)
      if (canopy) img.setOrigin(0.5, TREE_BASE[key] ?? 0.85);
      else img.setRotation(rnd.realInRange(0, TAU));
      this.obs.push({ x, y, r, img, canopy, size });
    };
    // полуразрушенные дома (картинки из src/house): в сюжете по 1–2 на участок, в «волнах» — несколько по карте
    if (HOUSE_NAMES.length) {
      const want = S.story ? GATES.length * 2 + 2 : 5;
      for (let n = 0, tries = 0; n < want && tries < 600; tries++) {
        const name = rnd.pick(HOUSE_NAMES), tex = this.textures.get("hs_" + name).getSourceImage();
        const w = tex.width / ART_K, h = tex.height / ART_K;
        const x = S.story ? (rnd.frac() < 0.5 ? rnd.between(200 + w / 2, W / 2 - 150 - w / 2) : rnd.between(W / 2 + 150 + w / 2, W - 200 - w / 2)) : rnd.between(300, W - 300);
        const y = rnd.between(500, H - 700);
        if (!free(x, y, Math.max(w, h) * 0.45)) continue;
        const im = this.add.image(x, y + h * 0.25, "hs_" + name).setDisplaySize(w, h).setOrigin(0.5, 0.85).setDepth(y + h * 0.15);
        yards.push({ x, y: y + h * 0.12, w: w * 1.05, h: h * 0.6, path: true });
        const p: Prop = { id: 5000 + n, kind: "deco", x, y, hp: 999, img: im, dead: false }; this.props.push(p);
        p.wall = { cx: x, cy: y, ex: w * 0.34, ey: h * 0.26, c: 1, s: 0, h: 40, art: true, shH: h * 0.55, pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: x + u * w * 0.34, y: y + v * h * 0.26 })) };
        p.wall.foot = artFootprint(im, 0.08) ?? undefined;
        this.walls.push(p.wall);
        this.obs.push({ x, y, r: Math.min(w, h) * 0.28, img: im, canopy: 0, size: 2, prop: p, low: true });
        n++;
      }
    }
    // постройки и крупные вещи глав (картинки из src/build): набор зависит от места
    {
      const bth = S.story ? CHAPTERS[CH].theme : "farm";
      const SETS: Record<string, string[]> = {
        farm: ["barn", "farmhouse", "silo", "windmill", "tractor", "woodpile", "woodpile"],
        road: ["gas_station", "motel", "billboard", "truck_wreck", "bus_stop", "phone_booth"],
        waste: ["billboard", "truck_wreck", "water_tank", "windmill", "boat", "woodpile"],
        town: ["shop", "town_house", "kiosk", "bus_stop", "fountain", "phone_booth", "playground"],
        junk: ["container_blue", "container_red", "forklift", "crane", "truck_wreck", "boat", "tractor", "spool"],
        factory: ["factory", "chimney", "container_blue", "container_red", "pipes", "forklift", "water_tank", "spool", "generator"],
        tunnel: ["truck_wreck", "generator", "truck_wreck"],
        dam: ["dam_tower", "crane", "generator", "watchtower", "boat"],
      };
      const TALL = new Set(["chimney", "silo", "water_tank", "watchtower", "windmill", "dam_tower", "crane"]);
      const set = (SETS[bth] ?? SETS.farm).filter((n) => BUILD_NAMES.has(n));
      const want = set.length ? (S.story ? GATES.length * 3 + 3 : 8) : 0;
      // вертолётная площадка — только в конце последней главы, на точке сбора (туда прилетает вертолёт)
      if (S.story && CH === CHAPTERS.length - 1 && BUILD_NAMES.has("helipad")) {
        const k = buildK("helipad"), tex = this.textures.get("bd_helipad").getSourceImage();
        this.add.image(W / 2, EXIT_Y, "bd_helipad").setDisplaySize(tex.width / k, tex.height / k).setDepth(-9);
      }
      for (let n = 0, tries = 0; n < want && tries < 900; tries++) {
        const name = rnd.pick(set), k = buildK(name), tex = this.textures.get("bd_" + name).getSourceImage();
        const w = tex.width / k, h = tex.height / k, tall = TALL.has(name), flat = name === "helipad";
        // от середины полосы: шоссе шире, городская улица — уже
        const half = bth === "road" ? 315 : bth === "town" ? 195 : 140, left = rnd.frac() < 0.5;
        // рекламный щит — у самой обочины, лицом к дороге
        const board = name === "billboard" && S.story;
        const x = board ? W / 2 + (left ? -1 : 1) * (half + w / 2 + 10) : S.story ? (left ? rnd.between(200 + w / 2, W / 2 - half - w / 2) : rnd.between(W / 2 + half + w / 2, W - 200 - w / 2)) : rnd.between(300, W - 300);
        const y = rnd.between(400, H - 600);
        if (!free(x, y, tall ? w * 0.4 : board ? w * 0.3 : Math.max(w, h) * 0.42)) continue;
        const flip = board ? !left : !tall && rnd.frac() < 0.5;
        const im = this.add.image(x, y, "bd_" + name).setDisplaySize(w, h).setFlipX(flip);
        const p: Prop = { id: 6000 + n, kind: "deco", x, y, hp: 999, img: im, dead: false }; this.props.push(p);
        if (flat) { im.setDepth(-9); n++; continue; }
        yards.push({ x, y: y + h * (tall ? 0.02 : 0.12), w: w * (tall ? 1.6 : 1.05), h: h * (tall ? 0.35 : 0.6), path: !BUILD_K_SMALL(name) });
        if (tall) {
          // высокое (труба, вышка, бак): основание — внизу картинки, препятствие — кружок
          im.setOrigin(0.5, 0.9).setDepth(y);
          this.artSh.push([im, 0.6, 0.08]);
          this.obs.push({ x, y, r: w * 0.26, img: im, canopy: 0, size: w * 0.5, prop: p, noSh: true });
        } else {
          im.setOrigin(0.5, 0.85).setY(y + h * 0.25).setDepth(y + h * 0.15);
          // перевёрнутая тень из-под середины постройки; у мелкой техники ось выше, тень короче
          // тень — проекция объёма (коробка следа, поднятая на высоту постройки), см. тени стен в updateLight
          const ex = w * 0.36, ey = h * 0.24;
          p.wall = { cx: x, cy: y, ex, ey, c: 1, s: 0, h: 40, art: true, shH: h * (BUILD_K_SMALL(name) ? 0.45 : 0.5), pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: x + u * ex, y: y + v * ey })) };
          p.wall.foot = artFootprint(im, BUILD_K_SMALL(name) ? 0.12 : 0.08) ?? undefined; // след по картинке, а не коробкой
          this.walls.push(p.wall);
          this.obs.push({ x, y, r: Math.min(w, h) * 0.26, img: im, canopy: 0, size: 2, prop: p, low: true });
        }
        n++;
      }
    }
    // край мира — стена из ёлок
    for (let t = 0; t < Math.max(W, H); t += 70) {
      for (const [x, y] of [[t, 10], [t, H - 10], [10, t], [W - 10, t]]) if (x <= W && y <= H && !inRock(x, y) && !(S.story && CHAPTERS[CH].theme === "dam" && (x < 275 || x > W - 275))) place(rnd.pick(["pine_1", "pine_2"]), x + rnd.between(-15, 15), y + rnd.between(-15, 15), rnd.between(110, 140), 26, 50);
    }
    // в сюжете по краям полосы — густой лес (дорога одна)
    if (S.story) for (let y = 60; y < H - 60; y += 46) for (const side of [0, 1]) {
      const x = side ? W - rnd.between(40, 190) : rnd.between(40, 190);
      if (free(x, y, 14)) { const s = rnd.between(110, 150); { if (th === "dam") { const r = rnd.between(60, 100); if (free(x + (side ? -150 : 150), y, r * 0.38)) place(rnd.pick(["boulder_1", "boulder_2", "boulder_3"]), x + (side ? -150 : 150), y, r, r * 0.38, 0); } else place(rnd.pick(BAND[th]), x, y, s, 15, s * 0.42); } }
    }
    const nTrees = Math.round(140 * (W * H) / 9e6 * (th === "town" || th === "factory" ? 0.7 : th === "tunnel" ? 0.08 : 1));
    for (let n = 0, tries = 0; n < nTrees && tries < 5000; tries++) {
      const x = rnd.between(80, W - 80), y = th === "tunnel" ? rnd.between(TUNNEL_Y + 60, H - 80) : rnd.between(80, H - 80);
      const kind = rnd.frac();
      if (onPave(th, x) || onTrail(x, y, 20)) continue;
      // плотина: по бокам вода — там только камни
      if (S.story && th === "dam" && (x < 275 || x > W - 275) && kind < MIX[th][0]) continue;
      if (S.story && th === "dam" && (x < 275 || x > W - 275) && kind >= MIX[th][1]) continue;
      if (kind < MIX[th][0]) { if (free(x, y, 18)) { const s = rnd.between(110, 150); place(rnd.pick(TREES[th]), x, y, s, 15, s * 0.42); n++; } }
      else if (kind < MIX[th][1]) { const s = rnd.between(55, 110); if (free(x, y, s * 0.38)) { place(rnd.pick(["boulder_1", "boulder_2", "boulder_3"]), x, y, s, s * 0.38, 0); n++; } }
      else if (free(x, y, 14)) { place(rnd.pick(["dead_tree_1", "dead_tree_2"]), x, y, rnd.between(100, 130), 12, 45); n++; }
    }
    this.buildProps(rnd, free);
    // мелочь без столкновений
    /** где своя земля (асфальт, плиты, бетон) — трава и цветы не растут */
    const paved = (x: number) => th === "tunnel" || th === "waste" || (th === "junk" && x > 160 && x < W - 160) || (th === "road" && Math.abs(x - W / 2) < 300) || (th === "town" && x > 230 && x < W - 230) || (th === "factory" && x > 170 && x < W - 170) || th === "dam";
    for (let i = 0; i < Math.round(420 * (W * H) / 9e6); i++) {
      const dx = rnd.between(0, W), dy = rnd.between(0, H);
      if (inHouse(hs, dx, dy, 10) || inRock(dx, dy) || inField(dx, dy, -20) || (S.story && paved(dx) && rnd.frac() < (th === "waste" ? 0.6 : 0.9))) continue;
      const key = rnd.pick(["grass_1", "grass_2", "grass_1", "flowers_1", "flowers_2", "flowers_3", "bush_red_full", "bush_blue_full", "stone", "stone_2", "grass_2", "flowers_1"]);
      if (key.startsWith("bush") || key.startsWith("stone") ? onTrail(dx, dy, 10) || onPave(th, dx) : false) continue;
      const s = key.startsWith("bush") ? rnd.between(40, 60) : rnd.between(22, 40);
      this.add.image(dx, dy, key).setDisplaySize(s, s).setRotation(key.startsWith("grass") || key.startsWith("bush") ? 0 : rnd.realInRange(0, TAU)).setDepth(-5);
    }
  }

  /** земля главы поверх травы: дорога, площадь, цех, плотина, поля */
  /** пашня с неровным краем: узор t_farm внутри извилистого контура, по краю — бровка и травинки */
  fieldImage(i: number | string, x: number, y: number, w: number, h: number, rnd: Phaser.Math.RandomDataGenerator, tex = "t_farm", fringe = true, wobK = 1, scK = 0.45) {
    const m = 16 * wobK, key = "field_" + i;
    if (this.textures.exists(key)) this.textures.remove(key);
    const cv = document.createElement("canvas"); cv.width = w + m * 2; cv.height = h + m * 2;
    const c = cv.getContext("2d")!;
    // контур: точки по скруглённому прямоугольнику, сдвинутые наружу/внутрь плавным шумом
    const pts: [number, number][] = [], n = Math.round((w + h) / 9), rr = Math.min(w, h) * 0.22, ph = [rnd.realInRange(0, 9), rnd.realInRange(0, 9)];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * 2 * (w + h);
      let px: number, py: number, nx: number, ny: number;
      if (t < w) { px = t; py = 0; nx = 0; ny = -1; } else if (t < w + h) { px = w; py = t - w; nx = 1; ny = 0; } else if (t < 2 * w + h) { px = 2 * w + h - t; py = h; nx = 0; ny = 1; } else { px = 0; py = 2 * (w + h) - t; nx = -1; ny = 0; }
      // скругление углов: подтягиваем к центру скругления
      const cxr = Math.min(Math.max(px, rr), w - rr), cyr = Math.min(Math.max(py, rr), h - rr), dx = px - cxr, dy = py - cyr, d = Math.hypot(dx, dy);
      if (d > rr) { px = cxr + (dx / d) * rr; py = cyr + (dy / d) * rr; }
      const wob = (Math.sin(t * 0.021 + ph[0]) * 7 + Math.sin(t * 0.067 + ph[1]) * 3.5 + rnd.realInRange(-1.5, 1.5) + (fringe ? 0 : rnd.realInRange(-3, 3))) * wobK;
      pts.push([m + px + nx * wob, m + py + ny * wob]);
    }
    const path = () => { c.beginPath(); pts.forEach(([a, b], k) => (k ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); };
    const src = this.textures.get(tex).getSourceImage() as CanvasImageSource & { width: number };
    const pat = c.createPattern(src, "repeat")!;
    const sc = scK * (512 / Math.max(256, src.width as number)) * (src.width as number >= 512 ? 1 : 2);
    pat.setTransform(new DOMMatrix().scale(sc));
    path(); c.fillStyle = pat; c.fill();
    // бровка: тёмная полоса по краю внутри
    c.save(); path(); c.clip(); c.lineWidth = 10; c.strokeStyle = "rgba(60,40,20,0.35)"; path(); c.stroke(); c.restore();
    // травинки, налезающие на край
    if (fringe) c.strokeStyle = "rgba(70,120,30,0.85)"; c.lineWidth = 1.5;
    for (let k = 0; k < pts.length; k += 1) for (let j = 0; j < 2; j++) {
      const [a, b] = pts[k], ox = rnd.realInRange(-4, 4), oy = rnd.realInRange(-4, 4);
      c.beginPath(); c.moveTo(a + ox, b + oy); c.lineTo(a + ox + rnd.realInRange(-3, 3), b + oy - rnd.realInRange(4, 9)); c.stroke();
    }
    this.textures.addCanvas(key, cv);
    return this.add.image(x - m, y - m, key).setOrigin(0).setDepth(-9.6);
  }
  /** живая земля: проплешины под дворами, кривые тропинки, пятна тёмной/сухой травы, цветы кучками */
  groundPatches(th: string, yards: { x: number; y: number; w: number; h: number; path: boolean }[], rnd: Phaser.Math.RandomDataGenerator) {
    if (th === "tunnel") return;
    const tint = S.story ? CHAPTERS[CH].tint : 0xffffff;
    const blob = (key: string, x: number, y: number, w: number, h: number, depth = -9.9) =>
      this.add.image(x, y, key).setDisplaySize(w, h).setRotation(rnd.realInRange(-0.3, 0.3)).setFlipX(rnd.frac() < 0.5).setDepth(depth).setTint(tint);
    // под домами и кострами — вытоптанная земля
    for (const y of yards) blob("gp_dirt" + rnd.between(0, 3), y.x + rnd.between(-8, 8), y.y, y.w * 1.3, y.h * 1.5);
    // тропинки: плавная кривая (Безье со смещёнными в стороны опорами), три слоя — тень края, земля, светлая середина
    const g = this.add.graphics().setDepth(-9.85);
    // все тропы рисуем слоями сразу (сначала края всех, потом середины): на развилках нет тёмных стыков
    const trails: [{ x: number; y: number }[], number][] = [];
    const trail = (pts: { x: number; y: number }[], wid: number) => { trails.push([pts, wid]); };
    const drawTrails = () => {
      // тропа из «клякс» вытоптанной земли (та же текстура, что под домами): рваный край, без ровных линий
      for (const [pts, wid] of trails) {
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y), step = wid * 0.38;
          for (let d = (step - acc) % step; d < L; d += step) {
            const t = d / L, x = a.x + (b.x - a.x) * t + rnd.between(-3, 3), y = a.y + (b.y - a.y) * t + rnd.between(-3, 3), s = wid * rnd.realInRange(1.25, 1.7);
            this.add.image(x, y, "gp_dirt" + rnd.between(0, 3)).setDisplaySize(s, s * rnd.realInRange(0.75, 1)).setRotation(rnd.realInRange(0, TAU)).setDepth(-9.86).setTint(tint);
          }
          acc = (acc + L) % step;
        }
      }
      // камешки и травинки по тропе
      for (const [pts, wid] of trails) for (let i = 0; i < pts.length; i += 2) {
        if (rnd.frac() < 0.45) g.fillStyle(0x9a9284, 0.9).fillEllipse(pts[i].x + rnd.between(-wid / 3, wid / 3), pts[i].y + rnd.between(-wid / 3, wid / 3), rnd.between(2, 5), rnd.between(2, 4));
        if (rnd.frac() < 0.5) g.fillStyle(0x5c6a2a, 0.8).fillEllipse(pts[i].x + rnd.between(-wid / 2, wid / 2), pts[i].y + rnd.between(-wid / 2, wid / 2), rnd.between(3, 7), rnd.between(2, 3));
      }
    };
    const curve = (ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
      const o1 = rnd.realInRange(-0.35, 0.35) * L, o2 = rnd.realInRange(-0.35, 0.35) * L;
      const c1 = { x: ax + dx * 0.33 + nx * o1, y: ay + dy * 0.33 + ny * o1 }, c2 = { x: ax + dx * 0.66 + nx * o2, y: ay + dy * 0.66 + ny * o2 };
      const n = Math.max(6, Math.round(L / 14)), pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push({ x: u * u * u * ax + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * bx, y: u * u * u * ay + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * by });
      }
      return pts;
    };
    const doors = yards.filter((y) => y.path).map((y) => ({ x: y.x, y: y.y + y.h * 0.45 }));
    if (S.story) {
      // главная тропа вдоль полосы (на шоссе и в городе её закрывает асфальт)
      const main: { x: number; y: number }[] = [], mx = trailX;
      for (let y = H; y >= 0; y -= 24) main.push({ x: mx(y), y });
      trail(main, 44);
      for (const d of doors) { const ty = d.y + rnd.between(60, 220); trail(curve(d.x, d.y, mx(ty), ty), 24); }
    } else {
      // «волны»: каждый двор — к ближайшему соседу, без повторов
      const done = new Set<string>();
      doors.forEach((d, i) => {
        let best = -1, bd = 1e9;
        doors.forEach((e, j) => { const q = Math.hypot(e.x - d.x, e.y - d.y); if (j !== i && q < bd) { bd = q; best = j; } });
        const key = [i, best].sort().join();
        if (best >= 0 && !done.has(key) && bd < 1400) { done.add(key); trail(curve(d.x, d.y, doors[best].x, doors[best].y), 26); }
      });
    }
    drawTrails();
    // пятна по всей карте: голая земля, тёмная и сухая трава, цветы кучками (не на пашнях)
    const area = (W * H) / 250000;
    const spots: [string, number, number, number][] = [["gp_dirt", 4, 0.22, 140], ["gp_dark", 2, 0.4, 260], ["gp_dry", 2, 0.35, 240], ["gp_flow", 3, 0.5, 110]];
    for (const [key, nv, k, sz] of spots) for (let i = 0; i < Math.round(area * k); i++) {
      const x = rnd.between(60, W - 60), y = rnd.between(60, H - 60), s = sz * rnd.realInRange(0.6, 1.5);
      if (inField(x, y, s * 0.4)) continue;
      blob(key + rnd.between(0, nv - 1), x, y, s, s * rnd.realInRange(0.6, 0.9), key === "gp_flow" ? -9.5 : -9.9);
    }
  }
  themeGround(th: string, rnd: Phaser.Math.RandomDataGenerator) {
    const band = (key: string, x: number, w: number, y = 0, h = H, sc = 0.5) => this.add.tileSprite(x, y, w, h, key).setOrigin(0).setTileScale(sc).setDepth(-9.6);
    const g = this.add.graphics().setDepth(-9.5);
    const cx = W / 2;
    if (th === "farm") {
      // поля по сторонам от тропы
      for (let y = 500; y < H - 700; y += rnd.between(500, 800)) {
        const left = rnd.frac() < 0.5, w = rnd.between(280, 420), h = rnd.between(220, 360), x = left ? rnd.between(200, 330) : W - rnd.between(200, 330) - w;
        FIELDS.push({ x, y, w, h });
        this.fieldImage(FIELDS.length - 1, x, y, w, h, rnd);
      }
    } else if (th === "road") {
      band("t_asphalt", cx - 270, 540);
      g.fillStyle(0x8a7a5a, 0.85).fillRect(cx - 300, 0, 30, H).fillRect(cx + 270, 0, 30, H);
      // обочина с рваным краем: кляксы утоптанной земли поверх края асфальта и травы
      for (const ex of [cx - 290, cx + 290]) for (let y = -20; y < H + 20; y += rnd.between(16, 26)) {
        const sz = rnd.between(46, 84);
        this.add.image(ex + rnd.between(-10, 10) + (ex < cx ? -8 : 8), y, "gp_dirt" + rnd.between(0, 3)).setDisplaySize(sz, sz * rnd.realInRange(0.7, 1)).setRotation(rnd.realInRange(0, 6.28)).setDepth(-9.55).setTint(CHAPTERS[CH].tint);
      }
      g.fillStyle(0xe8e4d8, 0.85).fillRect(cx - 258, 0, 6, H).fillRect(cx + 252, 0, 6, H);
      g.fillStyle(0xf0c840, 0.9);
      for (let y = 0; y < H; y += 96) g.fillRect(cx - 4, y, 8, 50);
    } else if (th === "town") {
      band("t_town", 230, W - 460, 0, H, 0.45);
      band("t_asphalt", cx - 170, 340);
      g.fillStyle(0xb0aca0, 1).fillRect(cx - 182, 0, 12, H).fillRect(cx + 170, 0, 12, H); // бордюры
      g.fillStyle(0xeeeae0, 0.9);
      for (let y = 900; y < H; y += 1500) for (let i = 0; i < 8; i++) g.fillRect(cx - 160 + i * 42, y, 26, 90); // зебры
    } else if (th === "factory") {
      band("t_factory", 170, W - 340, 0, H, 0.55);
      for (const x of [170, W - 186]) for (let y = 0; y < H; y += 40) g.fillStyle((y / 40) % 2 ? 0x1e1c18 : 0xe8c030, 0.9).fillRect(x, y, 16, 40);
      // рельсы
      g.fillStyle(0x5a3a22, 1); for (let y = 0; y < H; y += 26) g.fillRect(cx + 150, y, 70, 9);
      g.fillStyle(0x8a8a86, 1).fillRect(cx + 160, 0, 6, H).fillRect(cx + 204, 0, 6, H);
    } else if (th === "waste") {
      band("t_waste", 0, W, 0, H, 0.5);
      // старая разбитая дорога: куски асфальта с провалами
      for (let y = 0; y < H; y += rnd.between(160, 320)) { const h = rnd.between(120, 260), ox = rnd.between(-30, 30); this.fieldImage("wa" + y, cx - 110 + ox, y, 220, h, rnd, "t_asphalt", false, 2.2, 0.5).setAlpha(0.75).setTint(0xc8b8a0); y += h; }
    } else if (th === "junk") {
      band("t_junk", 150, W - 300, 0, H, 0.5);
      // рваный край свалки: кляксы земли по границе с травой
      for (const ex of [150, W - 150]) for (let y = -20; y < H + 20; y += rnd.between(18, 30)) {
        const sz = rnd.between(50, 95);
        this.add.image(ex + rnd.between(-14, 14), y, "gp_dirt" + rnd.between(0, 3)).setDisplaySize(sz, sz * rnd.realInRange(0.7, 1)).setRotation(rnd.realInRange(0, 6.28)).setDepth(-9.55).setTint(0x8a7a60);
      }
      // сетка-рабица по краям свалки
      g.lineStyle(2, 0x8a8a86, 0.7);
      for (const x of [150, W - 150]) { g.lineBetween(x, 0, x, H); for (let y = 0; y < H; y += 60) g.lineBetween(x - 4, y, x + 4, y + 60).lineBetween(x + 4, y, x - 4, y + 60); }
    } else if (th === "tunnel" && LANE) {
      const [l0, l1] = LANE;
      // снаружи у входа — дорога, внутри — тёмный асфальт, по бокам скала
      band("t_asphalt", l0 + 60, l1 - l0 - 120, TUNNEL_Y, H - TUNNEL_Y, 0.5);
      band("t_tunnel", l0, l1 - l0, 0, TUNNEL_Y, 0.5);
      const rock = this.add.graphics().setDepth(-4.6);
      rock.fillStyle(0x121214, 1).fillRect(0, 0, l0, TUNNEL_Y).fillRect(l1, 0, W - l1, TUNNEL_Y);
      rock.fillStyle(0x4a4a50, 1).fillRect(l0 - 16, 0, 16, TUNNEL_Y).fillRect(l1, 0, 16, TUNNEL_Y); // стены
      rock.fillStyle(0x6a6a70, 1).fillRect(l0 - 4, 0, 4, TUNNEL_Y).fillRect(l1, 0, 4, TUNNEL_Y);
      for (let y = 0; y < TUNNEL_Y; y += 90) rock.fillStyle(0x2a2a2e, 1).fillRect(l0 - 16, y, 12, 3).fillRect(l1 + 4, y, 12, 3); // швы плит
      // портал: бетонная арка над входом
      rock.fillStyle(0x7a7a7e, 1).fillRect(l0 - 120, TUNNEL_Y - 30, 120, 30).fillRect(l1, TUNNEL_Y - 30, 120, 30);
      rock.fillStyle(0x5a5a5e, 1).fillRect(l0 - 120, TUNNEL_Y - 6, 120, 6).fillRect(l1, TUNNEL_Y - 6, 120, 6);
      // разметка: прерывистая посередине, сплошные у тротуаров
      g.fillStyle(0xe8d070, 0.75); for (let y = 0; y < H; y += 110) g.fillRect(cx - 4, y, 8, 56);
      g.fillStyle(0xd8d4c8, 0.6).fillRect(l0 + 40, 0, 5, TUNNEL_Y).fillRect(l1 - 45, 0, 5, TUNNEL_Y);
      g.fillStyle(0x6a6a6e, 1).fillRect(l0, 0, 34, TUNNEL_Y).fillRect(l1 - 34, 0, 34, TUNNEL_Y); // тротуары
      // стены — непроходимы, пули в них застревают
      for (const [x0, x1] of [[0, l0], [l1, W]]) {
        const cx_ = (x0 + x1) / 2, cy_ = TUNNEL_Y / 2, ex = (x1 - x0) / 2, ey = TUNNEL_Y / 2;
        this.walls.push({ cx: cx_, cy: cy_, ex, ey, c: 1, s: 0, h: 0, pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: cx_ + u * ex, y: cy_ + v * ey })) });
      }
    } else if (th === "dam") {
      band("t_water", 0, 260, 0, H, 0.6); band("t_water", W - 260, 260, 0, H, 0.6);
      band("t_dam", 260, W - 520, 0, H, 0.55);
      g.fillStyle(0x5a6064, 1).fillRect(256, 0, 10, H).fillRect(W - 266, 0, 10, H); // парапет
      g.fillStyle(0xe8c030, 0.8); for (let y = 0; y < H; y += 120) g.fillRect(cx - 3, y, 6, 60);
    }
  }

  // ───────── предметы на карте ─────────
  buildProps(rnd: Phaser.Math.RandomDataGenerator, free: (x: number, y: number, r: number) => boolean) {
    let pid = 0;
    const hs = this.house!;
    const img = (art: PropArt, x: number, y: number, oy = 0.85) => this.add.image(x, y, "prop_" + art).setDisplaySize(PROP_ART[art][0], PROP_ART[art][1]).setOrigin(0.5, oy).setDepth(y);
    const ob = (p: Prop, r: number, extra: Partial<Ob> = {}) => { const o: Ob = { x: p.x, y: p.y, r, img: p.img, canopy: 0, size: r * 2, prop: p, ...extra }; p.ob = o; this.obs.push(o); return o; };
    const box = (cx: number, cy: number, ex: number, ey: number, a: number, h: number): WallBox => {
      const c = Math.cos(a), s = Math.sin(a);
      const pts = [[-ex, -ey], [ex, -ey], [ex, ey], [-ex, ey]].map(([u, v]) => ({ x: cx + u * c - v * s, y: cy + u * s + v * c }));
      return { cx, cy, ex, ey, c, s, h, pts };
    };
    const add = (kind: PropKind, x: number, y: number, hp: number, im: Phaser.GameObjects.Image) => { const p: Prop = { id: pid++, kind, x, y, hp, img: im, dead: false }; this.props.push(p); return p; };
    const barrel = (x: number, y: number, blue = false) => { const p = add(blue ? "drum" : "barrel", x, y, blue ? 9 : 3, img(blue ? "barrel_blue" : "barrel", x, y, 0.86)); ob(p, 10, { upright: true }); };
    const crate = (x: number, y: number) => { const p = add("crate", x, y, 4, img("crate", x, y, 0.88)); ob(p, 14, { upright: true }); return p; };
    const tires = (x: number, y: number) => { const p = add("tires", x, y, 99, img("tires", x, y, 0.6)); ob(p, 13, { low: true }); };
    // брошенные машины (прямоугольник-препятствие, как стены дома)
    const th = S.story ? CHAPTERS[CH].theme : "farm";
    const nCars = th === "junk" ? 24 : th === "tunnel" ? 16 : th === "road" ? 12 : 8;
    for (let n = 0, tries = 0; n < nCars && tries < 900; tries++) {
      const x = rnd.between(200, W - 200), y = rnd.between(200, H - 200);
      if (!free(x, y, th === "tunnel" ? 70 : 62)) continue;
      // машина — модель из срезов (как герой); поворот кратен 45°, по нему и коробка-препятствие
      const pool = th === "junk" ? ["car_rust", "car_rust", "car_burnt", "car_burnt", "van", "bus", "car_teal"] : th === "tunnel" ? ["car_burnt", "car_burnt", "car_red", "car_teal", "van", "car_police", "bus"] : th === "waste" ? ["car_rust", "car_burnt", "car_rust", "van"] : th === "road" ? ["car_red", "car_teal", "car_burnt", "car_police", "van", "bus", "car_burnt"] : th === "town" ? ["car_red", "car_teal", "car_police", "van", "car_burnt"] : ["car_red", "car_teal", "car_burnt", "car_burnt", "van"];
      const name = rnd.pick(pool), o = SV[name];
      let f = rnd.between(0, 7);
      // нарисованная машина: боком (нос вправо или влево — зеркало) или вдоль (если есть такой ракурс)
      const along = rnd.frac() < 0.4 && !!objArt(name, "v") && !!objArt(name, "h"), art = objArt(name, along ? "v" : "h");
      let im: Phaser.GameObjects.Image;
      if (art) {
        const tex = this.textures.get(art).getSourceImage(), flip = rnd.frac() < 0.5;
        f = along ? 6 : flip ? 4 : 0;
        im = this.add.image(x, y, art).setDisplaySize(tex.width / OBJ_K, tex.height / OBJ_K).setFlipX(flip && !along).setDepth(y);
      } else im = this.add.image(x, y, "sv_" + name, f).setDisplaySize(o.w * SV_SCALE, o.h * SV_SCALE).setOrigin(o.x, o.y).setDepth(y);
      const a = (f / 8) * TAU;
      const p = add("car", x, y, 999, im);
      const [ex, ey] = art ? [im.displayWidth * 0.42, im.displayHeight * 0.33] : { bus: [94, 24], van: [52, 22], car_teal: [43, 18] }[name] ?? [48, 20];
      p.wall = box(x, y, ex, ey, a, name === "bus" || name === "van" ? 34 : 24);
      if (art) { p.wall.art = true; im.setOrigin(0.5, 0.8).setY(y + im.displayHeight * 0.3); p.wall.shH = im.displayHeight * 0.4; p.wall.foot = artFootprint(im, 0.15) ?? undefined; }
      this.walls.push(p.wall);
      // рядом — бочки и покрышки
      const c = Math.cos(a), s = Math.sin(a);
      if (rnd.frac() < 0.7) barrel(x + c * 64 - s * 10, y + s * 64 + c * 10);
      if (rnd.frac() < 0.4) barrel(x + c * 66 + s * 18, y + s * 66 - c * 18);
      if (rnd.frac() < 0.5) tires(x - c * 70 + s * 6, y - s * 70 - c * 6);
      n++;
    }
    // бочки кучками (красные взрываются, синие — просто железо)
    for (let n = 0, tries = 0; n < 16 && tries < 600; tries++) {
      const x = rnd.between(140, W - 140), y = rnd.between(140, H - 140);
      if (!free(x, y, 40)) continue;
      const k = rnd.between(1, 3);
      for (let i = 0; i < k; i++) barrel(x + (i % 2) * 22 - 11 + rnd.between(-3, 3), y + Math.floor(i / 2) * 18 + rnd.between(-3, 3), rnd.frac() < 0.25);
      n++;
    }
    // ящики
    for (let n = 0, tries = 0; n < 14 && tries < 600; tries++) {
      const x = rnd.between(140, W - 140), y = rnd.between(140, H - 140);
      if (!free(x, y, 30)) continue;
      crate(x, y);
      if (rnd.frac() < 0.4) crate(x + 30, y + rnd.between(-6, 6));
      n++;
    }
    // предметы из срезов: набор зависит от места (ферма, шоссе, городок, завод, плотина)
    const deco = (name: string, x: number, y: number, rot = rnd.between(0, 7)) => {
      const o = SV[name], inf = SLICE_INFO[name];
      if (!o || !inf) return;
      // есть нарисованная картинка — она, иначе модель из срезов
      const art = objArt(name), tex = art ? this.textures.get(art).getSourceImage() : null;
      const im = art && tex ? this.add.image(x, y, art).setDisplaySize(tex.width / OBJ_K, tex.height / OBJ_K).setOrigin(0.5, 0.85).setFlipX(rot % 2 === 1).setDepth(y)
        : this.add.image(x, y, "sv_" + name, rot).setDisplaySize(o.w * SV_SCALE, o.h * SV_SCALE).setOrigin(o.x, o.y).setDepth(y);
      const p = add("deco", x, y, 999, im);
      ob(p, inf.r * SV_SCALE, inf.low ? { low: true } : { upright: true });
    };
    this.deco = deco;
    const set = this.decoSet();
    for (let n = 0, tries = 0; n < (S.story ? 70 : 34) && tries < 1500; tries++) {
      const x = rnd.between(120, W - 120), y = rnd.between(120, H - 120), name = rnd.pick(set);
      const r = SLICE_INFO[name].r * SV_SCALE;
      if (!free(x, y, r + 6)) continue;
      deco(name, x, y);
      // мелкое — кучками
      if (r < 8 && rnd.frac() < 0.6) { const x2 = x + rnd.between(-26, 26), y2 = y + rnd.between(14, 26); if (free(x2, y2, r)) deco(name, x2, y2); }
      n++;
    }
    // у дома: ящики, бочка, фонарь и забор
    crate(hs.cx - 120, hs.by1 + 30); crate(hs.cx - 92, hs.by1 + 36); barrel(hs.cx - 106, hs.by1 + 62);
    // костры (светят и ночью греют глаз)
    const fire = (x: number, y: number) => {
      const p = add("fire", x, y, 99, img("campfire", x, y, 0.6));
      ob(p, 14, { low: true });
      p.light = { dx: 0, dy: -4, r: 210, col: 0xff8a30, a: 0.75, flick: 0.25, night: false };
      p.fire = this.flames(x, y - 6, 1);
      // вытоптанная земля под костром (и у лагерей тоже — они ставятся позже пятен)
      this.add.image(x + rnd.between(-6, 6), y + 6, "gp_dirt" + rnd.between(0, 3)).setDisplaySize(rnd.between(150, 180), rnd.between(115, 135)).setRotation(rnd.realInRange(-0.3, 0.3)).setDepth(-9.9).setTint(S.story ? CHAPTERS[CH].tint : 0xffffff);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; const lx = x + Math.cos(a) * 44, ly = y + Math.sin(a) * 30; if (free(lx, ly, 10)) { const lp = add("fence", lx, ly, 99, this.add.image(lx, ly, "prop_fence").setDisplaySize(40, 12).setRotation(a + Math.PI / 2).setDepth(-4)); void lp; } }
    };
    for (let n = 0, tries = 0; n < 4 && tries < 300; tries++) {
      const x = rnd.between(300, W - 300), y = rnd.between(300, H - 300);
      if (!free(x, y, 60)) continue;
      fire(x, y); n++;
    }
    this.groundPatches(S.story ? CHAPTERS[CH].theme : "farm", this.yards, rnd);
    // фонарные столбы: у дома и вдоль старой дороги через карту
    const lamp = (x: number, y: number, broken: boolean) => {
      const p = add("lamp", x, y, 99, img("lamp", x, y, 0.95));
      ob(p, 6, { upright: true });
      p.light = { dx: 7, dy: 6, r: 200, col: 0xffd890, a: 0.85, flick: broken ? 1 : 0.03, night: true };
    };
    lamp(hs.bx0 - 26, hs.by1 + 10, false);
    for (let i = 0, tries = 0; i < 7 && tries < 200; tries++) {
      const x = 260 + (i * (W - 520)) / 6 + rnd.between(-30, 30), y = H / 2 + 330 + Math.sin(i * 1.3) * 60;
      if (!free(x, y, 16)) { i++; continue; }
      lamp(x, y, rnd.frac() < 0.3); i++;
    }
    // туннель: редкие фонари вдоль стен, многие мигают
    if (LANE) for (let y = 160, k = 0; y < TUNNEL_Y - 60; y += 150, k++) {
      const side = k % 2, x = side ? LANE[1] - 22 : LANE[0] + 22;
      if (free(x, y, 8)) lamp(x, y, rnd.frac() < 0.45);
    }
    // заборы (поломанные пролёты)
    for (let n = 0, tries = 0; n < 6 && tries < 300; tries++) {
      const x = rnd.between(200, W - 200), y = rnd.between(200, H - 200), a = rnd.pick([0, 0, rnd.realInRange(-0.35, 0.35)]); // поперёк (90°) забор сверху похож на лестницу
      const k = rnd.between(2, 4), c = Math.cos(a), s = Math.sin(a);
      let ok = true;
      for (let i = 0; i < k; i++) if (!free(x + c * i * 80, y + s * i * 80, 44)) ok = false;
      if (!ok) continue;
      for (let i = 0; i < k; i++) {
        if (i > 0 && rnd.frac() < 0.25) continue; // дыра в заборе
        const fx = x + c * i * 80, fy = y + s * i * 80;
        const im = this.add.image(fx, fy, "prop_fence").setDisplaySize(84, 26).setRotation(a).setOrigin(0.5, 0.6).setDepth(fy);
        const p = add("fence", fx, fy, 5, im);
        p.wall = box(fx, fy, 40, 3, a, 14); p.wall.art = true; this.artSh.push([im, -1.5]);
        this.walls.push(p.wall);
      }
      n++;
    }
    // заборчик вокруг пашен: пролёты по краю, пара дыр-проходов
    for (const f of FIELDS) {
      const seg = (fx: number, fy: number, a: number) => {
        const im = this.add.image(fx, fy, "prop_fence").setDisplaySize(64, 20).setRotation(a).setOrigin(0.5, 0.6).setDepth(fy);
        const p = add("fence", fx, fy, 4, im);
        p.wall = box(fx, fy, 30, 3, a, 12); p.wall.art = true; this.artSh.push([im, -1.5]); this.walls.push(p.wall);
      };
      const x0 = f.x - 14, x1 = f.x + f.w + 14, y0 = f.y - 16, y1 = f.y + f.h + 12;
      const nx = Math.max(2, Math.round((x1 - x0) / 62)), ny = Math.max(2, Math.round((y1 - y0) / 62));
      const gaps = new Set([rnd.between(0, 2 * (nx + ny) - 1), rnd.between(0, 2 * (nx + ny) - 1)]);
      let k = 0;
      for (let i = 0; i < nx; i++, k++) if (!gaps.has(k)) seg(x0 + (i + 0.5) * (x1 - x0) / nx, y0, 0);
      for (let i = 0; i < nx; i++, k++) if (!gaps.has(k)) seg(x0 + (i + 0.5) * (x1 - x0) / nx, y1, 0);
      for (let i = 0; i < ny; i++, k++) if (!gaps.has(k)) seg(x0, y0 + (i + 0.5) * (y1 - y0) / ny, Math.PI / 2);
      for (let i = 0; i < ny; i++, k++) if (!gaps.has(k)) seg(x1, y0 + (i + 0.5) * (y1 - y0) / ny, Math.PI / 2);
      // пугало посреди пашни (иногда два) и часто — брошенный трактор
      const hasTr = BUILD_NAMES.has("tractor") && rnd.frac() < 0.65;
      const sx = hasTr ? (rnd.frac() < 0.5 ? 0.25 : 0.75) : rnd.realInRange(0.3, 0.7);
      for (let i = 0, ns = rnd.frac() < 0.3 ? 2 : 1; i < ns; i++) deco("scarecrow", f.x + f.w * (i ? 1 - sx : sx), f.y + f.h * rnd.realInRange(0.35, 0.75), 0);
      if (hasTr) {
        const tex = this.textures.get("bd_tractor").getSourceImage(), k = buildK("tractor"), w = tex.width / k, h = tex.height / k;
        const tx = f.x + f.w * (1 - sx), ty = f.y + f.h * rnd.realInRange(0.4, 0.6);
        const im = this.add.image(tx, ty, "bd_tractor").setDisplaySize(w, h).setFlipX(rnd.frac() < 0.5).setOrigin(0.5, 0.85).setY(ty + h * 0.25).setDepth(ty + h * 0.15);
        const p = add("deco", tx, ty, 999, im);
        p.wall = box(tx, ty, w * 0.36, h * 0.24, 0, 30); p.wall.art = true; p.wall.shH = h * 0.5; p.wall.foot = artFootprint(im, 0.12) ?? undefined; this.walls.push(p.wall);
      }
    }
    // предупреждающие таблички
    for (let n = 0, tries = 0; n < 5 && tries < 200; tries++) {
      const x = rnd.between(200, W - 200), y = rnd.between(200, H - 200);
      if (!free(x, y, 16)) continue;
      const p = add("sign", x, y, 99, img("sign", x, y, 0.96)); ob(p, 5, { upright: true }); n++;
    }
    if (!S.story) return;
    // ── сюжет: заслоны поперёк полосы (середина открывается, когда участок зачищен), лагеря, ящики с оружием ──
    this.gates = GATES.map((gy, k) => {
      const g = { y: gy, open: false, walls: [] as WallBox[], imgs: [] as Phaser.GameObjects.GameObject[], seg: k };
      for (let x = 50; x < W - 40; x += 78) {
        const door = Math.abs(x - W / 2) < 130;
        const im = this.add.image(x, gy, "prop_fence").setDisplaySize(84, 26).setOrigin(0.5, 0.6).setDepth(gy).setTint(door ? 0xd8b890 : 0xffffff);
        const p = add("fence", x, gy, 1e9, im);
        p.wall = box(x, gy, 40, 4, 0, 16);
        this.walls.push(p.wall);
        if (door) { g.walls.push(p.wall); g.imgs.push(im); }
      }
      // у прохода — ящики и бочки, сбоку табличка
      for (const dx of [-150, 150]) { const c = crate(W / 2 + dx, gy + 26); g.imgs.push(c.img); }
      barrel(W / 2 - 190, gy + 30); barrel(W / 2 + 196, gy + 34, true);
      const sp = add("sign", W / 2 + 240, gy + 40, 99, img("sign", W / 2 + 240, gy + 40, 0.96)); ob(sp, 5, { upright: true });
      return g;
    });
    for (const c of CAMPS) {
      fire(c.x, c.y);
      crate(c.x + 90, c.y - 20); crate(c.x - 96, c.y + 14);
      lamp(c.x - 70, c.y - 70, false);
    }
    for (const wc of WEAPON_CRATES) {
      const p = crate(wc.x, wc.y);
      p.loot = wc.slot; p.hp = 2;
      p.light = { dx: 0, dy: -10, r: 110, col: 0xffe070, a: 0.55, flick: 0.15, night: false };
      p.star = this.add.image(wc.x, wc.y - 44, this.textures.exists("hud_score") ? "hud_score" : "dot").setDisplaySize(22, 22).setDepth(wc.y + 50);
      this.tweens.add({ targets: p.star, y: wc.y - 52, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }
  /** пламя: частицы вверх, ярко (ADD) */
  flames(x: number, y: number, scale: number) {
    return this.add.particles(x, y, "flame", {
      speedY: { min: -60 * scale, max: -25 * scale }, speedX: { min: -12, max: 12 }, lifespan: { min: 350, max: 750 }, frequency: 45 / scale,
      scale: { start: 0.65 * scale, end: 0.1 }, alpha: { start: 0.9, end: 0 }, tint: [0xffe080, 0xffa030, 0xff6020, 0xff4010],
      x: { min: -6 * scale, max: 6 * scale }, blendMode: Phaser.BlendModes.ADD,
    }).setDepth(y + 8);
  }
  /** облачко пыли из-под ног */
  dust(x: number, y: number) {
    if (settings.quality === "low") return;
    for (let i = 0; i < 2; i++) {
      const d = this.add.image(x + rand(-5, 5), y + rand(-2, 2), "dot").setTint(0x8a7a5a).setAlpha(0.32).setScale(0.6).setDepth(y - 1);
      this.tweens.add({ targets: d, scale: rand(1.6, 2.4), alpha: 0, y: d.y - rand(3, 8), x: d.x + rand(-6, 6), duration: rand(380, 560), ease: "Quad.easeOut", onComplete: () => d.destroy() });
    }
  }
  /** всплывающая надпись над миром (+очки) */
  popup(x: number, y: number, s: string, color: string) {
    const tx = this.add.text(x, y, s, { fontFamily: "system-ui, sans-serif", fontSize: "15px", fontStyle: "900", color, stroke: "#14110d", strokeThickness: 4 }).setOrigin(0.5).setDepth(1e6 + 2).setScale(0.6);
    this.tweens.add({ targets: tx, scale: 1, duration: 120, ease: "Back.easeOut" });
    this.tweens.add({ targets: tx, y: y - 30, alpha: 0, delay: 250, duration: 650, ease: "Quad.easeIn", onComplete: () => tx.destroy() });
  }
  /** ударная волна: светлое кольцо расходится по земле */
  shock(x: number, y: number, power: number) {
    const ring = this.add.circle(x, y, 16).setStrokeStyle(5, 0xfff0c0, 0.75).setDepth(-3.9);
    this.tweens.add({ targets: ring, scale: 7.5 * power, alpha: 0, duration: 380, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
    const dust = this.add.circle(x, y, 30, 0x6a5a3a, 0.35).setDepth(-3.95);
    this.tweens.add({ targets: dust, scale: 3.5 * power, alpha: 0, duration: 900, ease: "Quad.easeOut", onComplete: () => dust.destroy() });
  }
  /** урон предмету (считает хозяин / одиночная игра) */
  hitProp(p: Prop, dmg: number) {
    if (p.dead || NET.role === "client") return;
    if (p.kind !== "barrel" && p.kind !== "crate" && p.kind !== "drum" && !(p.kind === "fence" && p.hp < 1e8)) return;
    p.hp -= dmg;
    if (p.hp <= 0) this.breakProp(p, true);
  }
  /** бочка взрывается, ящик разлетается. fx=false — тихо (догоняем по снимку хозяина) */
  breakProp(p: Prop, fx: boolean) {
    if (p.dead) return;
    if (p.kind === "drum") { p.hp = 999; return; } // синюю бочку не взорвать — просто вмятины
    p.dead = true;
    if (NET.role === "host") send({ t: "prop", id: p.id });
    if (p.ob) this.obs = this.obs.filter((o) => o !== p.ob);
    this.light.removeShadow(p.img);
    p.img.destroy();
    if (p.wall) this.walls = this.walls.filter((w) => w !== p.wall);
    this.buildGrid(); this.flowCell = -1;
    if (!fx) return;
    if (p.kind === "barrel") {
      // взрыв сильнее гранаты, остаётся горящее пятно; соседние бочки рвутся цепочкой (в explode)
      if (NET.role !== "client") this.explode(p.x, p.y - 4, 1.25);
      const sc = this.blotch(p.x, p.y, 30, 20, 0x0e0a06, 0.7).setDepth(-4.1);
      this.tweens.add({ targets: sc, alpha: 0, delay: 20000, duration: 4000, onComplete: () => sc.destroy() });
      for (let i = 0; i < 5; i++) this.gib("gib_chunk", Phaser.Utils.Array.GetRandom([0xc8281a, 0x8a1a10, 0x3a3a3a]), p.x, p.y, 10, rand(0, TAU), rand(120, 300), rand(200, 380), { scale: rand(0.8, 1.4), life: rand(6, 9) });
      this.burns.push({ x: p.x, y: p.y, t: 6, fire: this.flames(p.x, p.y - 2, 0.8), tick: 0 });
    } else {
      sfx("crate", this.near(p.x, p.y));
      for (let i = 0; i < 10; i++) this.gib("gib_arm", Phaser.Utils.Array.GetRandom([0xc8945a, 0xa8743a, 0x7a5228]), p.x, p.y, 10, rand(0, TAU), rand(60, 200), rand(120, 260), { scale: rand(0.5, 0.9), life: rand(5, 8) });
      this.blood.setParticleTint(0xb88a4e); this.blood.explode(14, p.x, p.y - 12);
      // ящик с оружием (сюжет)
      if (p.loot !== undefined) {
        S.owned[p.loot] = true;
        const id = SLOTS[p.loot]; S.clip[id] = wstat(id).mag;
        p.star?.destroy();
        this.selectWeapon(p.loot);
        S.msg = t("st_found", { w: wname(id) }); S.msgT = 3; sfx("pickup");
        this.popup(p.x, p.y - 30, wname(id), "#ffe070");
      }
      // иногда в ящике что-то есть
      else if (NET.role !== "client") { const r = Math.random(); if (r < 0.1) this.dropItem("grenade", p.x, p.y); else if (r < 0.2) this.dropItem("medkit", p.x, p.y); else if (r < 0.24) this.dropItem("armor", p.x, p.y); else if (r < 0.42) this.dropItem(this.ammoPick(), p.x, p.y); }
      // детали для верстака (каждому игроку свои)
      if (fx && Math.random() < (S.story ? 0.6 : 0.3)) this.gainParts(S.story ? 1 + (Math.random() * 2 | 0) : 1, p.x, p.y - 20);
    }
  }
  /** горящие пятна: жгут монстров и игроков рядом, гаснут */
  updateBurns(dt: number) {
    for (const b of this.burns) {
      b.t -= dt;
      if (b.t < 1.2) b.fire.setFrequency(45 / Math.max(0.15, b.t / 1.2) / 0.8);
      if (b.t <= 0) { b.fire.stop(); this.time.delayedCall(900, () => b.fire.destroy()); continue; }
      b.tick -= dt;
      if (b.tick > 0 || NET.role === "client") continue;
      b.tick = 0.4;
      for (const e of this.enemies) if (!e.dead && Math.hypot(e.x - b.x, e.y - b.y) < 30 + KINDS[e.kind].r) {
        e.hp -= 1; e.hitT = 0.07;
        if (e.hp <= 0) this.kill(e, rand(0, TAU));
      }
      if (!this.dead && Math.hypot(this.px - b.x, this.py - b.y) < 34) this.hurtPlayer(4);
      for (const m of this.mates.values()) if (!m.dead && Math.hypot(m.x - b.x, m.y - b.y) < 34) this.hurtMate(m, 4);
    }
    this.burns = this.burns.filter((b) => b.t > 0);
  }
  /** свет костров, фонарей, пожаров и взрывов на этот кадр */
  propLights() {
    const L = this.light, night = L.night, now = performance.now() / 1000, out: typeof L.extra = [];
    const v = this.cameras.main.worldView;
    for (const p of this.props) {
      const l = p.light;
      if (!l || p.dead) continue;
      const x = p.x + l.dx, y = p.y + l.dy;
      const seen = !(x < v.x - l.r || x > v.right + l.r || y < v.y - l.r || y > v.bottom + l.r);
      // пламя вне экрана не считаем
      if (p.fire && p.fire.active !== seen) { p.fire.active = seen; p.fire.setVisible(seen); }
      if (!seen) continue;
      // мерцание: костёр дышит, сломанный фонарь моргает
      let f = 1 - l.flick * 0.5 * (Math.sin(now * 13 + p.id) * 0.5 + Math.sin(now * 7.3 + p.id * 3) * 0.5 + 0.5);
      if (l.flick >= 1) f = Math.sin(now * 3 + p.id) > 0.2 || Math.sin(now * 23 + p.id) > 0.6 ? 1 : 0.08;
      const k = l.night ? Math.max(0, (night - 0.25) / 0.75) : 0.25 + night * 0.75;
      out.push({ x, y, r: l.r * (0.92 + f * 0.08), col: l.col, a: l.a * f * k });
    }
    for (const b of this.burns) out.push({ x: b.x, y: b.y - 4, r: 170, col: 0xff7a20, a: Math.min(1, b.t / 1.5) * (0.5 + night * 0.5) * (0.85 + Math.random() * 0.15) });
    for (const b of this.booms) { const k = 1 - b.t / 0.55; if (k > 0) out.push({ x: b.x, y: b.y, r: 280, col: 0xffa040, a: k * k * (0.35 + night * 1.1) }); }
    L.extra = out;
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
      const R = Math.hypot(w.ex, w.ey) + 13;
      for (let j = Math.max(0, Math.floor((w.cy - R) / C)); j <= Math.min(n - 1, Math.floor((w.cy + R) / C)); j++)
        for (let i = Math.max(0, Math.floor((w.cx - R) / C)); i <= Math.min(n - 1, Math.floor((w.cx + R) / C)); i++)
          if (wDist(w, (i + 0.5) * C, (j + 0.5) * C) < 13) this.blocked[j * n + i] = 1;
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
      const m = r + 3, a = wLocal(w, x, y), b = wLocal(w, tx, ty), ldx = b.x - a.x, ldy = b.y - a.y;
      let t0 = 0, t1 = 1;
      const ok = ([[-ldx, a.x + w.ex + m], [ldx, w.ex + m - a.x], [-ldy, a.y + w.ey + m], [ldy, w.ey + m - a.y]] as const).every(([pp, q]) => {
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
    // стены (повёрнутые прямоугольники): выталкиваем в координатах стены
    for (const w of this.walls) {
      if (Math.abs(x - w.cx) > w.ex + w.ey + r || Math.abs(y - w.cy) > w.ex + w.ey + r) continue;
      let { x: lx, y: ly } = wLocal(w, x, y);
      const cx = Phaser.Math.Clamp(lx, -w.ex, w.ex), cy = Phaser.Math.Clamp(ly, -w.ey, w.ey);
      const dx = lx - cx, dy = ly - cy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 0.01) { lx = cx + (dx / d) * r; ly = cy + (dy / d) * r; }
      else {
        // центр внутри стены: к ближайшему краю
        const e = [lx + w.ex, w.ex - lx, ly + w.ey, w.ey - ly], k = e.indexOf(Math.min(...e));
        if (k === 0) lx = -w.ex - r; else if (k === 1) lx = w.ex + r; else if (k === 2) ly = -w.ey - r; else ly = w.ey + r;
      }
      ({ x, y } = wWorld(w, lx, ly));
    }
    return { x: Phaser.Math.Clamp(x, 40, W - 40), y: Phaser.Math.Clamp(y, 40, H - 40) };
  }

  /** текущее оружие */
  get cur() { return wstat(SLOTS[S.weapon]); }
  /** магазин полон (ракеты и топливо — из запаса) */
  refill(w: WStat) {
    if (!w.stock) { S.clip[w.id] = w.mag; return; }
    const take = Math.min(w.mag - S.clip[w.id], S.stock[w.id] ?? 0);
    S.clip[w.id] += take; S.stock[w.id] = (S.stock[w.id] ?? 0) - take;
  }
  /** спецпатроны: обычные → бронебойные → зажигательные (только те, что есть) */
  setAmmo(k: number) {
    if (S.over || S.chatOpen || this.dead || S.ammoK === k) return;
    if ((k === 1 && S.ap <= 0) || (k === 2 && S.inc <= 0)) return;
    S.ammoK = k;
    S.msg = t((["ammo_n", "ammo_ap", "ammo_inc"] as Key[])[k]); S.msgT = 1;
    sfx("swap");
  }
  cycleAmmo() {
    if (S.over || S.chatOpen || this.dead) return;
    for (let k = 1; k <= 3; k++) {
      const n = (S.ammoK + k) % 3;
      if (n === 0 || (n === 1 && S.ap > 0) || (n === 2 && S.inc > 0)) { S.ammoK = n; break; }
    }
    S.msg = t((["ammo_n", "ammo_ap", "ammo_inc"] as Key[])[S.ammoK]); S.msgT = 1;
    sfx("swap");
  }
  startReload() {
    const w = this.cur;
    if (S.reload > 0 || !w.mag || S.clip[w.id] === w.mag || S.over || this.dead) return;
    if (w.stock && !(S.stock[w.id]! > 0)) { if (S.clip[w.id] <= 0 && this.emptyT <= 0) { this.emptyT = 0.6; S.msg = t("no_ammo"); S.msgT = 1; sfx("empty"); } return; }
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
    for (let i = 0; i < 7 + n * 4; i++) q.push(n >= 2 && i % 3 === 2 ? "runner" : "zombie");
    if (n >= 2) for (let i = 0; i < n - 1; i++) q.push("bloater");
    if (n >= 3) for (let i = 0; i < n - 1; i++) q.push("armored");
    if (n >= 4) for (let i = 0; i < Math.floor((n - 2) / 2); i++) q.push("brute");
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
      if (!inHouse(hs, x, y, 30) && Math.hypot(x - this.px, y - this.py) > 300 && this.obs.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + K_.r + 4)) break;
    }
    this.addEnemy(kind, x, y, this.eid++);
  }

  addEnemy(kind: Kind, x: number, y: number, id: number): Enemy {
    const K_ = KINDS[kind];
    const e: Enemy = { id, tx: x, ty: y, kind, x, y, kx: 0, ky: 0, hp: K_.hp, a: 0, ph: Math.random() * TAU, cool: 0, hitT: 0, dead: false, voice: rand(0.5, 4), hx: 0, hy: 0, sx: x, sy: y, st: 0.6, side: 0, sideT: 0 } as Enemy;
    if (K_.sprite) {
      const sh = this.add.image(2, 3, "lt_cast").setDisplaySize(K_.size! * 0.6, K_.size! * 0.42).setAlpha(0.35);
      e.cast = this.make.image({ key: silTex(this, K_.sprite!) }, false).setDisplaySize(K_.size!, K_.size!);
      e.img = this.add.image(0, 0, K_.sprite).setDisplaySize(K_.size!, K_.size!).setTint(0xd8e0c8);
      e.c = this.add.container(x, y, [sh, e.img]);
    } else {
      const [sk, pal] = kind === "zombie" ? ["zA", PAL_ZOMBIE_A] as const : kind === "spitter" ? ["zC", PAL_ZOMBIE_C] as const
        : kind === "armored" ? ["zD", PAL_ZOMBIE_D] as const : kind === "brute" ? ["zE", PAL_ZOMBIE_E] as const : kind === "bloater" ? ["zF", PAL_ZOMBIE_F] as const : ["zB", PAL_ZOMBIE_B] as const;
      e.hum = new Humanoid(this, x, y, sk, pal, false);
      if (kind === "spitter") e.throwT = rand(1.5, 3);
      if (kind === "armored") { e.arm = ARMOR_PTS; e.hum.setArmor(true); }
      e.c = e.hum.c;
      e.cast = e.hum.cast;
      const sc = KIND_SCALE[kind];
      if (sc) { e.c.setScale(sc); e.hum.castIn.setScale(sc); }
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

  /** неровное пятно (кровь, копоть): клякса с брызгами, не ровный овал */
  blotch(x: number, y: number, w: number, h: number, col: number, a: number) {
    return this.add.image(x, y, "splat" + Math.floor(Math.random() * 4)).setDisplaySize(w * 1.25, h * 1.25).setTint(col).setAlpha(a).setRotation(rand(-0.5, 0.5)).setFlipX(Math.random() < 0.5);
  }
  /** кровавое пятно на земле */
  splat(x: number, y: number, col: number, r: number) {
    const e = this.blotch(x, y, r * rand(1.6, 2.4), r * rand(1.1, 1.6), col, rand(0.5, 0.75)).setDepth(-4);
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
    for (const e of this.enemies) if (!e.dead) occ.push({ x: e.x, y: e.y, r: KINDS[e.kind].r * 0.8, obj: e.c, move: true });
    for (const m of this.mates.values()) occ.push({ x: m.x, y: m.y, r: 9, obj: m.hum.c, move: true });
    // стены дома для фонаря — прямоугольники (одна тень на стену)
    for (const w of this.walls) {
      if (Math.abs(w.cx - this.px) > reach + 80 || Math.abs(w.cy - this.py) > reach + 80) continue;
      occ.push({ x: w.cx, y: w.cy, r: 0, poly: w.pts });
    }
    const alive = !S.over;
    // время суток из настроек (у гостя — как у хозяина)
    if (NET.role !== "client" && settings.daynight !== "cycle") L.t = Math.floor(L.t) + (settings.daynight === "day" ? 0.25 : 0.72);
    // сюжет — утро, в туннеле всегда темно
    if (S.story) L.t = Math.floor(L.t) + (LANE ? 0.75 : 0.07);
    L.shadows = settings.quality !== "low";
    L.setRes(settings.quality === "high" ? 1 : 2);

    this.propLights();
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
    if (settings.quality === "low" || (shA < 0.05 && !flashSh)) shA = 0; // низкое качество (или ночь): без длинных теней людей и зверей
    // ночью этот слой пуст — не открываем проход вовсе (на телефоне каждый проход дорогой)
    if (shA > 0.01) rt.beginDraw(); // все силуэты одним проходом в текстуру
    if (shA <= 0.01) { /* пусто */ }
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
    if (shA > 0.01) rt.endDraw();
    // тени стен дома от солнца: прямоугольник + он же, сдвинутый по солнцу на высоту стены
    if (!flashSh && SHADOW_ALPHA * sun.day > 0.01 && this.walls.length) {
      const g = (this.wallShG ??= this.make.graphics({}, false)).clear().fillStyle(0x000000);
      for (const w of this.walls) {
        if ((w.art && !w.shH) || !onView(w.cx, w.cy)) continue;
        const d = (w.shH ?? w.h) * sun.len * SHADOW, sx = Math.cos(sun.ang) * d, sy = Math.sin(sun.ang) * d;
        const pts = w.foot ?? w.pts, hp = hull([...pts, ...pts.map((q) => ({ x: q.x + sx, y: q.y + sy }))]);
        if (!w.shH) { g.fillStyle(0x000000, 1).fillPoints(hp.map((q) => ({ x: q.x - ox, y: q.y - oy })), true); continue; }
        // у построек и машин — мягкий край: тот же контур чуть шире и чуть уже, слоями
        let mx = 0, my = 0; for (const q of hp) { mx += q.x; my += q.y; } mx /= hp.length; my /= hp.length;
        const sz = Math.max(20, Math.hypot(w.ex, w.ey));
        for (const [e, al] of [[7, 0.3], [2, 0.45], [-4, 1]] as const) {
          const k = 1 + e / sz;
          g.fillStyle(0x000000, al).fillPoints(hp.map((q) => ({ x: mx + (q.x - mx) * k - ox, y: my + (q.y - my) * k - oy })), true);
        }
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
    S.hurtV = Math.min(1, S.hurtV + 0.55 + dmg / 40); // красные края экрана (рисует UI)
    sfx("hurt");
    if (!fxOnly && S.hp <= 0) this.die();
  }

  die() {
    S.hp = 0;
    this.player.flash(false);
    this.player.body.setTint(0x777777); this.player.head.setTint(0x777777);
    this.player.back.clear(); this.player.front.clear();
    this.aimG.clear();
    if (NET.role === "solo" && !this.mates.size) { S.over = true; sfx("over"); return; }
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

  /** подобрал патроны (свои — сразу, гостю — подарком от хозяина). false — некуда (всё полно) */
  takeAmmo(k: ItemKind) {
    const n = AMMO_GIVE[k] ?? 0;
    if (k === "ap" || k === "inc") {
      if (S[k] >= AMMO_MAX) return false;
      S[k] = Math.min(AMMO_MAX, S[k] + n);
      // первые спецпатроны — сразу заряжены
      if (!S.ammoK) S.ammoK = k === "ap" ? 1 : 2;
    } else {
      const id: WeaponId = k === "rocket" ? "bazooka" : "flamer", max = STOCK_MAX[id]!;
      if ((S.stock[id] ?? 0) >= max) return false;
      S.stock[id] = Math.min(max, (S.stock[id] ?? 0) + n);
    }
    sfx("pickup"); S.msg = `${t(`got_${k}` as Key)} +${n}`; S.msgT = 1.1;
    return true;
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
        if (m.dead || m.bot || Math.hypot(it.x - m.x, it.y - m.y) > 24) continue;
        if (it.kind === "medkit" && m.med < MAX_MED) { m.med++; send({ t: "give", k: "medkit" }, m.id); it.life = 0; break; }
        if (it.kind === "grenade" && m.gren < MAX_GREN) { m.gren++; send({ t: "give", k: "grenade" }, m.id); it.life = 0; break; }
        if (it.kind === "armor" && m.armor < 100) { m.armor = Math.min(100, m.armor + 50); send({ t: "give", k: "armor" }, m.id); it.life = 0; break; }
        if (AMMO_GIVE[it.kind]) { send({ t: "give", k: it.kind }, m.id); it.life = 0; break; }
      }
      if (NET.role !== "client" && !S.over && !this.dead && it.life > 0 && Math.hypot(it.x - this.px, it.y - this.py) < 24 && it.vz === 0) {
        if (it.kind === "medkit" && S.medkits < MAX_MED) {
          S.medkits++;
          sfx("pickup"); S.msg = tk("got_med"); S.msgT = 0.9; it.life = 0;
        } else if (it.kind === "armor" && S.armor < 100) {
          S.armor = Math.min(100, S.armor + 50);
          sfx("armor"); S.msg = t("got_armor"); S.msgT = 0.9; it.life = 0;
        } else if (it.kind === "grenade" && S.grenades < MAX_GREN) {
          S.grenades++;
          sfx("pickup"); S.msg = t("got_nade"); S.msgT = 0.9; it.life = 0;
        } else if (AMMO_GIVE[it.kind] && this.takeAmmo(it.kind)) it.life = 0;
      }
      if (it.life <= 0) { it.img.destroy(); it.sh.destroy(); }
    }
    this.items = this.items.filter((it) => it.life > 0);
  }

  /** замах гранатой: откуда (клавиша, мышь, кнопка на экране, «огонь» в ячейке 4) и когда начали */
  charge: { src: "key" | "mouse" | "touch" | "fire"; t0: number; pid?: number } | null = null;
  /** сила броска 0..1: полная — за NADE_FULL секунд удержания */
  nadePower() { return this.charge ? Math.min(1, (performance.now() - this.charge.t0) / 1000 / NADE_FULL) : 0; }
  nadeDist(p: number) { return NADE_MIN + (NADE_MAX - NADE_MIN) * p; }
  chargeNade(src: "key" | "mouse" | "touch" | "fire", pid?: number) {
    if (S.over || S.paused || this.dead || S.inv || S.chatOpen || this.charge) return;
    if (S.grenades <= 0) { S.msg = t("no_nades"); S.msgT = 0.8; sfx("empty"); return; }
    this.charge = { src, t0: performance.now(), pid };
  }
  releaseNade(src: "key" | "mouse" | "touch" | "fire") {
    if (!this.charge || this.charge.src !== src) return;
    const p = this.nadePower();
    this.charge = null;
    this.throwNade(this.nadeDist(p));
  }
  throwNade(dist = 230) {
    if (S.over || S.paused || this.dead) return;
    if (S.grenades <= 0) { S.msg = t("no_nades"); S.msgT = 0.8; sfx("empty"); return; }
    S.grenades--;
    this.player.recoil = 1;
    dist = Phaser.Math.Clamp(dist, NADE_MIN, NADE_MAX);
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

  explode(x: number, y: number, power = 1) {
    if (NET.role === "host") send({ t: "boom", x, y, p: power });
    sfx("boom", Math.max(0.6, this.near(x, y)));
    this.cameras.main.shake(220 * power, 0.004 * power);
    this.booms.push({ x, y, t: 0 });
    this.shock(x, y, power);
    const R = 125 * power;
    // соседние бочки рвутся цепочкой (с задержкой), ящики ломаются
    if (NET.role !== "client") for (const p of this.props) {
      if (p.dead || (p.kind !== "barrel" && p.kind !== "crate" && !(p.kind === "fence" && p.hp < 1e8))) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > R * 0.85 || d < 1) continue;
      if (p.kind === "barrel") this.time.delayedCall(110 + d * 1.2, () => this.breakProp(p, true));
      else this.hitProp(p, p.kind === "fence" ? 99 : 6 * (1 - d / R) + 1);
    }
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
      const PR = 95 * power;
      if (pd < PR) this.hurtPlayer(Math.round(5 + 30 * (1 - pd / PR)));
      for (const m of this.mates.values()) { const md = Math.hypot(m.x - x, m.y - y); if (md < PR) this.hurtMate(m, Math.round(5 + 30 * (1 - md / PR))); }
    }
    // искры, земля, воронка
    this.blood.setParticleTint(0xffb040);
    this.blood.explode(40, x, y - 6);
    for (let i = 0; i < 12; i++) this.gib("gib_chunk", Phaser.Utils.Array.GetRandom([0x5a4a30, 0x4a3a24, 0x6a5a3a, 0x3a3020]), x, y, 3, rand(0, TAU), rand(80, 280), rand(160, 340), { scale: rand(0.5, 1.1) });
    const scorch = this.blotch(x, y, 74, 50, 0x16120a, 0.6).setDepth(-4.2);
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
      for (let i = 0; i < 4; i++) g.fillStyle(ITEM_COL[it.kind], 0.045 * night * p).fillCircle(it.x, it.y - 4, 20 * (1 - i / 5));
    }
  }

  /** опыт: уровни растут сами, на новом уровне — бонус и полное здоровье */
  gainXp(n: number) {
    if (S.level >= MAX_LV) return;
    S.xp += n;
    while (S.level < MAX_LV && S.xp >= xpNeed(S.level)) {
      S.xp -= xpNeed(S.level); S.level++;
      const r = (S.level - 2) % 4;
      S.maxHp = heroMaxHp();
      if (r === 3) S.grenades = Math.min(MAX_GREN, S.grenades + 1);
      if (!this.dead) S.hp = S.maxHp;
      const bonus = t((["lv_hp", "lv_dmg", "lv_rel", "lv_spd"] as Key[])[r]);
      S.msg = `${t("lv_up", { n: S.level })} ${bonus}`; S.msgT = 3;
      this.popup(this.px, this.py - 60, t("lv_up", { n: S.level }), "#80e8ff");
      sfx("wave", 0.6);
      const ring = this.add.circle(this.px, this.py, 14).setStrokeStyle(4, 0x80e8ff, 0.9).setDepth(this.py + 1);
      this.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
    }
    if (S.level >= MAX_LV) S.xp = 0;
  }
  gainParts(n: number, x: number, y: number) {
    if (n <= 0) return;
    S.parts += n;
    this.popup(x, y, `+${n} ${t("parts_s")}`, "#9fd8ff");
  }
  /** улучшить оружие на верстаке */
  upgrade(id: WeaponId) {
    const u = S.up[id] ?? 0, st = UPG[u];
    if (!st || !S.bench) return;
    if (S.parts < st.cost) { S.msg = t("no_parts", { n: st.cost - S.parts }); S.msgT = 1.2; sfx("empty"); return; }
    const was = wstat(id).mag;
    S.parts -= st.cost; S.up[id] = u + 1;
    const now = wstat(id).mag;
    if (now > was) S.clip[id] = Math.min(now, S.clip[id] + now - was);
    sfx("swap"); sfx("pickup");
    S.msg = `${wname(id)}: ${t(st.key)}`; S.msgT = 1.6;
  }
  kill(e: Enemy, dir: number) {
    if (NET.role === "host") send({ t: "kill", id: e.id, dir });
    e.dead = true;
    S.kills++;
    S.score += KINDS[e.kind].score;
    this.popup(e.x, e.y - 34, `+${KINDS[e.kind].score}`, e.kind === "bear" ? "#ffb040" : "#ffe2a0");
    this.gainXp(KINDS[e.kind].score);
    const pp = PARTS[e.kind];
    if (Math.random() < pp[0]) this.gainParts(pp[1] + (Math.random() * (pp[2] - pp[1] + 1) | 0), e.x, e.y - 52);
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
    const pool = this.blotch(e.x, e.y, KINDS[e.kind].r * 3, KINDS[e.kind].r * 2, KINDS[e.kind].blood, 0.6).setDepth(-4);
    e.c.setDepth(-3);
    if (e.hum) { e.hum.back.clear(); e.hum.front.clear(); e.hum.flash(false); e.hum.body.setTint(0x6a6a6a); }
    if (e.img) e.img.setTint(0x555555);
    const [pg, pm, pa] = NET.role === "client" ? [0, 0, 0] : DROP[e.kind];
    if (Math.random() < pg) this.dropItem("grenade", e.x - 5, e.y);
    if (Math.random() < pm) this.dropItem("medkit", e.x + 6, e.y + 4);
    if (Math.random() < pa) this.dropItem("armor", e.x, e.y - 7);
    if (NET.role !== "client" && Math.random() < AMMO_DROP[e.kind]) this.dropItem(this.ammoPick(), e.x + 4, e.y - 4);
    // раздутый лопается: взрыв ранит всех рядом
    if (e.kind === "bloater") {
      if (NET.role !== "client") this.time.delayedCall(80, () => this.explode(e.x, e.y - 4, 0.85));
      this.blood.setParticleTint(0x9ac040); this.blood.explode(30, e.x, e.y - 10);
      for (let i = 0; i < 6; i++) this.splat(e.x + rand(-30, 30), e.y + rand(-20, 20), 0x7a9a2a, rand(5, 10));
      e.c.setVisible(false);
    }
    this.tweens.add({ targets: e.c, alpha: 0, scale: (KIND_SCALE[e.kind] ?? 1) * 0.85, delay: 6000, duration: 2000, onComplete: () => e.c.destroy() });
    this.tweens.add({ targets: pool, alpha: 0, delay: 8000, duration: 3000, onComplete: () => pool.destroy() });
  }

  /** какие патроны выпадут: бронебойные и зажигательные всегда к месту, ракеты и топливо — если есть чем стрелять */
  ammoPick(): ItemKind {
    const o: ItemKind[] = ["ap", "ap", "inc", "inc"];
    if (S.owned[SLOTS.indexOf("bazooka")]) o.push("rocket");
    if (S.owned[SLOTS.indexOf("flamer")]) o.push("fuel", "fuel");
    return Phaser.Utils.Array.GetRandom(o);
  }
  /** броня «в броне» сбита: латы слетают */
  breakArmor(e: Enemy) {
    e.arm = 0;
    e.hum?.setArmor(false);
    sfx("clang", this.near(e.x, e.y)); sfx("crate", this.near(e.x, e.y) * 0.6);
    for (let i = 0; i < 4; i++) this.gib("gib_chunk", Phaser.Utils.Array.GetRandom([0x9aa2ac, 0x828a94, 0x6a727c]), e.x, e.y, 14, rand(0, TAU), rand(80, 180), rand(150, 260), { scale: rand(0.9, 1.4), life: rand(6, 9) });
    this.popup(e.x, e.y - 40, t("armor_off"), "#c0d8ff");
  }
  /** поджечь монстра (огнемёт, зажигательные) */
  ignite(e: Enemy, s: number) {
    if (e.dead) return;
    e.burn = Math.max(e.burn ?? 0, s);
  }
  /** горение: урон у хозяина, искры и оранжевый цвет — у всех */
  burnFx(e: Enemy, dt: number) {
    if (!e.burn || e.burn <= 0) return;
    e.burn -= dt;
    e.burnT = (e.burnT ?? 0) - dt;
    if (e.burnT <= 0) {
      e.burnT = 0.2;
      this.blood.setParticleTint(Math.random() < 0.5 ? 0xff8a20 : 0xffd040);
      this.blood.explode(2, e.x + rand(-6, 6), e.y - rand(14, 30) * (KIND_SCALE[e.kind] ?? 1));
      if (NET.role !== "client") {
        e.hp -= 0.45; e.hitT = Math.max(e.hitT, 0.02);
        if (e.hp <= 0) { this.kill(e, rand(0, TAU)); return; }
      }
    }
    if (e.hitT <= 0) {
      const c = Math.random() < 0.5 ? 0xffa050 : 0xff7a30;
      if (e.hum) { e.hum.body.setTint(c); e.hum.head.setTint(c); } else e.img?.setTint(c);
    }
  }
  /** бензопила: удар по всем перед героем (у хозяина). x, y — где герой, a — куда смотрит, dm — множитель урона */
  sawHit(x: number, y: number, a: number, dm: number) {
    const ca = Math.cos(a), sa = Math.sin(a);
    let any = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy), r = KINDS[e.kind].r;
      if (d > 34 + r || (dx * ca + dy * sa) < -4) continue;
      any = true;
      if (NET.role === "client") continue;
      const front = e.arm && e.arm > 0 && (ca * Math.cos(e.a) + sa * Math.sin(e.a)) < -0.3;
      if (front) { e.arm! -= 1.2; if (e.arm! <= 0) this.breakArmor(e); }
      e.hp -= WEAPONS.saw.dmg * dm * (front ? 0.35 : 1);
      e.hitT = 0.07;
      e.kx += ca * 40 / KINDS[e.kind].mass; e.ky += sa * 40 / KINDS[e.kind].mass;
      if (e.hp <= 0) { this.kill(e, a); this.chunks(e, a, 5, 1.4); }
      else if (Math.random() < 0.35) this.hitFx(e, a, 1, 0.9, e.hum && Math.random() < 0.25 ? (Math.random() < 0.5 ? 0 : 1) : -1);
    }
    if (any) {
      this.blood.setParticleTint(0x8a1010);
      this.blood.explode(6, x + ca * 26, y + sa * 26 - 10);
      if (Math.random() < 0.3) this.splat(x + ca * 30 + rand(-8, 8), y + sa * 30 + rand(-8, 8), 0x7a1010, rand(3, 6));
      sfx("gore", this.near(x, y) * 0.35);
    }
    // ящики и бочки пилятся тоже
    if (NET.role !== "client") for (const p of this.props) if (!p.dead && Math.hypot(p.x - x - ca * 22, p.y - y - sa * 22) < 26) this.hitProp(p, 0.6);
    return any;
  }

  update(_t: number, dtMs: number) {
    if ((S.paused || S.inv) && NET.role === "solo") return;
    const dt = Math.min(0.05, dtMs / 1000);
    if (S.menu) {
      // за главным экраном — живой мир: камера медленно плывёт над картой, бродят зомби
      this.menuWorld(dt);
      if (!document.hidden) this.updateLight(dt);
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
    this.updateBurns(dt);
    this.updateItems(dt);
    this.drawFx(dt);
    // скрытая вкладка (кооператив в фоне): свет и тени не нужны, только логика и сеть
    if (!document.hidden) { this.light.adapt(dtMs, settings.quality === "high" ? 2 : 1); this.updateLight(dt); }
    if (S.over) {
      if (!this.overShown) { this.overShown = true; if (S.story) this.storyDeath(); else this.showOver(); }
      this.aimG.clear(); this.updateMates(dt); this.netTick(dt); return;
    }
    S.time += dt;

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
    const spd = 175 * heroSpeed();
    const p = this.collide(this.px + mx * spd * dt, this.py + my * spd * dt, 10);
    const went = Math.hypot(p.x - this.px, p.y - this.py);
    this.pvx = (p.x - this.px) / dt; this.pvy = (p.y - this.py) / dt;
    this.px = p.x; this.py = p.y;
    this.moving = Phaser.Math.Linear(this.moving, Math.min(1, went / (spd * dt + 1e-6)), 0.25);
    if (ml > 0.1) this.moveA = Math.atan2(my, mx);
    const ph0 = this.ph;
    this.ph += went * 0.12;
    if (Math.floor(this.ph / Math.PI) !== Math.floor(ph0 / Math.PI)) { sfx("step", 0.8); this.dust(this.px, this.py + 4); }

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
    if (S.reload > 0) { S.reload -= dt; if (S.reload <= 0) { S.reload = 0; this.refill(W_); } }
    if (W_.id === "grenade") {
      // ячейка 4: огонь — бросок гранаты
      // держишь огонь — замах, отпустил — бросок
      if (firing && this.fireT <= 0 && !this.charge) this.chargeNade("fire");
      if (!firing && this.charge?.src === "fire") { this.releaseNade("fire"); this.fireT = W_.rate; }
    } else if (W_.id === "saw") {
      // бензопила: пока держишь огонь — пилит всё перед собой
      if (firing && this.fireT <= 0) {
        this.fireT = W_.rate; this.muzzleT = 0.12;
        this.player.recoil = 0.3 + Math.random() * 0.4;
        const dm = Math.round(W_.dmg / WEAPONS.saw.dmg * 100) / 100;
        if (NET.role === "client") send({ t: "saw", x: Math.round(this.px), y: Math.round(this.py), a: Math.round(this.aimA * 100) / 100, dm });
        const any = this.sawHit(this.px, this.py, this.aimA, dm);
        sfx("saw", any ? 1 : 0.6);
        if (any) cam.shake(60, W_.shake);
      }
    } else {
      if (firing && S.reload > 0 && this.emptyT <= 0) { this.emptyT = 0.35; sfx("empty", 0.7); }
      if (firing && this.fireT <= 0 && S.reload <= 0) {
        if (S.clip[W_.id] <= 0) this.startReload();
        else {
          S.clip[W_.id]--;
          // спецпатроны (бронебойные / зажигательные) — пока не кончатся
          let ak = 0;
          if (BULLET_GUN(W_.id) && S.ammoK) {
            if (S.ammoK === 1 && S.ap > 0) { ak = 1; S.ap--; } else if (S.ammoK === 2 && S.inc > 0) { ak = 2; S.inc--; }
            if ((S.ammoK === 1 && S.ap <= 0) || (S.ammoK === 2 && S.inc <= 0)) { S.ammoK = 0; S.msg = t("ammo_out"); S.msgT = 1.2; }
          }
          this.fireT = W_.rate;
          this.muzzleT = W_.pellets > 1 ? 0.07 : 0.05;
          this.player.recoil = 1;
          const ca = Math.cos(this.aimA), sa = Math.sin(this.aimA);
          // дробь — веером, одиночная пуля — с небольшим разбросом
          const as: number[] = [];
          for (let i = 0; i < W_.pellets; i++) as.push(Math.round((this.aimA + (W_.pellets > 1 ? ((i + Math.random()) / W_.pellets - 0.5) : Math.random() - 0.5) * W_.spread) * 1000) / 1000);
          // пуля летит от героя (чтобы попадать и в упор), видна от дула; высота добавляется при отрисовке
          const bx = Math.round(this.px + ca * 6), by = Math.round(this.py + sa * 6);
          this.bullets.push(...shotBullets(W_, bx, by, as, NET.role === "client", ak));
          // гость: пуля у него только для вида, попадания считает хозяин
          if (NET.role === "client") send({ t: "shot", x: bx, y: by, as, w: W_.id, dm: Math.round(W_.dmg / WEAPONS[W_.id].dmg * 100) / 100, pc: W_.pierce, ak });
          else if (NET.role === "host") send({ t: "fx", k: "shot", who: "host", x: bx, y: by, as, w: W_.id, ak });
          cam.shake(W_.pellets > 1 || W_.shell === "rocket" ? 90 : 30, W_.shake);
          sfx(W_.sound);
          if (W_.shell === "rocket") { this.blood.setParticleTint(0xc8c0b0); this.blood.explode(10, this.px - ca * 18, this.py - sa * 18 - 14); }
          // гильза вылетает вправо от ствола (у дробовика — когда передёрнул цевьё)
          const casing = () => this.gib("gib_casing", W_.pellets > 1 ? 0xff6050 : 0xffffff, this.px + ca * 12 - sa * 3, this.py + sa * 12 + ca * 3, 9, this.aimA + Math.PI / 2 + rand(-0.4, 0.4), rand(70, 120), rand(90, 160), { casing: true, life: rand(4, 6), scale: W_.pellets > 1 ? 1.4 : 1 });
          if (W_.shell) { /* ракета и огонь — без гильз */ }
          else if (W_.pellets > 1) this.time.delayedCall(330, () => { if (!this.dead) { sfx("pump", 0.9); casing(); } });
          else casing();
          if (S.clip[W_.id] === 0) this.time.delayedCall(W_.pellets > 1 ? 500 : 0, () => SLOTS[S.weapon] === W_.id && this.startReload());
        }
      }
    }

    // ── пули ──
    const BS = 1500;
    this.bg.clear();
    for (const b of this.bullets) {
      const step = (b.v ?? BS) * dt;
      let hit = false;
      // огонь и зажигательные поджигают бочки сразу
      const pdmg = b.kind === "fire" || b.kind === "flame" ? 99 : b.kind === "rocket" ? 0 : b.dmg;
      // стены дома: пуля застревает в досках
      if (b.d > 0) for (const w of this.walls) if (wDist(w, b.x, b.y) === 0) {
        hit = true;
        sfx("thunk", this.near(b.x, b.y) * 0.8);
        this.blood.setParticleTint(0x7a5432);
        this.blood.explode(4, b.x - b.dx * 3, b.y - b.dy * 3 + gunZ);
        // забор от пуль ломается (стены домов — нет)
        if (!b.vis) { const fp = this.props.find((p) => p.wall === w && p.kind === "fence" && !p.dead); if (fp) this.hitProp(fp, pdmg); }
        break;
      }
      // стоячие предметы (бочки, ящики, столбы): попадание по видимой высоте и по всему пути пули за кадр
      if (b.d > 0) for (const o of this.obs) {
        if (!o.prop || !o.upright || hit) continue;
        const rx = o.x - b.x, ry = o.y - b.y;
        if (Math.abs(rx) > step + 30 || Math.abs(ry) > step + 40) continue;
        for (let u = 0; u <= step; u += 5) {
          const qx = b.x + b.dx * u - o.x, qy = b.y + b.dy * u - o.y;
          if (Math.abs(qx) < o.r + 1 && qy > -o.r - 16 && qy < o.r * 0.7) { hit = true; break; }
        }
        if (!hit) continue;
        const metal = o.prop.kind !== "crate" && o.prop.kind !== "sign";
        sfx(metal ? "clang" : "thunk", this.near(o.x, o.y) * 0.9);
        this.blood.setParticleTint(metal ? 0xffe080 : 0xb88a4e);
        this.blood.explode(metal ? 6 : 5, o.x - b.dx * 8, o.y - 12);
        if (!b.vis) this.hitProp(o.prop, pdmg);
      }
      for (const o of this.obs) if (!hit && b.d > 0 && !o.low && !(o.prop && o.upright) && Math.hypot(b.x - o.x, b.y - o.y) < o.r * 0.9) {
        if (o.prop) {
          // бочка/ящик/столб: пуля застревает, предмет получает урон
          hit = true;
          const metal = o.prop.kind !== "crate" && o.prop.kind !== "sign";
          sfx(metal ? "clang" : "thunk", this.near(b.x, b.y) * 0.9);
          this.blood.setParticleTint(metal ? 0xffe080 : 0xb88a4e);
          this.blood.explode(metal ? 6 : 5, b.x - b.dx * 4, b.y - b.dy * 4 - 10);
          if (!b.vis) this.hitProp(o.prop, pdmg);
          break;
        }
        if (!o.canopy && b.bounces < 2 && !b.kind) {
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
        if (e.dead || e === b.last) continue;
        // отрезок пули за кадр против круга врага
        const rx = e.x - b.x, ry = e.y - b.y, t = Phaser.Math.Clamp(rx * b.dx + ry * b.dy, 0, step);
        if (Math.hypot(rx - b.dx * t, ry - b.dy * t) < KINDS[e.kind].r + 3) {
          hit = true;
          if (b.kind === "rocket") break; // взрыв — ниже
          // броня спереди: пуля отскакивает, броня понемногу сбивается (бронебойные и огонь — насквозь)
          const facing = b.dx * Math.cos(e.a) + b.dy * Math.sin(e.a);
          if ((e.arm ?? 0) > 0 && b.kind !== "flame" && (b.kind !== "ap" ? facing < -0.35 : false)) {
            if (!b.vis) {
              e.arm! -= b.dmg * 0.5; e.hp -= b.dmg * 0.08; e.hitT = 0.03;
              if (e.arm! <= 0) this.breakArmor(e);
              else if (e.hp <= 0) this.kill(e, Math.atan2(b.dy, b.dx));
            }
            const ra = Math.atan2(-b.dy, -b.dx) + rand(-1.1, 1.1);
            b.dx = Math.cos(ra); b.dy = Math.sin(ra); b.last = e; b.bounces++; b.life = Math.min(b.life, 0.22);
            b.x = e.x + b.dx * (KINDS[e.kind].r + 4); b.y = e.y + b.dy * (KINDS[e.kind].r + 4);
            sfx("clang", this.near(e.x, e.y) * 0.8); sfx("ricochet", this.near(e.x, e.y) * 0.6);
            this.blood.setParticleTint(0xffe8a0); this.blood.explode(6, b.x, b.y - 16);
            hit = false;
            break;
          }
          if (b.kind === "ap" && (e.arm ?? 0) > 0 && !b.vis) { e.arm! -= b.dmg * 0.6; if (e.arm! <= 0) this.breakArmor(e); }
          if (b.vis && !b.pierce) break;
          if (b.pierce) { b.pierce--; b.last = e; hit = false; }
          if (b.vis) continue;
          if (b.kind === "flame") {
            // огонь: слабо, но поджигает и проходит сквозь толпу
            this.ignite(e, 3.5); e.hp -= b.dmg; e.hitT = 0.04;
            e.kx += b.dx * b.kb / KINDS[e.kind].mass; e.ky += b.dy * b.kb / KINDS[e.kind].mass;
            if (e.hp <= 0) this.kill(e, Math.atan2(b.dy, b.dx));
            continue;
          }
          if (b.kind === "fire") this.ignite(e, 2.5);
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
      if (hit) { b.life = 0; if (b.kind === "rocket" && !b.vis) this.explode(b.x - b.dx * 6, b.y - b.dy * 6, 1.1 * Math.min(1.6, b.dmg)); continue; }
      b.x += b.dx * step; b.y += b.dy * step; b.life -= dt; b.d += step;
      if (b.life <= 0 && b.kind === "rocket" && !b.vis) this.explode(b.x, b.y, 1.1 * Math.min(1.6, b.dmg));
      if (b.kind === "flame") {
        // язык пламени: растёт и тускнеет к концу
        const u = Math.min(1, b.d / 220), r = 4 + u * 11;
        this.bg.fillStyle(0xff5a10, 0.35 * (1 - u * 0.6)).fillCircle(b.x, b.y + gunZ, r * 1.4);
        this.bg.fillStyle(u < 0.4 ? 0xffe080 : 0xffa030, 0.7 * (1 - u * 0.7)).fillCircle(b.x, b.y + gunZ, r);
      } else if (b.kind === "rocket") {
        this.bg.lineStyle(5, 0x2a2e1a, 1).lineBetween(b.x - b.dx * 12, b.y - b.dy * 12 + gunZ, b.x, b.y + gunZ);
        this.bg.lineStyle(3, 0x6a7a3a, 1).lineBetween(b.x - b.dx * 11, b.y - b.dy * 11 + gunZ, b.x - b.dx * 2, b.y - b.dy * 2 + gunZ);
        this.bg.fillStyle(0xffa030, 0.9).fillCircle(b.x - b.dx * 15, b.y - b.dy * 15 + gunZ, 4 + Math.random() * 2).fillStyle(0xfff0a0, 1).fillCircle(b.x - b.dx * 14, b.y - b.dy * 14 + gunZ, 2);
        if (Math.random() < 0.6) { this.blood.setParticleTint(0xb8b0a0); this.blood.explode(1, b.x - b.dx * 18, b.y - b.dy * 18 + gunZ); }
      } else if (b.d > 36) this.bg.lineStyle(b.tr < 16 ? 1.8 : 2.2, b.kind === "ap" ? 0x9ae8ff : b.kind === "fire" ? 0xff7030 : 0xffe080, 0.95).lineBetween(b.x - b.dx * b.tr, b.y - b.dy * b.tr + gunZ, b.x, b.y + gunZ);
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // ── враги ──
    if (this.waitHost) { /* ждём хозяина (см. начало update) */ }
    else if (NET.role === "client") { this.clientEnemies(dt); if (S.story) this.storyBench(); }
    else this.hostEnemies(dt, cam);
    this.enemies = this.enemies.filter((e) => !e.dead);

    // ── крыша дома: прозрачная, пока ты внутри ──
    if (this.house) {
      const hs = this.house, inside = inHouse(hs, this.px, this.py, 2);
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
    this.updateBots(dt);
    this.updateMates(dt);
    this.netTick(dt);

    // ── камера чуть впереди героя — туда, куда целишься ──
    {
      const look = this.dead || S.over ? 0 : S.touch ? (S.aim ? 48 : 0) : Phaser.Math.Clamp(aimDist * 0.2, 0, 80);
      this.lookX = Phaser.Math.Linear(this.lookX, -Math.cos(this.aimA) * look, 0.06);
      this.lookY = Phaser.Math.Linear(this.lookY, -Math.sin(this.aimA) * look * 0.8, 0.06);
      cam.setFollowOffset(this.lookX, this.lookY);
    }
    // ── мало жизни — стучит сердце; вокруг — сверчки ночью, птицы днём ──
    this.beatT -= dt; this.ambT -= dt;
    if (!this.dead && !S.over && S.hp < 30 && this.beatT <= 0) { this.beatT = 0.6 + S.hp / 60; sfx("beat", 0.9); }
    if (this.ambT <= 0) { this.ambT = rand(5, 12); sfx(this.light.night > 0.5 ? "cricket" : "bird", 0.7); }
    // ── линия прицела ──
    const g = this.aimG.clear();
    if (this.dead) return;
    const ca = Math.cos(this.aimA), sa = Math.sin(this.aimA);
    const sx = this.px + ca * 30, sy = this.py + sa * 30 + gunZ;
    let L = Math.max(40, (S.touch ? 260 : aimDist) - 30);
    if (this.charge && (S.over || S.paused || S.inv)) this.charge = null;
    if (this.charge) {
      // замах: дуга полёта и место падения, растут, пока держишь
      const p = this.nadePower(), d = this.nadeDist(p), T = 0.45 + d / 900, peak = (600 * T * T) / 8;
      const lx = this.px + ca * d, ly = this.py + sa * d, col = p >= 1 ? 0xffd040 : 0x9aff60;
      for (let i = 1; i < 14; i++) {
        const u = i / 14, z = 4 * peak * u * (1 - u) + 18 * (1 - u);
        const dx = this.px + ca * d * u, dy = this.py + sa * d * u - z;
        g.fillStyle(0x14110d, 0.45).fillCircle(dx, dy, 3.6).fillStyle(col, 0.95 - u * 0.3).fillCircle(dx, dy, 2.4);
      }
      g.lineStyle(4, 0x14110d, 0.35).strokeCircle(lx, ly, 16).lineStyle(2, col, 0.95).strokeCircle(lx, ly, 16).lineStyle(1.2, col, 0.35).strokeCircle(lx, ly, 95);
      g.lineStyle(3, col, 0.9).beginPath().arc(this.px, this.py - 34, 9, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2).strokePath();
      L = 0;
    } else if (W_.id === "grenade") L = 0;
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
    if (S.story) this.storyTick(dt);
    else if (this.spawnQ.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(this.spawnQ.pop()!); this.spawnT = Math.max(0.12, 0.5 - S.wave * 0.04); }
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
      // упёрся в забор — ломает его (чтобы не застревать у пашен)
      if (moved < spd * dt * 0.4 && NET.role !== "client") for (const p of this.props) {
        if (p.kind !== "fence" || p.dead || !p.wall || p.hp > 1e8 || Math.abs(p.x - e.x) > 60 || Math.abs(p.y - e.y) > 60) continue;
        if (wDist(p.wall, e.x, e.y) < K_.r + 6) { this.hitProp(p, dt * 1.6 * K_.mass); break; }
      }
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
        e.hitT > 0 ? e.img.setTintFill(0xffffff) : e.img.setTint(e.boss ? 0xe08878 : 0xd8e0c8);
      }
      this.burnFx(e, dt);
      if (e.dead) continue;
      // голоса
      e.voice -= dt;
      if (e.voice <= 0) {
        e.voice = e.kind === "bear" ? rand(4, 7) : e.kind === "rat" ? rand(1.5, 4) : rand(3, 8);
        sfx(VOICE[e.kind], this.near(e.x, e.y) * (e.kind === "rat" ? 0.7 : 1));
      }
      // раздутый лопается вплотную к игроку
      if (e.kind === "bloater" && T.length && d < K_.r + 20) { this.kill(e, Math.atan2(dy, dx)); continue; }
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
      Object.assign(S, { hp: 100, armor: 0, medkits: 0, grenades: 1, wave: 0, kills: 0, score: 0, time: 0, over: false });
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
    send({ t: "hi", x: Math.round(this.px + 40), y: Math.round(this.py + 20), lt: this.light.t, name: mt.name, mode: MODE, hero: S.myName,
      st: S.story ? { ch: CH, seg: this.seg, camp: this.campDone, gates: this.gates.map((g) => g.open), woke: this.woke, owned: S.owned, end: this.storyEnd } : undefined }, id);
    // отряд не больше 4: пришёл человек — уходит бот
    if (S.story) this.fitBots();
  }
  applyHi(m: Record<string, any>) {
    // хозяин в другом режиме (или начал сюжет заново) — перестраиваем мир под него
    const mode = m.mode === "story" ? "story" : "waves";
    if (mode !== MODE || (mode === "story" && syncedHi !== m)) { MODE = mode; storyCh = m.st?.ch | 0; syncedHi = m; pendingHi = m; this.scene.restart(); return; }
    if (m.hero) S.hero = String(m.hero).slice(0, 16);
    if (S.story && m.st) {
      const st = m.st;
      this.seg = st.seg | 0; this.storyEnd = !!st.end;
      if (Array.isArray(st.camp)) this.campDone = CAMPS.map((_, k) => !!st.camp[k]);
      if (Array.isArray(st.woke)) this.woke = GROUPS.map((_, k) => !!st.woke[k]);
      if (Array.isArray(st.gates)) st.gates.forEach((o: boolean, k: number) => { if (o) this.openGate(k, false); });
      if (Array.isArray(st.owned)) S.owned = S.owned.map((o, k) => o || !!st.owned[k]);
      S.wave = this.seg + 1;
      S.bannerText = this.seg > 0 ? t("st_seg", { n: this.seg + 1, m: SEGS }) : chTitle(); S.bannerN++;
    }
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
        // гость ещё в другом мире (перестраивается под наш режим) — его место не считаем
        if ((m.md ?? "waves") !== MODE) { mt.seen = performance.now(); return; }
        this.mateTarget(mt, m.x, m.y);
        Object.assign(mt, { aimA: m.aimA, moveA: m.moveA, ph: m.ph, moving: m.moving, gren: m.gren, w: (m.w | 0) % SLOTS.length, med: m.med | 0, seen: performance.now() });
        // макс. здоровье гостя растёт с его уровнем
        const mh = Phaser.Math.Clamp(m.mh | 0, 100, 200);
        if (mh > (mt.mh ?? 100)) { if (!mt.dead) mt.hp += mh - (mt.mh ?? 100); mt.mh = mh; }
      } else if (m.t === "shot") {
        const mt = this.mates.get(from);
        const w = WEAPONS[m.w as WeaponId];
        if (!mt || mt.dead || !w || !w.pellets || !Array.isArray(m.as)) return;
        mt.muzzle = 0.06; mt.hum.recoil = 1;
        const as = (m.as as number[]).slice(0, w.pellets).map(Number);
        // урон и пробитие — с улучшениями гостя
        const dm = Phaser.Math.Clamp(Number(m.dm) || 1, 1, 3), pc = Phaser.Math.Clamp(m.pc | 0, 0, 1), ak = Phaser.Math.Clamp(m.ak | 0, 0, 2);
        this.bullets.push(...shotBullets(w, m.x, m.y, as, false, ak).map((b) => ({ ...b, dmg: b.dmg * dm, pierce: w.shell === "flame" ? b.pierce : pc })));
        sfx(w.sound, this.near(m.x, m.y) * 0.8);
        send({ t: "fx", k: "shot", who: from, x: m.x, y: m.y, as, w: w.id, ak }, undefined, from);
      } else if (m.t === "saw") {
        const mt = this.mates.get(from);
        if (!mt || mt.dead) return;
        mt.muzzle = 0.12; mt.hum.recoil = 0.5;
        if (Math.hypot(mt.x - m.x, mt.y - m.y) < 120) this.sawHit(Number(m.x), Number(m.y), Number(m.a) || 0, Phaser.Math.Clamp(Number(m.dm) || 1, 1, 3));
        sfx("saw", this.near(m.x, m.y) * 0.6);
      } else if (m.t === "name") {
        const mt = this.mates.get(from);
        const nm = String(m.name ?? "").replace(/[<>]/g, "").trim().slice(0, 16);
        if (mt && nm) { mt.name = nm; mt.label.setText(nm); }
      } else if (m.t === "heal") {
        const mt = this.mates.get(from);
        if (mt && !mt.dead) mt.hp = Math.min(mt.mh ?? 100, mt.hp + MED_HEAL);
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
      case "boom": this.explode(m.x, m.y, m.p || 1); break;
      case "prop": { const p = this.props.find((q) => q.id === m.id); if (p) this.breakProp(p, true); break; }
      case "spit": { this.spawnSpit(m.x, m.y, m.z, m.vx, m.vy, m.vz, true); const e = this.enemies.find((q) => q.id === m.id); if (e?.hum) e.hum.recoil = 0.25; sfx("splat", this.near(m.x, m.y) * 0.8); break; }
      case "hurt": this.hurtPlayer(m.dmg, true); break;
      case "gate": if (S.story) this.openGate(m.k | 0, true); break;
      case "camp": if (S.story && CAMPS[m.i | 0]) this.campReached(m.i | 0); break;
      case "stend": if (S.story) this.storyDone(); break;
      case "tp": { const q = this.collide(Number(m.x), Number(m.y), 10); this.px = q.x; this.py = q.y; break; }
      case "give":
        if (AMMO_GIVE[m.k as ItemKind]) this.takeAmmo(m.k as ItemKind);
        else if (m.k === "grenade") { S.grenades++; sfx("pickup"); S.msg = t("got_nade"); }
        else if (m.k === "armor") { sfx("armor"); S.msg = t("got_armor"); }
        else { S.medkits = Math.min(MAX_MED, S.medkits + 1); sfx("pickup"); S.msg = tk("got_med"); }
        S.msgT = 0.9;
        break;
      case "fx":
        if (m.k === "shot") {
          const w = WEAPONS[m.w as WeaponId] ?? WEAPONS.rifle;
          this.bullets.push(...shotBullets(w, m.x, m.y, Array.isArray(m.as) ? m.as : [m.a], true, m.ak | 0));
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
    if (NET.role === "host") for (const m of [...this.mates.values()]) if (!m.bot && now - m.seen > 6000) { netDrop(m.id); NET.onLeave(m.id); }
    if (NET.role === "client" && this.lastSnap && now - this.lastSnap > 6000) { this.lastSnap = 0; this.hostLost(); return; }
    if (NET.role === "host" && NET.conns.size) {
      this.snapT -= dt;
      if (this.snapT > 0) return;
      this.snapT = 1 / 20;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const P: unknown[] = [["host", this.px | 0, this.py | 0, r2(this.aimA), r2(this.moveA), r2(this.moving), r2(this.ph), this.muzzleT > 0 ? 1 : 0, Math.ceil(S.hp), this.dead ? 1 : 0, S.myName, S.weapon, Math.ceil(S.armor)]];
      for (const mt of this.mates.values()) P.push([mt.id, mt.x | 0, mt.y | 0, r2(mt.aimA), r2(mt.moveA), r2(mt.moving), r2(mt.ph), mt.muzzle > 0 ? 1 : 0, Math.ceil(mt.hp), mt.dead ? 1 : 0, mt.name, mt.w, Math.ceil(mt.armor)]);
      const E = this.enemies.filter((e) => !e.dead).map((e) => [e.id, KIND_LIST.indexOf(e.kind), e.x | 0, e.y | 0, r2(e.a), r2(e.ph), e.hitT > 0 ? 1 : 0, (e.hum ? (e.hum.armsOn[0] ? 1 : 0) | (e.hum.armsOn[1] ? 2 : 0) | (e.hum.crawl ? 4 : 0) : 3) | ((e.arm ?? 0) > 0 ? 8 : 0) | ((e.burn ?? 0) > 0 ? 16 : 0)]);
      const I = this.items.map((it) => [it.id, ITEM_KINDS.indexOf(it.kind), it.x | 0, it.y | 0]);
      const N = this.nades.map((n) => [n.x | 0, n.y | 0, n.z | 0, r2(n.spin), n.t < 0.7 && Math.sin(n.t * 40) > 0 ? 1 : 0]);
      send({ t: "snap", P, E, I, N, pd: this.props.filter((p) => p.dead).map((p) => p.id), w: S.wave, k: S.kills, s: S.score, lt: Math.round(this.light.t * 1e4) / 1e4, o: S.over ? 1 : 0 });
    } else if (NET.role === "client") {
      this.inT -= dt;
      if (this.inT > 0) return;
      this.inT = 1 / 30;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      send({ t: "in", x: this.px | 0, y: this.py | 0, aimA: r2(this.aimA), moveA: r2(this.moveA), ph: r2(this.ph), moving: r2(this.moving), gren: S.grenades, w: S.weapon, med: S.medkits, mh: S.maxHp, md: MODE });
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
    if (Array.isArray(m.pd)) for (const id of m.pd) { const p = this.props.find((q) => q.id === id); if (p && !p.dead) this.breakProp(p, false); }
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
      if ((e.arm ?? 0) > 0 && !(arms & 8)) this.breakArmor(e);
      if (arms & 16) e.burn = Math.max(e.burn ?? 0, 0.4);
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
        e.hitT > 0 ? e.img.setTintFill(0xffffff) : e.img.setTint(e.boss ? 0xe08878 : 0xd8e0c8);
      }
      this.burnFx(e, dt);
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
  /** верхняя панель: картинки и надписи из пула (каждый кадр раздаются заново) */
  g2!: Phaser.GameObjects.Graphics;
  pool: Phaser.GameObjects.Image[] = []; pi = 0;
  tpool: Phaser.GameObjects.Text[] = []; tpi = 0;
  constructor() { super("ui"); }
  get gm() { return this.scene.get("game") as Game; }
  preload() { loadHudFiles(this); }
  vig!: Phaser.GameObjects.Image;
  /** миникарта: круг под кнопками справа сверху; нажатие (или N) — крупнее. Перерисовка 10 раз в секунду */
  mmG!: Phaser.GameObjects.Graphics; mmT = 0; mmBig = false; mmR = 0;
  drawMini(w: number, h: number, dt: number, hits: Hit[]) {
    const gm = this.gm, g = this.mmG;
    if (S.over || S.inv || S.paused || !gm.px) { g.clear(); this.mmR = 0; return; }
    const R = this.mmBig ? Math.round(Math.min(150, h * 0.34)) : S.touch || h < 500 ? 44 : 54;
    const cx = w - 12 - R, cy = 64 + R;
    hits.push({ x: cx - R, y: cy - R, w: R * 2, h: R * 2, fn: () => { this.mmBig = !this.mmBig; this.mmT = 0; } });
    this.mmT -= dt;
    if (this.mmT > 0 && R === this.mmR) return;
    this.mmT = 0.1; this.mmR = R;
    const range = this.mmBig ? 1100 : 650, k = R / range, px = gm.px, py = gm.py;
    const inR = (x: number, y: number, pad = 2) => (x - cx) ** 2 + (y - cy) ** 2 < (R - pad) ** 2;
    const P = (x: number, y: number) => ({ x: cx + (x - px) * k, y: cy + (y - py) * k });
    g.clear().fillStyle(0x1a2214, 0.82).fillCircle(cx, cy, R);
    // край мира
    g.lineStyle(1.5, 0x2a4a20, 0.9);
    for (const [ax, ay, bx, by] of [[0, 0, W, 0], [0, H, W, H], [0, 0, 0, H], [W, 0, W, H]]) {
      const a = P(ax, ay), b = P(bx, by), n = 24;
      for (let i = 0; i < n; i++) {
        const x1 = a.x + (b.x - a.x) * (i / n), y1 = a.y + (b.y - a.y) * (i / n), x2 = a.x + (b.x - a.x) * ((i + 1) / n), y2 = a.y + (b.y - a.y) * ((i + 1) / n);
        if (inR(x1, y1) && inR(x2, y2)) g.lineBetween(x1, y1, x2, y2);
      }
    }
    // деревья, камни, предметы
    for (const o of gm.obs) {
      const q = P(o.x, o.y);
      if (!inR(q.x, q.y, 3)) continue;
      const kind = o.prop?.kind;
      const col = kind === "barrel" ? 0xe04030 : kind === "drum" ? 0x4a7ad0 : kind === "crate" ? 0xc89a5a : kind === "car" ? 0x9a9a9a : kind === "fire" || kind === "lamp" ? 0xffd070 : kind ? 0x8a7a60 : o.canopy ? 0x3c6a2c : 0x7a7a84;
      g.fillStyle(col, kind ? 0.95 : 0.75).fillCircle(q.x, q.y, Math.max(kind ? 1.6 : 1.3, Math.min(o.r * k, 6)));
    }
    // дом
    g.fillStyle(0xa07a50, 0.95);
    for (const wb of gm.walls) {
      const pts = wb.pts.map((t) => P(t.x, t.y));
      if (pts.every((t) => inR(t.x, t.y, 1))) g.fillPoints(pts, true);
    }
    // находки
    for (const it of gm.items) {
      const q = P(it.x, it.y);
      if (!inR(q.x, q.y, 3)) continue;
      g.fillStyle(ITEM_COL[it.kind], 1).fillRect(q.x - 1.8, q.y - 1.8, 3.6, 3.6);
    }
    // враги: крупные — крупнее
    for (const e of gm.enemies) {
      if (e.dead) continue;
      const q = P(e.x, e.y);
      if (!inR(q.x, q.y, 2)) continue;
      const big = e.kind === "bear" ? 3.6 : e.kind === "spitter" || e.kind === "panther" ? 2.4 : 1.8;
      g.fillStyle(0xff3020, 1).fillCircle(q.x, q.y, big);
    }
    for (const m of gm.mates.values()) {
      const q = P(m.x, m.y);
      if (!inR(q.x, q.y, 3)) { // напарник далеко — стрелка на краю
        const a = Math.atan2(m.y - py, m.x - px);
        g.fillStyle(0x6ab0ff, 1).fillCircle(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5), 2.6);
        continue;
      }
      g.fillStyle(m.dead ? 0x50607a : 0x6ab0ff, 1).fillCircle(q.x, q.y, 2.8);
    }
    // сюжет: куда идти — жёлтое кольцо, а если далеко — жёлтый треугольник на краю
    const goal = gm.storyGoal();
    if (goal) {
      const q = P(goal.x, goal.y);
      if (inR(q.x, q.y, 6)) g.lineStyle(2, 0xffd040, 1).strokeCircle(q.x, q.y, 4.5);
      else {
        const ga = Math.atan2(goal.y - py, goal.x - px), ex = cx + Math.cos(ga) * (R - 6), ey = cy + Math.sin(ga) * (R - 6);
        g.fillStyle(0xffd040, 1).fillTriangle(ex + Math.cos(ga) * 5, ey + Math.sin(ga) * 5, ex + Math.cos(ga + 2.3) * 5, ey + Math.sin(ga + 2.3) * 5, ex + Math.cos(ga - 2.3) * 5, ey + Math.sin(ga - 2.3) * 5);
      }
    }
    // герой: стрелка по прицелу
    const a = gm.aimA, ar = this.mmBig ? 7 : 5.5;
    g.fillStyle(0xffe2a0, 1).lineStyle(1.5, 0x14110d, 1);
    const tri = [{ x: cx + Math.cos(a) * ar, y: cy + Math.sin(a) * ar }, { x: cx + Math.cos(a + 2.5) * ar * 0.8, y: cy + Math.sin(a + 2.5) * ar * 0.8 }, { x: cx + Math.cos(a - 2.5) * ar * 0.8, y: cy + Math.sin(a - 2.5) * ar * 0.8 }];
    g.fillPoints(tri, true).strokePoints(tri, true);
    g.lineStyle(2, 0xffe2a0, 0.55).strokeCircle(cx, cy, R).lineStyle(1, 0x14110d, 0.9).strokeCircle(cx, cy, R + 1.5);
  }
  /** дождь (каждая третья волна, начиная со второй): капли, брызги, пасмурно, ночью молнии */
  rainG!: Phaser.GameObjects.Graphics; rain = 0; boltT = 6; bolt = 0;
  drops: { x: number; y: number; l: number; end: number }[] = [];
  splash: { x: number; y: number; t: number }[] = [];
  drawRain(w: number, h: number, dt: number) {
    const want = S.wave >= 2 && S.wave % 3 === 2 && !S.over && !S.menu && !S.story ? 1 : 0;
    if (!S.paused) this.rain += Phaser.Math.Clamp(want - this.rain, -dt / 5, dt / 5);
    setRain(S.menu || S.paused ? 0 : this.rain);
    const g = this.rainG.clear();
    if (this.rain <= 0.001) { this.drops.length = 0; this.splash.length = 0; return; }
    const night = this.gm.light?.night ?? 0;
    // пасмурно: серо-синяя дымка
    g.fillStyle(0x203040, this.rain * (0.16 + night * 0.08)).fillRect(0, 0, w, h);
    // молния ночью: белая вспышка с двойным мерцанием, гром чуть позже
    if (!S.paused) {
      this.boltT -= dt;
      if (this.boltT <= 0 && this.rain > 0.6 && night > 0.35) { this.boltT = rand(9, 20); this.bolt = 0.0001; this.time.delayedCall(rand(400, 1400), () => sfx("thunder", 0.9)); }
      if (this.bolt > 0) { this.bolt += dt; if (this.bolt > 0.6) this.bolt = 0; }
    }
    if (this.bolt > 0) { const b = this.bolt, a = b < 0.06 ? 0.55 : b < 0.12 ? 0.1 : b < 0.2 ? 0.45 : 0.45 * (1 - (b - 0.2) / 0.4); g.fillStyle(0xdde8ff, a * this.rain).fillRect(0, 0, w, h); }
    // капли: косые штрихи, долетев до «земли», дают брызги
    const n = Math.round((settings.quality === "low" ? 60 : settings.quality === "med" ? 110 : 170) * this.rain * (w * h) / (1000 * 620));
    while (this.drops.length < n) this.drops.push({ x: rand(-60, w + 20), y: rand(-h, 0), l: rand(16, 28), end: rand(h * 0.1, h) });
    if (this.drops.length > n) this.drops.length = n;
    const vx = 170, vy = 900, kx = vx / vy;
    g.lineStyle(1.4, 0xd0e2ff, 0.5 - night * 0.08);
    g.beginPath();
    for (const d of this.drops) {
      if (!S.paused) { d.x += vx * dt; d.y += vy * dt; }
      if (d.y >= d.end) {
        if (this.splash.length < 120) this.splash.push({ x: d.x, y: d.end, t: 0 });
        d.x = rand(-60, w + 20); d.y = rand(-60, -10); d.end = rand(h * 0.05, h);
      }
      g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * kx, d.y - d.l);
    }
    g.strokePath();
    for (let i = this.splash.length - 1; i >= 0; i--) {
      const s = this.splash[i];
      if (!S.paused) s.t += dt;
      const k = s.t / 0.28;
      if (k >= 1) { this.splash.splice(i, 1); continue; }
      g.lineStyle(1, 0xd8e8ff, 0.5 * (1 - k)).strokeEllipse(s.x, s.y, 3 + k * 9, 1.5 + k * 4);
    }
  }
  /** заставка новой волны: лента через экран, череп, крупная надпись */
  bannerT!: Phaser.GameObjects.Text; bWave = 0; bT = 9; bN = 0;
  drawBanner(g: Phaser.GameObjects.Graphics, w: number, h: number, dt: number) {
    if (S.wave !== this.bWave || S.bannerN !== this.bN) { if (S.wave > 0 && this.bWave >= 0) this.bT = 0; this.bWave = S.wave; this.bN = S.bannerN; }
    const D = 2.6, tt = this.bT;
    if (tt >= D || S.over || S.paused || S.inv) { this.bannerT.setVisible(false); this.bT += dt; return; }
    this.bT += dt;
    const ease = (k: number) => { k = Phaser.Math.Clamp(k, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
    const open = ease(tt / 0.32), fade = tt > D - 0.45 ? Math.max(0, (D - tt) / 0.45) : 1;
    const cy = h * 0.3, bw = Math.min(w * 0.9, 560) * open, bh = Math.min(84, h * 0.16);
    const x0 = w / 2 - bw / 2;
    // лента: тёмная середина, золотые кромки, края уходят в прозрачность
    const edge = Math.min(70, bw * 0.2);
    g.fillStyle(0x14110d, 0.78 * fade).fillRect(x0 + edge, cy - bh / 2, bw - edge * 2, bh);
    for (let i = 0; i < 10; i++) {
      const a = 0.78 * fade * (1 - i / 10), sw = edge / 10;
      g.fillStyle(0x14110d, a).fillRect(x0 + edge - (i + 1) * sw, cy - bh / 2, sw, bh).fillRect(x0 + bw - edge + i * sw, cy - bh / 2, sw, bh);
    }
    g.fillStyle(0x8a1010, 0.55 * fade).fillRect(x0 + edge * 0.5, cy - bh / 2 + 4, bw - edge, 3).fillRect(x0 + edge * 0.5, cy + bh / 2 - 7, bw - edge, 3);
    g.fillStyle(0xffe2a0, 0.85 * fade).fillRect(x0 + edge * 0.3, cy - bh / 2, bw - edge * 0.6, 2).fillRect(x0 + edge * 0.3, cy + bh / 2 - 2, bw - edge * 0.6, 2);
    // блик пробегает по ленте
    const sk = (tt - 0.35) / 0.55;
    if (sk > 0 && sk < 1) {
      const sx = x0 + bw * sk;
      g.fillStyle(0xffffff, 0.14 * fade).fillPoints([{ x: sx, y: cy - bh / 2 }, { x: sx + 26, y: cy - bh / 2 }, { x: sx + 6, y: cy + bh / 2 }, { x: sx - 20, y: cy + bh / 2 }] as Phaser.Types.Math.Vector2Like[], true);
    }
    // надпись прилетает крупной и «падает» на ленту
    const k = Phaser.Math.Clamp((tt - 0.12) / 0.22, 0, 1), sc = 1 + (1 - k) * (1 - k) * 1.4;
    const fs = Math.min(46, bh * 0.56);
    this.bannerT.setText((S.story && S.bannerText ? S.bannerText : t("wave_n", { n: S.wave })).toUpperCase()).setFontSize(fs).setScale(sc).setAlpha(k * fade).setVisible(true);
    const iw = fs * 1.05, tw = this.bannerT.width * sc;
    this.bannerT.setPosition(w / 2 + iw / 2 + 4, cy + 1);
    const ic = this.img("wave", w / 2 - tw / 2 - iw / 2 - 4, cy, (fs / 26) * 1.05 * sc, k * fade);
    ic.setX(ic.x - ic.displayWidth / 2).setDepth(1.1);
    if (tt < 0.12 + 0.22 && tt + dt >= 0.12 + 0.22) this.gm.cameras.main.shake(120, 0.004);
  }
  img(n: HudArt, x: number, y: number, sc = 1, alpha = 1) {
    let im = this.pool[this.pi++];
    if (!im) { im = this.add.image(0, 0, "hud_" + n).setDepth(0.5); this.pool.push(im); }
    const [iw, ih] = HUD_ART[n];
    return im.setDepth(0.5).setTexture("hud_" + n).setDisplaySize(iw * sc, ih * sc).setOrigin(0, 0.5).setPosition(x, y).setAlpha(alpha).setVisible(true);
  }
  txt(s: string, x: number, y: number, size: number, color = "#f2ead8", ox = 0) {
    let tt = this.tpool[this.tpi++];
    if (!tt) { tt = this.add.text(0, 0, "", { fontFamily: "system-ui, Segoe UI, Roboto, sans-serif", fontStyle: "800", stroke: "#14110d", strokeThickness: 4 }).setDepth(1); this.tpool.push(tt); }
    return tt.setText(s).setFontSize(size).setColor(color).setOrigin(ox, 0.5).setPosition(x, y).setVisible(true);
  }
  /** верх экрана одной строкой: [сердце | жизнь, под ней броня] [волна] [убито] [очки] [патроны пульками] [гранаты] [аптечки] */
  drawTop(g: Phaser.GameObjects.Graphics, w: number, h: number, hits: Hit[]) {
    const g2 = this.g2, sc = w < 700 || h < 450 ? 0.8 : 0.92, x = 10;
    // всё в одну строку; если не влезает (узкий экран) — патроны и предметы переносятся во вторую
    const right = w - Math.max(S.touch ? 70 : 120, this.mmR * 2 + 24); // справа кнопки паузы/рюкзака и миникарта
    let y = 10 + 16 * sc;
    const pillBg = (x0: number, pw: number, cy: number) => g.fillStyle(0x14110d, 0.6).fillRoundedRect(x0, cy - 14 * sc, pw, 28 * sc, 14 * sc).lineStyle(1.2, 0xffe2a0, 0.22).strokeRoundedRect(x0, cy - 14 * sc, pw, 28 * sc, 14 * sc);
    // блок жизни: сердце слева, полоска жизни, под ней — всегда полоска брони (пустая или полная)
    const f = Phaser.Math.Clamp(S.hp / S.maxHp, 0, 1), low = f < 0.3;
    const beat = low ? 1 + Math.max(0, Math.sin(performance.now() / 110)) * 0.12 : 1;
    this.img("heart", x - (beat - 1) * 15 * sc, y, sc * beat);
    const bx = x + 34 * sc, bw = 190 * sc, bh = 18 * sc, hy = y - 5 * sc;
    this.img("bar", bx, hy, 1).setDisplaySize(bw, bh).setDepth(0.4);
    const ix = bx + 3.5 * sc, iy = hy - bh / 2 + 3.5 * sc, iw = bw - 7 * sc, ih = bh - 7 * sc;
    const [c1, c2] = f > 0.5 ? [0x8ae05a, 0x3a8a22] : f > 0.25 ? [0xffd050, 0xb07a10] : [0xff6a50, 0xa01810];
    if (f > 0) {
      g2.fillGradientStyle(c1, c1, c2, c2, 1).fillRect(ix, iy, iw * f, ih);
      g2.fillStyle(0xffffff, 0.28).fillRect(ix, iy + 1, iw * f, ih * 0.3);
    }
    g2.fillStyle(0x000000, 0.28);
    for (let i = 1; i < 10; i++) g2.fillRect(ix + (iw * i) / 10 - 0.5, iy, 1, ih);
    this.txt(`${Math.ceil(S.hp)}`, bx + bw / 2, hy + 0.5, 12 * sc, "#ffffff", 0.5).setStroke("#14110d", 3);
    const ay = hy + bh / 2 + 5.5 * sc, ah = 8 * sc, a = Math.min(1, S.armor / 100);
    g2.fillStyle(0x14110d, 0.85).fillRoundedRect(bx + 2 * sc, ay - ah / 2, bw - 4 * sc, ah, 3).lineStyle(1.2, a > 0 ? 0x8ab0e8 : 0x6a6050, 0.9).strokeRoundedRect(bx + 2 * sc, ay - ah / 2, bw - 4 * sc, ah, 3);
    if (a > 0) g2.fillGradientStyle(0xb0d0ff, 0xb0d0ff, 0x4a6ab8, 0x4a6ab8, 1).fillRect(bx + 3.5 * sc, ay - ah / 2 + 1.5, (bw - 7 * sc) * a, ah - 3);
    this.img("shield", bx - 13 * sc, ay, sc * 0.5, a > 0 ? 1 : 0.45);
    // опыт: тонкая полоска под бронёй, уровень — на сердце
    const xy = ay + ah / 2 + 3 * sc, xf = S.level >= MAX_LV ? 1 : S.xp / xpNeed(S.level);
    g2.fillStyle(0x14110d, 0.8).fillRect(bx + 2 * sc, xy, bw - 4 * sc, 3.5 * sc);
    if (xf > 0) g2.fillStyle(0x80e8ff, 0.95).fillRect(bx + 2 * sc, xy, (bw - 4 * sc) * xf, 3.5 * sc);
    this.txt(`${S.level}`, x + 15 * sc, y + 8 * sc, 11 * sc, "#80e8ff", 0.5).setStroke("#14110d", 3);
    // плашки: значок + число
    const pill = (cx: number, cy: number, icon: HudArt, s: string, color = "#f2ead8", isc = 0.8) => {
      const ic = this.img(icon, cx + 5 * sc, cy, sc * isc);
      const tx = this.txt(s, cx + ic.displayWidth + 9 * sc, cy + 0.5, 14 * sc, color);
      const pw = ic.displayWidth + 9 * sc + tx.width + 8 * sc;
      pillBg(cx, pw, cy);
      return cx + pw + 5 * sc;
    };
    let cx = bx + bw + 8 * sc;
    cx = pill(cx, y, "wave", `${S.wave}`, "#d8f0a0");
    cx = pill(cx, y, "kills", `${S.kills}`);
    cx = pill(cx, y, "score", `${S.score}`, "#ffe2a0");
    // патроны: пульки текущего оружия, истраченные — тусклые; при перезарядке наполняются
    const W_ = wstat(SLOTS[S.weapon]);
    // базука, огнемёт, пила: картинка и «в магазине / в запасе»
    if (W_.id === "bazooka" || W_.id === "flamer" || W_.id === "saw") {
      const lo = W_.id !== "saw" && S.clip[W_.id] + (S.stock[W_.id] ?? 0) === 0;
      cx = pill(cx, y, `w_${W_.id}` as HudArt, W_.id === "saw" ? "∞" : S.reload > 0 ? "…" : `${S.clip[W_.id]} | ${S.stock[W_.id] ?? 0}`, lo ? "#ff8070" : "#ffe2a0", 0.42);
      cx = pill(cx, y, "grenade", `${S.grenades}`, S.grenades ? "#f2ead8" : "#8a8270", 0.72);
      pill(cx, y, "medkit", `${S.medkits}`, S.medkits ? "#f2ead8" : "#8a8270", 0.72);
      return;
    }
    const [art, step, n] = W_.id === "grenade" ? ["grenade", 17, Math.max(1, Math.min(S.grenades, 12))] as const
      : W_.id === "rifle" ? ["bullet_rifle", 6.2, W_.mag] as const : W_.id === "shotgun" ? ["shell", 12, W_.mag] as const : ["bullet_pistol", 9, W_.mag] as const;
    const ammoW = 10 * sc + n * step * sc + 6 * sc, itemsW = 2 * 62 * sc;
    if (cx + ammoW + (W_.id === "grenade" ? itemsW / 2 : itemsW) > right) { cx = x; y += 34 * sc; }
    const stripX = cx;
    let ex = cx + 9 * sc;
    if (W_.id === "grenade") for (let i = 0; i < n; i++) this.img("grenade", ex + i * step * sc, y, sc * 0.72, S.grenades ? 1 : 0.2);
    else {
      const full = S.reload > 0 ? Math.floor(W_.mag * (1 - S.reload / W_.reload)) : S.clip[W_.id];
      for (let i = 0; i < n; i++) this.img(art, ex + i * step * sc, y, sc * 0.92, i < full ? (S.reload > 0 ? 0.6 : 1) : 0.16);
    }
    ex += n * step * sc + 4 * sc;
    pillBg(cx, ex - cx, y);
    cx = ex + 5 * sc;
    // типы патронов: три кнопки под лентой пуль — обычные, бронебойные, зажигательные (нажать — зарядить; B — по кругу)
    if (BULLET_GUN(W_.id)) {
      const by = y + 31 * sc, bh2 = 22 * sc;
      let bx2 = stripX;
      const kinds = [[t("ammo_n_s"), -1, "#f2ead8", 0xffe2a0], [t("ammo_ap_s"), S.ap, "#9ae8ff", 0x9ae8ff], [t("ammo_inc_s"), S.inc, "#ff9a50", 0xff9a50]] as const;
      kinds.forEach(([lb, n, col, line], k) => {
        const sel = S.ammoK === k, has = n !== 0;
        const tx = this.txt(n < 0 ? `${lb}` : `${lb} ${n}`, bx2 + 10 * sc, by + 0.5, 12 * sc, has ? (sel ? col : "#c8bfa8") : "#6a6252");
        const bw2 = tx.width + 20 * sc;
        g.fillStyle(sel ? 0x2a2416 : 0x14110d, sel ? 0.85 : 0.55).fillRoundedRect(bx2, by - bh2 / 2, bw2, bh2, bh2 / 2)
          .lineStyle(sel ? 2 : 1.2, sel ? line : 0xffe2a0, sel ? 0.95 : 0.2).strokeRoundedRect(bx2, by - bh2 / 2, bw2, bh2, bh2 / 2);
        if (has) hits.push({ x: bx2, y: by - bh2 / 2 - 3, w: bw2, h: bh2 + 6, fn: () => this.gm.setAmmo(k) });
        bx2 += bw2 + 5 * sc;
      });
      if (!S.touch) this.txt("[B]", bx2 + 2 * sc, by + 0.5, 11 * sc, "#8a8270");
    }
    if (W_.id !== "grenade") cx = pill(cx, y, "grenade", `${S.grenades}`, S.grenades ? "#f2ead8" : "#8a8270", 0.72);
    pill(cx, y, "medkit", `${S.medkits}`, S.medkits ? "#f2ead8" : "#8a8270", 0.72);
  }
  create() {
    const font = "system-ui, Segoe UI, Roboto, sans-serif";
    makeHudArt(this);
    // красная виньетка: прозрачный центр, красные края
    if (!this.textures.exists("vignette")) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const c = cv.getContext("2d")!, gr = c.createRadialGradient(128, 128, 70, 128, 128, 150);
      gr.addColorStop(0, "rgba(230,10,10,0)"); gr.addColorStop(0.5, "rgba(220,10,10,.5)"); gr.addColorStop(1, "rgba(170,0,0,1)");
      c.fillStyle = gr; c.fillRect(0, 0, 256, 256);
      this.textures.addCanvas("vignette", cv);
    }
    this.rainG = this.add.graphics().setDepth(-2);
    this.mmG = this.add.graphics().setDepth(0.45);
    this.input.keyboard?.on("keydown-N", () => { this.mmBig = !this.mmBig; this.mmT = 0; });
    this.vig = this.add.image(0, 0, "vignette").setOrigin(0).setDepth(-1).setAlpha(0);
    this.g = this.add.graphics();
    this.g2 = this.add.graphics().setDepth(0.45);
    this.info = this.add.text(16, 40, "", { fontFamily: font, fontSize: "16px", fontStyle: "700", color: "#f2ead8", stroke: "#14110d", strokeThickness: 4 });
    this.bannerT = this.add.text(0, 0, "", { fontFamily: font, fontSize: "44px", fontStyle: "900", color: "#ffe2a0", stroke: "#14110d", strokeThickness: 7 }).setOrigin(0.5).setDepth(1.1).setShadow(0, 3, "#000000", 6, true, true);
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
    this.invT = Array.from({ length: 46 }, () => this.add.text(0, 0, "", { fontFamily: font, fontSize: "14px", fontStyle: "700", color: "#f2ead8", align: "center", lineSpacing: 2 }).setOrigin(0.5).setDepth(5).setVisible(false));
  }

  /** окно снаряжения: герой, здоровье и броня, оружие (клик — взять), гранаты, аптечки (клик — лечиться) */
  drawInv(g: Phaser.GameObjects.Graphics, w: number, h: number, hits: Hit[]) {
    const gm = this.gm;
    const pw = Math.min(640, w - 20), ph = Math.min(420, h - 20), x0 = (w - pw) / 2, y0 = (h - ph) / 2;
    const T = this.invT; let ti = 0;
    const text = (x: number, y: number, s: string, size = 14, color = "#f2ead8", ox = 0.5) => T[ti++].setPosition(x, y).setText(s).setFontSize(size).setColor(color).setOrigin(ox, 0.5).setVisible(true);
    g.fillStyle(0x000000, 0.45).fillRect(0, 0, w, h);
    g.fillStyle(0x1c1812, 0.96).fillRoundedRect(x0, y0, pw, ph, 14).lineStyle(2, 0xffe2a0, 0.6).strokeRoundedRect(x0, y0, pw, ph, 14);
    // вкладки: снаряжение | мастерская
    const tw = Math.min(170, (pw - 80) / 2);
    [t("inv_title"), t("workshop")].forEach((s, i) => {
      const tx = x0 + 14 + i * (tw + 6), on = S.invTab === i;
      g.fillStyle(on ? 0x4a3c1c : 0x2a241a, 1).fillRoundedRect(tx, y0 + 9, tw, 30, 8).lineStyle(1.5, on ? 0xffe2a0 : 0x5a5040, on ? 1 : 0.8).strokeRoundedRect(tx, y0 + 9, tw, 30, 8);
      text(tx + tw / 2, y0 + 24, s, 15, on ? "#ffe2a0" : "#c8bfa8");
      hits.push({ x: tx, y: y0 + 4, w: tw, h: 40, fn: () => { S.invTab = i; } });
    });
    // закрыть
    g.lineStyle(3, 0xf2ead8, 0.8).lineBetween(x0 + pw - 34, y0 + 14, x0 + pw - 18, y0 + 30).lineBetween(x0 + pw - 18, y0 + 14, x0 + pw - 34, y0 + 30);
    hits.push({ x: x0 + pw - 44, y: y0 + 4, w: 40, h: 40, fn: () => gm.toggleInv() });
    const outside = () => {
      // клик мимо окна — закрыть; внутри окна по пустому месту — ничего
      hits.push({ x: 0, y: 0, w, h: y0, fn: () => gm.toggleInv() }, { x: 0, y: y0 + ph, w, h: h - y0 - ph, fn: () => gm.toggleInv() }, { x: 0, y: 0, w: x0, h, fn: () => gm.toggleInv() }, { x: x0 + pw, y: 0, w: w - x0 - pw, h, fn: () => gm.toggleInv() });
      hits.push({ x: x0, y: y0, w: pw, h: ph, fn: () => {} });
    };
    if (S.invTab === 1) {
      this.doll.c.setVisible(false);
      const rx = x0 + 18, rw = pw - 36;
      // уровень и опыт
      const need = xpNeed(S.level), top = S.level >= MAX_LV;
      text(rx, y0 + 58, `${t("level")} ${S.level}${top ? "" : ` · ${t("xp")} ${S.xp}/${need}`}`, 15, "#80e8ff", 0);
      text(rx + rw, y0 + 58, `${t("parts")}: ${S.parts}`, 15, "#9fd8ff", 1);
      g.fillStyle(0x0c0a07, 1).fillRoundedRect(rx, y0 + 70, rw, 8, 3);
      g.fillStyle(0x80e8ff, 1).fillRoundedRect(rx + 1, y0 + 71, Math.max(4, (rw - 2) * (top ? 1 : S.xp / need)), 6, 2);
      const bon = [lvBonus(0) && `❤ +${10 * lvBonus(0)}`, lvBonus(1) && `${t("b_dmg")} +${8 * lvBonus(1)}%`, lvBonus(2) && `${t("b_rel")} −${10 * lvBonus(2)}%`, lvBonus(3) && `${t("b_spd")} +${4 * lvBonus(3)}%`].filter(Boolean).join("   ") || t("lv_none");
      text(rx, y0 + 92, bon, 12, "#c8bfa8", 0);
      // оружие: 5 ступеней, следующая — кнопкой
      const UPW: WeaponId[] = ["rifle", "shotgun", "pistol", "bazooka", "flamer", "saw"];
      const r0 = y0 + 110, rh = Math.min(64, (ph - 40 - 110) / UPW.length);
      UPW.forEach((id, i) => {
        const ry = r0 + i * rh, own = S.owned[SLOTS.indexOf(id)], u = S.up[id] ?? 0, st = UPG[u];
        g.fillStyle(0x2a241a, 1).fillRoundedRect(rx, ry, rw, rh - 6, 8).lineStyle(1.5, 0x5a5040, 0.8).strokeRoundedRect(rx, ry, rw, rh - 6, 8);
        const cy = ry + (rh - 6) / 2;
        text(rx + 12, cy - 9, own ? wname(id) : `${wname(id)} — ${t("w_missing")}`, 14, own ? "#f2ead8" : "#7a7060", 0);
        for (let k = 0; k < UPG.length; k++) g.fillStyle(k < u ? 0x80e8ff : 0x14110d, 1).fillRoundedRect(rx + 12 + k * 16, cy + 6, 12, 8, 2).lineStyle(1, 0x80e8ff, 0.6).strokeRoundedRect(rx + 12 + k * 16, cy + 6, 12, 8, 2);
        if (!own) return;
        const bw = Math.min(150, rw * 0.36), bx = rx + rw - bw - 8, bh = rh - 18, by = ry + 6;
        if (!st) { text(bx + bw / 2, cy, t("up_max"), 13, "#80e8ff"); return; }
        text(rx + 12 + UPG.length * 16 + 8, cy + 10, `→ ${t(st.key)}`, 12, "#c8bfa8", 0);
        const ok = S.bench && S.parts >= st.cost;
        g.fillStyle(ok ? 0x2e5a22 : 0x2a241a, 1).fillRoundedRect(bx, by, bw, bh, 8).lineStyle(1.5, ok ? 0x8ae05a : 0x5a5040, 0.9).strokeRoundedRect(bx, by, bw, bh, 8);
        text(bx + bw / 2, cy, S.bench ? `${t("upgrade")} · ${st.cost}` : t("need_bench"), S.bench ? 13 : 11, ok ? "#e8ffd8" : "#a89f88");
        hits.push({ x: bx, y: by, w: bw, h: bh, fn: () => gm.upgrade(id) });
      });
      text(x0 + pw / 2, y0 + ph - 20, S.bench ? t("shop_hint") : t("need_bench_long"), 12, "#a89f88");
      outside();
      return;
    }
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
    const sw = (rw - 3 * 8) / 4, sh = 46;
    SLOTS.forEach((id, i) => {
      const W_ = wstat(id), sx = rx + (i % 4) * (sw + 8), sy = y0 + 166 + Math.floor(i / 4) * (sh + 6), sel = S.weapon === i, own = S.owned[i];
      g.fillStyle(sel ? 0x4a3c1c : 0x2a241a, 1).fillRoundedRect(sx, sy, sw, sh, 8).lineStyle(2, sel ? 0xffe2a0 : 0x5a5040, sel ? 1 : 0.8).strokeRoundedRect(sx, sy, sw, sh, 8);
      const am = id === "grenade" ? `${S.grenades}` : id === "saw" ? "∞" : W_.stock ? `${S.clip[id]} | ${S.stock[id] ?? 0}` : `${S.clip[id]}/${W_.mag}`;
      text(sx + sw / 2, sy + sh / 2, own ? `${S.touch ? "" : `${i + 1}. `}${wname(id)}\n${am}` : S.touch ? "—" : `${i + 1}. —`, 12, sel ? "#ffe2a0" : "#f2ead8");
      if (own) hits.push({ x: sx, y: sy, w: sw, h: sh, fn: () => gm.selectWeapon(i) });
    });
    // предметы
    text(rx, y0 + 278, t("items"), 13, "#c8bfa8", 0);
    const iy = y0 + 292, iw = (rw - 8) / 2, ih = 46;
    g.fillStyle(0x2a241a, 1).fillRoundedRect(rx, iy, iw, ih, 8).lineStyle(2, 0x5a5040, 0.8).strokeRoundedRect(rx, iy, iw, ih, 8);
    g.fillStyle(0x5e6e2c).fillEllipse(rx + 24, iy + 28, 16, 20).fillStyle(0x9a9a92).fillRect(rx + 21, iy + 13, 6, 5);
    text(rx + 42, iy + ih / 2, `${t("grenades")}: ${S.grenades}\n${S.touch ? t("tap_take") : t("throw_keys")}`, 12, "#f2ead8", 0);
    hits.push({ x: rx, y: iy, w: iw, h: ih, fn: () => gm.selectWeapon(3) });
    const mx = rx + iw + 8;
    g.fillStyle(S.medkits ? 0x4a1c1c : 0x2a241a, 1).fillRoundedRect(mx, iy, iw, ih, 8).lineStyle(2, S.medkits ? 0xff7060 : 0x5a5040, 0.8).strokeRoundedRect(mx, iy, iw, ih, 8);
    g.fillStyle(0xeeeeee).fillRoundedRect(mx + 12, iy + 16, 24, 20, 3).fillStyle(0xd83a2a).fillRect(mx + 21, iy + 19, 6, 14).fillRect(mx + 17, iy + 23, 14, 6);
    text(mx + 44, iy + ih / 2, `${t("meds")}: ${S.medkits}/${MAX_MED}\n${S.touch ? `+${MED_HEAL}` : t("med_use", { n: MED_HEAL })}`, 12, "#f2ead8", 0);
    hits.push({ x: mx, y: iy, w: iw, h: ih, fn: () => gm.useMedkit() });
    // патроны: нажми — следующие (обычные → бронебойные → зажигательные)
    const ay = iy + ih + 8, ah = 32, on = S.ammoK;
    g.fillStyle(on ? 0x1c3440 : 0x2a241a, 1).fillRoundedRect(rx, ay, rw, ah, 8).lineStyle(2, on === 1 ? 0x9ae8ff : on === 2 ? 0xff9a50 : 0x5a5040, 0.8).strokeRoundedRect(rx, ay, rw, ah, 8);
    text(rx + 12, ay + ah / 2, `${t("ammo")}: ${t((["ammo_n", "ammo_ap", "ammo_inc"] as Key[])[on])}   ·   ${t("ammo_ap_s")} ${S.ap}   ${t("ammo_inc_s")} ${S.inc}${S.touch ? "" : "   [B]"}`, 12, "#f2ead8", 0);
    hits.push({ x: rx, y: ay, w: rw, h: ah, fn: () => gm.cycleAmmo() });
    text(narrow ? x0 + pw / 2 : rx + rw / 2, y0 + ph - 22, S.touch ? t("inv_close_touch") : `${t("inv_close_key")}${NET.role === "solo" ? t("paused_note") : ""}`, 12, "#a89f88");
    outside();
  }
  update(_t: number, dms: number) {
    const dt = Math.min(0.1, dms / 1000);
    const w = this.scale.width, h = this.scale.height, g = this.g.clear();
    this.g2.clear();
    for (const o of this.pool) o.setVisible(false);
    for (const o of this.tpool) o.setVisible(false);
    this.pi = 0; this.tpi = 0;
    if (S.menu) {
      for (const o of [this.bannerT, this.info, this.big, this.help, this.net, this.chatT, this.bagT, ...this.btn, ...this.slotT, ...this.invT]) o.setVisible(false);
      this.doll.c.setVisible(false);
      S.hits = [];
      this.mmG.clear(); this.mmR = 0;
      this.rain = 0; this.drawRain(w, h, dt);
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
    this.info.setText("");
    // ранили — края экрана краснеют; мало жизни — пульсируют
    S.hurtV = Math.max(0, S.hurtV - this.game.loop.delta / 1000 * 2.2);
    const lowA = !S.over && S.hp > 0 && S.hp < 30 ? 0.5 + 0.35 * Math.max(0, Math.sin(performance.now() / 160)) : 0;
    this.vig.setDisplaySize(w, h).setAlpha(Math.min(0.95, Math.max(S.hurtV, lowA))).setVisible(!S.menu);
    if (!S.over && !S.inv) this.drawTop(g, w, h, hits);
    this.help.setPosition(w - 14, h - 12).setWordWrapWidth(w - 28).setText(S.touch || S.inv ? "" : t("help"));
    // ячейки оружия и рюкзак: внизу по центру (на тачскрине — между стиками, а если тесно — над кнопками справа)
    if (!S.over && !S.inv) {
      const gap = 6, sh = 52, bag = 44;
      let sw = 84, bx: number, by: number, lift = 0;
      const tot = () => SLOTS.length * sw + SLOTS.length * gap + (S.touch ? bag : 0) - (S.touch ? 0 : gap);
      if (!S.touch) { bx = (w - tot()) / 2; by = h - sh - this.help.height - 16; }
      else if (tot() <= w - 350) { bx = (w - tot()) / 2; by = h - sh - 10; }
      else { sw = Math.min(80, (w - 24 - bag - SLOTS.length * gap) / SLOTS.length); bx = (w - tot()) / 2; by = h - sh - 10; lift = sh + 18; }
      SLOTS.forEach((id, i) => {
        if (!S.owned[i]) return;
        const x = bx + i * (sw + gap), sel = S.weapon === i, W_ = wstat(id);
        g.fillStyle(0x14110d, sel ? 0.8 : 0.5).fillRoundedRect(x, by, sw, sh, 7).lineStyle(2, sel ? 0xffe2a0 : 0xf2ead8, sel ? 0.95 : 0.25).strokeRoundedRect(x, by, sw, sh, 7);
        const am = id === "grenade" ? `×${S.grenades}` : id === "saw" ? "∞" : sel && S.reload > 0 ? "…" : W_.stock ? `${S.clip[id]}|${S.stock[id] ?? 0}` : `${S.clip[id]}/${W_.mag}`;
        // картинка оружия сверху, подпись и патроны снизу
        const wn = (id === "grenade" && !HUD_FILE("w_grenade") ? "grenade" : "w_" + id) as HudArt, [iw, ih] = HUD_ART[wn], isc = Math.min((sw - 14) / iw, 22 / ih);
        this.img(wn, x + sw / 2 - (iw * isc) / 2, by + 15, isc, sel ? 1 : 0.75);
        if (!S.touch) this.txt(`${i + 1}`, x + 5, by + 9, 10, sel ? "#ffe2a0" : "#a89f88");
        this.slotT[i].setPosition(x + sw / 2, by + sh - 11).setText(`${wname(id)} ${am}`).setFontSize(sw < 70 ? 9 : 10.5).setColor(sel ? "#ffe2a0" : "#d8d0bc").setVisible(true);
        hits.push({ x, y: by, w: sw, h: sh, fn: () => gm.selectWeapon(i) });
      });
      // кнопка «снаряжение» (рюкзак): на компьютере — слева от паузы/чата, на тачскрине — в конце ряда ячеек
      const kx = S.touch ? bx + SLOTS.length * (sw + gap) : w - 104, ky = S.touch ? by + 1 : 12;
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(kx, ky, 42, 42, 8);
      this.img("bag", kx + 7, ky + 21);
      if (!S.touch) this.bagT.setPosition(kx + 21, ky + 50).setText("I").setVisible(true);
      hits.push({ x: kx, y: ky, w: 42, h: 42, fn: () => gm.toggleInv() });
      S.lift = lift;
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
        const labels = NET.role === "host" ? [t("copy_code", { c: NET.code }), t("copy_link")] : [tk("invite"), tk("join_code")];
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
      this.big.setAlpha(0); // итоги — на экране смерти (menu.ts)
    } else {
      const wv = S.msg === t("wave_n", { n: S.wave }); // номер волны показывает заставка
      // длинное сообщение (рация в сюжете) — мельче и в несколько строк; под заставкой, если она идёт
      const long = S.msg.length > 34, under = this.bT < 2.6 && !wv;
      this.big.setPosition(w / 2, h * (under ? 0.44 : 0.28)).setText(S.msg).setFontSize(long ? Math.min(24, w / 30) : 42).setWordWrapWidth(w * 0.86, true).setAlpha(wv ? 0 : Phaser.Math.Clamp(S.msgT, 0, 1));
    }
    this.drawBanner(g, w, h, dt);
    this.drawRain(w, h, dt);
    // кнопка паузы (в кооперативе мир не останавливается — кнопки нет)
    if (!S.over && NET.role === "solo") {
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(w - 54, 12, 42, 42, 8);
      this.img(S.paused ? "play" : "pause", w - 45, 33);
    }
    // кнопка чата (в кооперативе — на месте паузы)
    if (NET.role !== "solo") {
      g.fillStyle(0x14110d, 0.55).fillRoundedRect(w - 54, 12, 42, 42, 8);
      this.img("chat", w - 47, 33);
    }
    // чат: последние сообщения слева внизу, гаснут через 12 с (пока пишешь — видны все)
    const now = performance.now();
    const lines = S.chat.filter((c) => S.chatOpen || now - c.t < 12000).slice(-7);
    this.chatT.setPosition(16, h - (S.touch ? 190 + S.lift : 112)).setText(lines.map((c) => `${c.who}: ${c.text}`)).setWordWrapWidth(Math.min(460, w - 32))
      .setAlpha(lines.length && !S.chatOpen ? Phaser.Math.Clamp((12000 - (now - lines[lines.length - 1].t)) / 1500, 0.35, 1) : 1);
    // стики на тачскрине
    if (S.touch && !S.over && !S.inv) {
      const stick = (st: Stick | null, label: string, col: number, defX: number) => {
        const ox = st ? st.ox : defX, oy = st ? st.oy : h - 110 - S.lift;
        g.lineStyle(3, 0xffffff, st ? 0.5 : 0.25).strokeCircle(ox, oy, 55).fillStyle(0xffffff, 0.08).fillCircle(ox, oy, 55);
        let kx = ox, ky = oy;
        if (st) { const dx = st.x - ox, dy = st.y - oy, d = Math.hypot(dx, dy), m = Math.min(d, 55); if (d > 0) { kx = ox + (dx / d) * m; ky = oy + (dy / d) * m; } }
        g.fillStyle(col, st ? 0.7 : 0.35).fillCircle(kx, ky, 24);
        void label;
      };
      stick(S.move, "ход", 0xe8e0cc, 110);
      stick(S.aim, "огонь", 0xff6040, w - 110);
      // кнопка гранаты
      const bx = w - 110, by = h - 235 - S.lift;
      g.fillStyle(0x14110d, 0.45).fillCircle(bx, by, 30).lineStyle(3, 0xffffff, S.grenades ? 0.5 : 0.2).strokeCircle(bx, by, 30);
      this.img("grenade", bx - 12, by, 1.1, S.grenades ? 1 : 0.35);
      if (gm.charge) { const pw = gm.nadePower(); g.lineStyle(4, pw >= 1 ? 0xffd040 : 0x9aff60, 0.95).beginPath().arc(bx, by, 30, -Math.PI / 2, -Math.PI / 2 + pw * Math.PI * 2).strokePath(); }
      // кнопка аптечки — левее гранаты
      if (!S.inv) {
        const hx = w - 190, hy = h - 215 - S.lift, on = S.medkits > 0;
        g.fillStyle(0x14110d, 0.45).fillCircle(hx, hy, 26).lineStyle(3, 0xffffff, on ? 0.5 : 0.2).strokeCircle(hx, hy, 26);
        this.img("medkit", hx - 13, hy, 1, on ? 1 : 0.35);
        hits.push({ x: hx - 28, y: hy - 28, w: 56, h: 56, fn: () => gm.useMedkit() });
      }
    }
    this.drawMini(w, h, dt, hits);
    // горячие точки (в окне снаряжения — только его кнопки и «мимо окна»)
    S.hits = S.paused || S.over ? [] : hits;
  }
}

// Запуск — только когда у окна есть размер. В скрытом/свёрнутом окне при холодной загрузке ширина и высота
// бывают 0: WebGL не может создать буфер кадра («Framebuffer status: Incomplete Attachment») и остаётся чёрный экран.
// Ждём, пока окно станет видимым и получит размер.
let booted = false;
const tryBoot = () => {
  if (booted || document.hidden || innerWidth < 2 || innerHeight < 2) return;
  booted = true;
  removeEventListener("resize", tryBoot); document.removeEventListener("visibilitychange", tryBoot);
  boot();
};
addEventListener("resize", tryBoot); document.addEventListener("visibilitychange", tryBoot);
setTimeout(tryBoot, 0);
// на всякий случай: окно так и не показали — через 3 с всё равно стартуем (мир идёт, звук и сеть живут)
setTimeout(() => { if (!booted && innerWidth >= 2 && innerHeight >= 2) { booted = true; boot(); } }, 3000);

function boot() {
  const game: Phaser.Game = ((window as any).G = new Phaser.Game({
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
    // горизонтальный режим: закрепляем ориентацию (Android — только в полном экране), а в вертикальном
    // показываем «Поверни телефон» и ставим одиночную игру на паузу, пока телефон не повернут
    const lockLand = () => { try { const o = (screen as any).orientation; o?.lock?.("landscape")?.catch?.(() => {}); } catch { /* не умеет */ } };
    if (mobile) {
      if (standalone) lockLand();
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:50;display:none;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#14110d;color:#ffe2a0;font:700 22px system-ui,sans-serif;text-align:center;padding:24px";
      ov.innerHTML = '<svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="#ffe2a0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="14" width="36" height="62" rx="7" style="transform-origin:48px 45px;animation:mzrot 2.4s ease-in-out infinite"/><path d="M14 66a36 36 0 0 0 26 22M82 30a36 36 0 0 0-26-22"/></svg><div></div>';
      const st = document.createElement("style");
      st.textContent = "@keyframes mzrot{0%,25%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}";
      document.head.appendChild(st);
      for (const ev of ["pointerdown", "mousedown", "touchstart", "touchend", "click"]) ov.addEventListener(ev, (e) => e.stopPropagation());
      let autoPaused = false;
      const check = () => {
        const port = innerHeight > innerWidth * 1.05;
        if (!document.body.contains(ov)) document.body.appendChild(ov);
        (ov.lastChild as HTMLElement).textContent = t("rotate");
        ov.style.display = port ? "flex" : "none";
        const g = game.scene.getScene("game") as any;
        if (!g || !g.sys?.isActive()) return;
        if (port && !S.paused && !S.over && !S.menu && NET.role === "solo") { g.togglePause(); autoPaused = true; }
        else if (!port && autoPaused) { autoPaused = false; if (S.paused) g.togglePause(); }
      };
      addEventListener("resize", check); addEventListener("orientationchange", () => setTimeout(check, 200));
      game.events.once("ready", check); setTimeout(check, 300);
    }
    if (mobile && !standalone) {
      const d = document as any, el = document.documentElement as any;
      const req: ((o?: object) => Promise<void> | void) | undefined = el.requestFullscreen ?? el.webkitRequestFullscreen;
      let hinted = false;
      const go = () => {
        if (!settings.fs || d.fullscreenElement || d.webkitFullscreenElement) return;
        if (req) {
          try {
            const r = req.call(el, { navigationUI: "hide" });
            if (r && (r as Promise<void>).then) (r as Promise<void>).then(lockLand, () => {}); else lockLand();
          } catch { /* не дали */ }
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
        const man = { name: "MyZombika", short_name: "MyZombika", start_url: here, scope: here.replace(/[^/]*$/, ""), display: "fullscreen", orientation: "landscape", background_color: "#1a1d14", theme_color: "#1a1d14",
          icons: [{ src: icon, sizes: "512x512", type: "image/png" }, { src: icon, sizes: "192x192", type: "image/png" }] };
        const link = document.createElement("link"); link.rel = "manifest";
        link.href = "data:application/manifest+json;charset=utf-8," + encodeURIComponent(JSON.stringify(man));
        document.head.appendChild(link);
        const ap = document.createElement("link"); ap.rel = "apple-touch-icon"; ap.href = icon; document.head.appendChild(ap);
      } catch { /* без значка */ }
    };
    game.events.once("ready", () => setTimeout(addManifest, 500));
  }
}
