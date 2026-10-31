import { transitionPlan } from './transition.js';
import { harmonicRelation, energyDifference } from './spectral.js';

export const MIX_LOOKAHEAD = 6;

// Only shuffled batches may change order. Explicit requests keep their position.
export function mixCandidates(tracks, settings) {
  const group = tracks[0]?.shuffleGroup;
  if (!group || !['smart', 'dj'].includes(settings.mode) || !settings.syncBpm) return tracks.slice(0, 2);
  const candidates = [];
  for (const track of tracks) {
    if (track.shuffleGroup !== group || candidates.length === MIX_LOOKAHEAD) break;
    candidates.push(track);
  }
  return candidates;
}

export function bestNext(current, candidates, settings, rate = 1, ready = () => true) {
  if (!current?.analysis || !settings.syncBpm || !['smart', 'dj'].includes(settings.mode)) return null;
  let best = null, bestScore = Infinity;
  for (const track of candidates) {
    if (!ready(track) || !track.analysis) continue;
    const plan = transitionPlan(current.analysis, track.analysis, settings, rate);
    const harmony=harmonicRelation(current.analysis.key,track.analysis.key);
    const energy=energyDifference(current.analysis.energy,track.analysis.energy);
    const reliable=current.analysis.confidence>=0.3&&track.analysis.confidence>=0.3&&current.analysis.bpm>0&&track.analysis.bpm>0;
    if ((!['smart', 'dj'].includes(plan.type) || plan.fallback) && (reliable || harmony.kind==='unknown'&&energy===null)) continue;
    const target = current.analysis.bpm * rate;
    const difference = reliable?Math.min(...[0.5, 1, 2].map(scale => Math.abs(target / (track.analysis.bpm * scale) - 1))):0.08;
    const loudness = !settings.normalize && Number.isFinite(current.analysis.loudness) && Number.isFinite(track.analysis.loudness)
      ? Math.min(12, Math.abs(current.analysis.loudness - track.analysis.loudness)) * 0.002 : 0;
    const score = difference + (1 - Math.min(1, track.analysis.confidence || 0)) * 0.01 + loudness+harmony.cost+(energy===null?0.04:energy*0.16);
    if (score < bestScore) { best = track; bestScore = score; }
  }
  return best;
}
