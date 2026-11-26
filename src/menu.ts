// Главный экран: выбор режима, игра с другом, настройки, «как играть». Обычный HTML поверх игры
// (за ним видно живой мир). Настройки хранятся в localStorage.
import { LANGS, deviceLang, setLang, getLang, t, type Lang, type Key } from "./i18n";
import { loadStory, CHAPTERS, unlockedChapters } from "./story";
import { fetchTop, fmtTime, submitScore, localBest, type Result } from "./scores";

export type Quality = "low" | "med" | "high";
export type DayNight = "cycle" | "day" | "night";
const KEY = "myzombika-settings";
declare const __VERSION__: string, __BUILT__: string;
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia("(pointer: coarse)").matches);

export const settings = {
  lang: deviceLang() as Lang,
  name: "",
  volume: 0.9,
  mute: false,
  quality: (mobile ? "med" : "high") as Quality,
  daynight: "cycle" as DayNight,
  shake: true,
  aim: true,
  fs: true,
  /** сюжет: сколько ботов-напарников (0–3) */
  bots: 2,
  save() {
    const { save: _s, ...data } = settings; void _s;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* нет хранилища */ }
  },
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* испорчено — по умолчанию */ }
if (!(settings.lang in LANGS)) settings.lang = deviceLang();
setLang(settings.lang);

export interface MenuActions { waves(): void; story?(fresh: boolean, ch?: number): void; host(): void; join(code: string): void; changed(): void; again?(): void; menu?(): void }

let root: HTMLDivElement | null = null;
let page: "main" | "coop" | "settings" | "howto" | "top" | "over" | "story" | "done" | "pause" = "main";
/** куда ведёт «Назад» из настроек и «как играть» (из главного меню или из паузы) */
let ret: "main" | "pause" = "main";
let acts: MenuActions | null = null;
let joinCode = "";

export const menuOpen = () => !!root && root.style.display !== "none";

const CSS = `
.mz{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;overflow:auto;padding:16px;box-sizing:border-box;
 background:radial-gradient(ellipse at center,rgba(8,14,6,.15) 0%,rgba(8,14,6,.45) 55%,rgba(6,10,4,.85) 100%);font:15px Rubik,"Segoe UI",Roboto,"Noto Sans",system-ui,sans-serif;color:#f4ead0;cursor:default;-webkit-user-select:none;user-select:none;touch-action:manipulation}
.mz *{box-sizing:border-box}
.mz .box{width:min(560px,100%);margin:auto}
.mz .logo{display:block;width:min(560px,100%);margin:0 auto -4px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.7));animation:mzFloat 5s ease-in-out infinite;pointer-events:none}
@keyframes mzFloat{0%,100%{transform:translateY(0) rotate(-.4deg)}50%{transform:translateY(-5px) rotate(.4deg)}}
.mz .sub{display:flex;align-items:center;gap:14px;justify-content:center;color:#f6e6b8;margin:0 0 16px;font-size:clamp(16px,2.6vw,22px);font-weight:700;text-shadow:0 2px 0 #1a1208,0 3px 10px rgba(0,0,0,.8)}
.mz .sub:before,.mz .sub:after{content:"";flex:0 1 90px;height:2px;background:linear-gradient(90deg,transparent,#e0b060);border-radius:2px}
.mz .sub:after{background:linear-gradient(270deg,transparent,#e0b060)}
.mz h2{display:flex;align-items:center;gap:12px;justify-content:center;margin:2px 0 14px;font-size:22px;font-weight:800;color:#f6d488;text-shadow:0 2px 0 #1a1208}
.mz h2:before,.mz h2:after{content:"";flex:1;height:2px;background:linear-gradient(90deg,transparent,rgba(224,176,96,.8))}.mz h2:after{background:linear-gradient(270deg,transparent,rgba(224,176,96,.8))}
/* кнопки — металлические таблички: бронзовая рамка со срезанными углами, заклёпки, царапины */
.mz .btn{--cut:12px;--plate:linear-gradient(180deg,#36584a 0%,#25443a 48%,#1b3229 100%);--rim:linear-gradient(180deg,#e2b46a,#9a6a30 55%,#6a4418);
 position:relative;display:block;width:100%;margin:0 0 12px;padding:0;border:0;background:none;color:#f8eed4;font:inherit;font-size:19px;font-weight:800;text-align:left;cursor:pointer;
 filter:drop-shadow(0 4px 0 rgba(10,8,4,.55)) drop-shadow(0 6px 10px rgba(0,0,0,.55));transition:transform .12s ease,filter .15s ease;-webkit-tap-highlight-color:transparent}
.mz .btn .pl{position:relative;display:flex;align-items:center;gap:14px;min-height:54px;padding:10px 34px 10px 30px;background:var(--rim);
 clip-path:polygon(var(--cut) 0,calc(100% - var(--cut)) 0,100% var(--cut),100% calc(100% - var(--cut)),calc(100% - var(--cut)) 100%,var(--cut) 100%,0 calc(100% - var(--cut)),0 var(--cut))}
.mz .btn .pl:before{content:"";position:absolute;inset:3px;z-index:0;background:repeating-linear-gradient(112deg,rgba(255,255,255,.035) 0 1px,transparent 1px 7px),radial-gradient(ellipse at 30% 0%,rgba(255,255,255,.16),transparent 60%),var(--plate);
 clip-path:polygon(calc(var(--cut) - 1px) 0,calc(100% - var(--cut) + 1px) 0,100% calc(var(--cut) - 1px),100% calc(100% - var(--cut) + 1px),calc(100% - var(--cut) + 1px) 100%,calc(var(--cut) - 1px) 100%,0 calc(100% - var(--cut) + 1px),0 calc(var(--cut) - 1px));box-shadow:inset 0 2px 0 rgba(255,255,255,.18),inset 0 -3px 0 rgba(0,0,0,.35)}
.mz .btn .pl:after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;
 background:radial-gradient(circle at 15px 50%,#f2c880 0 2.2px,#5a3a14 3px,rgba(0,0,0,.35) 4px,transparent 5px),radial-gradient(circle at calc(100% - 15px) 50%,#f2c880 0 2.2px,#5a3a14 3px,rgba(0,0,0,.35) 4px,transparent 5px)}
.mz .btn .pl>*{position:relative;z-index:2}
.mz .btn .ic{flex:none;width:30px;height:30px;color:#f0c070;filter:drop-shadow(0 2px 0 rgba(0,0,0,.6))}.mz .btn .ic svg{display:block;width:100%;height:100%}
.mz .btn .sep{flex:none;width:2px;align-self:stretch;margin:4px 0;background:linear-gradient(180deg,transparent,rgba(240,192,112,.75),transparent)}
.mz .btn .tx{flex:1;min-width:0;text-shadow:0 2px 0 rgba(0,0,0,.55)}
.mz .btn small{display:block;font-size:13px;font-weight:500;color:#e8dcc0;margin-top:2px;text-shadow:0 1px 0 rgba(0,0,0,.6)}
.mz .btn:hover,.mz .btn:focus-visible{transform:translateY(-2px);outline:none;filter:drop-shadow(0 6px 0 rgba(10,8,4,.5)) drop-shadow(0 0 12px rgba(255,200,110,.45)) drop-shadow(0 8px 12px rgba(0,0,0,.5))}
.mz .btn:hover .pl:before,.mz .btn:focus-visible .pl:before{filter:brightness(1.18) saturate(1.1)}
.mz .btn:active{transform:translateY(2px);filter:drop-shadow(0 1px 0 rgba(10,8,4,.6)) drop-shadow(0 3px 6px rgba(0,0,0,.5))}
.mz .btn.main{--plate:linear-gradient(180deg,#e08a2c 0%,#c06418 45%,#8a3e0c 100%);--rim:linear-gradient(180deg,#ffe0a0,#e0962c 50%,#8a4a10);animation:mzGlow 2.4s ease-in-out infinite}
.mz .btn.main .ic{color:#fff0d0}
@keyframes mzGlow{0%,100%{filter:drop-shadow(0 4px 0 rgba(10,8,4,.55)) drop-shadow(0 0 8px rgba(255,160,50,.45))}50%{filter:drop-shadow(0 4px 0 rgba(10,8,4,.55)) drop-shadow(0 0 18px rgba(255,170,60,.85))}}
.mz .btn.main:hover{animation:none}
.mz .btn.big{font-size:clamp(24px,4.4vw,34px);margin-bottom:14px}
.mz .btn.big .pl{min-height:84px;padding:12px 40px 12px 34px;gap:16px}
.mz .btn.big .ic{width:62px;height:62px;padding:12px;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(255,255,255,.12),rgba(0,0,0,.4) 70%);box-shadow:inset 0 0 0 2px rgba(240,192,112,.6),0 2px 4px rgba(0,0,0,.4)}
.mz .btn.big small{font-size:clamp(12px,1.9vw,15px)}
.mz .btn[disabled]{opacity:.55;cursor:default;transform:none}
.mz .btn .tag{float:right;font-size:12px;font-weight:700;color:#14110d;background:#e0c690;border-radius:6px;padding:2px 6px;margin-top:3px}
.mz[dir=rtl] .btn{text-align:right}.mz[dir=rtl] .btn .tag{float:left}
.mz .row2,.mz .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.mz .row2 .btn .pl,.mz .grid .btn .pl{justify-content:center;padding:9px 28px}.mz .row2 .btn .tx,.mz .grid .btn .tx{flex:0 1 auto}
.mz .grid .btn{font-size:17px}.mz .grid .btn .pl{min-height:50px}
.mz .join .btn .pl{padding:8px 26px}.mz .join .btn .ic{width:20px;height:20px}
/* окна — тёмно-зелёная табличка в бронзовой раме с заклёпками по углам */
.mz .card{position:relative;padding:18px 20px 8px;border-radius:14px;border:3px solid #b8853e;
 background:radial-gradient(circle at 12px 12px,#f2c880 0 2.4px,#4a2e10 3.4px,transparent 4.4px),radial-gradient(circle at calc(100% - 12px) 12px,#f2c880 0 2.4px,#4a2e10 3.4px,transparent 4.4px),
 radial-gradient(circle at 12px calc(100% - 12px),#f2c880 0 2.4px,#4a2e10 3.4px,transparent 4.4px),radial-gradient(circle at calc(100% - 12px) calc(100% - 12px),#f2c880 0 2.4px,#4a2e10 3.4px,transparent 4.4px),
 repeating-linear-gradient(112deg,rgba(255,255,255,.025) 0 1px,transparent 1px 8px),linear-gradient(180deg,rgba(40,66,54,.96),rgba(22,40,32,.97));
 box-shadow:0 0 0 2px #3a2610,inset 0 0 0 2px rgba(0,0,0,.35),inset 0 2px 0 3px rgba(255,255,255,.06),0 10px 30px rgba(0,0,0,.6)}
.mz label.f{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 2px;border-bottom:1px solid rgba(224,176,96,.18);font-weight:600}
.mz label.f:last-of-type{border-bottom:0}
.mz select,.mz input[type=text]{font:inherit;font-weight:600;color:#f8eed4;background:#14231c;border:2px solid #8a6430;border-radius:9px;padding:7px 10px;min-width:0;max-width:60%;box-shadow:inset 0 2px 4px rgba(0,0,0,.5)}
.mz select:focus,.mz input[type=text]:focus{outline:none;border-color:#f0c070}
.mz input[type=text]{width:100%;max-width:none}
.mz input[type=range]{width:50%;accent-color:#e0a040}
.mz input[type=checkbox]{width:22px;height:22px;accent-color:#e0a040}
.mz .join{display:flex;gap:8px;margin-bottom:12px}.mz .join input{flex:1}.mz .join .btn{width:auto;margin:0}
.mz p{margin:0 0 10px;line-height:1.5;color:#eadfc4}
.mz .squad{display:flex;align-items:center;gap:6px;margin:6px 0 8px}.mz .squad span{flex:1;font-weight:800;color:#f6d488}
.mz .squad button{font:inherit;font-weight:800;color:#f8eed4;background:linear-gradient(180deg,#36584a,#1b3229);border:2px solid #9a6a30;border-radius:8px;padding:6px 11px;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.5);transition:transform .1s}
.mz .squad button:hover:not(:disabled){transform:translateY(-1px);border-color:#f0c070}
.mz .chs{flex-wrap:wrap}.mz .chs span{flex-basis:100%}.mz .squad button:disabled{opacity:.4;cursor:default}
.mz .squad button.on{background:linear-gradient(180deg,#e08a2c,#8a3e0c);border-color:#ffe0a0;color:#fff4dc}
.mz p.note{font-size:12.5px;color:#c8bc9c}
.mz.dead{background:radial-gradient(ellipse at center,rgba(60,6,4,.4) 0%,rgba(16,4,3,.88) 75%)}
.mz .over{text-align:center}
.mz .over .skull{width:64px;height:64px;margin:0 auto 4px;color:#e04a30;filter:drop-shadow(0 3px 8px rgba(0,0,0,.7))}
.mz .over h1{margin:0;font-weight:900;color:#ff7a5a;text-shadow:0 3px 0 #3a0a06,0 6px 18px rgba(0,0,0,.8);font-size:clamp(34px,7vw,52px)}
.mz .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0 12px}
.mz .stat{position:relative;border-radius:10px;border:2px solid #9a6a30;padding:9px 4px 8px;background:radial-gradient(ellipse at 30% 0%,rgba(255,255,255,.12),transparent 60%),linear-gradient(180deg,#30524a,#1b3229);box-shadow:0 0 0 1px #2a1a08,0 4px 0 rgba(0,0,0,.45),inset 0 2px 0 rgba(255,255,255,.1)}
.mz .stat i{display:block;width:22px;height:22px;margin:0 auto 2px;color:#f0c070}.mz .stat i svg{width:100%;height:100%;display:block}
.mz .stat b{display:block;font-size:24px;font-weight:900;color:#fff0c8;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.5)}
.mz .stat span{font-size:12px;font-weight:600;color:#d8cba8}
.mz .stat.hi{border-color:#ffd080;background:radial-gradient(ellipse at 30% 0%,rgba(255,255,255,.2),transparent 60%),linear-gradient(180deg,#d07a24,#8a3e0c)}
.mz .rec{margin:0 0 6px;color:#d8cba8}.mz .rec.new{color:#c8f070;font-weight:800;font-size:18px}
.mz .lb{min-height:22px;margin:0 0 12px;color:#eadfc4}.mz .lb b{color:#f6d488}
.mz .lbn{display:flex;gap:8px;margin:0 0 12px}.mz .lbn input{flex:1}.mz .lbn .btn{width:auto;margin:0}
.mz table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.mz th{font-size:12px;font-weight:700;color:#d8b878;text-align:right;padding:4px 6px}.mz th:nth-child(2),.mz td:nth-child(2){text-align:left}
.mz td{padding:6px;text-align:right;border-top:1px solid rgba(224,176,96,.15)}
.mz td:first-child{color:#c8bc9c;width:2.5em}.mz td:nth-child(2){max-width:9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mz tr.me td{color:#fff0c8;background:rgba(224,140,40,.22)}.mz tr.g1 td:first-child{color:#ffd24a;font-weight:800}
.mz .tbl{max-height:min(52vh,420px);overflow:auto;margin:0 0 12px}
.mz .ver{text-align:center;color:rgba(240,228,200,.55);font-size:12px;margin-top:6px;text-shadow:0 1px 2px #000}
@media (max-width:520px){.mz{padding:12px}.mz .grid,.mz .row2{gap:0 8px}.mz .grid .btn .pl,.mz .row2 .btn .pl{padding:8px 18px;gap:8px;--cut:9px}.mz .grid .btn .sep,.mz .row2 .btn .sep{display:none}.mz .grid .btn .ic{width:22px;height:22px}.mz .grid .btn .tx{text-align:center;line-height:1.15}.mz .btn .pl:after{background:radial-gradient(circle at 10px 50%,#f2c880 0 1.8px,#5a3a14 2.6px,transparent 3.6px),radial-gradient(circle at calc(100% - 10px) 50%,#f2c880 0 1.8px,#5a3a14 2.6px,transparent 3.6px)}.mz .sub{white-space:nowrap;gap:8px}.mz .sub:before,.mz .sub:after{flex-basis:30px}.mz .btn.big .pl{min-height:70px;padding:10px 30px 10px 26px}.mz .btn.big .ic{width:48px;height:48px;padding:9px}.mz .grid .btn{font-size:15px}.mz .stats{grid-template-columns:repeat(2,1fr)}.mz .over.win .stats{grid-template-columns:repeat(2,1fr)}}
@media (max-height:520px){.mz .over .skull{display:none}.mz .over h1{font-size:34px}.mz .stats{margin:8px 0 6px}.mz .stat b{font-size:20px}.mz .stat i{display:none}.mz .tbl{max-height:46vh}
 .mz .logo{width:min(360px,70%)}.mz .sub{margin-bottom:8px;font-size:15px}.mz .btn{margin-bottom:8px}.mz .btn small{display:none}.mz .btn.big .pl{min-height:58px}.mz .btn.big .ic{width:42px;height:42px;padding:8px}
 .mz .box.wide{width:min(760px,100%)}}
.mz.paused{background:radial-gradient(ellipse at center,rgba(4,8,4,.45) 0%,rgba(4,8,4,.8) 100%)}
.mz .card.pz{padding-bottom:6px}.mz .card.pz .hint{text-align:center;margin:-6px 0 12px}.mz .card.pz .btn.main{font-size:22px}.mz .card.pz .btn.main .pl{justify-content:center;min-height:58px}
.mz .card.pz .row2 .btn{font-size:15px}.mz .card.pz>.btn:last-child .pl{justify-content:center}
.mz .over.win h1{color:#c8f070;text-shadow:0 3px 0 #1a3a0a,0 6px 18px rgba(0,0,0,.8);font-size:clamp(44px,9vw,68px)}
.mz .over.win .sub{margin:0 0 6px;font-size:15px}.mz .over.win .sub:before,.mz .over.win .sub:after{flex-basis:60px}
.mz .over.win .stats{grid-template-columns:repeat(4,1fr)}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}
// пиктограммы пунктов меню (линии 24×24, цвет — от кнопки)
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const LOGO = Object.values(import.meta.glob("./menuArt/logo.png", { eager: true, import: "default" }) as Record<string, string>)[0];
const ICON = {
  // прицел: меткость
  aim: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/>'),
  // шестерёнка: детали
  parts: svg('<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>'),
  // взрыв: урон
  dmg: svg('<path fill="currentColor" stroke="none" d="M12 1l2.2 6.3L20.5 4l-3 6 5.5 2-5.5 2 3 6-6.3-3.3L12 23l-2.2-6.3L3.5 20l3-6L1 12l5.5-2-3-6 6.3 3.3z"/>'),
  // череп: волны зомби
  waves: svg('<path d="M12 3c-4.4 0-8 3.1-8 7.2 0 2.4 1.2 4.3 3 5.5V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3.3c1.8-1.2 3-3.1 3-5.5C20 6.1 16.4 3 12 3z"/><circle cx="9" cy="11" r="1.6" fill="currentColor"/><circle cx="15" cy="11" r="1.6" fill="currentColor"/><path d="M10 20v-2.5M14 20v-2.5M12 14.5l-.8 1.5h1.6z"/>'),
  // карта с маршрутом: сюжет
  story: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  // двое: игра с другом
  coop: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.1c2.6.3 4.5 2.6 4.5 5.4"/>'),
  // шестерёнка: настройки
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  // вопрос в круге: как играть
  howto: svg('<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/>'),
  // плюс: создать игру
  create: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  // вход в дверь: войти к другу
  join: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l4-4-4-4M14 12H4"/>'),
  // кубок: топ игроков
  top: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z"/>'),
  // круговая стрелка: ещё раз
  again: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>'),
  // домик: главное меню
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5M10 20v-5h4v5"/>'),
  // часы
  time: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  // мишень: убито
  kills: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  // звезда: очки
  score: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  // стрелка назад
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
};
type Icon = keyof typeof ICON;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render() {
  if (!root || !acts) return;
  const a = acts;
  root.dir = getLang() === "ar" ? "rtl" : "ltr";
  root.innerHTML = "";
  const box = el("div", { class: "box" + (page === "main" || page === "top" ? " wide" : "") });
  root.appendChild(box);
  const btn = (html: string, fn: () => void, cls = "", ic?: Icon) => {
    const b = el("button", { class: "btn " + cls, type: "button" }, `<span class="pl">${ic ? `<i class="ic">${ICON[ic]}</i><span class="sep"></span>` : ""}<span class="tx">${html}</span></span>`);
    b.onclick = fn; return b;
  };
  if (page === "main") {
    ret = "main";
    box.append(el("img", { class: "logo", src: LOGO, alt: "MyZombika", draggable: "false" }), el("div", { class: "sub" }, esc(t("subtitle"))));
    if (joinCode) box.appendChild(btn(`${esc(t("m_join_friend", { c: joinCode }))}`, () => a.join(joinCode), "main big", "join"));
    box.appendChild(btn(`${esc(t("m_waves"))}<small>${esc(t("m_waves_d"))}</small>`, () => a.waves(), joinCode ? "big" : "main big", "waves"));
    box.appendChild(btn(`${esc(t("m_story"))}<small>${esc(t("m_story_d"))}</small>`, () => { page = "story"; render(); }, "big", "story"));
    const g = el("div", { class: "grid" });
    box.appendChild(g);
    g.appendChild(btn(esc(t("m_coop")), () => { page = "coop"; render(); }, "", "coop"));
    g.appendChild(btn(esc(t("m_top")), () => { back = "main"; page = "top"; render(); }, "", "top"));
    g.appendChild(btn(esc(t("m_settings")), () => { page = "settings"; render(); }, "", "settings"));
    g.appendChild(btn(esc(t("m_howto")), () => { page = "howto"; render(); }, "", "howto"));
  } else if (page === "story") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_story"))));
    box.appendChild(c);
    const sv = loadStory();
    if (sv && (sv.camp > 0 || sv.ch > 1)) c.appendChild(btn(`${esc(t("st_continue", { n: sv.camp, c: sv.ch }))}<small>${esc(t("st_chn", { n: sv.ch, name: t(`st_th_${CHAPTERS[Math.min(CHAPTERS.length, Math.max(1, sv.ch)) - 1].theme}` as Key) }))}</small>`, () => a.story?.(false), "main", "story"));
    c.appendChild(btn(`${esc(t("st_new"))}<small>${esc(t("st_new_d"))}</small>`, () => a.story?.(true), sv && (sv.camp > 0 || sv.ch > 1) ? "" : "main", "story"));
    // любая пройденная глава — сразу (открытые — по самой дальней, куда дошёл)
    const open = unlockedChapters();
    if (open > 1) {
      const row = el("div", { class: "squad chs" });
      row.appendChild(el("span", {}, esc(t("st_pick"))));
      CHAPTERS.forEach((ch, i) => {
        const name = t("st_chn", { n: i + 1, name: t(`st_th_${ch.theme}` as Key) });
        const b = el("button", { title: name, ...(i + 1 > open ? { disabled: "" } : {}) }, i + 1 > open ? "🔒" : String(i + 1)) as HTMLButtonElement;
        if (i + 1 <= open) b.onclick = () => a.story?.(true, i);
        row.appendChild(b);
      });
      c.appendChild(row);
    }
    // отряд: боты вместо недостающих игроков
    const sq = el("div", { class: "squad" });
    sq.appendChild(el("span", {}, esc(t("st_squad"))));
    [0, 1, 2, 3].forEach((n) => {
      const b = el("button", { class: settings.bots === n ? "on" : "" }, n === 0 ? esc(t("st_solo")) : `+${n}`) as HTMLButtonElement;
      b.onclick = () => { settings.bots = n; settings.save(); render(); };
      sq.appendChild(b);
    });
    c.appendChild(sq);
    c.appendChild(el("p", { class: "note" }, esc(t("st_squad_d"))));
    c.appendChild(btn(esc(t("m_back")), () => { page = "main"; render(); }, "", "back"));
  } else if (page === "coop") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_coop"))));
    c.appendChild(btn(esc(t("m_create")), () => a.host(), "main", "create"));
    const j = el("div", { class: "join" });
    const inp = el("input", { type: "text", placeholder: t("m_code_ph"), maxlength: "200", autocomplete: "off", autocapitalize: "characters" }) as HTMLInputElement;
    inp.value = joinCode;
    const go = () => { const v = inp.value.trim(); if (v) a.join(v); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") go(); };
    j.append(inp, btn(esc(t("m_join")), go, "", "join"));
    c.appendChild(j);
    c.appendChild(btn(esc(t("m_back")), () => { page = "main"; render(); }, "", "back"));
    box.appendChild(c);
  } else if (page === "settings") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_settings"))));
    const field = (label: string, input: HTMLElement) => { const l = el("label", { class: "f" }); l.append(el("span", {}, esc(label)), input); c.appendChild(l); return input; };
    const sel = (opts: [string, string][], val: string, on: (v: string) => void) => {
      const s = el("select") as HTMLSelectElement;
      for (const [v, n] of opts) { const o = el("option", { value: v }, esc(n)) as HTMLOptionElement; if (v === val) o.selected = true; s.appendChild(o); }
      s.onchange = () => { on(s.value); settings.save(); a.changed(); };
      return s;
    };
    const chk = (val: boolean, on: (v: boolean) => void) => { const i = el("input", { type: "checkbox" }) as HTMLInputElement; i.checked = val; i.onchange = () => { on(i.checked); settings.save(); a.changed(); }; return i; };
    const name = el("input", { type: "text", maxlength: "16", placeholder: `${t("player")} 1` }) as HTMLInputElement;
    name.value = settings.name;
    name.onkeydown = (e) => e.stopPropagation();
    name.oninput = () => { settings.name = name.value.replace(/[<>]/g, "").slice(0, 16); settings.save(); a.changed(); };
    field(t("s_name"), name);
    field(t("s_lang"), sel(Object.entries(LANGS), settings.lang, (v) => { settings.lang = v as Lang; setLang(settings.lang); settings.save(); a.changed(); render(); }));
    field(t("s_sound"), chk(!settings.mute, (v) => (settings.mute = !v)));
    const vol = el("input", { type: "range", min: "0", max: "1", step: "0.05" }) as HTMLInputElement;
    vol.value = String(settings.volume);
    vol.oninput = () => { settings.volume = Number(vol.value); settings.save(); a.changed(); };
    field(t("s_volume"), vol);
    field(t("s_quality"), sel([["low", t("q_low")], ["med", t("q_med")], ["high", t("q_high")]], settings.quality, (v) => (settings.quality = v as Quality)));
    field(t("s_daynight"), sel([["cycle", t("dn_cycle")], ["day", t("dn_day")], ["night", t("dn_night")]], settings.daynight, (v) => (settings.daynight = v as DayNight)));
    field(t("s_shake"), chk(settings.shake, (v) => (settings.shake = v)));
    field(t("s_aim"), chk(settings.aim, (v) => (settings.aim = v)));
    if (mobile) field(t("s_fs"), chk(settings.fs, (v) => (settings.fs = v)));
    const back = btn(esc(t("m_back")), () => { page = ret; render(); }, "", "back");
    back.style.marginTop = "12px";
    c.appendChild(back);
    box.appendChild(c);
  } else if (page === "top") {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_top"))));
    const tb = el("div", { class: "tbl" }, `<p>${esc(t("lb_loading"))}</p>`);
    c.appendChild(tb);
    const me = (settings.name || "").toLowerCase();
    fetchTop().then(({ top }) => {
      if (!top.length) { tb.innerHTML = `<p>${esc(t("top_empty"))}</p>`; return; }
      tb.innerHTML = `<table><tr><th>#</th><th>${esc(t("player"))}</th><th>${esc(t("score"))}</th><th>${esc(t("wave"))}</th><th>${esc(t("killed"))}</th><th>${esc(t("st_time"))}</th></tr>${top.map((r, i) =>
        `<tr class="${r.name.toLowerCase() === me ? "me" : ""}${i < 3 ? " g1" : ""}"><td>${i + 1}</td><td>${esc(r.name)}${r.co > 1 ? " 👥" : ""}</td><td>${r.score}</td><td>${r.wave}</td><td>${r.kills}</td><td>${fmtTime(r.time)}</td></tr>`).join("")}</table>`;
    }).catch(() => { tb.innerHTML = `<p>${esc(t("lb_off"))}</p>`; });
    c.appendChild(btn(esc(t("m_back")), () => { page = back; render(); }, "", "back"));
    box.appendChild(c);
  } else if (page === "pause" && pz) {
    // пауза: те же таблички — продолжить, позвать друга, настройки, как играть, в главное меню
    const z = pz, c = el("div", { class: "card pz" });
    c.appendChild(el("h2", {}, esc(t("pause"))));
    if (!mobile) c.appendChild(el("p", { class: "note hint" }, esc(t("p_hint"))));
    c.appendChild(btn(esc(t("p_resume")), () => z.resume(), "main", "again"));
    if (z.role !== "client") {
      const row = el("div", { class: "row2" });
      if (z.role === "host") row.append(btn(esc(t("copy_code", { c: z.code })), () => z.copyCode(), "", "join"), btn(esc(t("copy_link")), () => z.copyLink(), "", "coop"));
      else row.append(btn(esc(t("invite").replace(/\s*\(.\)$/, "")), () => z.invite(), "", "coop"), btn(esc(t("join_code").replace(/\s*\(.\)$/, "")), () => z.join(), "", "join"));
      c.appendChild(row);
    }
    const row2 = el("div", { class: "row2" });
    row2.append(btn(esc(t("m_settings")), () => { ret = "pause"; page = "settings"; render(); }, "", "settings"), btn(esc(t("m_howto")), () => { ret = "pause"; page = "howto"; render(); }, "", "howto"));
    c.appendChild(row2);
    c.appendChild(btn(esc(t("main_menu")), () => z.menu(), "", "home"));
    box.appendChild(c);
  } else if (page === "done" && done) {
    // глава пройдена: «Выжили!», мелко — какая глава, итоги, кнопка дальше
    const d = done, s = d.stats, c = el("div", { class: "over win" });
    c.appendChild(el("h1", {}, esc(d.title)));
    c.appendChild(el("div", { class: "sub" }, esc(d.sub)));
    const st = el("div", { class: "stats" });
    const tile = (ic: keyof typeof ICON, v: string, l: string, hi = false) => st.appendChild(el("div", { class: "stat" + (hi ? " hi" : "") }, `<i>${ICON[ic]}</i><b>${esc(v)}</b><span>${esc(l)}</span>`));
    tile("kills", String(s.kills), t("rs_kills"), true);
    tile("dmg", String(Math.round(s.dmg * 10)), t("rs_dmg"));
    tile("aim", s.shots ? `${Math.min(100, Math.round((s.hits / s.shots) * 100))}%` : "—", t("rs_acc"));
    tile("time", fmtTime(Math.round(s.time)), t("rs_time"));
    tile("score", `+${s.xp}`, t("rs_xp"));
    tile("parts", `+${s.parts}`, t("rs_parts"));
    tile("waves", String(s.deaths), t("rs_deaths"));
    c.appendChild(st);
    const go = btn(esc(d.last ? t("main_menu") : t("st_go_on")), () => d.go(), "main", d.last ? "home" : "story");
    go.style.textAlign = "center"; go.style.marginTop = "6px";
    if (d.client && !d.last) { go.setAttribute("disabled", ""); go.querySelector(".tx")!.innerHTML += `<small>${esc(t("st_host_go"))}</small>`; }
    c.appendChild(go);
    box.appendChild(c);
    setTimeout(() => go.focus(), 50);
  } else if (page === "over" && over) {
    const o = over, c = el("div", { class: "over" });
    c.appendChild(el("div", { class: "skull" }, ICON.waves));
    c.appendChild(el("h1", {}, esc(t("over_title"))));
    const st = el("div", { class: "stats" });
    const tile = (ic: keyof typeof ICON, v: string, l: string, hi = false) => st.appendChild(el("div", { class: "stat" + (hi ? " hi" : "") }, `<i>${ICON[ic]}</i><b>${esc(v)}</b><span>${esc(l)}</span>`));
    tile("waves", String(o.r.wave), t("wave")); tile("kills", String(o.r.kills), t("killed")); tile("time", fmtTime(o.r.time), t("st_time")); tile("score", String(o.r.score), t("score"), true);
    c.appendChild(st);
    c.appendChild(el("p", { class: "rec" + (o.newBest ? " new" : "") }, esc(o.newBest ? t("new_best") : o.best > 0 ? t("st_best", { n: o.best }) : "")));
    const lb = el("p", { class: "lb" }, esc(o.lb));
    c.appendChild(lb);
    if (o.ask) {
      // имени ещё нет — спрашиваем, под каким именем записать в топ
      const f = el("div", { class: "lbn" });
      const inp = el("input", { type: "text", maxlength: "16", placeholder: t("lb_name") }) as HTMLInputElement;
      const go = () => { const v = inp.value.replace(/[<>]/g, "").trim().slice(0, 16); if (!v) { inp.focus(); return; } settings.name = v; settings.save(); a.changed(); o.ask = false; sendScore(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") go(); };
      f.append(inp, btn(esc(t("lb_send")), go, "", "top"));
      c.appendChild(f);
    }
    const row = el("div", { class: "row2" });
    const again = btn(esc(t("over_again")), () => a.again?.(), "main", "again");
    if (o.client) { again.setAttribute("disabled", ""); again.querySelector(".tx")!.innerHTML += `<small>${esc(t("host_decides").replace(/[()]/g, "").trim())}</small>`; }
    row.append(again, btn(esc(t("main_menu")), () => a.menu?.(), "", "home"));
    c.appendChild(row);
    c.appendChild(btn(esc(t("m_top")), () => { back = "over"; page = "top"; render(); }, "", "top"));
    box.appendChild(c);
  } else {
    const c = el("div", { class: "card" });
    c.appendChild(el("h2", {}, esc(t("m_howto"))));
    for (const k of (mobile ? ["howto_touch", "howto_items"] : ["howto_pc", "howto_touch", "howto_items"]) as ("howto_pc" | "howto_touch" | "howto_items")[]) c.appendChild(el("p", {}, esc(t(k))));
    c.appendChild(btn(esc(t("m_back")), () => { page = ret; render(); }, "", "back"));
    box.appendChild(c);
  }
  box.appendChild(el("div", { class: "ver" }, `v${__VERSION__} · ${__BUILT__} · myzombika.pion.ltd`));
}

function ensureRoot() {
  if (!root) {
    document.head.appendChild(el("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Rubik:wght@500;600;700;800;900&display=swap" }));
    document.head.appendChild(el("style", {}, CSS));
    root = el("div", { class: "mz" }) as HTMLDivElement;
    // клики по меню не должны доходить до игры
    for (const ev of ["pointerdown", "mousedown", "touchstart", "wheel", "contextmenu"]) root.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(root);
  }
  root.style.display = "flex";
}
export function openMenu(actions: MenuActions, code = "") {
  acts = actions; joinCode = code; page = "main";
  ensureRoot(); root!.classList.remove("dead");
  render();
}

// ───────── экран смерти ─────────
let back: "main" | "over" = "main";
let over: { r: Result; best: number; newBest: boolean; lb: string; ask: boolean; client: boolean; sent: boolean } | null = null;
function sendScore() {
  const o = over;
  if (!o || o.sent || o.ask) return;
  if (o.r.score <= 0) { o.lb = ""; return; }
  o.sent = true; o.lb = t("lb_sending"); if (page === "over") render();
  submitScore(settings.name, o.r).then(
    (res) => { if (over === o) { o.lb = t("lb_place", { p: res.place, n: res.total }); if (page === "over") render(); } },
    () => { if (over === o) { o.lb = t("lb_off"); if (page === "over") render(); } });
}
/** показать экран смерти; again — начать заново (у гостя кнопка неактивна), menu — в главное меню */
export function openOver(actions: MenuActions, r: Result, client: boolean) {
  acts = actions; page = "over"; back = "main";
  const old = localBest(r.score);
  over = { r, best: Math.max(old, r.score), newBest: r.score > old && old > 0, lb: "", ask: !settings.name && r.score > 0, client, sent: false };
  sendScore();
  ensureRoot(); root!.classList.add("dead");
  render();
}
// ───────── пауза ─────────
export interface PauseInfo { role: "solo" | "host" | "client"; code: string; resume(): void; menu(): void; invite(): void; join(): void; copyCode(): void; copyLink(): void }
let pz: PauseInfo | null = null;
export function openPause(actions: MenuActions, info: PauseInfo) {
  acts = actions; pz = info; page = "pause"; ret = "pause";
  ensureRoot(); root!.classList.remove("dead"); root!.classList.add("paused");
  render();
}
// ───────── глава пройдена ─────────
export interface DoneInfo { title: string; sub: string; stats: { kills: number; dmg: number; shots: number; hits: number; time: number; xp: number; parts: number; deaths: number }; last: boolean; client: boolean; go(): void }
let done: DoneInfo | null = null;
export function openDone(d: DoneInfo) {
  done = d; page = "done";
  acts = acts ?? { waves: () => {}, host: () => {}, join: () => {}, changed: () => {} };
  ensureRoot(); root!.classList.remove("dead");
  render();
}
export function closeMenu() { if (root) { root.style.display = "none"; root.classList.remove("paused"); } }
