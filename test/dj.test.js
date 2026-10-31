import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PermissionsBitField,PermissionFlagsBits} from 'discord.js';
import {DjSettings,SkipVotes,controlsMusic,managesMusic,isDjControl} from '../src/music/dj.js';
import {musicCommands} from '../src/commands/music.js';
import {renderPanel} from '../src/music/panel.js';
import {DEFAULT_MIX} from '../src/music/mix-settings.js';

const member=(id,roles=[],permissions=[])=>({id,roles:{cache:new Map(roles.map(id=>[id,{}]))},permissions:new PermissionsBitField(permissions)});
const guild={ownerId:'owner'};
test('sin configurar todos controlan; con rol solo DJ, propietario y Administrar servidor',()=>{
  assert(controlsMusic(member('listener'),guild,{roleId:null}));
  assert(!controlsMusic(member('listener'),guild,{roleId:'dj'}));
  assert(controlsMusic(member('listener',['dj']),guild,{roleId:'dj'}));
  assert(controlsMusic(member('owner'),guild,{roleId:'deleted-role'}));
  assert(controlsMusic(member('manager',[],[PermissionFlagsBits.ManageGuild]),guild,{roleId:'deleted-role'}));
  assert(controlsMusic(member('admin',[],[PermissionFlagsBits.Administrator]),guild,{roleId:'dj'}));
  assert(!managesMusic(member('dj',['dj']),guild));
});
test('el rol y la votación quedan guardados por servidor y se pueden desactivar',()=>{
  const db=new DatabaseSync(':memory:');try{
    let settings=new DjSettings(db);assert.deepEqual(settings.get('a'),{roleId:null,voting:false});
    settings.save('a','dj-a');settings.save('b','dj-b',false);
    settings=new DjSettings(db);assert.deepEqual(settings.get('a'),{roleId:'dj-a',voting:true});
    assert.deepEqual(settings.get('b'),{roleId:'dj-b',voting:false});
    settings.clear('a');assert.equal(settings.get('a').roleId,null);assert.equal(settings.get('b').roleId,'dj-b');
  }finally{db.close();}
});
test('mayoría estricta para uno, dos, tres y cuatro oyentes; votos únicos',()=>{
  for(const size of [1,2,3,4]){
    const votes=new SkipVotes(),ids=Array.from({length:size},(_,i)=>String(i));const required=Math.floor(size/2)+1;
    for(let i=0;i<required;i++){const result=votes.vote(ids[i],ids);assert.equal(result.needed,required);assert.equal(result.passed,i+1>=required);}
    const duplicate=votes.vote(ids[0],ids);assert(duplicate.duplicate);assert.equal(duplicate.count,required);
  }
});
test('no votan personas ajenas al canal y los votos de quienes salen desaparecen',()=>{
  const votes=new SkipVotes();assert.throws(()=>votes.vote('outside',['a','b']),/canal de voz/);
  votes.vote('a',['a','b','c']);votes.vote('b',['a','b','c']);
  assert.deepEqual(votes.tally(['b','c']),{count:1,needed:2,passed:false,pending:false});
  assert(votes.tally(['b']).passed);assert(!votes.tally([]).passed);
});
test('un salto en curso no puede reclamarse dos veces ni acumular votos',()=>{
  const votes=new SkipVotes();votes.vote('a',['a','b']);const token=votes.claim();
  assert.equal(votes.claim(),null);assert(votes.vote('b',['a','b']).pending);assert.equal(votes.voters.size,1);
  votes.release(token);assert.notEqual(votes.claim(),null);
});
test('cambio, repetición y recuperación de pista reinician votos y reclamaciones antiguas',()=>{
  const a=new SkipVotes(),b=new SkipVotes();a.vote('a',['a']);const old=a.claim();a.reset();
  assert.equal(a.tally(['a']).count,0);assert(!a.pending);assert.equal(b.tally(['a']).count,0);
  a.claim();a.release(old);assert(a.pending);
});
test('la política protege botones, comandos y cambios de audio pero deja consultar y pedir música',()=>{
  const empty={data:[],getString:()=>null};
  for(const action of ['pausa','continuar','toggle','detener','volumen','repetir','mezclar','quitar','panel-mode','panel-repeat','panel-volume-down','panel-volume-up','reproductor'])assert(isDjControl(action,empty),action);
  for(const action of ['play','buscar','favoritos','playlist','panel-favorite','cola','actual','calidad','saltar','panel-refresh','automix','ecualizador'])assert(!isDjControl(action,empty),action);
  for(const name of ['modo','duracion','sincronizar','normalizar'])assert(isDjControl('automix',{data:[{name}]}));
  assert(isDjControl('ecualizador',{getString:()=> 'original'}));
});
test('el comando DJ permite consultar, configurar rol con votos opcionales y desactivar',()=>{
  const dto=musicCommands.find(c=>c.data.name==='dj').data.toJSON();
  assert.deepEqual(dto.options.map(o=>o.name),['estado','configurar','desactivar']);
  assert(dto.options[1].options.find(o=>o.name==='rol').required);
  assert(dto.options[1].options.find(o=>o.name==='votacion'));
});
test('el reproductor muestra rol, umbral y botón para votar sin mencionar a nadie',()=>{
  const state={volume:50,player:{},queue:{current:{info:{title:'A',author:'B'}},tracks:[],repeat:'off'},mixSettings:DEFAULT_MIX,
    djSettings:{roleId:'123',voting:true},skipTally:{count:1,needed:2}};
  const panel=renderPanel(state);assert(panel.embeds[0].toJSON().fields.find(f=>f.name==='Controles DJ').value.includes('1/2'));
  assert.equal(panel.components[0].toJSON().components[1].label,'Saltar / Votar');assert.deepEqual(panel.allowedMentions,{parse:[]});
});
