import { MAX_QUEUE } from './queue.js';
const id = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
function publicInfo(info) {
  if (!info || typeof info.title !== 'string') throw Error('Canción guardada inválida.');
  return { title: text(info.title), author: text(info.author), length: Math.max(0, Number.isFinite(info.length) ? info.length : 0),
    isStream: Boolean(info.isStream), sourceName: text(info.sourceName, 40), identifier: text(info.identifier, 100) };
}
export function savedTrack(track) {
  if (!track) return null;
  return { info: publicInfo(track.info), requester: id(track.requester) ? track.requester : null,
    ...(track.query?.startsWith('ytsearch:') ? { query: text(track.query, 1000) } : {}),
    ...(track.shuffleGroup ? { shuffleGroup: text(track.shuffleGroup, 100) } : {}),
    ...(track.audioInfo && /^[a-zA-Z0-9_-]{11}$/.test(track.audioInfo.identifier || '') ? { audioInfo: publicInfo(track.audioInfo) } : {}) };
}
export function normalizeSession(value) {
  if (value?.version !== 1 || !id(value.guildId) || !id(value.voiceChannelId) ||
      (value.textChannelId !== null && !id(value.textChannelId)) || !Array.isArray(value.tracks) || value.tracks.length > MAX_QUEUE ||
      !['off','track','queue'].includes(value.repeat) || !Number.isInteger(value.volume) || value.volume < 0 || value.volume > 100 ||
      (value.autoResume !== undefined && typeof value.autoResume !== 'boolean') || typeof value.paused !== 'boolean' || !Number.isFinite(value.position) || value.position < 0 ||
      !Number.isFinite(value.rate) || value.rate < 0.92 || value.rate > 1.08 || !Number.isFinite(value.savedAt)) throw Error('Sesión guardada inválida.');
  return { version: 1, guildId: value.guildId, voiceChannelId: value.voiceChannelId, textChannelId: value.textChannelId,
    autoResume: value.autoResume !== false, current: savedTrack(value.current), tracks: value.tracks.map(track => { if (!track) throw Error('Canción pendiente inválida.'); return savedTrack(track); }), repeat: value.repeat, volume: value.volume,
    paused: value.paused, position: Math.floor(value.position), rate: value.rate, savedAt: value.savedAt };
}
export function sessionSnapshot(state) {
  const sameTrack = state.mixer?.current?.track === state.queue.current;
  const position = state.starting ? state.resumePosition || 0 : state.mixer
    ? (sameTrack ? state.mixer.position : 0) : state.player.position || 0;
  return normalizeSession({ version: 1, guildId: state.guildId, voiceChannelId: state.channelId,
    textChannelId: state.textChannel?.id || null, current: state.queue.current, tracks: state.queue.tracks,
    repeat: state.queue.repeat, volume: state.volume, paused: state.starting ? Boolean(state.resumePaused) : Boolean(state.player.paused),
    position: state.queue.current?.info.isStream ? 0 : Math.max(0, position),
    rate: sameTrack ? state.mixer.current.rate : state.resumeRate || 1, savedAt: Date.now() });
}
export class SessionStore {
  constructor(db, onError = error => console.warn('[Recuperación] ' + error.message)) {
    this.db = db; this.onError = onError;
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS music_sessions (guild_id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  }
  save(value) {
    const snapshot = normalizeSession(value);
    if (!snapshot.current && !snapshot.tracks.length) { this.delete(snapshot.guildId); return; }
    this.db.prepare('INSERT INTO music_sessions(guild_id,payload) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET payload=excluded.payload')
      .run(snapshot.guildId, JSON.stringify(snapshot));
  }
  read(guildId) {
    const row = this.db.prepare('SELECT payload FROM music_sessions WHERE guild_id=?').get(guildId);
    if (!row) return null;
    try {
      if (row.payload.length > 1000000) throw Error('Sesión guardada demasiado grande.');
      const value = normalizeSession(JSON.parse(row.payload));
      if (value.guildId !== guildId) throw Error('Servidor de recuperación incorrecto.');
      return value;
    } catch (error) { this.onError(error); return null; }
  }
  list() { return this.db.prepare('SELECT guild_id FROM music_sessions').all().map(row => this.read(row.guild_id)).filter(Boolean); }
  delete(guildId) { this.db.prepare('DELETE FROM music_sessions WHERE guild_id=?').run(guildId); }
}
