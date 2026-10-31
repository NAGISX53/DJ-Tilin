import { Shoukaku, Connectors } from 'shoukaku';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { config } from '../config.js';
import { GuildLock, MusicQueue, identifier } from './queue.js';
import { playableTrack, resolveTracks } from './sources.js';
import { TrackPreparation } from './preparation.js';
import { AudioQuality } from './quality.js';
import { acknowledge } from './interaction.js';
import { cleanAudioCache } from './audio.js';
import { applyEqualizer, EQ_NAMES } from './equalizer.js';
import { getMusicEqualizer, setMusicEqualizer, getMixSettings, saveMixSettings } from '../db.js';
import { analyze } from './analysis.js';
import { MixSession } from './mixer.js';
import { MIX_MODES } from './mix-settings.js';

const safe = text => escapeMarkdown(String(text || 'Desconocido').slice(0, 130));
const duration = ms => {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const title = track => `${safe(track.info.title)} — ${safe(track.info.author)}`;
const controls = () => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('music:toggle').setLabel('Pausa / Continuar').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('music:saltar').setLabel('Saltar').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('music:cola').setLabel('Cola').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('music:detener').setLabel('Detener').setStyle(ButtonStyle.Danger)
)];

export function createMusic(client) {
  cleanAudioCache().catch(error => console.warn(`[Música] Caché: ${error.message}`));
  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{
    name: 'tilin-music', url: `${config.lavalink.host}:${config.lavalink.port}`,
    auth: config.lavalink.password, secure: config.lavalink.secure
  }], { resume: true, resumeTimeout: 60, reconnectTries: 5, restTimeout: 30 });
  shoukaku.on('ready', name => console.log(`[Música] ${name} conectado.`));
  shoukaku.on('error', (name, error) => console.error(`[Música] ${name}: ${error.message}`));
  const sessions = new Map();
  const lock = new GuildLock();
  const quality = new AudioQuality();

  function configureMix(state, guildId, patch) {
    const settings = saveMixSettings(guildId, patch);
    if (state) { state.mixSettings = settings; state.mixer?.configure(settings); prefetch(state); }
    return settings;
  }

  function mixDescription(state, settings) {
    const last = state?.mixer?.lastTransition;
    return `🎚️ **AutoMix: ${MIX_MODES[settings.mode]}**\nTransición: ${settings.seconds} s · Sincronizar BPM: ${settings.syncBpm ? 'sí' : 'no'} · Normalizar: ${settings.normalize ? 'sí' : 'no'}${last ? `\nÚltima transición: ${last.type}${last.fallback ? ` — ${last.fallback}` : ''}` : ''}\nLos cambios se aplican a las próximas transiciones.`;
  }

  function announceTrack(state, track, transition) {
    if (sessions.get(state.guildId) !== state) return;
    const embed = new EmbedBuilder().setColor('#9ACCF0').setTitle('🎵 Reproduciendo')
      .setDescription(title(track)).addFields(
        { name: 'Duración', value: track.info.isStream ? 'En vivo' : duration(track.info.length), inline: true },
        { name: 'Solicitada por', value: `<@${track.requester}>`, inline: true }
      );
    if (transition) embed.addFields({ name: 'Transición', value: transition.fallback || `${transition.type} · ${transition.seconds.toFixed(1)} s${transition.type === 'dj' ? ' · ritmo sincronizado sin cambiar el tono' : ''}` });
    void state.textChannel?.send({ embeds: [embed], components: controls(), allowedMentions: { parse: [] } }).catch(() => {});
  }

  function prefetch(state) {
    const candidates = state.queue.candidates(state.mixSettings);
    state.preparation.prefetch(candidates, candidates.length || 2);
  }

  function selectNext(state, reason = 'finished') {
    if (reason === 'finished' && state.queue.repeat === 'track') return state.queue.current;
    state.queue.orderForMix(state.mixSettings, state.mixer?.current?.rate || 1, item => state.preparation.ready.has(item));
    return state.queue.tracks[0] || (reason === 'finished' && state.queue.repeat === 'queue' ? state.queue.current : null);
  }

  async function startMix(state, track) {
    state.mixer?.stop();
    const mixer = new MixSession({
      track, settings: state.mixSettings,
      peek: () => selectNext(state),
      ready: item => state.preparation.ready.has(item),
      prepare: item => state.preparation.prepare(item),
      // Queue mutations are synchronous on Node's event loop. Do not wait for
      // a command's network search while the audio thread needs its next song.
      next: reason => {
        if (sessions.get(state.guildId) !== state) return null;
        selectNext(state, reason);
        const next = state.queue.next(reason);
        prefetch(state);
        return next;
      },
      onTrack: (next, transition) => announceTrack(state, next, transition),
      onError: error => console.warn(`[AutoMix] ${error.message}`)
    });
    try {
      const result = await state.player.node.rest.resolve(await mixer.url());
      if (result?.loadType !== 'track') throw Error('El motor no pudo abrir el mezclador.');
      state.mixer = mixer; state.streamEncoded = result.data.encoded;
      mixer.activate();
      await state.player.playTrack({ track: { encoded: result.data.encoded }, paused: false });
    } catch (error) { mixer.stop(); state.mixer = null; state.streamEncoded = null; throw error; }
  }

  async function synchronizeQuality(state, channel) {
    const settings = await quality.synchronize(channel);
    if (state.quality?.bitrate !== settings.bitrate) console.log(`[Música] Opus estéreo 48kHz: ${settings.bitrate / 1000} kbps (máximo del servidor ${settings.maximum / 1000}).`);
    state.quality = settings;
  }

  const notify = (state, content) => state.textChannel?.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
  const event = (state, action) => lock.run(state.guildId, async () => {
    if (sessions.get(state.guildId) === state) await action();
  }).catch(error => console.error(`[Música] ${error.message}`));

  async function destroy(state) {
    clearTimeout(state.idleTimer);
    clearTimeout(state.emptyTimer);
    state.mixer?.stop();
    state.preparation.close();
    sessions.delete(state.guildId);
    await shoukaku.leaveVoiceChannel(state.guildId).catch(error => console.warn(`[Música] Al salir: ${error.message}`));
  }

  function idle(state) {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => event(state, async () => {
      await destroy(state);
      await notify(state, '👋 Salí del canal porque la cola terminó. Usa /play para volver a escuchar música.');
    }), 120_000).unref();
  }

  async function advance(state, reason) {
    clearTimeout(state.idleTimer);
    // Failed tracks must never loop, even with repeat enabled.
    selectNext(state, reason);
    let track = state.queue.next(reason);
    while (track) {
      try {
        const began = performance.now();
        await state.preparation.prepare(track);
        if (!state.mixingDisabled) {
          try { await startMix(state, track); }
          catch (error) { state.mixingDisabled = true; console.warn(`[AutoMix] ${error.message}; reproducción normal.`); }
        }
        if (state.mixingDisabled) {
          state.streamEncoded = null;
          await state.player.playTrack({ track: { encoded: track.encoded }, paused: false });
        }
        console.log(`[Música] Cambio de canción preparado en ${Math.round(performance.now() - began)}ms.`);
        prefetch(state);
        return;
      } catch {
        await notify(state, `⚠️ No pude reproducir ${title(track)}. Intentaré la siguiente.`);
        track = state.queue.next('loadFailed');
      }
    }
    idle(state);
  }

  async function checkVoice(interaction, state, joining = false) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;
    if (!channel) throw new Error('Primero entra a un canal de voz.');
    if (state && channel.id !== state.channelId) throw new Error('Debes estar en el mismo canal de voz que DJ Tilin.');
    if (joining) {
      if (channel.type !== ChannelType.GuildVoice) throw new Error('Elige un canal de voz normal para reproducir música.');
      const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        throw new Error('Necesito los permisos Ver canal, Conectar y Hablar en tu canal de voz.');
      }
      if (channel.full && !channel.permissionsFor(me).has(PermissionFlagsBits.MoveMembers)) throw new Error('El canal de voz está lleno.');
    }
    return channel;
  }

  function showQueue(state, page = 1) {
    const pages = Math.max(1, Math.ceil(state.queue.tracks.length / 10));
    if (page > pages) throw new Error(`La cola solo tiene ${pages} página(s).`);
    const offset = (page - 1) * 10;
    const rows = state.queue.tracks.slice(offset, offset + 10).map((track, i) => `${offset + i + 1}. ${title(track)}`);
    return { embeds: [new EmbedBuilder().setColor('#9ACCF0').setTitle('🎶 Cola de DJ Tilin')
      .setDescription(`**Ahora:** ${state.queue.current ? title(state.queue.current) : 'Sin reproducción'}\n\n${rows.join('\n') || 'No hay canciones pendientes.'}`)
      .setFooter({ text: `Página ${page}/${pages} · ${state.queue.tracks.length} pendientes · Repetición: ${state.queue.repeat}${state.queue.tracks[0]?.shuffleGroup ? ' · Aleatorio (AutoMix puede reordenar)' : ''}` })] };
  }

  async function run(interaction, action) {
    if (!interaction.inGuild() || interaction.guildId !== config.discord.guildId) {
      return interaction.reply({ content: 'Usa este comando en el servidor configurado para DJ Tilin.', ephemeral: true });
    }
    console.log(`[Música] /${action}: recibido; antigüedad ${Date.now() - interaction.createdTimestamp}ms.`);
    try {
      if (!await acknowledge(interaction)) return;
      console.log(`[Música] /${action}: confirmado.`);
      if (action === 'play') await interaction.editReply({ content: '🎵 Preparando la música…', allowedMentions: { parse: [] } });
      const payload = await lock.run(interaction.guildId, async () => {
        let state = sessions.get(interaction.guildId);
        if (action === 'play') {
          await checkVoice(interaction, state, true);
          console.log('[Música] Canal y permisos comprobados.');
          const node = shoukaku.options.nodeResolver(shoukaku.nodes);
          if (!node) throw new Error('El motor de música está desconectado. Inicia Lavalink con INICIAR-MUSICA.cmd y vuelve a intentar.');
          let tracks, note;
          try { ({ tracks, note } = await resolveTracks(node, identifier(interaction.options.getString('busqueda', true)))); }
          catch (error) {
            if (error.name === 'RestError') throw new Error('El motor de música no respondió. Revisa Lavalink e inténtalo de nuevo.');
            throw error;
          }
          if (!tracks.length) throw new Error('No encontré canciones. Prueba el título junto con el artista o un enlace público.');
          console.log(`[Música] ${tracks.length} canción(es) encontradas.`);
          const channel = await checkVoice(interaction, state, true);
          if (!state) {
            let player;
            try { player = await shoukaku.joinVoiceChannel({ guildId: interaction.guildId, channelId: channel.id, shardId: interaction.guild.shardId, deaf: true }); }
            catch {
              await shoukaku.leaveVoiceChannel(interaction.guildId).catch(() => {});
              throw new Error('No pude entrar al canal de voz. Revisa los permisos y que Lavalink esté actualizado.');
            }
            state = { guildId: interaction.guildId, channelId: channel.id, textChannel: interaction.channel, player, queue: new MusicQueue(), volume: 50, mixSettings: getMixSettings(interaction.guildId) };
            state.preparation = new TrackPreparation(player.node, async (node, item) => {
              await playableTrack(node, item);
              if (item.filePath) {
                try { await analyze(item); }
                catch (error) { console.warn(`[AutoMix] Análisis no disponible: ${error.message}`); }
              }
              return item;
            }, error => console.warn(`[Música] Precarga: ${error.message}`));
            sessions.set(interaction.guildId, state);
            try { await synchronizeQuality(state, channel); }
            catch (error) { await destroy(state); throw error; }
            console.log('[Música] Conexión de voz preparada.');
            player.on('start', () => {
              if (sessions.get(state.guildId) !== state) return;
              const track = state.queue.current;
              // Posting the card must not hold up an end/skip event if Discord
              // is slow: playback and notification have independent lifetimes.
              if (track) announceTrack(state, track);
            });
            player.on('end', data => event(state, async () => {
              if (!['finished', 'loadFailed', 'stopped'].includes(data.reason)) return;
              if (state.streamEncoded && data.track?.encoded && data.track.encoded !== state.streamEncoded) return;
              if (state.mixer) {
                const mixer = state.mixer;
                state.mixer = null; state.streamEncoded = null;
                mixer.stop();
                if (mixer.finished && !mixer.failure) { state.queue.current = null; idle(state); return; }
                state.mixingDisabled = true;
                if (state.queue.current) {
                  await notify(state, '⚠️ AutoMix no respondió. Continúo con reproducción normal.');
                  await state.preparation.prepare(state.queue.current);
                  await player.playTrack({ track: { encoded: state.queue.current.encoded }, paused: false });
                  return;
                }
              }
              await advance(state, data.reason);
            }));
            // Lavalink emits loadFailed after a track exception. Advance on end only.
            player.on('exception', () => event(state, () => state.mixer?.finished ? undefined : notify(state, '⚠️ La fuente no pudo reproducir esta canción. Intentaré la siguiente; si se repite, revisa el registro de Lavalink.')));
            player.on('stuck', () => event(state, async () => {
              await notify(state, '⚠️ La canción dejó de responder. La saltaré.');
              await player.stopTrack();
            }));
            player.on('closed', () => event(state, async () => {
              await destroy(state);
              await notify(state, 'La conexión de voz se cerró. Usa /play para reconectar.');
            }));
            try {
              await player.setGlobalVolume(state.volume);
              await applyEqualizer(state, getMusicEqualizer(interaction.guildId));
            }
            catch { await destroy(state); throw new Error('No pude preparar el reproductor. Vuelve a intentar /play.'); }
          }
          state.textChannel = interaction.channel;
          const shuffled = interaction.options.getBoolean('aleatorio') === true;
          const result = state.queue.add(tracks, interaction.user.id, { shuffle: shuffled });
          if (!result.added) throw new Error('La cola está llena (200 canciones pendientes).');
          clearTimeout(state.idleTimer);
          if (!state.queue.current) await advance(state, 'initial');
          else prefetch(state);
          return { content: `✅ Agregué ${result.added} canción(es): ${title(tracks[0])}.${result.omitted ? ` Se omitieron ${result.omitted} por el límite de 200 canciones.` : ''}${tracks[0].info.sourceName === 'spotify' ? '\nSpotify: audio mediante una coincidencia en YouTube.' : ''}${note ? `\n${note}` : ''}${shuffled ? '\n🔀 Lista aleatoria. Smart Mix y DJ elegirán la siguiente entre hasta 6 candidatas analizadas; normal y crossfade conservan el orden aleatorio.' : ''}` };
        }
        if (action === 'automix') {
          const options = {
            mode: interaction.options.getString('modo'), seconds: interaction.options.getInteger('duracion'),
            syncBpm: interaction.options.getBoolean('sincronizar'), normalize: interaction.options.getBoolean('normalizar')
          };
          const patch = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null && value !== undefined));
          if (!Object.keys(patch).length) return { content: mixDescription(state, state?.mixSettings || getMixSettings(interaction.guildId)) };
          await checkVoice(interaction, state);
          return { content: mixDescription(state, configureMix(state, interaction.guildId, patch)) };
        }
        if (action === 'ecualizador') {
          const mode = interaction.options.getString('modo');
          if (!mode) return { content: `🎛️ Ecualizador: **${EQ_NAMES[state?.equalizer || getMusicEqualizer(interaction.guildId)]}**. Usa modo:equilibrado para el ajuste suave o modo:original para desactivarlo.` };
          if (!Object.hasOwn(EQ_NAMES, mode)) throw Error('Elige equilibrado u original.');
          await checkVoice(interaction, state);
          if (state) await applyEqualizer(state, mode);
          setMusicEqualizer(interaction.guildId, mode);
          return { content: `🎛️ Ecualizador: **${EQ_NAMES[mode]}**. Guardé tu preferencia para las siguientes canciones y reinicios.` };
        }
        if (!state) throw new Error('No hay un reproductor activo. Usa /play primero.');
        if (action === 'cola') return showQueue(state, interaction.options?.getInteger('pagina') ?? 1);
        if (action === 'calidad') {
          const settings = state.quality;
          return { content: `🎧 **Calidad de música**\nMáximo del servidor: **${settings.maximum / 1000} kbps**\nCanal y emisión del bot: **${settings.bitrate / 1000} kbps**\nOpus · estéreo · 48 kHz\nEcualizador: ${EQ_NAMES[state.equalizer]}\nVolumen del bot: ${state.volume}%. El volumen personal de Discord es independiente.${!settings.canManage ? '\nNo tengo permiso para subir el bitrate del canal; utilizo su configuración actual.' : ''}` };
        }
        if (action === 'actual') {
          if (!state.queue.current) throw new Error('No hay una canción sonando.');
          return { content: `🎵 ${title(state.queue.current)} · ${duration(state.mixer?.position ?? state.player.position)} / ${state.queue.current.info.isStream ? 'En vivo' : duration(state.queue.current.info.length)} · Volumen ${state.volume}%${state.player.paused ? ' · En pausa' : ''} · ${state.mixingDisabled ? 'Normal (respaldo)' : MIX_MODES[state.mixSettings.mode]}` };
        }
        await checkVoice(interaction, state);
        if (action === 'detener') { await destroy(state); return { content: '⏹️ Detuve la música, vacié la cola y salí del canal.' }; }
        if (['pausa', 'continuar', 'toggle'].includes(action)) {
          if (!state.queue.current) throw new Error('No hay una canción sonando.');
          const paused = action === 'toggle' ? !state.player.paused : action === 'pausa';
          await state.player.setPaused(paused);
          state.mixer?.pause(paused);
          return { content: paused ? '⏸️ Música en pausa.' : '▶️ Continúa la música.' };
        }
        if (action === 'saltar') {
          if (!state.queue.current) throw new Error('No hay una canción sonando.');
          if (state.mixer && !state.mixer.finished) {
            // Match the existing player behavior: skipping starts the next song,
            // including when the previous one was paused.
            if (state.player.paused) await state.player.setPaused(false);
            state.mixer.pause(false);
            state.mixer.skip();
          }
          else await state.player.stopTrack(); // The stopped event advances exactly once and bypasses repeat.
          return { content: '⏭️ Canción saltada.' };
        }
        if (action === 'volumen') {
          const value = interaction.options.getInteger('nivel', true);
          await state.player.setGlobalVolume(value);
          state.volume = value;
          return { content: `🔊 Volumen: ${value}%.` };
        }
        if (action === 'repetir') {
          state.queue.repeat = interaction.options.getString('modo', true);
          return { content: `🔁 Repetición: ${{ off: 'desactivada', track: 'canción actual', queue: 'toda la cola' }[state.queue.repeat]}.` };
        }
        if (action === 'mezclar') {
          state.queue.shuffle();
          prefetch(state);
          return { content: '🔀 Mezclé las canciones pendientes. Smart Mix y DJ elegirán las próximas por compatibilidad de ritmo.' };
        }
        if (action === 'quitar') {
          const removed = state.queue.remove(interaction.options.getInteger('posicion', true));
          prefetch(state);
          return { content: `🗑️ Quité ${title(removed)}.` };
        }
        throw new Error('Control de música desconocido.');
      });
      await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
      console.log(`[Música] /${action}: completado.`);
    } catch (error) {
      console.warn(`[Música] ${error.message}`);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ ${error.message}`, allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    const state = sessions.get(newState.guild.id);
    if (!state) return;
    event(state, async () => {
      if (newState.id === client.user.id) {
        if (!newState.channelId) { await destroy(state); return; }
        state.channelId = newState.channelId;
        const destination = newState.guild.channels.cache.get(state.channelId);
        if (destination) await synchronizeQuality(state, destination);
      }
      const channel = newState.guild.channels.cache.get(state.channelId);
      clearTimeout(state.emptyTimer);
      if (channel && !channel.members.some(member => !member.user.bot)) {
        state.emptyTimer = setTimeout(() => event(state, async () => {
          const current = newState.guild.channels.cache.get(state.channelId);
          if (current?.members.some(member => !member.user.bot)) return;
          await destroy(state);
          await notify(state, '👋 Salí del canal porque ya no quedaban oyentes.');
        }), 60_000).unref();
      }
    });
  });

  client.on('guildUpdate', (oldGuild, guild) => {
    const state = sessions.get(guild.id);
    if (state) event(state, async () => {
      const channel = guild.channels.cache.get(state.channelId);
      if (channel) await synchronizeQuality(state, channel);
    });
  });
  client.on('channelUpdate', (oldChannel, channel) => {
    const state = sessions.get(channel.guild?.id);
    if (state && channel.id === state.channelId && oldChannel.bitrate !== channel.bitrate) {
      event(state, () => synchronizeQuality(state, channel));
    }
  });

  shoukaku.on('close', () => {
    for (const state of sessions.values()) event(state, async () => {
      await destroy(state);
      await notify(state, '⚠️ Se perdió la conexión con el motor de música. Cuando vuelva a estar disponible, usa /play.');
    });
  });

  return {
    run,
    configure: (guildId, patch) => lock.run(guildId, () => configureMix(sessions.get(guildId), guildId, patch)),
    settings: guildId => getMixSettings(guildId),
    isReady: () => Boolean(shoukaku.options.nodeResolver(shoukaku.nodes)),
    status: guildId => {
      const state = sessions.get(guildId);
      return state ? { channelId: state.channelId, position: state.mixer?.position ?? state.player.position, playing: Boolean(state.queue.current), paused: state.player.paused,
        preloaded: state.queue.tracks.slice(0, 2).filter(track => track.localAudio).length, equalizer: state.equalizer,
        automix: state.mixSettings, transition: state.mixer?.lastTransition || null, mixingDisabled: Boolean(state.mixingDisabled) } : null;
    },
    handleButton: interaction => run(interaction, interaction.customId.slice('music:'.length)),
    close: async () => {
      await Promise.all([...sessions.values()].map(state => lock.run(state.guildId, () => destroy(state))));
      for (const name of [...shoukaku.nodes.keys()]) shoukaku.removeNode(name);
    }
  };
}
