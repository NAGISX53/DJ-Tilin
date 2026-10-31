export const MIX_MODES = Object.freeze({ normal: 'Normal', crossfade: 'Crossfade', smart: 'Smart Mix', dj: 'DJ automático' });
export const DEFAULT_MIX = Object.freeze({ mode: 'smart', seconds: 6, syncBpm: true, normalize: true });

export function mixSettings(patch = {}, previous = DEFAULT_MIX) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Configuración de AutoMix inválida.');
  for (const key of Object.keys(patch)) if (!Object.hasOwn(DEFAULT_MIX, key)) throw Error(`Opción de AutoMix desconocida: ${key}`);
  const value = { ...previous, ...patch };
  if (!Object.hasOwn(MIX_MODES, value.mode)) throw Error('Elige normal, crossfade, smart o dj.');
  if (!Number.isInteger(value.seconds) || value.seconds < 3 || value.seconds > 15) throw Error('La transición debe durar entre 3 y 15 segundos.');
  if (typeof value.syncBpm !== 'boolean' || typeof value.normalize !== 'boolean') throw Error('Sincronizar BPM y normalizar deben ser opciones de sí/no.');
  return value;
}
