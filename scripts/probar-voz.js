// Manual integration check. Run with the normal bot stopped and its owner in voice.
// Does not post text messages. Plays the supplied query for ten seconds, then leaves.
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../src/config.js';
import { createMusic } from '../src/music/index.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const music = createMusic(client);
const transitions = process.argv.includes('--transiciones');
const equalizerTest = process.argv.includes('--ecualizador');
const automixTest = process.argv.includes('--automix');
let savedMix;
const deadline = setTimeout(() => { console.error('Prueba excedió 100 segundos.'); process.exit(1); }, 100_000);
try {
  // Wait for the local audio node before the gateway connector starts retries.
  let nodeReady = false;
  for (let i = 0; i < 100; i++) {
    try {
      const protocol = config.lavalink.secure ? 'https' : 'http';
      const response = await fetch(`${protocol}://${config.lavalink.host}:${config.lavalink.port}/version`, { headers: { Authorization: config.lavalink.password }, signal: AbortSignal.timeout(1000) });
      if (response.ok) { nodeReady = true; break; }
    } catch {}
    await delay(250);
  }
  if (!nodeReady) throw Error('El motor de música no está disponible.');
  const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
  await client.login(config.discord.token);
  await ready;
  for (let i = 0; i < 40 && !music.isReady(); i++) await delay(250);
  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) throw Error('Servidor no disponible.');
  if (guild.members.me?.voice.channelId && !transitions && !equalizerTest && !automixTest) throw Error('El bot ya está en un canal; no se interrumpe esa sesión.');
  const member = await guild.members.fetch(config.discord.ownerId);
  if (!member.voice.channel) throw Error('El propietario debe estar conectado a voz.');
  const starts = [];
  const channel = { send: async payload => {
    console.log('Aviso:', payload.content || payload.embeds?.[0]?.data?.title);
    if (payload.embeds?.[0]?.data?.title === '🎵 Reproduciendo') starts.push(performance.now());
  } };
  let reply;
  const command = (action, query) => music.run({
    inGuild: () => true, guildId: guild.id, guild, user: member.user, channel,
    createdTimestamp: Date.now(), deferred: true,
    options: { getString: name => typeof query === 'string' ? query : query?.[name] ?? null,
      getInteger: name => query?.[name] ?? null, getBoolean: name => query?.[name] ?? null },
    editReply: async payload => { reply = payload.content; console.log('Resultado:', reply); }
  }, action);
  if (automixTest) {
    savedMix = music.settings(guild.id);
    await music.configure(guild.id, { mode: 'dj', seconds: 3, syncBpm: true, normalize: true });
  }
  await command('play', transitions || equalizerTest || automixTest ? 'Daft Punk Get Lucky' : process.argv[2] || 'Daft Punk Get Lucky');
  if (reply?.startsWith('❌')) throw Error(reply);
  if (equalizerTest) {
    for (const mode of ['equilibrado', 'original', 'equilibrado']) {
      await command('ecualizador', mode);
      if (reply?.startsWith('❌') || music.status(guild.id)?.equalizer !== mode) throw Error('No se aplicó el ecualizador.');
    }
    await delay(10_000);
  } else if (transitions || automixTest) {
    await command('play', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    if (reply?.startsWith('❌')) throw Error(reply);
    for (let i = 0; i < 300 && !music.status(guild.id)?.preloaded; i++) await delay(200);
    if (!music.status(guild.id)?.preloaded) throw Error('La siguiente canción no se precargó.');
    if (automixTest) {
      if (music.status(guild.id).mixingDisabled) throw Error('AutoMix cayó a reproducción de respaldo.');
      await command('pausa');
      await delay(100);
      const before = music.status(guild.id).position;
      await delay(4000);
      if (music.status(guild.id).position - before > 40) throw Error('AutoMix siguió avanzando en pausa.');
      await command('continuar');
    }
    const previousStarts = starts.length;
    const skipTime = performance.now();
    await command('saltar');
    for (let i = 0; i < 100 && starts.length === previousStarts; i++) await delay(20);
    if (starts.length === previousStarts) throw Error('No comenzó la siguiente canción.');
    console.log(`Salto hasta anunciar la siguiente canción: ${Math.round(starts.at(-1) - skipTime)}ms.`);
    // Lavalink sends position updates every five seconds.
    await delay(6_000);
    if (automixTest) {
      const state = music.status(guild.id);
      if (state.mixingDisabled || state.transition?.type !== 'dj') throw Error('No se ejecutó la mezcla DJ real.');
      console.log('OK: DJ real, tempo conservando tono, pausa/continuar y salto.');
      await command('automix', { modo: 'crossfade', duracion: 4, sincronizar: false, normalizar: true });
      if (reply?.startsWith('❌')) throw Error(reply);
    }
  } else await delay(10_000);
  const status = music.status(guild.id);
  console.log('Estado real de voz:', JSON.stringify(status));
  if (!status?.playing || status.position < 1000) throw Error('El audio no avanzó en el canal de voz.');
  console.log('OK: conexión de voz y reproducción avanzando.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (savedMix) await music.configure(config.discord.guildId, savedMix);
  await music.close();
  client.destroy();
  clearTimeout(deadline);
  process.exit(process.exitCode || 0);
}
