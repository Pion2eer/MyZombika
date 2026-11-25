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
  // оружие на панели внизу — вид сбоку
  w_rifle: ["ui", 256, 104, "Side view of a worn military assault rifle with a curved magazine, wooden grip, pointing RIGHT. Wide image 5:2."],
  w_shotgun: ["ui", 256, 88, "Side view of a pump-action shotgun with a wooden stock and pump, pointing RIGHT. Wide image 3:1."],
  w_pistol: ["ui", 144, 104, "Side view of a black semi-automatic pistol, pointing RIGHT."],
  w_grenade: ["ui", 96, 112, "An olive green frag hand grenade with ring pin and spoon, side view, upright."],
  // ── глава 1: лес и ферма ──
  barn: ["build", 640, 560, "A big old red wooden barn with a grey shingle roof (we see the roof from above and the front wall with big double doors), slightly damaged."],
  farmhouse: ["build", 600, 520, "A small rural farmhouse with a brown roof, porch, boarded-up windows, abandoned."],
  silo: ["build", 240, 440, "A tall rusty grain silo with a dome top, ladder on the side. Tall image."],
  haystack: ["build", 240, 200, "A round golden hay bale stack, three bales."],
  tractor: ["build", 360, 280, "An old rusty green farm tractor, abandoned, big rear wheels."],
  windmill: ["build", 320, 480, "A rusty metal farm windpump (windmill) on a lattice tower. Tall image."],
  well: ["build", 200, 220, "A stone water well with a small wooden roof and a bucket."],
  woodpile: ["build", 280, 180, "A pile of chopped firewood logs with an axe stuck in a stump."],
  scarecrow: ["build", 180, 260, "A creepy scarecrow on a pole in ragged clothes and a straw hat."],
  // ── глава 2: шоссе ──
  gas_station: ["build", 720, 520, "An abandoned roadside gas station: canopy roof on pillars over two fuel pumps, broken sign, from above at 3/4."],
  bus_wreck: ["build", 640, 260, "STRICTLY top-down view of a wrecked yellow school bus lying on the road, nose pointing RIGHT, broken windows. Wide image."],
  truck_wreck: ["build", 640, 260, "STRICTLY top-down view of a crashed semi truck with a grey trailer, nose pointing RIGHT. Wide image."],
  police_car: ["build", 448, 216, "STRICTLY top-down view of an abandoned police car, black and white, light bar on the roof, nose pointing RIGHT. Wide image 2:1."],
  billboard: ["build", 520, 360, "A big roadside billboard on two posts with a torn faded advertisement poster (no readable text)."],
  barrier: ["build", 320, 120, "A row of concrete road barriers (jersey barriers) with red and white stripes. Wide image."],
  cones: ["build", 200, 140, "Three orange traffic cones, one knocked over."],
  motel: ["build", 720, 480, "A small one-storey roadside motel block with four doors, flat roof, broken neon frame (no text)."],
  // ── глава 3: городок ──
  shop: ["build", 640, 520, "A small-town brick shop building with a striped awning, smashed shop window, flat roof from above."],
  town_house: ["build", 600, 560, "A two-storey town house with a red tiled roof, balcony and boarded windows."],
  kiosk: ["build", 260, 240, "A small street news kiosk, green paint, closed shutters."],
  bus_stop: ["build", 360, 220, "A bus stop shelter with glass panels (one broken) and a bench."],
  fountain: ["build", 360, 300, "A round stone town fountain, dry, cracked, with a small statue in the middle."],
  phone_booth: ["build", 140, 260, "An old red phone booth with cracked glass. Tall image."],
  playground: ["build", 420, 320, "A rusty children's swing set and a small slide, abandoned."],
  // ── глава 4: завод ──
  factory: ["build", 760, 560, "A large industrial factory hall with a sawtooth roof, rusty corrugated metal walls, big gate."],
  chimney: ["build", 220, 560, "A tall brick factory chimney with black soot at the top. Very tall image."],
  container_blue: ["build", 520, 220, "A blue steel shipping container, ribbed walls, seen from above at 3/4, rusty. Wide image."],
  container_red: ["build", 520, 220, "A red steel shipping container, ribbed walls, seen from above at 3/4, rusty. Wide image."],
  pipes: ["build", 480, 260, "A cluster of big industrial pipes and valves with yellow handwheels. Wide image."],
  forklift: ["build", 300, 260, "A yellow forklift truck, abandoned, forks lowered."],
  water_tank: ["build", 320, 440, "A rusty industrial water tower tank on four legs. Tall image."],
  spool: ["build", 200, 180, "A big wooden cable spool lying on its side with black cable."],
  // ── глава 5: плотина ──
  dam_tower: ["build", 360, 560, "A concrete dam control tower with small windows and an antenna on top. Tall image."],
  crane: ["build", 520, 560, "A yellow construction crane base with a lattice mast (we see it from above at 3/4)."],
  generator: ["build", 320, 240, "A big industrial diesel generator box with warning stripes and cables."],
  helipad: ["build", 520, 520, "STRICTLY top-down view of a round concrete helicopter landing pad with a big painted H and yellow circle, cracked."],
  sandbags: ["build", 360, 160, "A curved wall of military sandbags. Wide image."],
  watchtower: ["build", 320, 520, "A wooden military watchtower on stilts with a ladder and a searchlight. Tall image."],
  boat: ["build", 480, 220, "STRICTLY top-down view of a small abandoned motor boat lying on dry ground, nose pointing RIGHT. Wide image."],
  rocks: ["build", 320, 220, "A cluster of large grey granite boulders with some moss."],
  // ── земля глав: бесшовные плитки, строго сверху ──
  t_grass: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: lush meadow grass with small flowers and clover."],
  t_farm: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: dry farm soil with plowed furrows and straw."],
  t_asphalt: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: cracked old asphalt with small weeds in the cracks."],
  t_town: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: grey stone paving slabs, cracked, with dirt."],
  t_factory: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: stained industrial concrete floor with oil spots and rust."],
  t_dam: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: rough wet concrete with moss and puddles."],
  t_water: ["tiles", 512, 512, "Seamless tileable texture, STRICTLY top-down: dark river water with gentle ripples."],
};
const TILE_STYLE = "Ground texture for a 2D top-down zombie survival game, bright cartoon painterly style. Fully opaque, edges must wrap seamlessly, even lighting, no objects, no text, no frame.";

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
    (dir === "tiles" ? `${TILE_STYLE}\nSubject: ${what}\nSquare image.` : `${dir === "ui" ? UI_STYLE : PROP_STYLE}\nSubject: ${what}\nTransparent PNG background.`);
  const t0 = Date.now();
  process.stdout.write(`${name}… `);
  await runCodex(prompt, dir === "props" || dir === "build");
  const img = newestImage(t0 - 1000);
  if (!img) { failed++; console.log("не получилось"); continue; }
  try {
    const clear = dir === "tiles"
      ? (execFileSync("python", ["-c", "import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert('RGB').resize((int(sys.argv[3]), int(sys.argv[4])), Image.Resampling.LANCZOS).save(sys.argv[2], optimize=True)", img, dst, String(w), String(h)]), 1)
      : Number(execFileSync("python", ["-c", PY, img, dst, String(w), String(h)]).toString().trim());
    made++;
    console.log(`готово за ${Math.round((Date.now() - t0) / 1000)} с${clear < 0.05 ? " (фон убран)" : ""}`);
  } catch (e) { failed++; console.log("ошибка обработки: " + String(e).slice(0, 200)); }
}
console.log(`итого: сделано ${made}, пропущено ${skipped}, ошибок ${failed}`);
