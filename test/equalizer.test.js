import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEqualizer, EQ_PREAMP } from '../src/music/equalizer.js';

function state(filters = {}) {
  return { volume: 50, player: { filters, setFilters: async function (value) { this.filters = value; } } };
}

test('ecualizar reserva margen antes del filtro y conserva estéreo, volumen y otros efectos', async () => {
  const session = state({ timescale: { speed: 1.1 }, volume: 0.9 });
  await applyEqualizer(session, 'equilibrado');
  assert.equal(session.volume, 50);
  assert.equal(session.player.filters.volume, 0.9);
  assert.deepEqual(session.player.filters.timescale, { speed: 1.1 });
  assert.deepEqual(session.player.filters.channelMix, { leftToLeft: EQ_PREAMP, leftToRight: 0, rightToLeft: 0, rightToRight: EQ_PREAMP });
  assert.equal(session.equalizer, 'equilibrado');
});

test('activar repetidamente no acumula atenuación y original restaura el mezclador previo', async () => {
  const mix = { leftToLeft: 0.9, leftToRight: 0, rightToLeft: 0, rightToRight: 0.9 };
  const session = state({ channelMix: mix });
  await applyEqualizer(session, 'equilibrado');
  const once = structuredClone(session.player.filters);
  await applyEqualizer(session, 'equilibrado');
  assert.deepEqual(session.player.filters, once);
  await applyEqualizer(session, 'original');
  assert.deepEqual(session.player.filters.channelMix, mix);
  assert.ok(session.player.filters.equalizer.every(band => band.gain === 0));
  await applyEqualizer(session, 'equilibrado');
  assert.deepEqual(session.player.filters, once);
});

test('un error del motor no anuncia ni guarda un estado de ecualización que no se aplicó', async () => {
  const session = state();
  session.player.setFilters = async () => { throw Error('offline'); };
  await assert.rejects(applyEqualizer(session, 'equilibrado'), /offline/);
  assert.equal(session.equalizer, undefined);
  assert.equal(session.equalizerBase, undefined);
});
