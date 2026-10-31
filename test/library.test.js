import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {MusicLibrary,libraryName} from '../src/music/library.js';
import {musicCommands} from '../src/commands/music.js';
import {renderPanel} from '../src/music/panel.js';
import {DEFAULT_MIX} from '../src/music/mix-settings.js';
const owner='111111111111111111',other='222222222222222222';
const song=(i=0)=>({encoded:'private-encoding',filePath:'C:/private/file',requester:owner,shuffleGroup:'random',analysis:{bpm:120},info:{title:'Song '+i,author:'Artist',sourceName:'youtube',identifier:String(i).padStart(11,'a'),length:180000}});
const fixture=()=>{const db=new DatabaseSync(':memory:');return {db,library:new MusicLibrary(db)};};
test('cada usuario conserva una biblioteca propia y no puede consultar ni borrar la ajena',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'playlist','Fiesta',[song()]);assert.deepEqual(l.list(other,'playlist'),[]);
  assert.throws(()=>l.get(other,'playlist','Fiesta'));assert.equal(l.remove(other,'playlist','Fiesta'),false);
  assert.equal(l.get(owner,'playlist','Fiesta').tracks.length,1);
 }finally{db.close();}
});
test('un favorito repetido no se duplica, pero las versiones distintas sí se guardan',()=>{
 const {db,library:l}=fixture();try{
  assert(!l.save(owner,'favorite','Original',[song()]).duplicate);
  const duplicate=l.save(owner,'favorite','Otro nombre',[song()]);assert(duplicate.duplicate);assert.equal(duplicate.name,'Original');
  l.save(owner,'favorite','Remix',[song(1)]);assert.equal(l.list(owner,'favorite').length,2);
 }finally{db.close();}
});
test('Spotify y YouTube con la misma coincidencia de audio comparten favorito',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'favorite','YT',[song()]);const spotify={...song(2),info:{...song(2).info,sourceName:'spotify'},audioInfo:song().info};
  assert(l.save(owner,'favorite','Spotify',[spotify]).duplicate);assert.equal(l.list(owner,'favorite').length,1);
 }finally{db.close();}
});
test('guardar una playlist mantiene el orden y los duplicados de las 201 canciones',()=>{
 const {db,library:l}=fixture();try{
  const tracks=Array.from({length:201},(_,i)=>song(i%3));l.save(owner,'playlist','Completa',tracks);
  const loaded=l.get(owner,'playlist','Completa');assert.equal(loaded.tracks.length,201);
  assert.deepEqual(loaded.tracks.map(t=>t.info.title),tracks.map(t=>t.info.title));
  assert.throws(()=>l.save(owner,'playlist','Exceso',[...tracks,song(4)]));
 }finally{db.close();}
});
test('se guardan referencias portables sin rutas, audio codificado ni orden aleatorio forzado',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'playlist','Portátil',[song()]);const [track]=l.get(owner,'playlist','Portátil').tracks;
  assert(!('encoded' in track));assert(!('filePath' in track));assert(!('requester' in track));assert(!('shuffleGroup' in track));assert(!('analysis' in track));
  assert.equal(track.info.identifier,song().info.identifier);
 }finally{db.close();}
});
test('consultar o reproducir una copia no modifica la lista persistente',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'playlist','Lista',[song(),song(1)]);const entry=l.get(owner,'playlist','Lista');entry.tracks[0].info.title='Changed';entry.tracks.reverse();entry.tracks.pop();
  assert.deepEqual(l.get(owner,'playlist','Lista').tracks.map(t=>t.info.title),['Song 0','Song 1']);
 }finally{db.close();}
});
test('los nombres se normalizan y solo se reemplazan cuando se solicita explícitamente',()=>{
 const {db,library:l}=fixture();try{
  assert.deepEqual(libraryName('  Ｆｉｅｓｔａ   noche '),{name:'Fiesta noche',key:'fiesta noche'});
  l.save(owner,'playlist','Fiesta',[song()]);assert.throws(()=>l.save(owner,'playlist','FIESTA',[song(1)]),/reemplazar/);
  assert.equal(l.get(owner,'playlist','fiesta').tracks[0].info.title,'Song 0');
  assert(l.save(owner,'playlist','FIESTA',[song(1)],{replace:true}).replaced);assert.equal(l.get(owner,'playlist','fiesta').tracks[0].info.title,'Song 1');
  l.save(owner,'playlist','Otra',[song(2)]);assert.equal(l.list(owner,'playlist').length,2);
 }finally{db.close();}
});
test('nombres con comillas se tratan como datos y los nombres vacíos se rechazan',()=>{
 const {db,library:l}=fixture();try{
  const name="x'); DROP TABLE music_library; --";l.save(owner,'playlist',name,[song()]);assert(l.get(owner,'playlist',name));
  for(const invalid of ['', '   ','x'.repeat(81)])assert.throws(()=>l.save(owner,'playlist',invalid,[song()]));
 }finally{db.close();}
});
test('el autocompletado filtra solo los nombres del usuario y admite acentos',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'playlist','Música de noche',[song()]);l.save(other,'playlist','Música privada',[song(2)]);
  const names=l.names(owner,'playlist','MÚSICA');assert.equal(names.length,1);assert.equal(names[0].value,'Música de noche');assert(names[0].name.length<=100);
 }finally{db.close();}
});
test('los límites son por usuario y tipo; reemplazar no ocupa otro espacio',()=>{
 const {db,library:l}=fixture();try{
  for(let i=0;i<30;i++)l.save(owner,'playlist','P'+i,[song(i)]);
  assert.throws(()=>l.save(owner,'playlist','P31',[song()]),/límite/);
  l.save(owner,'playlist','P0',[song(40)],{replace:true});l.save(other,'playlist','P31',[song()]);
  for(let i=0;i<100;i++)l.save(owner,'favorite','F'+i,[song(i)]);
  assert.throws(()=>l.save(owner,'favorite','F101',[song(101)]),/límite/);assert(l.remove(owner,'favorite','F0'));l.save(owner,'favorite','F101',[song(101)]);
 }finally{db.close();}
});
test('una lista dañada no impide leer ni eliminar las demás',()=>{
 const {db,library:l}=fixture();try{
  l.save(owner,'playlist','Buena',[song()]);l.save(owner,'playlist','Rota',[song(1)]);
  db.prepare('UPDATE music_library SET tracks_json=? WHERE name_key=?').run('{broken','rota');
  assert.throws(()=>l.get(owner,'playlist','Rota'),/leer/);assert(l.get(owner,'playlist','Buena'));assert(l.remove(owner,'playlist','Rota'));
 }finally{db.close();}
});
test('favoritos y playlists siguen disponibles tras cerrar y abrir SQLite',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'tilin-library-')),file=path.join(directory,'library.sqlite');let db;
 try{
  db=new DatabaseSync(file);let l=new MusicLibrary(db);l.save(owner,'favorite','Favorita',[song()]);l.save(owner,'playlist','Mi cola',[song(),song(1)]);db.close();
  db=new DatabaseSync(file);l=new MusicLibrary(db);assert.equal(l.get(owner,'favorite','Favorita').tracks.length,1);assert.equal(l.get(owner,'playlist','Mi cola').tracks.length,2);
 }finally{db?.close();await rm(directory,{recursive:true,force:true});}
});
test('los comandos tienen subcomandos y autocompletado para nombres guardados',()=>{
 const f=musicCommands.find(c=>c.data.name==='favoritos').data.toJSON();const p=musicCommands.find(c=>c.data.name==='playlist').data.toJSON();
 assert.deepEqual(f.options.map(o=>o.name),['guardar','lista','reproducir','quitar']);
 assert.deepEqual(p.options.map(o=>o.name),['guardar','lista','ver','reproducir','borrar']);
 assert(p.options.find(o=>o.name==='reproducir').options.find(o=>o.name==='nombre').autocomplete);
});
test('el botón de favorito ocupa la quinta posición y se desactiva al detener',()=>{
 const state={guildId:'guild',volume:50,equalizer:'equilibrado',mixSettings:DEFAULT_MIX,player:{position:0,paused:false},queue:{current:song(),tracks:[],repeat:'off'}};
 const row=renderPanel(state).components[0].toJSON();assert.equal(row.components.length,5);assert.equal(row.components[4].custom_id,'music:panel-favorite');assert.equal(row.components[4].disabled,false);
 assert(renderPanel(state,'stopped').components[0].toJSON().components[4].disabled);
});
