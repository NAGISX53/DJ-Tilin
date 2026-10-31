import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackPreparation } from '../src/music/preparation.js';

const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};

test('prepara las dos siguientes antes del cambio, sin cargar toda la playlist', async () => {
  const downloaded = [];
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const preparation = new TrackPreparation({}, async (_, track) => { downloaded.push(track.id); track.encoded = `audio-${track.id}`; });
  preparation.prefetch(tracks);
  await preparation.worker;
  assert.deepEqual(downloaded, [1, 2]);
  assert.equal((await preparation.prepare(tracks[0])).encoded, 'audio-1');
  assert.deepEqual(downloaded, [1, 2]);
});

test('saltar durante la precarga comparte el trabajo en curso sin duplicarlo', async () => {
  const download = gate();
  const track = {};
  let calls = 0;
  const preparation = new TrackPreparation({}, async () => { calls++; await download.promise; });
  preparation.prefetch([track]);
  const foreground = preparation.prepare(track);
  const again = preparation.prepare(track);
  assert.equal(foreground, again);
  download.release();
  await foreground;
  await preparation.worker;
  assert.equal(calls, 1);
});

test('mezclar o quitar cambia la siguiente prioridad sin esperar una lista antigua', async () => {
  const first = gate();
  const [a, b, c] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const order = [];
  const preparation = new TrackPreparation({}, async (_, track) => {
    order.push(track.id);
    if (track === a) await first.promise;
  });
  preparation.prefetch([a, b]);
  preparation.prefetch([c]);
  first.release();
  await preparation.worker;
  assert.deepEqual(order, ['a', 'c']);
});

test('un fallo de fondo permite preparar la siguiente y reintentar al reproducir', async () => {
  const [a, b] = [{ id: 'a' }, { id: 'b' }];
  let attempts = 0;
  const errors = [];
  const preparation = new TrackPreparation({}, async (_, track) => {
    if (track === a && ++attempts === 1) throw Error('fallo temporal');
    track.encoded = track.id;
  }, error => errors.push(error.message));
  preparation.prefetch([a, b]);
  await preparation.worker;
  assert.equal(b.encoded, 'b');
  assert.deepEqual(errors, ['fallo temporal']);
  assert.equal((await preparation.prepare(a)).encoded, 'a');
  assert.equal(attempts, 2);
});

test('detener impide iniciar más descargas de la cola', async () => {
  const first = gate();
  const order = [];
  const preparation = new TrackPreparation({}, async (_, track) => { order.push(track.id); await first.promise; });
  preparation.prefetch([{ id: 1 }, { id: 2 }]);
  preparation.close();
  first.release();
  await preparation.worker;
  preparation.prefetch([{ id: 3 }]);
  assert.deepEqual(order, [1]);
});

test('agregar otra canción justo al terminar una preparación no pierde la precarga', async () => {
  const [a, b] = [{ id: 'a' }, { id: 'b' }];
  const order = [];
  const preparation = new TrackPreparation({}, async (_, track) => { order.push(track.id); });
  preparation.prefetch([a]);
  await preparation.prepare(a);
  preparation.prefetch([b]);
  while (preparation.worker) await preparation.worker;
  assert.deepEqual(order, ['a', 'b']);
});
