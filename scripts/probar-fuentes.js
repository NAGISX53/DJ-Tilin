import { config } from '../src/config.js';
import { resolveTracks, playableTrack } from '../src/music/sources.js';

const base = `${config.lavalink.secure ? 'https' : 'http'}://${config.lavalink.host}:${config.lavalink.port}`;
const queries = process.argv.slice(2);
await Promise.all((queries.length ? queries : [
  'ytsearch:Daft Punk Get Lucky',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
]).map(async identifier => {
  try {
    const node = { rest: { resolve: async value => {
    const response = await fetch(`${base}/v4/loadtracks?identifier=${encodeURIComponent(value)}`, {
      headers: { Authorization: config.lavalink.password }, signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
    } } };
    const { tracks, note } = await resolveTracks(node, identifier);
    if (tracks.length) await playableTrack(node, tracks[0]);
    console.log(JSON.stringify({ identifier, count: tracks.length, first: tracks[0]?.info?.title, audioResolved: Boolean(tracks[0]?.encoded), note }));
    if (!tracks.length) process.exitCode = 1;
  } catch (error) { console.error(`${identifier}: ${error.message}`); process.exitCode = 1; }
}));
