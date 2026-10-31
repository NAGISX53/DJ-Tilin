import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioQuality, maximumBitrate } from '../src/music/quality.js';

test('detecta los límites sin boosts, por nivel y con boosts nuevos por característica', () => {
  for (const [premiumTier, expected] of [[0, 96000], [1, 128000], [2, 256000], [3, 384000]]) {
    assert.equal(maximumBitrate({ premiumTier, features: [] }), expected);
  }
  assert.equal(maximumBitrate({ premiumTier: 0, maximumBitrate: 96000, features: ['AUDIO_BITRATE_256_KBPS'] }), 256000);
  assert.equal(maximumBitrate({ features: ['VIP_REGIONS'] }), 384000);
});

const channel = (manage, bitrate = 96000, tier = 1) => ({
  bitrate,
  guild: { premiumTier: tier, features: [], members: { me: {} } },
  permissionsFor: () => ({ has: () => manage }),
  setBitrate: async function (value) { this.bitrate = value; return this; }
});

test('sube el canal al máximo permitido y solicita el mismo bitrate al codificador', async () => {
  const updates = [];
  const quality = new AudioQuality(async (method, payload) => { updates.push(payload.bitrate); return { ...payload, channels: 2, sampleRate: 48000 }; });
  const voice = channel(true);
  assert.equal((await quality.synchronize(voice)).bitrate, 128000);
  voice.guild.premiumTier = 3;
  assert.equal((await quality.synchronize(voice)).bitrate, 384000);
  voice.guild.premiumTier = 0;
  assert.equal((await quality.synchronize(voice)).bitrate, 96000);
  assert.deepEqual(updates, [128000, 384000, 96000]);
});

test('sin permisos respeta el bitrate del canal y nunca supera el máximo del servidor', async () => {
  const quality = new AudioQuality(async (_, payload) => payload);
  assert.equal((await quality.synchronize(channel(false, 64000))).bitrate, 64000);
  assert.equal((await quality.synchronize(channel(false, 384000, 0))).bitrate, 96000);
});

test('no informa una calidad que el codificador no haya confirmado', async () => {
  const quality = new AudioQuality(async () => ({ bitrate: 64000 }));
  await assert.rejects(quality.synchronize(channel(false)), /no confirmó/);
});
