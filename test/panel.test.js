import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MusicPanels,renderPanel,artwork} from '../src/music/panel.js';
import {DEFAULT_MIX} from '../src/music/mix-settings.js';
const state=(guildId='guild',channel=null)=>({guildId,textChannel:channel,volume:35,equalizer:'equilibrado',quality:{bitrate:128000},mixSettings:{...DEFAULT_MIX,mode:'dj'},player:{position:60000,paused:false},
 queue:{current:{info:{title:'Song @everyone',author:'Artist',length:180000,identifier:'abcdefghijk'},requester:'111111111111111111'},tracks:[{info:{title:'Next',author:'Other'}}],repeat:'off'}});
const memory=()=>{const records=new Map();return {records,read:id=>records.get(id)||null,save:(id,r)=>records.set(id,{...r}),delete:id=>records.delete(id)};};
function channel(id){const value={id,sent:[],edits:[],deleted:[]};value.send=async payload=>{value.sent.push(payload);return {id:id+'-'+value.sent.length};};value.messages={delete:async id=>{value.deleted.push(id);},edit:async(id,payload)=>{value.edits.push({id,payload});return {id};}};return value;}
const client=(channels=[])=>({guilds:{cache:new Map()},channels:{cache:new Map(channels.map(c=>[c.id,c])),fetch:async()=>null}});
const json=payload=>({embed:payload.embeds[0].toJSON(),rows:payload.components.map(r=>r.toJSON())});
test('muestra canción, portada, progreso, siguiente pista, calidad y controles válidos',()=>{
 const payload=renderPanel(state()),{embed,rows}=json(payload);
 assert.equal(embed.title,'🎵 Reproduciendo');assert.equal(embed.thumbnail.url,'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
 assert(embed.fields.find(f=>f.name==='Progreso').value.includes('1:00 / 3:00'));
 assert(embed.fields.find(f=>f.name==='Siguiente').value.includes('Next'));
 assert(embed.fields.find(f=>f.name==='Audio').value.includes('128 kbps'));
 assert.deepEqual(payload.allowedMentions,{parse:[]});assert.equal(rows.length,3);
 assert(rows.every(row=>row.components.length<=5));
 const menu=rows[2].components[0];assert.equal(menu.custom_id,'music:panel-mode');assert.equal(menu.options.filter(o=>o.default).length,1);assert(menu.options.find(o=>o.value==='dj').default);
});
test('la pausa y las colas guardadas muestran acciones coherentes; detener desactiva los controles',()=>{
 const s=state();s.player.paused=true;assert.equal(json(renderPanel(s)).rows[0].components[0].label,'▶ Continuar');
 const saved=json(renderPanel(s,'saved'));assert.equal(saved.rows[0].components[0].custom_id,'music:continuar');assert(saved.rows[0].components[1].disabled);assert(saved.rows[2].components[0].disabled);
 const stopped=json(renderPanel(s,'stopped'));assert(stopped.rows.every(r=>r.components.every(c=>c.disabled)));
 s.volume=0;assert(json(renderPanel(s)).rows[1].components[0].disabled);s.volume=100;assert(json(renderPanel(s)).rows[1].components[1].disabled);
});
test('un enlace de portada ajeno a las fuentes permitidas no se publica',()=>{
 assert.equal(artwork({info:{artworkUrl:'http://127.0.0.1/private'}}),null);
 assert.equal(artwork({info:{artworkUrl:'https://example.com/private'}}),null);
});
test('cambios concurrentes crean un solo mensaje y conservan la última actualización',async()=>{
 const c=channel('one'),store=memory();let release;const gate=new Promise(resolve=>{release=resolve;});
 c.send=async payload=>{c.sent.push(payload);await gate;return {id:'fixed'};};
 const panels=new MusicPanels(client([c]),store);const s=state('g',c);
 const first=panels.update(s);s.volume=45;const second=panels.update(s);release();await Promise.all([first,second]);
 assert.equal(c.sent.length,1);assert.equal(store.read('g').messageId,'fixed');
 assert.equal(json(c.edits.at(-1).payload).embed.fields.find(f=>f.name==='Volumen').value,'45%');
});
test('al reiniciar reutiliza el mensaje persistente sin leer el historial ni enviar otro',async()=>{
 const c=channel('one'),store=memory(),s=state('g',c);await new MusicPanels(client([c]),store).update(s);
 await new MusicPanels(client([c]),store).update(s);assert.equal(c.sent.length,1);assert.equal(c.edits.length,1);assert.equal(c.edits[0].id,'one-1');
});
test('si borran el mensaje, lo recrea una vez y guarda su nuevo identificador',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);let removed=true;c.messages.edit=async()=>{if(removed){removed=false;throw {code:10008};}};
 await panels.update(s);await panels.update(s);assert.equal(c.sent.length,2);assert.equal(store.read('g').messageId,'one-2');
});
test('sin permisos no crea duplicados ni insiste en cada actualización',async()=>{
 const c=channel('one'),store=memory(),errors=[],panels=new MusicPanels(client([c]),store,e=>errors.push(e)),s=state('g',c);
 await panels.update(s);let edits=0;c.messages.edit=async()=>{edits++;throw {code:50013};};
 assert.equal(await panels.update(s),false);await panels.update(s);assert.equal(edits,1);assert.equal(c.sent.length,1);assert.equal(errors.length,1);
});
test('mover el panel desactiva el mensaje anterior y los servidores mantienen mensajes separados',async()=>{
 const a=channel('a'),b=channel('b'),c=channel('c'),store=memory(),panels=new MusicPanels(client([a,b,c]),store);
 const s=state('first',a);await panels.update(s);await panels.update(state('second',c));s.textChannel=b;await panels.update(s);
 assert.deepEqual(a.edits.at(-1).payload.components,[]);assert.equal(store.read('first').channelId,'b');assert.equal(store.read('second').channelId,'c');
 assert.equal(b.sent.length,1);assert.equal(c.sent.length,1);
});
test('un fallo de presentación se registra sin detener la reproducción',async()=>{
 const c=channel('one'),errors=[],panels=new MusicPanels(client([c]),{read:()=>{throw Error('db unavailable');}},e=>errors.push(e));
 assert.equal(await panels.update(state('g',c)),false);assert.equal(errors.length,1);
});

test('al cambiar de canción publica al final, borra el panel anterior y conserva el nuevo ID',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);s.queue.current.info.title='Nueva canción';
 await panels.update(s,'playing',{repost:true});
 assert.equal(c.sent.length,2);assert.deepEqual(c.deleted,['one-1']);assert.equal(store.read('g').messageId,'one-2');
 assert(json(c.sent[1]).embed.description.includes('Nueva canción'));
 await panels.update(s);s.volume=45;await panels.update(s);
 assert.equal(c.sent.length,2);assert.equal(c.edits.at(-1).id,'one-2');
});

test('progreso y controles durante el reenvío actualizan la tarjeta nueva sin duplicarla',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);let release;const gate=new Promise(resolve=>{release=resolve;});
 c.send=async payload=>{c.sent.push(payload);await gate;return {id:'new'};};
 const first=panels.update(s,'playing',{repost:true});s.volume=60;const progress=panels.update(s);release();await Promise.all([first,progress]);
 assert.equal(c.sent.length,2);assert.deepEqual(c.deleted,['one-1']);assert.equal(store.read('g').messageId,'new');
 assert.equal(c.edits.at(-1).id,'new');assert.equal(json(c.edits.at(-1).payload).embed.fields.find(f=>f.name==='Volumen').value,'60%');
});

test('si no puede enviar el nuevo panel conserva el anterior y puede reintentar sin perder el reenvío',async()=>{
 const c=channel('one'),store=memory(),errors=[],panels=new MusicPanels(client([c]),store,e=>errors.push(e)),s=state('g',c);
 await panels.update(s);const send=c.send;c.send=async()=>{throw {code:50013};};
 assert.equal(await panels.update(s,'playing',{repost:true}),false);assert.equal(store.read('g').messageId,'one-1');assert.equal(c.deleted.length,0);
 c.send=send;await panels.update(s,'playing',{force:true});assert.equal(store.read('g').messageId,'one-2');assert.deepEqual(c.deleted,['one-1']);assert.equal(errors.length,1);
});

test('si no puede borrar el panel anterior le retira los controles sin duplicar el nuevo',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);c.messages.delete=async()=>{throw {code:50013};};
 await panels.update(s,'playing',{repost:true});assert.equal(c.sent.length,2);assert.equal(store.read('g').messageId,'one-2');
 assert.equal(c.edits.at(-1).id,'one-1');assert.deepEqual(c.edits.at(-1).payload.components,[]);assert.deepEqual(c.edits.at(-1).payload.embeds,[]);
 await panels.update(s);assert.equal(c.sent.length,2);
});

test('repetir la misma canción y terminar la cola también permiten reenviar el reproductor',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);await panels.update(s,'playing',{repost:true});await panels.update(s,'playing',{repost:true});
 s.queue.current=null;s.queue.tracks=[];await panels.update(s,'playing',{repost:true});
 assert.equal(c.sent.length,4);assert.deepEqual(c.deleted,['one-1','one-2','one-3']);assert.equal(json(c.sent[3]).embed.title,'🎶 Cola terminada');
});

test('cambios consecutivos durante un envío dejan un único panel activo con la última canción',async()=>{
 const c=channel('one'),store=memory(),panels=new MusicPanels(client([c]),store),s=state('g',c);
 await panels.update(s);let release;const gate=new Promise(resolve=>{release=resolve;});
 c.send=async payload=>{c.sent.push(payload);const id='one-'+c.sent.length;if(c.sent.length===2)await gate;return {id};};
 const first=panels.update(s,'playing',{repost:true});s.queue.current.info.title='Última canción';const next=panels.update(s,'playing',{repost:true});release();await Promise.all([first,next]);
 assert.equal(c.sent.length,3);assert.deepEqual(c.deleted,['one-1','one-2']);assert.equal(store.read('g').messageId,'one-3');assert(json(c.sent[2]).embed.description.includes('Última canción'));
});
