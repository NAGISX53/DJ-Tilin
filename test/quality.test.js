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

const player = () => ({ filters: { equalizer: [{band:0,gain:0.1}] }, async setFilters(value) { this.filters=value; } });

const channel = (manage, bitrate = 96000, tier = 1) => ({
  bitrate,
  guild: { id: '111111111111111111', premiumTier: tier, features: [], members: { me: {} } },
  permissionsFor: () => ({ has: () => manage }),
  setBitrate: async function (value) { this.bitrate = value; return this; }
});

test('sube el canal al máximo permitido y solicita el mismo bitrate al codificador', async () => {
  const updates = [];
  const quality = new AudioQuality(async (method, payload) => { updates.push(payload.bitrate); return { ...payload, channels: 2, sampleRate: 48000 }; });
  const voice = channel(true);
  assert.equal((await quality.synchronize(voice, player())).bitrate, 128000);
  voice.guild.premiumTier = 3;
  assert.equal((await quality.synchronize(voice, player())).bitrate, 384000);
  voice.guild.premiumTier = 0;
  assert.equal((await quality.synchronize(voice, player())).bitrate, 96000);
  assert.deepEqual(updates, [128000, 384000, 96000]);
});

test('sin permisos respeta el bitrate del canal y nunca supera el máximo del servidor', async () => {
  const quality = new AudioQuality(async (_, payload) => payload);
  assert.equal((await quality.synchronize(channel(false, 64000), player())).bitrate, 64000);
  assert.equal((await quality.synchronize(channel(false, 384000, 0), player())).bitrate, 96000);
});

test('no informa una calidad que el codificador no haya confirmado', async () => {
  const quality = new AudioQuality(async () => ({ bitrate: 64000 }));
  await assert.rejects(quality.synchronize(channel(false), player()), /no confirmó/);
});


test('dos servidores conservan bitrate y filtros independientes al cambiar la calidad', async () => {
  const profiles=new Map();
  const quality=new AudioQuality(async(method,payload)=>{
    if(method==='DELETE') { profiles.delete(payload.guildId);return {}; }
    profiles.set(payload.guildId,payload.bitrate);return {...payload,channels:2,sampleRate:48000};
  });
  const a=channel(false,96000), b=channel(false,384000,3);b.guild.id='222222222222222222';
  const pa=player(),pb=player();
  await Promise.all([quality.synchronize(a,pa),quality.synchronize(b,pb)]);
  assert.equal(profiles.get(a.guild.id),96000);assert.equal(profiles.get(b.guild.id),384000);
  assert.deepEqual(pa.filters.pluginFilters.tilinQuality,{guildId:a.guild.id});
  assert.deepEqual(pb.filters.pluginFilters.tilinQuality,{guildId:b.guild.id});
  assert.deepEqual(pa.filters.equalizer,[{band:0,gain:0.1}]);
  a.bitrate=64000;await quality.synchronize(a,pa);
  assert.equal(profiles.get(b.guild.id),384000);
  await quality.release(a.guild.id);assert(!profiles.has(a.guild.id));assert(profiles.has(b.guild.id));
});
