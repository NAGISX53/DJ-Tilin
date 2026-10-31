import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { identifier } from './queue.js';
export const SEARCH_VERSIONS = Object.freeze({ all:'Todas', original:'Estudio / oficial', remix:'Remix', live:'En directo', extended:'Extendida', instrumental:'Instrumental' });
const hints={all:'',original:'official audio',remix:'remix',live:'live',extended:'extended mix',instrumental:'instrumental'};
export async function searchTracks(node,query,version='all') {
  if(typeof query!=='string'||!query.trim()||query.length>450)throw Error('Escribe canción y artista, hasta 450 caracteres.');
  if(!Object.hasOwn(SEARCH_VERSIONS,version))throw Error('Tipo de versión inválido.');
  const base=identifier(query);
  if(!base.startsWith('ytsearch:'))throw Error('Usa /buscar con el nombre de una canción. Para enlaces o playlists, usa /play.');
  const result=await node.rest.resolve(base+(hints[version]?' '+hints[version]:''));
  if(result?.loadType==='error')throw Error('No pude consultar las versiones. Inténtalo de nuevo.');
  if(result?.loadType!=='search'||!Array.isArray(result.data))return [];
  const seen=new Set();
  return result.data.filter(track=>{
    const id=track?.info?.identifier;
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id || '')||track.info.isStream||seen.has(id))return false;
    seen.add(id);return true;
  }).slice(0,5);
}
export function versionTags(title) {
  const value=String(title || '').toLowerCase();const tags=[];
  if(/remix|rework|mashup/.test(value))tags.push('Remix');
  if(/(?:\(|\[)\s*live\b|\blive\s+(?:at|from|in|version)\b|en vivo|en directo|\bconcert/.test(value))tags.push('En directo');
  if(/extended|extendida/.test(value))tags.push('Extendida');
  if(/instrumental|karaoke/.test(value))tags.push('Instrumental');
  if(/acoustic|acústic|acustic/.test(value))tags.push('Acústica');
  if(!tags.length&&/official|oficial/.test(value))tags.push('Estudio / oficial');
  return tags.length?tags:['Sin etiqueta'];
}
const text=(value,length)=>String(value || 'Desconocido').replace(/[\r\n\t]/g,' ').slice(0,length);
const time=ms=>{const s=Math.max(0,Math.floor((ms || 0)/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
export function searchPayload(query,record) {
  const embed=new EmbedBuilder().setColor('#9ACCF0').setTitle('Elige una versión')
    .setDescription(escapeMarkdown(text(query,200))+'\nSelecciona una canción para añadirla a la cola.');
  const options=record.tracks.map((track,index)=>{
    const tags=versionTags(track.info.title).join(' · ');
    embed.addFields({name:(index+1)+'. '+escapeMarkdown(text(track.info.title,100)),value:escapeMarkdown(text(track.info.author,80))+' · '+time(track.info.length)+' · '+tags+'\n[Abrir en YouTube](https://www.youtube.com/watch?v='+track.info.identifier+')'});
    return {label:text(track.info.title,100),description:text(track.info.author,45)+' · '+time(track.info.length)+' · '+text(tags,30),value:String(index)};
  });
  embed.setFooter({text:'Disponible 5 minutos. Las etiquetas se orientan por el título; no certifican la versión.'});
  return {content:'',embeds:[embed],components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('music:search-pick:'+record.token).setPlaceholder('Selecciona la canción que quieres escuchar').addOptions(options)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:search-cancel:'+record.token).setLabel('Cancelar búsqueda').setStyle(ButtonStyle.Secondary))],allowedMentions:{parse:[]}};
}
export class SearchPicks {
  constructor({now=Date.now,ttl=300000,max=1000}={}) {this.now=now;this.ttl=ttl;this.max=max;this.entries=new Map();this.preparing=new Map();}
  prune(){for(const [key,entry] of this.entries)if(entry.expires<=this.now())this.entries.delete(key);for(const [key,entry] of this.preparing)if(entry.expires<=this.now())this.preparing.delete(key);}
  begin({guildId,userId}){
    this.prune();const key=guildId+':'+userId;
    for(const [token,entry] of this.entries)if(entry.guildId===guildId&&entry.userId===userId)this.entries.delete(token);
    if(!this.preparing.has(key)&&this.preparing.size>=this.max)this.preparing.delete(this.preparing.keys().next().value);
    const generation=randomBytes(12).toString('hex');this.preparing.set(key,{generation,expires:this.now()+this.ttl});return generation;
  }
  create({guildId,userId,voiceChannelId,tracks,edit,generation}) {
    this.prune();
    const key=guildId+':'+userId;
    if(generation&&this.preparing.get(key)?.generation!==generation)throw Error('Esta búsqueda fue reemplazada por una más reciente.');
    if(!tracks.length||tracks.length>5)throw Error('No hay resultados para elegir.');
    for(const [token,entry] of this.entries)if(entry.guildId===guildId&&entry.userId===userId)this.entries.delete(token);
    while(this.entries.size>=this.max)this.entries.delete(this.entries.keys().next().value);
    this.preparing.delete(key);
    const token=randomBytes(12).toString('hex');const record={token,guildId,userId,voiceChannelId,tracks,edit,expires:this.now()+this.ttl,used:false};this.entries.set(token,record);return record;
  }
  get(token,{guildId,userId}) {
    this.prune();const record=this.entries.get(token);
    if(!record)throw Error('Esta búsqueda caducó o fue reemplazada. Usa /buscar de nuevo.');
    if(record.guildId!==guildId||record.userId!==userId)throw Error('Esta búsqueda pertenece a otro usuario o servidor.');
    if(record.used)throw Error('Esta búsqueda ya fue utilizada. Usa /buscar para añadir otra canción.');
    return record;
  }
  resolve(token,value,context){const record=this.get(token,context);if(!/^[0-4]$/.test(String(value))||!record.tracks[Number(value)])throw Error('Selección inválida.');return {record,track:record.tracks[Number(value)]};}
  claim(token,value,context){const result=this.resolve(token,value,context);result.record.used=true;return result;}
  cancel(token,context){const record=this.get(token,context);record.used=true;return record;}
  removeGuild(guildId){for(const [token,entry] of this.entries)if(entry.guildId===guildId)this.entries.delete(token);for(const key of this.preparing.keys())if(key.startsWith(guildId+':'))this.preparing.delete(key);}
  clear(){this.entries.clear();this.preparing.clear();}
}
