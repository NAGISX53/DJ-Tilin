import { tracksFrom, MAX_QUEUE } from './queue.js';
import { localAudio } from './audio.js';

export function spotifyReference(value) {
  const uri = /^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)$/.exec(value);
  if (uri) return { type: uri[1], id: uri[2] };
  if (!value.startsWith('https://open.spotify.com/')) return null;
  const match = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)\/?$/.exec(new URL(value).pathname);
  if (!match) throw new Error('Ese enlace de Spotify no es una canción, álbum, artista o playlist pública.');
  return { type: match[1], id: match[2] };
}

export function spotifyTracks(entity) {
  const rows = entity.type === 'track' ? [{
    title: entity.title || entity.name,
    subtitle: entity.artists?.map(artist => artist.name).join(', '),
    duration: entity.duration, uri: entity.uri
  }] : entity.trackList || [];
  return rows.filter(row => row.title && row.uri?.startsWith('spotify:track:')).slice(0, MAX_QUEUE).map(row => ({
    encoded: null,
    query: `ytsearch:${row.title} ${row.subtitle || ''} audio`,
    info: { title: row.title, author: row.subtitle || '', length: row.duration || 0, isStream: false, sourceName: 'spotify' }
  }));
}

export async function resolveTracks(node, value) {
  const reference = spotifyReference(value);
  if (!reference) return { tracks: tracksFrom(await node.rest.resolve(value)), note: '' };
  // Prefer the native source; public embeds provide a credential-free fallback.
  try {
    const tracks = tracksFrom(await node.rest.resolve(value));
    if (tracks.length) return { tracks, note: '' };
  } catch { /* Spotify's anonymous API is not available on every network. */ }
  const response = await fetch(`https://open.spotify.com/embed/${reference.type}/${reference.id}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('No pude leer ese enlace de Spotify. Comprueba que sea público o escribe canción y artista.');
  const html = await response.text();
  const data = /<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  let entity;
  try { entity = data && JSON.parse(data[1]).props?.pageProps?.state?.data?.entity; }
  catch { /* A changed public embed gets the same clear error below. */ }
  if (!entity) throw new Error('Spotify no dejó leer este enlace. Prueba escribiendo canción y artista.');
  const tracks = spotifyTracks(entity);
  return {
    tracks,
    note: reference.type === 'track' ? '' : 'Spotify mostró las canciones de su reproductor público; una lista larga puede quedar incompleta.'
  };
}

export async function playableTrack(node, track, loadAudio = localAudio) {
  if (track.localAudio) return track;
  if (track.encoded && track.info.sourceName !== 'youtube' && track.info.sourceName !== 'spotify') return track;
  if (track.encoded && track.info.sourceName === 'youtube') {
    track.encoded = await loadAudio(node, track.info);
    track.filePath = track.info.localPath;
    track.localAudio = true;
    return track;
  }
  const result = await node.rest.resolve(track.query || `ytsearch:${track.info.title} ${track.info.author} audio`);
  if (result?.loadType !== 'search' || !result.data.length) throw new Error('No encontré audio para esta canción de Spotify.');
  // Prefer a version close in duration; fall back to the top search result.
  const candidates = result.data.slice(0, 5);
  const match = candidates.find(item => !item.info.isStream && Math.abs(item.info.length - track.info.length) < 12_000) || candidates[0];
  track.encoded = await loadAudio(node, match.info);
  track.filePath = match.info.localPath;
  track.localAudio = true;
  return track;
}
