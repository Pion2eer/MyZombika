# Картинки верхней панели (HUD)

Положи сюда PNG с прозрачным фоном под одним из имён ниже и пересобери игру (`npm run build`).
Файл заменит картинку, которую игра рисует сама (`src/hudArt.ts`). Можно менять по одной.

Делай картинку в 4 раза крупнее экранного размера, с теми же пропорциями.

| Файл | Что это | Экранный размер | Размер файла |
|---|---|---|---|
| heart.png | сердце, здоровье | 30×30 | 120×120 |
| shield.png | щит, броня | 28×28 | 112×112 |
| bar.png | рамка полоски здоровья (середина пустая и тёмная, заливку рисует игра) | 220×22 | 880×88 |
| wave.png | череп зомби, номер волны | 26×26 | 104×104 |
| kills.png | череп с костями, убито | 26×26 | 104×104 |
| score.png | звезда, очки | 26×26 | 104×104 |
| sun.png | солнце, день | 26×26 | 104×104 |
| moon.png | месяц, ночь | 26×26 | 104×104 |
| grenade.png | граната | 22×26 | 88×104 |
| medkit.png | аптечка | 26×24 | 104×96 |
| chat.png | облачко чата | 28×26 | 112×104 |
| pause.png | пауза | 24×24 | 96×96 |
| play.png | продолжить | 24×24 | 96×96 |
| bag.png | рюкзак, снаряжение | 28×28 | 112×112 |
| bullet_rifle.png | патрон автомата, вертикально, пулей вверх | 6×18 | 24×72 |
| bullet_pistol.png | патрон пистолета, вертикально | 7×14 | 28×56 |
| shell.png | патрон дробовика, вертикально | 10×18 | 40×72 |

## Подсказка для ChatGPT

Общее начало, одно для всех картинок, чтобы стиль совпал:

> Game UI icon for a top-down zombie survival game. Chunky hand-painted cartoon style, thick dark brown outline (#14110d), warm saturated colors, soft top-left highlight, no text, centered, single object, transparent background, PNG.

Дальше добавь одну строку под нужную картинку:

- heart: `A glossy red heart, health icon. Square 1:1.`
- shield: `A blue steel shield with a vertical seam, armor icon. Square 1:1.`
- bar: `An empty horizontal health bar frame, brass/gold rim, very dark inside, rounded ends, wide 10:1 ratio.`
- wave: `A pale green zombie skull with glowing red eyes, front view. Square 1:1.`
- kills: `A bone-white skull over crossed bones. Square 1:1.`
- score: `A gold five-pointed star with a shine. Square 1:1.`
- sun: `A small bright yellow sun with short rays. Square 1:1.`
- moon: `A pale blue crescent moon with craters. Square 1:1.`
- grenade: `An olive green hand grenade with a ring pin, upright. Portrait 0.85:1.`
- medkit: `A white first-aid box with a red cross and a handle. Square 1:1.`
- chat: `A cream speech bubble with three dots. Square 1:1.`
- pause: `Two cream vertical pause bars. Square 1:1.`
- play: `A cream play triangle pointing right. Square 1:1.`
- bag: `A brown leather backpack, front view. Square 1:1.`
- bullet_rifle: `A single rifle cartridge standing upright, copper tip, brass case. Tall 1:3.`
- bullet_pistol: `A single short pistol cartridge standing upright, grey tip, brass case. Tall 1:2.`
- shell: `A single red shotgun shell standing upright, brass base. Tall 1:1.8.`

Если ChatGPT вернёт картинку не того размера, её можно просто уменьшить. Главное — пропорции и прозрачный фон.
