import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicQueue, shuffleTracks, MAX_QUEUE } from '../src/music/queue.js';
import { bestNext, mixCandidates } from '../src/music/ordering.js';
import { TrackPreparation } from '../src/music/preparation.js';
import { DEFAULT_MIX } from '../src/music/mix-settings.js';
import { musicCommands } from '../src/commands/music.js';
const settings = { ...DEFAULT_MIX, mode: 'dj' };
const song = (id, bpm, group = 'playlist') => ({ encoded: id, info: {title: id}, shuffleGroup: group,
  analysis: { bpm, confidence: 0.9, duration: 180, loudness: -14 } });

test('play expone aleatorio opcional y conserva los comandos musicales', () => {
  const play = musicCommands.find(c => c.data.name === 'play').data.toJSON();
  const option = play.options.find(o => o.name === 'aleatorio');
  assert.equal(option.type, 5); assert(!option.required);
});
test('mezclar una playlist conserva canciones, duplicados, solicitante y la cola anterior', () => {
  const queue = new MusicQueue(); queue.add([song('manual', 120)], 'first');
  const source = [song('a', 120), song('a', 120), song('b', 130)];
  const before = structuredClone(source);
  queue.add(source, 'second', {shuffle: true});
  assert.deepEqual(source, before);
  assert.equal(queue.tracks[0].encoded, 'manual');
  assert.deepEqual(queue.tracks.slice(1).map(t => t.encoded).sort(), ['a','a','b']);
  assert(queue.tracks.slice(1).every(t => t.requester === 'second'));
  assert.equal(new Set(queue.tracks.slice(1).map(t => t.shuffleGroup)).size, 1);
  const values = ['a','b','c']; shuffleTracks(values, () => 0);
  assert.deepEqual(values, ['b','c','a']);
  assert.deepEqual(queue.add(Array.from({length:250},(_,i) => song(String(i),120)), 'u', {shuffle:true}), {added:MAX_QUEUE-4,omitted:54});
});
test('DJ elige el ritmo más compatible y conserva todas las pendientes', () => {
  const queue = new MusicQueue(); queue.current = song('current',120);
  queue.tracks = [song('incompatible',155),song('okay',126),song('best',121)];
  queue.orderForMix(settings,1,()=>true);
  assert.deepEqual(queue.tracks.map(t=>t.encoded), ['best','incompatible','okay']);
  assert.equal(queue.next('stopped').encoded,'best');
});
test('considera el tempo que está sonando y los ritmos a mitad o doble', () => {
  const current = song('current',120);
  const half = song('half',60), shifted = song('shifted',129.6);
  assert.equal(bestNext(current,[shifted,half],settings),half);
  assert.equal(bestNext(current,[half,shifted],settings,1.08),shifted);
});
test('ritmos desconocidos, incompatibles o no preparados conservan el azar sin esperar descargas', () => {
  const current = song('current',120), bad = song('bad',155), good = song('good',120);
  assert.equal(bestNext(current,[bad],settings),null);
  good.analysis.confidence=0.1;
  assert.equal(bestNext(current,[good],settings),null);
  good.analysis.confidence=0.9;
  assert.equal(bestNext(current,[good],settings,1,()=>false),null);
  assert.equal(bestNext({...current,analysis:null},[good],settings),null);
});
test('no invade peticiones manuales ni otra playlist y limita la búsqueda a seis', () => {
  const queue = new MusicQueue();queue.current = song('current',120);
  queue.tracks = [song('a',150,'one'),song('b',120,'two')];
  queue.orderForMix(settings); assert.equal(queue.tracks[0].encoded,'a');
  queue.tracks = [song('manual',150,null),song('b',120)];
  queue.orderForMix(settings); assert.equal(queue.tracks[0].encoded,'manual');
  const tracks = Array.from({length:20},(_,i)=>song(String(i),120));
  assert.equal(mixCandidates(tracks,settings).length,6);
});
test('normal, crossfade y sincronización desactivada respetan el orden aleatorio', () => {
  const current = song('current',120), a = song('a',155), b = song('b',120);
  for (const patch of [{mode:'normal'},{mode:'crossfade'},{syncBpm:false}]) {
    assert.equal(bestNext(current,[a,b],{...settings,...patch}),null);
  }
});
test('precarga seis candidatas sin descargar toda la playlist', async () => {
  const loaded=[];
  const preparation=new TrackPreparation({},async(_,track)=>loaded.push(track.encoded));
  preparation.prefetch(Array.from({length:20},(_,i)=>song(String(i),120)),6);
  while(preparation.worker) await preparation.worker;
  assert.deepEqual(loaded,['0','1','2','3','4','5']);
  preparation.close();
});
