let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let crowdGain: GainNode | null = null;
let crowdFilter: BiquadFilterNode | null = null;
let chantGain: GainNode | null = null;
let noise: AudioBuffer | null = null;
let volume = 0.8;
let level = 0.15;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function out(): GainNode {
  audio();
  return master as GainNode;
}

function noiseBuffer(): AudioBuffer {
  const c = audio();
  if (noise) return noise;
  const len = c.sampleRate * 4;
  noise = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = noise.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
  }
  return noise;
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}

/** Continuous stadium bed: pink noise through a band-pass, plus a slow chant-like modulation. */
export function startCrowd(): void {
  const c = audio();
  if (crowdGain) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  crowdFilter = c.createBiquadFilter();
  crowdFilter.type = "bandpass";
  crowdFilter.frequency.value = 700;
  crowdFilter.Q.value = 0.6;
  crowdGain = c.createGain();
  crowdGain.gain.value = 0;
  src.connect(crowdFilter);
  crowdFilter.connect(crowdGain);
  crowdGain.connect(out());
  src.start();
  const chant = c.createBufferSource();
  chant.buffer = noiseBuffer();
  chant.loop = true;
  chant.playbackRate.value = 0.7;
  const cf = c.createBiquadFilter();
  cf.type = "bandpass";
  cf.frequency.value = 420;
  cf.Q.value = 3;
  chantGain = c.createGain();
  chantGain.gain.value = 0;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.9;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain);
  lfoGain.connect(chantGain.gain);
  lfo.start();
  chant.connect(cf);
  cf.connect(chantGain);
  chantGain.connect(out());
  chant.start();
}

export function stopCrowd(): void {
  if (!ctx || !crowdGain) return;
  crowdGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  chantGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
}

export function crowdLevel(v: number): void {
  if (!ctx || !crowdGain || !crowdFilter) return;
  level = v;
  const t = ctx.currentTime;
  crowdGain.gain.setTargetAtTime(0.12 + v * 0.55, t, 0.35);
  crowdFilter.frequency.setTargetAtTime(600 + v * 700, t, 0.4);
  chantGain?.gain.setTargetAtTime(0.03 + (1 - v) * 0.04, t, 1.5);
}

function burst(dur: number, freq: number, q: number, gain: number, attack = 0.01, type: BiquadFilterType = "bandpass", delay = 0): void {
  const c = audio();
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out());
  src.start(t, Math.random() * 2);
  src.stop(t + dur + 0.05);
}

function tone(freq: number, dur: number, type: OscillatorType, gainValue: number, delay = 0, slide = 0): void {
  const c = audio();
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(out());
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playKick(power = 0.5): void {
  tone(95 + power * 40, 0.09 + power * 0.05, "sine", 0.18 + power * 0.25, 0, 0.45);
  burst(0.05 + power * 0.04, 2400, 0.8, 0.05 + power * 0.12, 0.002, "highpass");
}

export function playTouch(): void {
  tone(120, 0.05, "sine", 0.06, 0, 0.6);
}

export function playWhistle(n = 1): void {
  for (let i = 0; i < n; i += 1) {
    const long = n > 1 && i === n - 1;
    const d = i * 0.42;
    const dur = long ? 0.9 : n > 1 ? 0.28 : 0.38;
    tone(2850, dur, "sine", 0.05, d);
    tone(2950, dur, "triangle", 0.03, d);
    burst(dur, 3000, 6, 0.03, 0.01, "bandpass", d);
  }
}

export function playGoal(): void {
  burst(5.5, 900, 0.5, 0.65, 0.25);
  burst(4.5, 1500, 0.7, 0.35, 0.3);
  burst(3.5, 400, 0.8, 0.3, 0.2);
}

export function playNet(): void {
  burst(0.35, 1800, 1.4, 0.12, 0.005, "highpass");
}

export function playPost(): void {
  tone(1350, 0.6, "sine", 0.12, 0, 0.98);
  tone(2710, 0.4, "sine", 0.05, 0, 0.98);
  burst(0.08, 4000, 2, 0.06, 0.002);
  playOoh();
}

export function playOoh(): void {
  const c = audio();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer();
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 2.2;
  f.frequency.setValueAtTime(520, t);
  f.frequency.linearRampToValueAtTime(340, t + 1.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 + level * 0.3, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
  src.connect(f);
  f.connect(g);
  g.connect(out());
  src.start(t, Math.random());
  src.stop(t + 2);
}

export function playTackle(): void {
  tone(80, 0.12, "sine", 0.2, 0, 0.5);
  burst(0.14, 700, 1, 0.12, 0.004);
}

export function playCheer(): void {
  burst(1.6, 1100, 0.6, 0.3, 0.12);
}

export function playUi(): void {
  tone(880, 0.06, "sine", 0.05);
}
