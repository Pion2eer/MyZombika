// Картинки через Codex CLI (подписка ChatGPT, без API-ключа) — как в LLM Survival (tools/gen-sprites.mjs).
// node tools/gen-art.mjs [имя ...]   — без аргументов: все, которых ещё нет в art/gen.
// Готовые картинки кладутся в art/gen/ui и art/gen/props (уже обрезанные и нужного размера).
// Чтобы игра их взяла, их копируют в src/ui и src/props и пересобирают игру.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "art", "gen");
const GEN = join(homedir(), ".codex", "generated_images");
const TIMEOUT = 6 * 60_000;
const REF = join(ROOT, "tools", "style-ref.png"); // скриншот игры — образец стиля

const UI_STYLE =
  "Game UI icon for a top-down zombie survival game. Chunky hand-painted cartoon style, thick dark brown outline (#14110d), warm saturated colors, " +
  "soft top-left highlight, bold readable silhouette that still reads at 26 pixels. No text, single object centered, fills ~90% of the canvas, transparent background, no shadow, no frame.";
const PROP_STYLE =
  "Game prop sprite for a 2D top-down zombie survival game. Match the art style of the attached reference screenshot (image1): bright cartoon painterly game art, " +
  "soft shading, light from top-left, same high top-down camera with a hint of 3/4 (we see the top and a bit of the front side). Use the reference ONLY for style, do not copy it. " +
  "Single object centered, fills ~90% of the canvas. Transparent background, no ground, no cast shadow, no text, no frame.";

// имя: [папка, ширина, высота (в файле, ×4 от экрана), подсказка]
const ITEMS = {
  heart: ["ui", 120, 120, "A glossy red heart, health icon."],
  shield: ["ui", 112, 112, "A blue steel shield with a vertical seam, armor icon."],
  wave: ["ui", 104, 104, "A pale green zombie skull with glowing red eyes, front view."],
  kills: ["ui", 104, 104, "A bone-white skull over crossed bones."],
  score: ["ui", 104, 104, "A gold five-pointed star with a shine."],
  grenade: ["ui", 88, 104, "An olive green hand grenade with a ring pin, upright."],
  medkit: ["ui", 104, 96, "A white first-aid box with a red cross and a handle."],
  bag: ["ui", 112, 112, "A brown leather backpack, front view."],
  chat: ["ui", 112, 104, "A cream speech bubble with three dots."],
  bullet_rifle: ["ui", 24, 72, "A single rifle cartridge standing upright, copper tip, brass case. Very tall narrow image 1:3."],
  bullet_pistol: ["ui", 28, 56, "A single short pistol cartridge standing upright, grey tip, brass case. Tall image 1:2."],
  shell: ["ui", 40, 72, "A single red shotgun shell standing upright, brass base. Tall image."],
  barrel: ["props", 104, 136, "A red metal fuel barrel standing upright with a yellow flame hazard sign, top lid visible, slightly dented."],
  barrel_blue: ["props", 104, 136, "A blue steel oil drum standing upright, top lid visible, ribs, a bit of rust."],
  crate: ["props", 136, 144, "A wooden supply crate with an X brace on the front, top visible, nailed planks."],
  car_red: ["props", 448, 216, "STRICTLY top-down view (from directly above) of an abandoned rusty red sedan car, nose pointing RIGHT, cracked windshield, dirty roof. Wide image 2:1."],
  car_teal: ["props", 448, 216, "STRICTLY top-down view (from directly above) of an abandoned faded teal hatchback car, nose pointing RIGHT, broken side window, dusty roof. Wide image 2:1."],
  car_burnt: ["props", 448, 216, "STRICTLY top-down view (from directly above) of a burnt-out car wreck, black charred metal with rust, no glass, nose pointing RIGHT. Wide image 2:1."],
  campfire: ["props", 160, 136, "A campfire ring: grey stones in a circle around charred logs and ash, NO flames (the game adds flames)."],
  lamp: ["props", 104, 336, "A tall dark iron street lamp post, lamp head at the top hanging to the right, base at the bottom. Very tall narrow image 1:3."],
  fence: ["props", 336, 104, "One section of a weathered wooden picket fence, seen from the front-top, horizontal. Wide image 3:1."],
  sign: ["props", 136, 160, "A yellow diamond warning sign with a black zombie hand silhouette, on a short wooden post."],
  tires: ["props", 144, 120, "A small stack of three old black car tires."],
};

function newestImage(since) {
  let best = null;
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f), s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(f) && s.mtimeMs > since && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs };
    }
  };
  walk(GEN);
  return best?.p ?? null;
}

function runCodex(prompt, ref) {
  return new Promise((resolve) => {
    const args = ["exec", "-", "--skip-git-repo-check", "--sandbox", "read-only", "--enable", "image_generation"];
    if (ref && existsSync(REF)) args.push("--image", `"${REF}"`);
    const ch = spawn("codex", args, { shell: true, stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => ch.kill(), TIMEOUT);
    ch.on("close", (code) => (clearTimeout(timer), resolve(code)));
    ch.stdin.end(prompt);
  });
}

// прозрачный фон (если пришёл сплошной — убираем заливкой от углов), обрезка по содержимому, вписывание в нужный размер
const PY = `
import sys
from PIL import Image, ImageDraw
src, dst, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert("RGBA")
a = im.getchannel("A")
clear = sum(1 for v in a.getdata() if v < 16) / (im.width * im.height)
if clear < 0.05:
    rgb = im.convert("RGB")
    mask = Image.new("L", im.size, 0)
    for c in [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]:
        tmp = rgb.copy()
        ImageDraw.floodfill(tmp, c, (255, 0, 255), thresh=40)
        px = tmp.load(); mp = mask.load()
        for y in range(im.height):
            for x in range(im.width):
                if px[x, y] == (255, 0, 255): mp[x, y] = 255
    al = im.getchannel("A").point(lambda v: v)
    al.paste(0, mask=mask)
    im.putalpha(al)
bb = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
if bb: im = im.crop(bb)
k = min(W / im.width, H / im.height)
im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.Resampling.LANCZOS)
out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
out.paste(im, ((W - im.width) // 2, H - im.height if H > W * 1.2 else (H - im.height) // 2), im)
out.save(dst, optimize=True)
print(f"{clear:.2f}")`;

const want = process.argv.slice(2);
const names = (want.length ? want : Object.keys(ITEMS)).filter((n) => ITEMS[n]);
let made = 0, skipped = 0, failed = 0;
for (const name of names) {
  const [dir, w, h, what] = ITEMS[name];
  mkdirSync(join(OUT, dir), { recursive: true });
  const dst = join(OUT, dir, `${name}.png`);
  if (existsSync(dst) && !want.length) { skipped++; continue; }
  const prompt = `$imagegen Generate exactly ONE image. Do not create files and do not run any commands.\n` +
    `${dir === "ui" ? UI_STYLE : PROP_STYLE}\nSubject: ${what}\nTransparent PNG background.`;
  const t0 = Date.now();
  process.stdout.write(`${name}… `);
  await runCodex(prompt, dir === "props");
  const img = newestImage(t0 - 1000);
  if (!img) { failed++; console.log("не получилось"); continue; }
  try {
    const clear = Number(execFileSync("python", ["-c", PY, img, dst, String(w), String(h)]).toString().trim());
    made++;
    console.log(`готово за ${Math.round((Date.now() - t0) / 1000)} с${clear < 0.05 ? " (фон убран)" : ""}`);
  } catch (e) { failed++; console.log("ошибка обработки: " + String(e).slice(0, 200)); }
}
console.log(`итого: сделано ${made}, пропущено ${skipped}, ошибок ${failed}`);
