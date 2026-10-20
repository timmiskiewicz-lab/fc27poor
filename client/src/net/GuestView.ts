import type { MatchView } from "../../../shared/state";
import { lerpView } from "../game/viewLerp";

interface Sample {
  at: number;
  v: MatchView;
}

const DELAY = 0.11;

export class GuestView {
  private samples: Sample[] = [];
  private offset: number | null = null;

  push(at: number, v: MatchView): void {
    const now = performance.now() / 1000;
    const o = now - at;
    if (this.offset === null || o < this.offset) this.offset = o;
    else this.offset += (o - this.offset) * 0.02;
    const last = this.samples[this.samples.length - 1];
    if (last && at <= last.at) return;
    this.samples.push({ at, v });
    while (this.samples.length > 2 && this.samples[0].at < at - 1.5) this.samples.shift();
  }

  latest(): MatchView | null {
    return this.samples[this.samples.length - 1]?.v ?? null;
  }

  sample(): MatchView | null {
    const s = this.samples;
    if (!s.length || this.offset === null) return null;
    const target = performance.now() / 1000 - this.offset - DELAY;
    if (target <= s[0].at) return s[0].v;
    for (let i = 0; i < s.length - 1; i += 1) {
      if (s[i + 1].at >= target) {
        const k = (target - s[i].at) / Math.max(1e-4, s[i + 1].at - s[i].at);
        return lerpView(s[i].v, s[i + 1].v, k);
      }
    }
    return s[s.length - 1].v;
  }
}
