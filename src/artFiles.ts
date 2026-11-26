// Картинки объектов от ChatGPT (стиль деревьев, угол камеры игры). Положи PNG — и он заменит модель из срезов:
//   src/obj/<имя>.png    — предмет (имена как у моделей: hay_round, cone, bench…; машины: car_red_h — боком, нос вправо;
//                          car_red_v — вдоль; без _h/_v — один ракурс). Размер в мире = размер файла / 2.
//   src/house/<имя>.png  — полуразрушенный дом (любое имя): ставится сплошным препятствием, по 1–2 на участок сюжета.
//   src/build/<имя>.png  — постройки и крупные вещи глав (амбар, заправка, кран…): набор по месту — SETS в buildWorld (main.ts).
//                          Размер в мире = файл / 2 (мелочь из BUILD_SMALL — / 2,67).
import Phaser from "phaser";

const OBJ = import.meta.glob("./obj/*.png", { eager: true, import: "default" }) as Record<string, string>;
const HOUSE = import.meta.glob("./house/*.png", { eager: true, import: "default" }) as Record<string, string>;
const BUILD = import.meta.glob("./build/*.png", { eager: true, import: "default" }) as Record<string, string>;
const nameOf = (p: string) => p.replace(/^.*\//, "").replace(/\.png$/, "");
export const OBJ_NAMES = new Set(Object.keys(OBJ).map(nameOf));
export const HOUSE_NAMES = Object.keys(HOUSE).map(nameOf).sort();
/** во сколько раз файл крупнее мира */
export const ART_K = 2;
/** предметы и машины (src/obj) */
export const OBJ_K = 2;
export const BUILD_NAMES = new Set(Object.keys(BUILD).map(nameOf));
const BUILD_SMALL = new Set(["phone_booth", "spool", "woodpile", "generator", "forklift", "kiosk", "bus_stop", "tractor", "fountain", "playground"]);
export const buildK = (n: string) => (BUILD_SMALL.has(n) ? 8 / 3 : ART_K);

export function loadArtFiles(scene: Phaser.Scene) {
  for (const [p, f] of Object.entries(OBJ)) scene.load.image("ob_" + nameOf(p), f);
  for (const [p, f] of Object.entries(BUILD)) scene.load.image("bd_" + nameOf(p), f);
  for (const [p, f] of Object.entries(HOUSE)) scene.load.image("hs_" + nameOf(p), f);
}
/** есть ли картинка для предмета (с ракурсом: «_h» / «_v» или без) */
export function objArt(name: string, view?: "h" | "v"): string | null {
  if (view && OBJ_NAMES.has(`${name}_${view}`)) return `ob_${name}_${view}`;
  if (OBJ_NAMES.has(name)) return "ob_" + name;
  return null;
}
