import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {SessionStore,sessionSnapshot,normalizeSession,savedTrack} from '../src/music/recovery.js';
import {playableTrack} from '../src/music/sources.js';
const guild='111111111111111111', other='222222222222222222';
const song=(title='A')=>({info:{title,author:'Artist',length:180000,isStream:false,sourceName:'youtube',identifier:'abcdefghijk'},requester:'333333333333333333',shuffleGroup:'batch'});
const snapshot=(guildId=guild)=>({version:1,guildId,voiceChannelId:'444444444444444444',textChannelId:'555555555555555555',current:song(),tracks:[song('B'),song('B')],repeat:'queue',volume:70,paused:true,position:43210,rate:1.04,savedAt:Date.now()});
test('conserva cola, duplicados, orden, solicitante, pausa y ajustes separados por servidor',()=>{
 const db=new DatabaseSync(':memory:'), store=new SessionStore(db);
 try{
  store.save(snapshot());store.save({...snapshot(other),volume:25,position:1000});
  assert.equal(store.read(guild).position,43210);assert.equal(store.read(guild).paused,true);
  assert.deepEqual(store.read(guild).tracks.map(t=>t.info.title),['B','B']);
  assert.equal(store.read(guild).current.requester,'333333333333333333');
  assert.equal(store.read(guild).rate,1.04);assert.equal(store.read(other).volume,25);
  store.delete(guild);assert.equal(store.read(guild),null);assert(store.read(other));
 }finally{db.close();}
});
test('descarta URLs temporales, audio codificado, rutas y datos de análisis del guardado',()=>{
 const track={...song(),encoded:'temporary',filePath:'C:/private/path',localAudio:true,analysis:{bpm:120},info:{...song().info,uri:'https://temporary.example/token',localPath:'C:/private'}};
 const saved=savedTrack(track);assert.deepEqual(saved,song());
 assert(!JSON.stringify(saved).includes('private'));assert(!JSON.stringify(saved).includes('temporary'));
});
test('un registro roto no impide recuperar otros servidores; rechaza estado inválido',()=>{
 const db=new DatabaseSync(':memory:'), errors=[],store=new SessionStore(db,e=>errors.push(e.message));
 try{
  store.save(snapshot(other));db.prepare('INSERT INTO music_sessions VALUES (?,?)').run(guild,'{broken');
  assert.deepEqual(store.list().map(s=>s.guildId),[other]);assert.equal(errors.length,1);
  for(const patch of [{volume:101},{position:-1},{rate:2},{voiceChannelId:'bad'},{paused:'yes'},{repeat:'bad'}])assert.throws(()=>normalizeSession({...snapshot(),...patch}));
 }finally{db.close();}
});
test('cola agotada se elimina y no se revive al volver a iniciar',()=>{
 const db=new DatabaseSync(':memory:'),store=new SessionStore(db);try{
  store.save(snapshot());store.save({...snapshot(),current:null,tracks:[]});assert.deepEqual(store.list(),[]);
 }finally{db.close();}
});
test('el checkpoint usa la posición de la pista y no la del flujo, y no salta pistas en preparación',()=>{
 const current=song();const state={guildId:guild,channelId:'444444444444444444',textChannel:{id:'555555555555555555'},queue:{current,tracks:[],repeat:'off'},volume:50,player:{position:999999,paused:false},mixer:{current:{track:current,rate:1.03},position:32000}};
 assert.equal(sessionSnapshot(state).position,32000);
 state.queue.current=song('next');assert.equal(sessionSnapshot(state).position,0);
 state.starting=true;state.resumePosition=12345;state.resumePaused=true;
 assert.equal(sessionSnapshot(state).position,12345);assert.equal(sessionSnapshot(state).paused,true);
});
test('recuperar YouTube reutiliza el identificador exacto sin buscar otra versión',async()=>{
 const track=savedTrack(song());let searched=false,loaded;
 await playableTrack({rest:{resolve:async()=>{searched=true;}}},track,async(_,info)=>{loaded=info.identifier;info.localPath='cache/audio';return 'new-encoding';});
 assert.equal(loaded,'abcdefghijk');assert.equal(searched,false);assert.equal(track.filePath,'cache/audio');
});
test('Spotify recupera la coincidencia de audio que ya había elegido',async()=>{
 const track=savedTrack({...song(),info:{...song().info,sourceName:'spotify'},audioInfo:song().info});
 let loaded;await playableTrack({},track,async(_,info)=>{loaded=info.identifier;return 'audio';});assert.equal(loaded,'abcdefghijk');
});
test('un cierre forzado de proceso conserva el checkpoint SQLite para el siguiente inicio',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tilin-recovery-'));const filename=path.join(dir,'queue.sqlite');
 const module=new URL('../src/music/recovery.js',import.meta.url).href;
 let child;
 try{
  const script='import {DatabaseSync} from "node:sqlite";import {SessionStore} from '+JSON.stringify(module)+';const db=new DatabaseSync('+JSON.stringify(filename)+');db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");const store=new SessionStore(db);store.save('+JSON.stringify(snapshot())+');console.log("saved");setInterval(()=>{},1000);';
  child=spawn(process.execPath,['--input-type=module','-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('No se guardó la cola')),5000);child.stdout.once('data',()=>{clearTimeout(t);resolve();});child.once('error',reject);});
  child.kill('SIGKILL');await exited;
  const read='import {DatabaseSync} from "node:sqlite";import {SessionStore} from '+JSON.stringify(module)+';const db=new DatabaseSync('+JSON.stringify(filename)+');console.log(JSON.stringify(new SessionStore(db).read('+JSON.stringify(guild)+')));db.close();';
  const result=spawnSync(process.execPath,['--input-type=module','-e',read],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);const restored=JSON.parse(result.stdout);
  assert.equal(restored.position,43210);assert.equal(restored.tracks.length,2);assert.equal(restored.repeat,'queue');assert.equal(restored.volume,70);
 }finally{if(child&&!child.killed)child.kill();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});


test('una desconexión manual conserva la cola pero no autoriza volver a entrar automáticamente',()=>{
 const db=new DatabaseSync(':memory:'),store=new SessionStore(db);try{
  store.save({...snapshot(),autoResume:false});assert.equal(store.read(guild).autoResume,false);
  assert.equal(store.read(guild).tracks.length,2);
  assert.throws(()=>normalizeSession({...snapshot(),autoResume:'yes'}));
 }finally{db.close();}
});
