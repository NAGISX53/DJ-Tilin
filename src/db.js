import { SessionStore } from './music/recovery.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { mixSettings, DEFAULT_MIX } from './music/mix-settings.js';

const dir = path.resolve('data');
fs.mkdirSync(dir, { recursive: true });
export const db = new DatabaseSync(path.join(dir, 'tilinbot.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS authorized_users (
  guild_id TEXT,
  user_id TEXT,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS music_preferences (
  guild_id TEXT PRIMARY KEY,
  equalizer TEXT NOT NULL DEFAULT 'equilibrado' CHECK(equalizer IN ('equilibrado','original'))
);
CREATE TABLE IF NOT EXISTS music_mix (
  guild_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'smart',
  seconds INTEGER NOT NULL DEFAULT 6,
  sync_bpm INTEGER NOT NULL DEFAULT 1,
  normalize INTEGER NOT NULL DEFAULT 1
);
`);

export function getMixSettings(guildId) {
  const row = db.prepare('SELECT * FROM music_mix WHERE guild_id=?').get(guildId);
  return row ? mixSettings({ mode: row.mode, seconds: row.seconds, syncBpm: Boolean(row.sync_bpm), normalize: Boolean(row.normalize) }) : { ...DEFAULT_MIX };
}

export function saveMixSettings(guildId, patch) {
  const value = mixSettings(patch, getMixSettings(guildId));
  db.prepare('INSERT INTO music_mix(guild_id,mode,seconds,sync_bpm,normalize) VALUES (?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET mode=excluded.mode,seconds=excluded.seconds,sync_bpm=excluded.sync_bpm,normalize=excluded.normalize')
    .run(guildId, value.mode, value.seconds, Number(value.syncBpm), Number(value.normalize));
  return value;
}

export function getMusicEqualizer(guildId) {
  return db.prepare('SELECT equalizer FROM music_preferences WHERE guild_id=?').get(guildId)?.equalizer || 'equilibrado';
}

export function setMusicEqualizer(guildId, mode) {
  db.prepare('INSERT INTO music_preferences(guild_id,equalizer) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET equalizer=excluded.equalizer').run(guildId, mode);
}

export const sessionStore = new SessionStore(db);

db.exec('CREATE TABLE IF NOT EXISTS music_panels (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)');
export const panelStore = {
  read: guildId => db.prepare('SELECT channel_id AS channelId,message_id AS messageId FROM music_panels WHERE guild_id=?').get(guildId) || null,
  save: (guildId, record) => db.prepare('INSERT INTO music_panels(guild_id,channel_id,message_id) VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id').run(guildId,record.channelId,record.messageId),
  delete: guildId => db.prepare('DELETE FROM music_panels WHERE guild_id=?').run(guildId)
};
