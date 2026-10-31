// Gentle all-purpose curve: a little warmth/presence, less low-mid congestion.
// Lavalink gains are linear band multipliers, NOT decibels.
export const EQ_GAINS = Object.freeze([
  -0.025, -0.01, 0.02, 0.025, 0.01, -0.015, -0.025, -0.015,
  0, 0.005, 0.015, 0.02, 0.015, 0.005, -0.01
]);
export const EQ_PREAMP = 0.8;
const IDENTITY = Object.freeze({ leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 });
export const EQ_NAMES = Object.freeze({ equilibrado: 'Equilibrado suave', original: 'Original (sin ecualizar)' });

export async function applyEqualizer(state, mode) {
  if (!Object.hasOwn(EQ_NAMES, mode)) throw Error('Elige equilibrado u original.');
  const current = state.player.filters || {};
  const base = state.equalizerBase || {
    volume: current.volume ?? 1,
    channelMix: current.channelMix ? { ...IDENTITY, ...current.channelMix } : null
  };
  const mix = base.channelMix || IDENTITY;
  // Lavalink builds its chain in reverse: channelMix runs BEFORE equalizer.
  // A filter-volume cut alone would occur AFTER the equalizer's internal clamp.
  // Reserve headroom before EQ without crossfeed, changing pitch or master volume.
  const channelMix = mode === 'original' ? base.channelMix : Object.fromEntries(
    Object.entries(mix).map(([key, gain]) => [key, gain * EQ_PREAMP])
  );
  const filters = {
    ...current,
    volume: base.volume,
    equalizer: EQ_GAINS.map((gain, band) => ({ band, gain: mode === 'original' ? 0 : gain })),
    channelMix
  };
  await state.player.setFilters(filters);
  state.equalizerBase = base;
  state.equalizer = mode;
}
