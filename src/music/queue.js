import { randomInt, randomUUID } from 'node:crypto';

import { bestNext, mixCandidates } from './ordering.js';

export const MAX_QUEUE = 200;

export function identifier(input) {
  const text = input.trim().replace(/^<(.+)>$/, '$1');
  if (!text || text.length > 500) throw new Error('Escribe una canción, artista o enlace (hasta 500 caracteres).');
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'open.spotify.com'];
    if (!hosts.includes(url.hostname) || url.username || url.password || url.port) {
      throw new Error('Acepto enlaces de youtube.com, youtu.be y open.spotify.com. Para otras fuentes, escribe la canción y el artista.');
    }
    if (url.protocol !== 'https:') url.protocol = 'https:';
    return url.toString();
  }
  if (text.startsWith('spotify:')) {
    if (!/^spotify:(track|album|playlist|artist):[a-zA-Z0-9]+$/.test(text)) throw new Error('El enlace de Spotify no es válido.');
    return text;
  }
  // Never forward user supplied source prefixes, file paths or arbitrary protocols.
  return `ytsearch:${text}`;
}

export function tracksFrom(result) {
  if (!result || result.loadType === 'empty') return [];
  if (result.loadType === 'error') throw new Error('La fuente de música no pudo cargar esa solicitud. Prueba otra canción o enlace.');
  if (result.loadType === 'track') return [result.data];
  if (result.loadType === 'search') return result.data.slice(0, 1);
  if (result.loadType === 'playlist') {
    const { tracks, info } = result.data;
    const selected = info?.selectedTrack ?? -1;
    return selected > 0 ? [...tracks.slice(selected), ...tracks.slice(0, selected)] : tracks;
  }
  return [];
}

export class MusicQueue {
  constructor() {
    this.tracks = [];
    this.current = null;
    this.repeat = 'off';
  }
  add(tracks, requester, { shuffle = false } = {}) {
    const room = MAX_QUEUE - this.tracks.length;
    const source = tracks.slice();
    const group = shuffle ? randomUUID() : null;
    if (shuffle) shuffleTracks(source);
    const accepted = source.slice(0, room).map(track => ({ ...track, requester, ...(group ? { shuffleGroup: group } : {}) }));
    this.tracks.push(...accepted);
    return { added: accepted.length, omitted: tracks.length - accepted.length };
  }
  next(reason = 'finished') {
    if (reason === 'finished' && this.current) {
      if (this.repeat === 'track') return this.current;
      if (this.repeat === 'queue') this.tracks.push(this.current);
    }
    this.current = this.tracks.shift() ?? null;
    return this.current;
  }
  remove(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.tracks.length) throw new Error('Esa posición no existe en la cola.');
    return this.tracks.splice(position - 1, 1)[0];
  }
  shuffle() {
    const group = randomUUID();
    for (const track of this.tracks) track.shuffleGroup = group;
    shuffleTracks(this.tracks);
  }
  candidates(settings) { return mixCandidates(this.tracks, settings); }
  orderForMix(settings, rate = 1, ready) {
    if (!this.tracks[0]?.shuffleGroup) return;
    const best = bestNext(this.current, this.candidates(settings), settings, rate, ready);
    const index = this.tracks.indexOf(best);
    if (index > 0) this.tracks.unshift(this.tracks.splice(index, 1)[0]);
  }
}

export function shuffleTracks(tracks, pick = randomInt) {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
    return tracks;
}

export class GuildLock {
  constructor() { this.pending = new Map(); }
  async run(guildId, action) {
    const previous = this.pending.get(guildId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    this.pending.set(guildId, task);
    try { return await task; }
    finally { if (this.pending.get(guildId) === task) this.pending.delete(guildId); }
  }
}
