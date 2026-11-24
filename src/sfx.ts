// Звуки синтезируются на лету (Web Audio), файлов нет. sfx(вид, громкость 0..1).
export type Sfx =
  | "shot" | "casing" | "empty" | "reload" | "hit" | "splat" | "gore" | "thunk" | "ricochet"
  | "step" | "hurt" | "groan" | "growl" | "squeak" | "roar" | "wave" | "over"
  | "boom" | "pin" | "pickup" | "heal" | "bounce" | "shotgun" | "pistol" | "pump" | "swap" | "armor";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const last: Partial<Record<Sfx, number>> = {};
/** не чаще, чем раз в N секунд (иначе каша из одинаковых звуков) */
const GAP: Partial<Record<Sfx, number>> = { hit: 0.03, splat: 0.04, casing: 0.05, thunk: 0.05, ricochet: 0.08, swap: 0.05,  bounce: 0.08, boom: 0.05, empty: 0.25, groan: 0.35, growl: 0.4, squeak: 0.2 };

let volume = 0.9;
export function toggleMute() { muted = !muted; if (out) out.gain.value = muted ? 0 : volume; return muted; }
/** громкость 0..1 и выключение (из настроек) */
export function setSound(v: number, mute: boolean) { volume = Math.max(0, Math.min(1, v)) * 0.9; muted = mute; if (out) out.gain.value = muted ? 0 : volume; }
/** браузер разрешает звук только после первого клика/нажатия */
export function unlockAudio() { init(); void ctx?.resume(); }

function init() {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6;
    out = ctx.createGain();
    out.gain.value = muted ? 0 : volume;
    out.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
  return ctx;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** шум через фильтр с огибающей */
function noise(t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.002) {
  const c = ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out!);
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.02);
}
/** тон со сползанием частоты */
function tone(t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.003, filt?: number) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = o;
  if (filt) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filt; o.connect(f); node = f; }
  node.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
}
/** металлический щелчок (части автомата) */
function click(t: number, vol: number, f: number) {
  noise(t, 0.035, vol, "bandpass", f, f * 0.8, 6);
  tone(t, 0.04, vol * 0.4, "square", f * 0.5, f * 0.3);
}
/** стон: пила через «гласную» полосу, с дрожанием */
function voice(t: number, dur: number, vol: number, f0: number, f1: number, formant: number) {
  const c = ctx!, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
  const bp = c.createBiquadFilter(), lp = c.createBiquadFilter(), g = c.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f1, t + dur);
  lfo.frequency.value = rnd(5, 9); lg.gain.value = f0 * 0.06;
  lfo.connect(lg).connect(o.frequency);
  bp.type = "bandpass"; bp.frequency.value = formant; bp.Q.value = 3;
  lp.type = "lowpass"; lp.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(lp).connect(g).connect(out!);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  noise(t, dur, vol * 0.25, "bandpass", formant * 1.5, formant, 2, dur * 0.3); // хрип
}

export function sfx(kind: Sfx, vol = 1) {
  const c = init();
  if (!c || muted || vol <= 0.02) return;
  const t = c.currentTime;
  if (t - (last[kind] ?? -1) < (GAP[kind] ?? 0)) return;
  last[kind] = t;
  const v = Math.min(1, vol);
  switch (kind) {
    case "shot": // хлопок + низкий удар + хвост
      noise(t, 0.09, 0.5 * v, "lowpass", 5000, 900);
      tone(t, 0.11, 0.45 * v, "sine", 150, 45);
      noise(t + 0.02, 0.25, 0.08 * v, "lowpass", 1200, 300);
      break;
    case "casing": // гильза звякнула о землю
      tone(t, 0.06, 0.07 * v, "sine", rnd(3800, 5200), rnd(3400, 4800));
      tone(t + 0.07, 0.05, 0.04 * v, "sine", rnd(4200, 5600));
      break;
    case "empty": // сухой щелчок
      click(t, 0.25 * v, 2600);
      break;
    case "reload": // магазин вон — магазин в паз — затвор
      click(t, 0.3 * v, 1500);
      noise(t + 0.05, 0.12, 0.08 * v, "bandpass", 900, 600, 2);
      click(t + 0.55, 0.45 * v, 1100);
      tone(t + 0.55, 0.06, 0.2 * v, "sine", 220, 120);
      click(t + 0.95, 0.35 * v, 1800);
      click(t + 1.07, 0.45 * v, 1300);
      break;
    case "hit": // пуля в тело
      noise(t, 0.07, 0.35 * v, "lowpass", 1500, 250);
      tone(t, 0.06, 0.2 * v, "sine", 180, 70);
      break;
    case "splat": // кусок шлёпнулся
      noise(t, 0.09, 0.18 * v, "lowpass", rnd(700, 1100), 150, 1, 0.005);
      break;
    case "gore": // разрывает на части
      noise(t, 0.35, 0.5 * v, "lowpass", 1800, 120);
      tone(t, 0.25, 0.3 * v, "sine", 110, 40);
      noise(t + 0.08, 0.2, 0.2 * v, "bandpass", 500, 200, 2);
      break;
    case "thunk": // в дерево
      tone(t, 0.08, 0.2 * v, "triangle", 260, 140);
      noise(t, 0.05, 0.12 * v, "bandpass", 900, 500, 3);
      break;
    case "ricochet": // от камня
      noise(t, 0.03, 0.15 * v, "highpass", 3000, 3000);
      tone(t + 0.01, 0.3, 0.07 * v, "sine", rnd(2600, 3400), rnd(900, 1300));
      break;
    case "step":
      noise(t, 0.06, 0.06 * v, "lowpass", 600, 200, 1, 0.004);
      break;
    case "hurt": // кряхтение героя + удар
      voice(t, 0.22, 0.35 * v, 170, 120, 700);
      noise(t, 0.08, 0.3 * v, "lowpass", 900, 200);
      break;
    case "groan": { // зомби
      const f = rnd(70, 120), d = rnd(0.6, 1.2);
      voice(t, d, 0.22 * v, f, f * rnd(0.6, 0.85), rnd(380, 600));
      break;
    }
    case "growl": // гиена / пантера
      voice(t, 0.5, 0.18 * v, rnd(90, 130), rnd(70, 90), 900);
      noise(t, 0.5, 0.1 * v, "bandpass", 500, 300, 4, 0.1);
      break;
    case "squeak": // крыса
      tone(t, 0.08, 0.08 * v, "triangle", rnd(2400, 3200), rnd(3600, 4400));
      tone(t + 0.1, 0.06, 0.05 * v, "triangle", rnd(2800, 3400), 2200);
      break;
    case "roar": // медведь
      voice(t, 1.1, 0.4 * v, 75, 55, 300);
      noise(t, 1.1, 0.2 * v, "lowpass", 700, 200, 1, 0.25);
      break;
    case "wave": // рог: началась волна
      tone(t, 0.9, 0.12 * v, "sawtooth", 110, 104, 0.15, 700);
      tone(t, 0.9, 0.08 * v, "sawtooth", 165, 156, 0.15, 700);
      tone(t + 0.5, 0.9, 0.1 * v, "sawtooth", 147, 139, 0.15, 700);
      break;
    case "boom": // взрыв: удар, рокот, осыпь
      noise(t, 0.12, 0.9 * v, "lowpass", 6000, 1200);
      tone(t, 0.5, 0.8 * v, "sine", 90, 28);
      noise(t + 0.02, 1.2, 0.45 * v, "lowpass", 1400, 90, 1, 0.03);
      noise(t + 0.25, 0.9, 0.12 * v, "bandpass", 2500, 900, 1.5, 0.1);
      break;
    case "shotgun": // дробовик: тяжёлый хлопок и длинный хвост
      noise(t, 0.14, 0.75 * v, "lowpass", 4200, 700);
      tone(t, 0.18, 0.6 * v, "sine", 120, 35);
      noise(t + 0.03, 0.45, 0.15 * v, "lowpass", 1000, 200);
      break;
    case "pistol":
      noise(t, 0.06, 0.4 * v, "lowpass", 6500, 1500);
      tone(t, 0.07, 0.3 * v, "sine", 220, 80);
      break;
    case "pump": // передёрнуть цевьё
      click(t, 0.3 * v, 1200);
      noise(t + 0.04, 0.08, 0.08 * v, "bandpass", 700, 500, 2);
      click(t + 0.16, 0.35 * v, 1600);
      break;
    case "swap": // смена оружия
      click(t, 0.18 * v, 2000);
      noise(t + 0.03, 0.06, 0.05 * v, "bandpass", 1200, 900, 2);
      break;
    case "armor": // надел бронежилет
      noise(t, 0.12, 0.15 * v, "bandpass", 500, 300, 1.5);
      click(t + 0.1, 0.25 * v, 900);
      click(t + 0.22, 0.25 * v, 1100);
      break;
    case "pin": // выдернул кольцо
      click(t, 0.3 * v, 3200);
      tone(t + 0.04, 0.12, 0.05 * v, "sine", 5200, 4800);
      break;
    case "bounce": // граната стукнулась о землю
      tone(t, 0.06, 0.12 * v, "triangle", rnd(500, 700), 300);
      noise(t, 0.04, 0.08 * v, "lowpass", 1200, 400);
      break;
    case "pickup":
      tone(t, 0.09, 0.12 * v, "triangle", 660, 680);
      tone(t + 0.08, 0.14, 0.12 * v, "triangle", 990, 1000);
      break;
    case "heal":
      tone(t, 0.12, 0.1 * v, "sine", 523, 530);
      tone(t + 0.1, 0.12, 0.1 * v, "sine", 659, 665);
      tone(t + 0.2, 0.25, 0.1 * v, "sine", 784, 790);
      break;
    case "over":
      tone(t, 2.2, 0.15 * v, "sawtooth", 110, 40, 0.05, 500);
      tone(t, 2.2, 0.1 * v, "sawtooth", 116, 42, 0.05, 500);
      voice(t + 0.1, 1.2, 0.3 * v, 90, 60, 450);
      break;
  }
}
