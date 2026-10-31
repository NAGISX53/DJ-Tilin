import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat, rename, unlink, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, 'runtime', 'audio');
const pending = new Map();

export async function localAudio(node, info) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(info.identifier || '')) throw Error('YouTube no devolvió un identificador de video válido.');
  const id = info.identifier;
  const filename = path.join(cache, `${id}.audio`);
  await mkdir(cache, { recursive: true });
  if (!await stat(filename).catch(() => null)) {
    if (!pending.has(id)) {
      pending.set(id, (async () => {
        // Download through yt-dlp itself: forwarding its signed URL to Java can
        // lose the HTTP behavior required by YouTube and result in a 403.
        const temporary = `${filename}.download`;
        try {
          await execute(path.join(root, 'runtime', 'yt-dlp.exe'), [
            '--no-playlist', '--no-warnings', '--quiet', '--no-part',
            '--max-filesize', '60M', '-f', 'bestaudio', '-o', temporary,
            '--', `https://www.youtube.com/watch?v=${id}`
          ], { cwd: root, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
          if (!(await stat(temporary)).size) throw Error('Archivo de audio vacío.');
          await rename(temporary, filename);
        } catch {
          await unlink(temporary).catch(() => {});
          throw Error('No pude obtener el audio completo de YouTube. Prueba otra canción.');
        }
      })().finally(() => pending.delete(id)));
    }
    await pending.get(id);
  }
  const result = await node.rest.resolve(filename);
  if (result?.loadType !== 'track') throw Error('El motor no pudo abrir el audio descargado.');
  info.localPath = filename;
  return result.data.encoded;
}

export async function cleanAudioCache() {
  await mkdir(cache, { recursive: true });
  const files = await readdir(cache);
  await Promise.all(files.map(async name => {
    if (!/^[a-zA-Z0-9_-]{11}\.audio(?:\.download)?$/.test(name)) return;
    const filename = path.join(cache, name);
    const file = await stat(filename).catch(() => null);
    if (file && Date.now() - file.mtimeMs > 24 * 60 * 60 * 1000) await unlink(filename).catch(() => {});
  }));
}
