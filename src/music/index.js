import { Shoukaku, Connectors } from 'shoukaku';
import { ChannelType, EmbedBuilder, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { config } from '../config.js';
import { GuildLock, MusicQueue, identifier, MAX_QUEUE, shuffleTracks } from './queue.js';
import { playableTrack, resolveTracks } from './sources.js';
import { TrackPreparation } from './preparation.js';
import { AudioQuality } from './quality.js';
import { acknowledge } from './interaction.js';
import { cleanAudioCache } from './audio.js';
import { applyEqualizer, EQ_NAMES } from './equalizer.js';
import { getMusicEqualizer, setMusicEqualizer, getMixSettings, saveMixSettings } from '../db.js';
import { analyze } from './analysis.js';
import { MixSession } from './mixer.js';
import { sessionSnapshot } from './recovery.js';
import { sessionStore, panelStore, musicLibrary } from '../db.js';
import { MusicPanels } from './panel.js';
import { SearchPicks, searchTracks, searchPayload } from './search.js';
import { SkipVotes, managesMusic, controlsMusic, isDjControl } from './dj.js';
import { djSettings } from '../db.js';
import { bestNext } from './ordering.js';
import { analysisDescription } from './spectral.js';
import { transitionPlan } from './transition.js';
import { MIX_MODES } from './mix-settings.js';

const safe = text => escapeMarkdown(String(text || 'Desconocido').slice(0, 130));
const duration = ms => {
  const total = Math.floor((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const title = track => `${safe(track.info.title)} — ${safe(track.info.author)}`;

export function createMusic(client, { recovery = true, panelStorage = panelStore } = {}) {
  cleanAudioCache().catch(error => console.warn(`[Música] Caché: ${error.message}`));
  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [{
    name: 'tilin-music', url: `${config.lavalink.host}:${config.lavalink.port}`,
    auth: config.lavalink.password, secure: config.lavalink.secure
  }], { resume: true, resumeTimeout: 60, reconnectTries: 5, restTimeout: 30 });
  shoukaku.on('ready', name => { console.log(`[Música] ${name} conectado.`); recoverSaved().catch(reportRecoveryError); });
  shoukaku.on('error', (name, error) => console.error(`[Música] ${name}: ${error.message}`));
  const sessions = new Map();
  const lock = new GuildLock();
  const quality = new AudioQuality();
  const picks = new SearchPicks();
  const panels = new MusicPanels(client,panelStorage,undefined,state=>({...state,djSettings:djSettings.get(state.guildId),skipTally:state.skipVotes?.tally(listeners(state))}));
  let closing = false;
  const savedSession = guildId => recovery ? sessionStore.read(guildId) : null;
  function checkpoint(state, patch = {}) {
    if (!recovery || sessions.get(state.guildId) !== state) return;
    sessionStore.save({ ...sessionSnapshot(state), ...patch });
  }
  function checkpointAll() {
    for (const state of sessions.values()) try { checkpoint(state); }
    catch (error) { console.warn('[Recuperación] No pude guardar: ' + error.message); }
  }
  const reportRecoveryError = error => console.warn('[Recuperación] ' + error.message);
  const checkpointTimer = setInterval(checkpointAll, 3000).unref();
  const panelTimer = setInterval(() => { for (const state of sessions.values()) void panels.update(state); }, 15000).unref();
  const recoveryTimer = setInterval(() => { recoverSaved().catch(reportRecoveryError); }, 30000).unref();
  client.once('clientReady', () => { recoverSaved().catch(reportRecoveryError); });


  function configureMix(state, guildId, patch) {
    const settings = saveMixSettings(guildId, patch);
    if (state) { state.mixSettings = settings; state.mixer?.configure(settings); prefetch(state); void panels.update(state); }
    return settings;
  }

  function mixDescription(state, settings) {
    const last = state?.mixer?.lastTransition;
    return `🎚️ **AutoMix: ${MIX_MODES[settings.mode]}**\nTransición: ${settings.seconds} s · Sincronizar BPM: ${settings.syncBpm ? 'sí' : 'no'} · Normalizar: ${settings.normalize ? 'sí' : 'no'}${last ? `\nÚltima transición: ${last.type}${last.fallback ? ` — ${last.fallback}` : ''}` : ''}\nLos cambios se aplican a las próximas transiciones.`;
  }

  function announceTrack(state, track, transition) {
    if (sessions.get(state.guildId) !== state) return;
    state.skipVotes?.reset();
    state.panelTransition = transition || state.mixer?.lastTransition || null;
    void panels.update(state);
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

  async function startMix(state, track, { position = 0, paused = false, rate = 1 } = {}) {
    state.mixer?.stop();
    const mixer = new MixSession({
      track, settings: state.mixSettings, startPosition: position, initialRate: rate, paused,
      peek: () => selectNext(state),
      ready: item => state.preparation.ready.has(item),
      prepare: item => state.preparation.prepare(item),
      // Queue mutations are synchronous on Node's event loop. Do not wait for
      // a command's network search while the audio thread needs its next song.
      next: reason => {
        if (sessions.get(state.guildId) !== state) return null;
        selectNext(state, reason);
        state.skipVotes.reset();
        const next = state.queue.next(reason);
        prefetch(state);
        return next;
      },
      onTrack: (next, transition) => { checkpoint(state); announceTrack(state, next, transition); },
      onError: error => console.warn(`[AutoMix] ${error.message}`)
    });
    try {
      const result = await state.player.node.rest.resolve(await mixer.url());
      if (result?.loadType !== 'track') throw Error('El motor no pudo abrir el mezclador.');
      state.mixer = mixer; state.streamEncoded = result.data.encoded;
      mixer.activate();
      await state.player.playTrack({ track: { encoded: result.data.encoded }, paused });
    } catch (error) { mixer.stop(); state.mixer = null; state.streamEncoded = null; throw error; }
  }

  function listeners(state) {
    const channel=client.guilds.cache.get(state.guildId)?.channels.cache.get(state.channelId);
    return [...(channel?.members.values() || [])].filter(member=>!member.user.bot).map(member=>member.id);
  }
  async function skipSong(state) {
    const generation=state.skipVotes.claim();if(generation===null)return false;
    try {
      if(state.mixer&&!state.mixer.finished) {
        if(state.player.paused)await state.player.setPaused(false);
        if(state.skipVotes.generation!==generation)return false;
        state.mixer.pause(false);state.mixer.skip();
      }else await state.player.stopTrack();
      return true;
    }catch(error){state.skipVotes.release(generation);throw error;}
  }

  async function synchronizeQuality(state, channel) {
    const settings = await quality.synchronize(channel, state.player);
    if (state.quality?.bitrate !== settings.bitrate) console.log(`[Música] Opus estéreo 48kHz: ${settings.bitrate / 1000} kbps (máximo del servidor ${settings.maximum / 1000}).`);
    state.quality = settings;
  }

  const notify = (state, content) => state.textChannel?.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
  const event = (state, action) => lock.run(state.guildId, async () => {
    if (sessions.get(state.guildId) === state) await action();
  }).catch(error => console.error(`[Música] ${error.message}`));

  async function destroy(state, { preserve = false, autoResume = true, updatePanel = true } = {}) {
    if (recovery) { if (preserve) checkpoint(state, { autoResume }); else sessionStore.delete(state.guildId); }
    if (updatePanel) void panels.update(state, preserve ? 'saved' : 'stopped');
    clearTimeout(state.idleTimer);
    clearTimeout(state.emptyTimer);
    sessions.delete(state.guildId);
    state.mixer?.stop();
    state.preparation.close();
    await quality.release(state.guildId).catch(error => console.warn(`[Música] Limpieza de calidad: ${error.message}`));
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
    state.skipVotes.reset();
    // Failed tracks must never loop, even with repeat enabled.
    selectNext(state, reason);
    let track = state.queue.next(reason);
    while (track) {
      try {
        const began = performance.now();
        await playCurrent(state);
        console.log('[Música] Cambio de canción preparado en ' + Math.round(performance.now() - began) + 'ms.');
        return;
      } catch {
        await notify(state, `⚠️ No pude reproducir ${title(track)}. Intentaré la siguiente.`);
        track = state.queue.next('loadFailed');
      }
    }
    checkpoint(state); void panels.update(state); idle(state);
  }

  async function connectSession(guild, channel, textChannel, saved = null) {
    let player;
    try { player = await shoukaku.joinVoiceChannel({ guildId: guild.id, channelId: channel.id, shardId: guild.shardId, deaf: true }); }
    catch {
      await shoukaku.leaveVoiceChannel(guild.id).catch(() => {});
      throw new Error('No pude entrar al canal de voz. Revisa los permisos y que Lavalink esté actualizado.');
    }
    const state = { skipVotes: new SkipVotes(), guildId: guild.id, channelId: channel.id, textChannel: textChannel, player, queue: new MusicQueue(), volume: saved?.volume ?? 50, starting: true, resumePosition: saved?.position || 0, resumePaused: Boolean(saved?.paused), resumeRate: saved?.rate || 1, mixSettings: getMixSettings(guild.id) };
    state.preparation = new TrackPreparation(player.node, async (node, item) => {
      await playableTrack(node, item);
      if (item.filePath) {
        try { await analyze(item); }
        catch (error) { console.warn(`[AutoMix] Análisis no disponible: ${error.message}`); }
      }
      return item;
    }, error => console.warn(`[Música] Precarga: ${error.message}`));
    if (saved) { state.queue.current = saved.current; state.queue.tracks = saved.tracks; state.queue.repeat = saved.repeat; }
    sessions.set(guild.id, state);
    try { await synchronizeQuality(state, channel); }
    catch (error) { await destroy(state, { preserve: Boolean(saved) }); throw error; }
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
        const resumePosition = mixer.current?.track === state.queue.current ? mixer.position : 0;
        state.mixer = null; state.streamEncoded = null;
        mixer.stop();
        if (mixer.finished && !mixer.failure) { state.queue.current = null; checkpoint(state); idle(state); return; }
        state.mixingDisabled = true;
        if (state.queue.current) {
          await notify(state, '⚠️ AutoMix no respondió. Continúo con reproducción normal.');
          await playCurrent(state, { position: resumePosition, paused: state.player.paused });
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
      await destroy(state, { preserve: true, autoResume: false });
      await notify(state, 'La conexión de voz se cerró. Guardé la cola para recuperarla.');
    }));
    try {
      await player.setGlobalVolume(state.volume);
      await applyEqualizer(state, getMusicEqualizer(guild.id));
    }
    catch { await destroy(state, { preserve: Boolean(saved) }); throw new Error('No pude preparar el reproductor. Vuelve a intentar /play.'); }

    return state;
  }

  async function playCurrent(state, { position = 0, paused = false, rate = 1 } = {}) {
    const track = state.queue.current;
    state.starting = true; state.resumePosition = position; state.resumePaused = paused; state.resumeRate = rate;
    checkpoint(state);
    await state.preparation.prepare(track);
    if (!state.mixingDisabled) {
      try { await startMix(state, track, { position, paused, rate }); }
      catch (error) { state.mixingDisabled = true; console.warn('[AutoMix] ' + error.message + '; reproducción normal.'); }
    }
    if (state.mixingDisabled) {
      state.streamEncoded = null;
      await state.player.playTrack({ track: { encoded: track.encoded }, position: track.info.isStream ? 0 : position, paused });
    }
    state.starting = false;
    checkpoint(state); prefetch(state); void panels.update(state);
  }

  async function restoreSession(guild, channel, textChannel, saved) {
    if (sessions.has(guild.id)) return sessions.get(guild.id);
    const state = await connectSession(guild, channel, textChannel, saved);
    try {
      if (!state.queue.current) state.queue.current = state.queue.tracks.shift() || null;
      if (!state.queue.current) { await destroy(state); return null; }
      await playCurrent(state, { position: saved.position, paused: saved.paused, rate: saved.rate });
      await notify(state, '💾 Recuperé la cola guardada' + (saved.paused ? ' y mantuve la pausa. Usa /continuar cuando quieras.' : ' y retomé la música.'));
      return state;
    } catch (error) { await destroy(state, { preserve: true }); throw error; }
  }

  async function recoverSaved() {
    if (!recovery || closing || !client.isReady() || !shoukaku.options.nodeResolver(shoukaku.nodes)) return;
    await Promise.allSettled(sessionStore.list().map(saved => lock.run(saved.guildId, async () => {
      if (closing || !saved.autoResume || sessions.has(saved.guildId) || !savedSession(saved.guildId)) return;
      const guild = client.guilds.cache.get(saved.guildId);
      const channel = guild?.channels.cache.get(saved.voiceChannelId);
      const listener = channel?.members?.find(member => !member.user.bot);
      if (!guild?.available || !listener) return;
      try {
        const actual = await checkVoice({ guild, user: listener.user }, null, true);
        if (actual.id !== saved.voiceChannelId) return;
        const textChannel = saved.textChannelId ? await guild.channels.fetch(saved.textChannelId).catch(() => null) : null;
        await restoreSession(guild, actual, textChannel, savedSession(saved.guildId));
      } catch (error) { console.warn('[Recuperación] ' + saved.guildId + ': ' + error.message); }
    })));
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
      const alreadyJoined = me.voice?.channelId === channel.id || state?.channelId === channel.id;
      if (channel.full && !alreadyJoined && !channel.permissionsFor(me).has(PermissionFlagsBits.MoveMembers)) throw new Error('El canal de voz está lleno.');
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

  async function enqueue(interaction,tracks,{shuffled=false,accept}={}) {
    let state=sessions.get(interaction.guildId);
    if(state?.queue.tracks.length>=MAX_QUEUE)throw Error('La cola está llena (200 canciones pendientes).');
    const channel=await checkVoice(interaction,state,true);
    let created=false;
    if(!state){
      const saved=savedSession(interaction.guildId);
      state=saved?await restoreSession(interaction.guild,channel,interaction.channel,saved):await connectSession(interaction.guild,channel,interaction.channel);
      created=!saved;
    }
    try{
      if(state.queue.tracks.length>=MAX_QUEUE)throw Error('La cola está llena (200 canciones pendientes).');
      if(accept)accept();
      state.textChannel=interaction.channel;
      const result=state.queue.add(tracks,interaction.user.id,{shuffle:shuffled});
      if(!result.added)throw Error('La cola está llena (200 canciones pendientes).');
      clearTimeout(state.idleTimer);
      if(!state.queue.current)await advance(state,'initial');else prefetch(state);
      checkpoint(state);void panels.update(state);
      return result;
    }catch(error){if(created&&!state.queue.current&&!state.queue.tracks.length)await destroy(state);throw error;}
  }

  async function run(interaction, action) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Usa este comando dentro de un servidor donde esté DJ Tilin.', ephemeral: true });
    }
    console.log(`[Música] /${action}: recibido; antigüedad ${Date.now() - interaction.createdTimestamp}ms.`);
    try {
      if (!await acknowledge(interaction, { ephemeral: ['favoritos','playlist','dj'].includes(action) || action === 'buscar' || action === 'reproductor' || Boolean(interaction.isButton?.() || interaction.isStringSelectMenu?.()) })) return;
      console.log(`[Música] /${action}: confirmado.`);
      const context={guildId:interaction.guildId,userId:interaction.user.id};
      if(action==='buscar') {
        const generation=picks.begin(context);
        const voice=await checkVoice(interaction,sessions.get(interaction.guildId));
        const node=shoukaku.options.nodeResolver(shoukaku.nodes);
        if(!node)throw Error('El motor de música está desconectado.');
        const query=interaction.options.getString('consulta',true);
        const tracks=await searchTracks(node,query,interaction.options.getString('version') || 'all');
        if(!tracks.length)throw Error('No encontré versiones. Prueba canción y artista, o cambia el tipo de versión.');
        const record=picks.create({...context,generation,voiceChannelId:voice.id,tracks,edit:payload=>interaction.editReply(payload)});
        return await interaction.editReply(searchPayload(query,record));
      }
      if(action.startsWith('search-cancel:')) {
        const record=picks.cancel(action.slice('search-cancel:'.length),context);
        await record.edit({content:'Búsqueda cancelada.',embeds:[],components:[]}).catch(()=>{});
        return await interaction.editReply({content:'Búsqueda cancelada.',allowedMentions:{parse:[]}});
      }
      if(action.startsWith('search-pick:')) {
        const token=action.slice('search-pick:'.length),value=interaction.values?.[0];
        let chosen, selectedRecord;
        await lock.run(interaction.guildId,async()=>{
          const result=picks.resolve(token,value,context);chosen=result.track;selectedRecord=result.record;
          const voice=await checkVoice(interaction,sessions.get(interaction.guildId));
          if(voice.id!==result.record.voiceChannelId)throw Error('Vuelve al canal de voz donde hiciste la búsqueda o usa /buscar de nuevo.');
          await enqueue(interaction,[chosen],{accept:()=>{
            const accepted=picks.claim(token,value,context);
            void accepted.record.edit({content:'🎵 Preparando: '+title(chosen),embeds:[],components:[],allowedMentions:{parse:[]}}).catch(()=>{});
          }});
        });
        const confirmation={content:'✅ Añadí la versión elegida: '+title(chosen),embeds:[],components:[],allowedMentions:{parse:[]}};
        await selectedRecord.edit(confirmation).catch(()=>{});
        return await interaction.editReply(confirmation);
      }
      if (action === 'play') await interaction.editReply({ content: '🎵 Preparando la música…', allowedMentions: { parse: [] } });
      const payload = await lock.run(interaction.guildId, async () => {
        let state = sessions.get(interaction.guildId);
        const saved = !state ? savedSession(interaction.guildId) : null;
        if(action==='dj') {
          const sub=interaction.options.getSubcommand();
          if(sub==='estado') {
            const setting=djSettings.get(interaction.guildId);
            return {content:setting.roleId?'🎧 Rol DJ: <@&'+setting.roleId+'> · Votación: '+(setting.voting?'activada (mayoría de oyentes humanos).':'desactivada.')+' Administrar servidor también permite controlar la música.':'🎧 Sin rol DJ: todos los oyentes del canal pueden controlar la música.'};
          }
          const member=await interaction.guild.members.fetch(interaction.user.id);
          if(!managesMusic(member,interaction.guild))throw Error('Necesitas el permiso Administrar servidor para configurar el rol DJ.');
          if(sub==='desactivar')djSettings.clear(interaction.guildId);
          else {
            const role=interaction.options.getRole('rol',true);
            if(role.id===interaction.guildId||role.managed)throw Error('Elige un rol para personas; no @everyone ni un rol automático de una aplicación.');
            djSettings.save(interaction.guildId,role.id,interaction.options.getBoolean('votacion')!==false);
          }
          state?.skipVotes.reset();
          return {content:sub==='desactivar'?'✅ Rol DJ desactivado: todos los oyentes vuelven a controlar la música.':'✅ Rol DJ configurado. Los demás pueden añadir canciones'+(djSettings.get(interaction.guildId).voting?' y votar con /saltar o el botón Saltar / Votar.':'.')};
        }
        const restricted=isDjControl(action,interaction.options);
        if(restricted) {
          const member=await interaction.guild.members.fetch(interaction.user.id);
          if(!controlsMusic(member,interaction.guild,djSettings.get(interaction.guildId)))throw Error('Este control requiere el rol DJ o el permiso Administrar servidor. Puedes añadir canciones y, si está habilitado, votar con /saltar.');
        }
        if (['favoritos','playlist','panel-favorite'].includes(action)) {
          const kind=action==='playlist'?'playlist':'favorite',owner=interaction.user.id;
          const sub=action==='panel-favorite'?'guardar':interaction.options.getSubcommand();
          const name=interaction.options?.getString('nombre');
          const page=interaction.options?.getInteger('pagina') || 1;
          if(sub==='lista'){
            const entries=musicLibrary.list(owner,kind),pages=Math.max(1,Math.ceil(entries.length/10));
            if(page>pages)throw Error('Esta biblioteca solo tiene '+pages+' página(s).');
            const rows=entries.slice((page-1)*10,page*10).map((row,i)=>((page-1)*10+i+1)+'. **'+safe(row.name)+'** · '+row.count+' canción(es)');
            return {embeds:[new EmbedBuilder().setColor('#9ACCF0').setTitle(kind==='favorite'?'♡ Tus favoritos':'🎶 Tus playlists').setDescription(rows.join('\n') || 'Todavía no has guardado nada.').setFooter({text:'Página '+page+'/'+pages+' · Biblioteca personal'})]};
          }
          if(sub==='guardar'){
            await checkVoice(interaction,state);
            const current=state?.queue.current || saved?.current;
            const tracks=kind==='favorite'?[current].filter(Boolean):[current,...(state?.queue.tracks || saved?.tracks || [])].filter(Boolean);
            if(!tracks.length)throw Error('No hay una canción o cola para guardar.');
            const label=name || String(current.info.title).normalize('NFKC').slice(0,80);
            const result=musicLibrary.save(owner,kind,label,tracks,{replace:interaction.options?.getBoolean('reemplazar')===true});
            return {content:(result.duplicate?'♡ Ya estaba en tus favoritos: ':'💾 Guardé ')+(kind==='playlist'?'la playlist ':'')+'**'+safe(result.name)+'** · '+result.count+' canción(es).'};
          }
          if(sub==='quitar'||sub==='borrar'){
            if(!musicLibrary.remove(owner,kind,name))throw Error('No encontré ese nombre en tu biblioteca.');
            return {content:'🗑️ Eliminé **'+safe(name)+'** de tu biblioteca.'};
          }
          const entry=musicLibrary.get(owner,kind,name);
          if(sub==='ver'){
            const pages=Math.max(1,Math.ceil(entry.tracks.length/10));if(page>pages)throw Error('Esta playlist solo tiene '+pages+' página(s).');
            const rows=entry.tracks.slice((page-1)*10,page*10).map((track,i)=>((page-1)*10+i+1)+'. '+safe((track.info.title+' — '+track.info.author).slice(0,130)));
            return {embeds:[new EmbedBuilder().setColor('#9ACCF0').setTitle('🎶 '+safe(entry.name)).setDescription(rows.join('\n')).setFooter({text:'Página '+page+'/'+pages+' · '+entry.tracks.length+' canciones'})]};
          }
          if(sub==='reproducir'){
            const shuffled=interaction.options?.getBoolean('aleatorio')===true;
            let result;
            if(entry.tracks.length>MAX_QUEUE&&!state?.queue.current&&!state?.queue.tracks.length&&!saved){
              if(shuffled)shuffleTracks(entry.tracks);
              const first=await enqueue(interaction,entry.tracks.slice(0,1));
              const rest=await enqueue(interaction,entry.tracks.slice(1),{shuffled});
              result={added:first.added+rest.added,omitted:first.omitted+rest.omitted};
            }else result=await enqueue(interaction,entry.tracks,{shuffled});
            return {content:'✅ Añadí '+result.added+' canción(es) de **'+safe(entry.name)+'** a la cola.'+(result.omitted?' Se omitieron '+result.omitted+' por el límite de la cola.':'')+(shuffled?' 🔀 Aleatorio compatible con AutoMix.':'')};
          }
          throw Error('Acción de biblioteca desconocida.');
        }
        if (action === 'reproductor') {
          await checkVoice(interaction,state);
          if (state) { state.textChannel=interaction.channel; if(!await panels.update(state,'playing',{force:true}))throw Error('No pude publicar el reproductor. Revisa Ver canal, Enviar mensajes e Insertar enlaces.'); }
          else if (saved) {
            const view={guildId:interaction.guildId,channelId:saved.voiceChannelId,textChannel:interaction.channel,
              queue:{current:saved.current,tracks:saved.tracks,repeat:saved.repeat},volume:saved.volume,
              starting:true,resumePosition:saved.position,player:{paused:saved.paused},mixSettings:getMixSettings(interaction.guildId),equalizer:getMusicEqualizer(interaction.guildId)};
            sessionStore.save({...saved,textChannelId:interaction.channel.id});if(!await panels.update(view,'saved',{force:true}))throw Error('No pude publicar el reproductor. Revisa los permisos del canal.');
          } else throw Error('No hay una cola activa ni guardada. Usa /play primero.');
          return {content:'🎛️ Reproductor actualizado en este canal.'};
        }
        if (saved && action === 'cola') return showQueue({ queue: { current: saved.current, tracks: saved.tracks, repeat: saved.repeat } }, interaction.options?.getInteger('pagina') ?? 1);
        if (saved && action === 'actual') return { content: '💾 Cola guardada. Usa /continuar desde un canal de voz para recuperarla.' };
        if (saved && action === 'detener') {
          await checkVoice(interaction, { channelId: saved.voiceChannelId });
          sessionStore.delete(interaction.guildId); return { content: '⏹️ Borré la cola guardada.' };
        }
        if (saved && action === 'continuar') {
          const channel = await checkVoice(interaction, null, true);
          state = await restoreSession(interaction.guild, channel, interaction.channel, saved);
        }
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
          const shuffled = interaction.options.getBoolean('aleatorio') === true;
          const result = await enqueue(interaction,tracks,{shuffled});
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
        if (action === 'analisis') {
          if(!state.queue.current)throw Error('No hay una canción sonando.');
          const current=state.queue.current;
          const next=state.queue.repeat==='track'?current:(state.queue.tracks[0]?.shuffleGroup?bestNext(current,state.queue.candidates(state.mixSettings),state.mixSettings,state.mixer?.current?.rate || 1,item=>state.preparation.ready.has(item)):null) || state.queue.tracks[0] || (state.queue.repeat==='queue'?current:null);
          const plan=next?transitionPlan(current.analysis,next.analysis,state.mixSettings,state.mixer?.current?.rate || 1):null;
          const details=analysisDescription(current.analysis)+(current.analysis?.key?' · Confianza tonal '+(current.analysis.key.confidence>=0.7?'alta':'media'):'');
          return {embeds:[new EmbedBuilder().setColor('#9ACCF0').setTitle('🎼 Análisis musical estimado').setDescription(title(current)+'\n'+details)
            .addFields({name:'Siguiente candidata',value:next?title(next)+'\n'+analysisDescription(next.analysis):'No hay canciones pendientes.'},
              {name:'Transición prevista',value:plan?MIX_MODES[plan.type]+' · '+plan.seconds.toFixed(1)+' s'+(plan.fallback?'\n'+plan.fallback:'')+(plan.adjustment?'\n'+plan.adjustment:''):'Sin siguiente canción.'})
            .setFooter({text:'Estimaciones locales; no son datos oficiales. La selección compatible se aplica a colas aleatorias en Smart Mix / DJ con sincronización activada.'})]};
        }
        if (action === 'actual') {
          if (!state.queue.current) throw new Error('No hay una canción sonando.');
          return { content: `🎵 ${title(state.queue.current)} · ${duration(state.mixer?.position ?? state.player.position)} / ${state.queue.current.info.isStream ? 'En vivo' : duration(state.queue.current.info.length)} · Volumen ${state.volume}%${state.player.paused ? ' · En pausa' : ''} · ${state.mixingDisabled ? 'Normal (respaldo)' : MIX_MODES[state.mixSettings.mode]}` };
        }
        await checkVoice(interaction, state);
        if (action === 'panel-refresh') { if(!await panels.update(state,'playing',{force:true}))throw Error('No pude actualizar el reproductor. Revisa los permisos del canal.'); return {content:'🎛️ Reproductor actualizado.'}; }
        if (action === 'panel-mode') {
          const mode=interaction.values?.[0];if(!Object.hasOwn(MIX_MODES,mode))throw Error('Modo de mezcla inválido.');
          configureMix(state,interaction.guildId,{mode});return {content:'🎚️ '+MIX_MODES[mode]};
        }
        if (action === 'panel-repeat') {
          state.queue.repeat=({off:'track',track:'queue',queue:'off'})[state.queue.repeat];
          return {content:'🔁 Repetición: '+({off:'desactivada',track:'canción actual',queue:'toda la cola'})[state.queue.repeat]};
        }
        if (action === 'panel-volume-down' || action === 'panel-volume-up') {
          const value=Math.max(0,Math.min(100,state.volume+(action==='panel-volume-up'?5:-5)));
          await state.player.setGlobalVolume(value);state.volume=value;return {content:'🔊 Volumen: '+value+'%.'};
        }
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
          const settings=djSettings.get(interaction.guildId);
          const member=await interaction.guild.members.fetch(interaction.user.id);
          if(!controlsMusic(member,interaction.guild,settings)) {
            if(!settings.voting)throw Error('Solo el rol DJ o Administrar servidor puede saltar; la votación está desactivada.');
            const result=state.skipVotes.vote(interaction.user.id,listeners(state));
            if(result.pending)return {content:'⏭️ El salto de esta canción ya está en curso.'};
            if(!result.passed)return {content:(result.duplicate?'Ya habías votado. ':'🗳️ Voto registrado. ')+result.count+'/'+result.needed+' votos para saltar.'};
          }
          const skipped=await skipSong(state);
          return { content:skipped?'⏭️ Canción saltada'+(!controlsMusic(member,interaction.guild,settings)?' por mayoría de votos.':'.'):'⏭️ El salto de esta canción ya está en curso.' };
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
      const active = sessions.get(interaction.guildId);
      if (active) { checkpoint(active); void panels.update(active); }
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
        if (!newState.channelId) { await destroy(state, { preserve: true, autoResume: false }); return; }
        state.skipVotes.reset();
        state.channelId = newState.channelId;
        const destination = newState.guild.channels.cache.get(state.channelId);
        if (destination) await synchronizeQuality(state, destination);
      }
      const channel = newState.guild.channels.cache.get(state.channelId);
      const tally=state.skipVotes.tally(listeners(state));
      if(state.queue.current&&djSettings.get(state.guildId).voting&&tally.passed&&!tally.pending)await skipSong(state);
      void panels.update(state);
      clearTimeout(state.emptyTimer);
      if (channel && !channel.members.some(member => !member.user.bot)) {
        state.emptyTimer = setTimeout(() => event(state, async () => {
          const current = newState.guild.channels.cache.get(state.channelId);
          if (current?.members.some(member => !member.user.bot)) return;
          await destroy(state, { preserve: true, autoResume: false });
          await notify(state, '👋 Salí del canal porque ya no quedaban oyentes. Guardé la cola; usa /continuar para recuperarla.');
        }), 60_000).unref();
      }
    });
  });

  client.on('guildDelete', guild => {
    const state = sessions.get(guild.id);
    if (recovery) sessionStore.delete(guild.id);
    djSettings.clear(guild.id);
    panels.remove(guild.id);
    picks.removeGuild(guild.id);
    if (state) event(state, () => destroy(state,{updatePanel:false}));
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
      await destroy(state, { preserve: true });
      await notify(state, '⚠️ Se perdió el motor de música. Guardé la cola e intentaré recuperarla al reconectarse.');
    });
  });

  return {
    run,
    checkpoint: checkpointAll,
    recover: recoverSaved,
    guilds: () => [...client.guilds.cache.values()].map(g => ({ id: g.id, name: g.name })),
    configure: (guildId, patch) => lock.run(guildId, () => configureMix(sessions.get(guildId), guildId, patch)),
    settings: guildId => getMixSettings(guildId),
    isReady: () => Boolean(shoukaku.options.nodeResolver(shoukaku.nodes)),
    status: guildId => {
      const state = sessions.get(guildId);
      return state ? { channelId: state.channelId, position: state.mixer?.position ?? state.player.position, playing: Boolean(state.queue.current), paused: state.player.paused,
        preloaded: state.queue.tracks.slice(0, 2).filter(track => track.localAudio).length, equalizer: state.equalizer,
        automix: state.mixSettings, transition: state.mixer?.lastTransition || null, mixingDisabled: Boolean(state.mixingDisabled) } : null;
    },
    handleAutocomplete: async interaction => {
      try { const kind=interaction.commandName==='playlist'?'playlist':'favorite';await interaction.respond(musicLibrary.names(interaction.user.id,kind,interaction.options.getFocused())); }
      catch(error) { console.warn('[Biblioteca] '+error.message);await interaction.respond([]).catch(()=>{}); }
    },
    handleButton: interaction => run(interaction, interaction.customId.slice('music:'.length)),
    handleSelect: interaction => run(interaction, interaction.customId.slice('music:'.length)),
    close: async ({ preserve = false } = {}) => {
      picks.clear();
      closing = true; clearInterval(checkpointTimer); clearInterval(recoveryTimer); clearInterval(panelTimer);
      await Promise.all([...sessions.values()].map(state => lock.run(state.guildId, () => destroy(state, { preserve }))));
      for (const name of [...shoukaku.nodes.keys()]) shoukaku.removeNode(name);
    }
  };
}
