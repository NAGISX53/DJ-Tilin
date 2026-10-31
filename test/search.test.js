import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SearchPicks,searchTracks,searchPayload,versionTags} from '../src/music/search.js';
import {MusicQueue} from '../src/music/queue.js';
import {playableTrack} from '../src/music/sources.js';
import {musicCommands} from '../src/commands/music.js';
const track=(i,title='Song '+i)=>({encoded:'encoded-'+i,info:{identifier:'abcdefghij'+i,title,author:'Artist',length:180000,sourceName:'youtube',isStream:false}});
const context={guildId:'guild',userId:'user'};
const create=(picks,extra={})=>picks.create({...context,voiceChannelId:'voice',tracks:[track(0),track(1),track(2)],...extra});
test('buscar permite elegir tipo de versión sin cambiar el play directo',()=>{
 const command=musicCommands.find(c=>c.data.name==='buscar').data.toJSON();
 assert.equal(command.options[0].name,'consulta');assert(command.options[0].required);
 assert.deepEqual(command.options[1].choices.map(c=>c.value),['all','original','remix','live','extended','instrumental']);
 assert(musicCommands.some(c=>c.data.name==='play'));
});
test('busca cinco coincidencias distintas, en orden, sin incluir emisiones en vivo',async()=>{
 let query;const data=[track(0),track(0),{...track(9),info:{...track(9).info,isStream:true}},...Array.from({length:8},(_,i)=>track(i+1))];
 const results=await searchTracks({rest:{resolve:async value=>{query=value;return {loadType:'search',data};}}},'Artist Song','extended');
 assert.equal(query,'ytsearch:Artist Song extended mix');assert.deepEqual(results.map(t=>t.encoded),['encoded-0','encoded-1','encoded-2','encoded-3','encoded-4']);
});
test('los enlaces, consultas vacías y tipos inválidos no se envían al buscador',async()=>{
 let calls=0;const node={rest:{resolve:async()=>{calls++;}}};
 for(const value of ['','https://youtu.be/abcdefghijk','spotify:track:abc'])await assert.rejects(searchTracks(node,value));
 await assert.rejects(searchTracks(node,'Song','other'));assert.equal(calls,0);
});
test('una respuesta vacía no se convierte en reproducción automática',async()=>{
 assert.deepEqual(await searchTracks({rest:{resolve:async()=>({loadType:'empty'})}},'Song'),[]);
 await assert.rejects(searchTracks({rest:{resolve:async()=>({loadType:'error'})}},'Song'));
});
test('el menú solo muestra etiquetas e índices, sin exponer el audio codificado',()=>{
 const picks=new SearchPicks(),entry=create(picks,{tracks:[track(0,'**Song** @everyone'),track(1,'Song Remix')]});const payload=searchPayload('Song',entry);
 const rows=payload.components.map(c=>c.toJSON());assert.equal(rows[0].components[0].options.length,2);
 assert.deepEqual(rows[0].components[0].options.map(o=>o.value),['0','1']);assert(rows[0].components[0].custom_id.length<100);
 assert(!JSON.stringify(payload).includes('encoded-'));assert.deepEqual(payload.allowedMentions,{parse:[]});
 assert(payload.embeds[0].toJSON().footer.text.includes('no certifican'));
});
test('otra persona u otro servidor no pueden consumir una selección ajena',()=>{
 const picks=new SearchPicks(),entry=create(picks);
 assert.throws(()=>picks.claim(entry.token,'1',{...context,userId:'other'}));
 assert.throws(()=>picks.claim(entry.token,'1',{...context,guildId:'other'}));
 assert.equal(picks.claim(entry.token,'1',context).track.encoded,'encoded-1');
});
test('una selección solo puede añadirse una vez aunque se vuelva a pulsar',async()=>{
 const picks=new SearchPicks(),entry=create(picks),queue=new MusicQueue();
 const chosen=picks.claim(entry.token,'2',context).track;queue.add([chosen],'user');
 assert.throws(()=>picks.claim(entry.token,'2',context),/ya fue utilizada/);
 assert.equal(queue.tracks.length,1);let loaded;
 await playableTrack({},queue.tracks[0],async(_,info)=>{loaded=info.identifier;return 'selected-audio';});assert.equal(loaded,'abcdefghij2');
});
test('un índice inválido no consume la búsqueda',()=>{
 const picks=new SearchPicks(),entry=create(picks);
 for(const value of ['','-1','0.5','4',undefined])assert.throws(()=>picks.claim(entry.token,value,context));
 assert.equal(picks.claim(entry.token,'0',context).track.info.title,'Song 0');
});
test('caducidad, cancelación y nueva búsqueda invalidan los menús anteriores',()=>{
 let now=0;const picks=new SearchPicks({now:()=>now,ttl:100});
 const a=create(picks);now=100;assert.throws(()=>picks.claim(a.token,'0',context),/caducó/);
 const b=create(picks);picks.cancel(b.token,context);assert.throws(()=>picks.claim(b.token,'0',context),/utilizada/);
 const c=create(picks);create(picks);assert.throws(()=>picks.claim(c.token,'0',context),/reemplazada/);
});
test('una respuesta lenta no reemplaza una búsqueda más reciente del mismo usuario',()=>{
 const picks=new SearchPicks(),first=picks.begin(context),second=picks.begin(context);
 const latest=create(picks,{generation:second});assert.throws(()=>create(picks,{generation:first}),/más reciente/);
 assert.equal(picks.claim(latest.token,'1',context).track.info.title,'Song 1');
});
test('la memoria está acotada y los servidores conservan búsquedas independientes',()=>{
 const picks=new SearchPicks({max:2});const a=create(picks),b=create(picks,{guildId:'other'});
 assert(picks.get(a.token,context));assert(picks.get(b.token,{...context,guildId:'other'}));
 create(picks,{userId:'third'});assert.throws(()=>picks.get(a.token,context));assert.equal(picks.entries.size,2);
 picks.removeGuild('other');assert.equal(picks.entries.size,1);picks.clear();assert.equal(picks.entries.size,0);
});
test('las etiquetas distinguen variantes y no confunden Live Forever con un concierto',()=>{
 assert(versionTags('Song (Live at Wembley)').includes('En directo'));
 assert(!versionTags('Live Forever (Official Audio)').includes('En directo'));
 assert.deepEqual(versionTags('Song Extended Remix'),['Remix','Extendida']);assert.deepEqual(versionTags('Song Instrumental'),['Instrumental']);
});
