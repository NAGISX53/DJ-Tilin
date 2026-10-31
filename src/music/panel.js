import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { EQ_NAMES } from './equalizer.js';
import { analysisDescription } from './spectral.js';
import { MIX_MODES } from './mix-settings.js';
const safe = (value, max = 160) => escapeMarkdown(String(value || 'Desconocido').slice(0,max));
const time = ms => { const seconds=Math.max(0,Math.floor((ms || 0)/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'); };
const song = track => safe(track.info.title)+' — '+safe(track.info.author,90);
const button = (action,label,disabled=false,style=ButtonStyle.Secondary) => new ButtonBuilder().setCustomId('music:'+action).setLabel(label).setStyle(style).setDisabled(disabled);
export function artwork(track) {
  const id=track?.audioInfo?.identifier || track?.info?.identifier;
  if (/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return 'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';
  try { const url=new URL(track?.info?.artworkUrl);if(url.protocol==='https:'&&['i.scdn.co','mosaic.scdn.co','i.ytimg.com'].includes(url.hostname))return url.toString(); } catch {}
  return null;
}
export function renderPanel(state, phase='playing') {
  const current=state.queue.current;
  const saved=phase==='saved', stopped=phase==='stopped', active=!saved&&!stopped;
  const playing=Boolean(current)&&active;
  const paused=Boolean(state.player.paused);
  const position=state.mixer?.position ?? (state.starting ? state.resumePosition || 0 : state.player.position || 0);
  const length=current?.info.length || 0;
  const progress=Math.max(0,Math.min(12,Math.floor(position/Math.max(1,length)*12)));
  const bar='▰'.repeat(progress)+'▱'.repeat(12-progress);
  const status=saved?'💾 Cola guardada':stopped?'⏹️ Detenido':!current?'🎶 Cola terminada':paused?'⏸️ En pausa':'🎵 Reproduciendo';
  const embed=new EmbedBuilder().setColor(saved?'#F5A6C6':'#9ACCF0').setAuthor({name:'DJ Tilin · Reproductor'})
    .setTitle(status).setDescription(current?song(current):'Usa /play para añadir música.');
  const cover=artwork(current);if(cover)embed.setThumbnail(cover);
  if(current){
    embed.addFields({name:'Progreso',value:current.info.isStream?'🔴 En vivo':bar+'  '+time(position)+' / '+time(length)});
    if(current.requester)embed.addFields({name:'Solicitada por',value:'<@'+current.requester+'>',inline:true});
  }
  const next=state.queue.repeat==='track'&&current?current:state.queue.tracks[0] || (state.queue.repeat==='queue'?current:null);
  embed.addFields({name:'Siguiente',value:next?song(next):'No hay más canciones.'},
    {name:'Cola',value:String(state.queue.tracks.length)+' pendientes',inline:true},
    {name:'Volumen',value:state.volume+'%',inline:true},
    {name:'Repetición',value:({off:'Desactivada',track:'Esta canción',queue:'Toda la cola'})[state.queue.repeat],inline:true},
    {name:'AutoMix',value:MIX_MODES[state.mixSettings.mode]+' · '+state.mixSettings.seconds+' s',inline:true},
    {name:'Audio',value:(state.quality?state.quality.bitrate/1000+' kbps · ':'')+(EQ_NAMES[state.equalizer] || EQ_NAMES.equilibrado),inline:true});
  if(current?.analysis)embed.addFields({name:'Análisis estimado',value:analysisDescription(current.analysis)});
  const transition=state.panelTransition || state.mixer?.lastTransition;
  if(state.djSettings?.roleId)embed.addFields({name:'Controles DJ',value:'<@&'+state.djSettings.roleId+'> · '+(state.djSettings.voting?'Votos para saltar: '+(state.skipTally?.count || 0)+'/'+(state.skipTally?.needed || 1):'Votación desactivada')});
  if(transition)embed.addFields({name:'Última mezcla',value:safe(transition.fallback || transition.adjustment || transition.type+' · '+transition.seconds.toFixed(1)+' s',250)});
  embed.setFooter({text:(state.guildName || 'Música del servidor')+' · Progreso actualizado cada 15 s'+(saved?' · Usa Recuperar cola o /continuar':'')});
  const rows=[new ActionRowBuilder().addComponents(
    button(saved?'continuar':'toggle',saved?'Recuperar cola':paused?'▶ Continuar':'Ⅱ Pausa',stopped||(!current&&!saved),ButtonStyle.Primary),
    button('saltar',state.djSettings?.voting?'Saltar / Votar':'Saltar',!playing),button('cola','Cola',stopped),button('detener','Detener',stopped,ButtonStyle.Danger),button('panel-favorite','♡ Favorita',stopped||!current)),
    new ActionRowBuilder().addComponents(button('panel-volume-down','Volumen −5',!active||state.volume<=0),button('panel-volume-up','Volumen +5',!active||state.volume>=100),
      button('panel-repeat','Repetir',!active),button('mezclar','Aleatorio',!active||state.queue.tracks.length<2),button('panel-refresh','Actualizar',!active)),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('music:panel-mode').setPlaceholder('Modo de mezcla').setDisabled(!active)
      .addOptions(Object.entries(MIX_MODES).map(([value,label])=>({label,value,default:value===state.mixSettings.mode}))))];
  return {content:'',embeds:[embed],components:rows,allowedMentions:{parse:[]}};
}

// One serial writer per guild: edits never block audio or duplicate a message
// when a track change, progress timer and button arrive at the same time.
export class MusicPanels {
  constructor(client,store,onError=error=>console.warn('[Reproductor] '+error.message),decorate=state=>state) {
    this.client=client;this.store=store;this.onError=onError;this.items=new Map();this.decorate=decorate;
  }
  update(...args) {
    try { return this.refresh(...args); }
    catch(error) { this.onError(error); return Promise.resolve(false); }
  }
  refresh(state,phase='playing',{force=false,repost=false}={}) {
    if(!state.textChannel?.send)return Promise.resolve(false);
    let item=this.items.get(state.guildId);
    if(!item){item={guildId:state.guildId,record:this.store.read(state.guildId),worker:null,dirty:false,retryAt:0,repostVersion:0,publishedVersion:0};this.items.set(state.guildId,item);}
    if(item.channel?.id!==state.textChannel.id)item.retryAt=0;
    item.channel=state.textChannel;
    item.payload=renderPanel({...this.decorate(state),guildName:this.client.guilds?.cache.get(state.guildId)?.name || state.guildName},phase);
    item.dirty=true;
    if(repost)item.repostVersion++;
    if(force)item.retryAt=0;
    if(!item.worker){item.worker=this.pump(item).finally(()=>{item.worker=null;if(item.dirty&&!item.cancelled&&Date.now()>=item.retryAt)this.start(item);});}
    return item.worker;
  }
  start(item) {
    if(item.worker||item.cancelled)return;
    item.worker=this.pump(item).finally(()=>{item.worker=null;if(item.dirty&&!item.cancelled&&Date.now()>=item.retryAt)this.start(item);});
  }
  async pump(item) {
    while(item.dirty&&!item.cancelled&&Date.now()>=item.retryAt){
      item.dirty=false;
      const channel=item.channel,payload=item.payload,repostVersion=item.repostVersion;
      try{
        if(item.record&&item.record.channelId!==channel.id){
          const old=this.client.channels?.cache.get(item.record.channelId) || await this.client.channels?.fetch(item.record.channelId).catch(()=>null);
          if(old?.messages)await old.messages.edit(item.record.messageId,{content:'🎛️ El reproductor se trasladó a <#'+channel.id+'>.',embeds:[],components:[],allowedMentions:{parse:[]}}).catch(()=>{});
          item.record=null;
        }
        if(item.record&&repostVersion>item.publishedVersion){
          const previous=item.record;
          const message=await channel.send(payload);
          if(item.cancelled){await channel.messages.delete(message.id).catch(()=>{});return false;}
          const record={channelId:channel.id,messageId:message.id};
          try{this.store.save(item.guildId,record);}
          catch(error){await channel.messages.delete(message.id).catch(()=>{});throw error;}
          item.record=record;item.publishedVersion=repostVersion;
          // Only remove our previous panel after the replacement is available.
          try{await channel.messages.delete(previous.messageId);}
          catch(error){
            if(Number(error.code)!==10008){
              try{await channel.messages.edit(previous.messageId,{content:'🎛️ Reproductor actualizado. Usa el mensaje más reciente.',embeds:[],components:[],allowedMentions:{parse:[]}});}
              catch(retireError){this.onError(retireError);}
            }
          }
        }else if(item.record){
          try{await channel.messages.edit(item.record.messageId,payload);}
          catch(error){if(Number(error.code)!==10008)throw error;item.record=null;}
        }
        if(!item.record&&!item.cancelled){
          const message=await channel.send(payload);
          if(item.cancelled)return false;
          item.record={channelId:channel.id,messageId:message.id};this.store.save(item.guildId,item.record);
          item.publishedVersion=repostVersion;
        }
        item.retryAt=0;
      }catch(error){item.retryAt=Date.now()+60000;this.onError(error);}
    }
    return !item.cancelled && item.retryAt===0;
  }
  remove(guildId){const item=this.items.get(guildId);if(item)item.cancelled=true;this.items.delete(guildId);this.store.delete(guildId);}
}
