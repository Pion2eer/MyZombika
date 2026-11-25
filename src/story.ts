// Сюжетный режим: данные главы и сохранение в браузере.
// Глава — вертикальная полоса: старт внизу у дома, 4–5 участков, между ними заслоны и лагеря (автосохранение), выход наверху.

import type { Kind } from "./main";

/** Пять глав «Дорога на север». Каждая — своя местность (земля, деревья, предметы), длина и враги. */
export type Theme = "farm" | "road" | "town" | "factory" | "dam";
export interface ChapterDef { theme: Theme; segs: number; tint: number; weapon?: { slot: number; seg: number }; boss?: boolean }
export const CHAPTERS: ChapterDef[] = [
  { theme: "farm", segs: 4, tint: 0xffffff, weapon: { slot: 1, seg: 1 } }, // дробовик
  { theme: "road", segs: 4, tint: 0xe6dcc0, weapon: { slot: 0, seg: 0 } }, // автомат
  { theme: "town", segs: 5, tint: 0xc8ccc4 },
  { theme: "factory", segs: 5, tint: 0xb8b0a0 },
  { theme: "dam", segs: 5, tint: 0xb8ccd0, boss: true },
];
const SEGL = 2300;

/** группы врагов: участок, место, кто. Просыпаются, когда кто-то из отряда подходит снизу */
export interface Group { seg: number; x: number; y: number; kinds: Kind[]; boss?: boolean }
const z = (n: number, k: Kind = "zombie") => Array<Kind>(Math.max(0, Math.round(n))).fill(k);

// раскладка текущей главы (живые привязки: main видит новые значения после setChapter)
export let CH = 0;
export let STORY_W = 1600, STORY_H = 7200;
export let GATES: number[] = [];
export let CAMPS: { x: number; y: number }[] = [];
export let START = { x: 0, y: 0 };
export const EXIT_Y = 520;
export let GROUPS: Group[] = [];
export let WEAPON_CRATES: { x: number; y: number; slot: number }[] = [];
export let SEGS = 3;

export function setChapter(ch: number) {
  CH = Math.max(0, Math.min(CHAPTERS.length - 1, ch | 0));
  const C = CHAPTERS[CH];
  SEGS = C.segs;
  STORY_W = 1600; STORY_H = C.segs * SEGL + 300;
  GATES = Array.from({ length: C.segs - 1 }, (_, k) => STORY_H - 50 - SEGL * (k + 1));
  CAMPS = GATES.map((g, k) => ({ x: STORY_W / 2 + (k % 2 ? 60 : -40), y: g - 230 }));
  START = { x: STORY_W / 2 - 80, y: STORY_H - 330 };
  // враги: чем дальше (глава и участок), тем больше и злее
  let s = 1234 + CH * 7919;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  GROUPS = [];
  for (let k = 0; k < C.segs; k++) {
    const y0 = k === 0 ? STORY_H - 650 : GATES[k - 1] - 450, y1 = k < GATES.length ? GATES[k] + 250 : EXIT_Y + 350;
    const d = CH + k * 0.4;
    for (let i = 0; i < 4; i++) {
      const y = y0 + ((y1 - y0) * (i + 0.5)) / 4, x = 380 + rnd() * (STORY_W - 760), last = i === 3;
      const kinds: Kind[] = [...z(3 + d * 1.1 + i), ...(d > 0.3 ? z(1 + d * 0.6, "runner") : [])];
      if (CH <= 1 && rnd() < 0.5) kinds.push(...z(2 + rnd() * 3, "rat"));
      if (d > 0.7 && rnd() < 0.6) kinds.push(...z(1 + d * 0.3, "hyena"));
      if (d > 1.2 && (last || rnd() < 0.4)) kinds.push(...z(1 + d * 0.25, "spitter"));
      if (d > 2.4 && rnd() < 0.5) kinds.push(...z(d * 0.3, "panther"));
      if (d > 3 && last) kinds.push("bear");
      GROUPS.push({ seg: k, x, y, kinds });
    }
  }
  // финал: «Хозяин» у плотины
  if (C.boss) GROUPS.push({ seg: C.segs - 1, x: STORY_W / 2, y: EXIT_Y + 420, kinds: ["bear", "spitter", "spitter", "panther", "panther"], boss: true });
  WEAPON_CRATES = C.weapon ? [{ x: 1180, y: (C.weapon.seg === 0 ? STORY_H - 1500 : GATES[C.weapon.seg - 1] - 900), slot: C.weapon.slot }] : [];
}
setChapter(0);

export interface StorySave {
  ch: number; camp: number; hp: number; armor: number; medkits: number; grenades: number;
  owned: boolean[]; clip: Record<string, number>; weapon: number; kills: number; score: number; time: number;
  /** прокачка (с 0.12) */
  level?: number; xp?: number; parts?: number; up?: Record<string, number>;
}
const KEY = "myzombika-story";
export function loadStory(): StorySave | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); return s && typeof s.camp === "number" ? s : null; } catch { return null; }
}
export function saveStory(s: StorySave | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* приватный режим */ }
}

/** гость в чужом сюжете: его прокачка хранится отдельно и едет с ним в любую игру */
export interface HeroSave { level: number; xp: number; parts: number; up: Record<string, number> }
const HERO = "myzombika-hero";
export function loadHero(): HeroSave | null {
  try { const s = JSON.parse(localStorage.getItem(HERO) || "null"); return s && typeof s.level === "number" ? s : null; } catch { return null; }
}
export function saveHero(s: HeroSave) {
  try { localStorage.setItem(HERO, JSON.stringify(s)); } catch { /* приватный режим */ }
}
