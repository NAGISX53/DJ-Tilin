import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicQueue, GuildLock, MAX_QUEUE, identifier, tracksFrom } from '../src/music/queue.js';
import { spotifyTracks, spotifyReference, playableTrack } from '../src/music/sources.js';

const song = encoded => ({ encoded, info: { title: encoded } });
test('Spotify identifica URLs localizadas y convierte metadatos sin usar previews', async () => {
  assert.deepEqual(spotifyReference('https://open.spotify.com/intl-es/track/abc?si=1'), { type: 'track', id: 'abc' });
  assert.equal(spotifyReference('https://youtu.be/abc'), null);
  const [track] = spotifyTracks({ type: 'track', title: 'Song', artists: [{ name: 'Artist' }], duration: 180000, uri: 'spotify:track:abc' });
  assert.equal(track.query, 'ytsearch:Song Artist audio');
  let calls = 0;
  const node = { rest: { resolve: async () => { calls++; return { loadType: 'search', data: [{ encoded: 'audio', info: { length: 181000 } }] }; } } };
  assert.equal((await playableTrack(node, track, async () => 'audio')).encoded, 'audio');
  await playableTrack(node, track);
  assert.equal(calls, 1);
});
test('nombre/artista, YouTube, Spotify y entradas que no deben llegar al motor', () => {
  assert.equal(identifier('  Juan Gabriel Amor eterno '), 'ytsearch:Juan Gabriel Amor eterno');
  assert.equal(identifier('<https://youtu.be/abc>'), 'https://youtu.be/abc');
  assert.equal(identifier('spotify:track:abc'), 'spotify:track:abc');
  assert.equal(identifier('http://open.spotify.com/track/abc'), 'https://open.spotify.com/track/abc');
  for (const url of ['https://youtube.com.evil.com/a', 'http://127.0.0.1/a', 'https://youtube.com:8080/a', 'https://user@youtube.com/a']) assert.throws(() => identifier(url));
  assert.equal(identifier('local:C:/secret'), 'ytsearch:local:C:/secret');
  assert.throws(() => identifier(' '));
});
test('búsqueda elige una canción y playlists mantienen el orden de inicio', () => {
  const tracks = ['a', 'b', 'c'].map(song);
  assert.deepEqual(tracksFrom({ loadType: 'search', data: tracks }), [tracks[0]]);
  assert.deepEqual(tracksFrom({ loadType: 'playlist', data: { tracks, info: { selectedTrack: 1 } } }), [tracks[1], tracks[2], tracks[0]]);
  assert.deepEqual(tracksFrom({ loadType: 'empty' }), []);
  assert.throws(() => tracksFrom({ loadType: 'error' }));
});
test('repetición no atrapa saltos ni canciones fallidas; cola avanza correctamente', () => {
  const queue = new MusicQueue();
  queue.add(['a', 'b', 'c'].map(song), 'user');
  assert.equal(queue.next('initial').encoded, 'a');
  queue.repeat = 'track';
  assert.equal(queue.next('finished').encoded, 'a');
  assert.equal(queue.next('stopped').encoded, 'b');
  assert.equal(queue.next('loadFailed').encoded, 'c');
  assert.equal(queue.next('loadFailed'), null);
  queue.add(['a', 'b'].map(song), 'user');
  queue.repeat = 'queue';
  queue.next('initial');
  assert.equal(queue.next('finished').encoded, 'b');
  assert.equal(queue.next('finished').encoded, 'a');
});
test('capacidad, eliminación y mezcla conservan las canciones', () => {
  const queue = new MusicQueue();
  assert.deepEqual(queue.add(Array.from({ length: 250 }, (_, i) => song(String(i))), 'user'), { added: MAX_QUEUE, omitted: 50 });
  assert.equal(queue.remove(2).encoded, '1');
  assert.throws(() => queue.remove(0));
  const before = queue.tracks.map(t => t.encoded).sort();
  queue.shuffle();
  assert.deepEqual(queue.tracks.map(t => t.encoded).sort(), before);
});
test('comandos simultáneos se serializan; un error no bloquea los siguientes', async () => {
  const lock = new GuildLock();
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const a = lock.run('guild', async () => { order.push('a'); await gate; throw Error('expected'); });
  const b = lock.run('guild', () => { order.push('b'); });
  await lock.run('other', () => order.push('other'));
  release();
  const outcomes = await Promise.allSettled([a, b]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.equal(outcomes[1].status, 'fulfilled');
  assert.deepEqual(order, ['a', 'other', 'b']);
  assert.equal(lock.pending.size, 0);
});
