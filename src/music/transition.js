const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function transitionPlan(current, next, settings, currentRate = 1) {
  if (settings.mode === 'normal') return { type: 'normal', seconds: 0, incomingRate: 1, cue: 0, fallback: null };
  const duration = Math.min(settings.seconds, (current?.duration || 300) / 3, (next?.duration || 300) / 3);
  let plan = { type: 'crossfade', seconds: Math.max(0.1, duration), incomingRate: 1, cue: 0, fallback: null };
  if (settings.mode === 'crossfade') return plan;
  plan.cue = next?.intro || 0;
  if (!settings.syncBpm) return { ...plan, type: 'smart', fallback: settings.mode === 'dj' ? 'Sincronización BPM desactivada: transición por energía.' : null };
  const reliable = current?.confidence >= 0.3 && next?.confidence >= 0.3 && current.bpm && next.bpm;
  if (!reliable) return { ...plan, fallback: 'Ritmo poco claro: fundido sencillo.' };
  const target = current.bpm * currentRate;
  const candidates = [next.bpm / 2, next.bpm, next.bpm * 2];
  const bpm = candidates.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best);
  const ratio = target / bpm;
  if (Math.abs(ratio - 1) > 0.08) return { ...plan, fallback: 'Ritmos poco compatibles: fundido sencillo.' };
  plan.type = settings.mode === 'dj' && settings.syncBpm ? 'dj' : 'smart';
  if (plan.type === 'dj') plan.incomingRate = clamp(ratio, 0.92, 1.08);
  // Favor a musical bar length without allowing excessively long overlaps.
  const beat = 60 / target;
  const beats = Math.max(4, Math.round(plan.seconds / (beat * 4)) * 4);
  plan.seconds = clamp(beats * beat, Math.min(3, duration), Math.min(15, duration));
  const period = 60 / (bpm * plan.incomingRate);
  const phase = (next.beatOffset || 0) / plan.incomingRate;
  const cueTime = plan.cue / plan.incomingRate;
  const aligned = phase + Math.ceil((cueTime - phase) / period) * period;
  plan.cue = Math.max(plan.cue, aligned * plan.incomingRate);
  return plan;
}

// Equal-power blend with a short, linked stereo peak limiter. No hard clipping.
export class StereoBlend {
  constructor() { this.gain = 1; }
  frame(outgoing, incoming = null, progress = 0) {
    const length = Math.max(outgoing?.length || 0, incoming?.length || 0, 1920);
    const mixed = new Float32Array(length);
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const t = clamp(progress + (Math.floor(i / 2) / (length / 2)) * (this.progressStep || 0), 0, 1);
      const a = incoming ? Math.cos(t * Math.PI / 2) : 1;
      const b = incoming ? Math.sin(t * Math.PI / 2) : 0;
      const value = (outgoing?.[i] || 0) * a + (incoming?.[i] || 0) * b;
      mixed[i] = value; peak = Math.max(peak, Math.abs(value));
    }
    const target = peak > 0.9 ? 0.9 / peak : 1;
    this.gain = target < this.gain ? target : Math.min(target, this.gain + 0.025);
    const output = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) output.writeInt16LE(Math.round(clamp(mixed[i] * this.gain, -0.999, 0.999) * 32767), i * 2);
    return output;
  }
}
