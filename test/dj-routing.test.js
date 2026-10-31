import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PermissionsBitField,PermissionFlagsBits} from 'discord.js';

test('el router real autoriza la configuración y bloquea controles antes de cambiar la reproducción',async()=>{
  const original=process.cwd(),directory=mkdtempSync(path.join(tmpdir(),'tilin-dj-routing-'));
  process.chdir(directory);let music,db;
  try{
    const module=await import('../src/db.js');db=module.db;
    const {createMusic}=await import('../src/music/index.js');
    const client=new EventEmitter();client.guilds={cache:new Map()};client.isReady=()=>false;
    let manager=false,role={id:'dj',managed:false},sub='configurar',memberRole=false;
    const member={id:'listener',get permissions(){return new PermissionsBitField(manager?[PermissionFlagsBits.ManageGuild]:[]);},get roles(){return {cache:new Map(memberRole?[['dj',{}]]:[])};}};
    const guild={id:'guild',ownerId:'owner',members:{fetch:async()=>member}};
    music=createMusic(client,{recovery:false});
    const invoke=async(action,values={})=>{
      let reply;const interaction={guild,guildId:guild.id,user:{id:member.id},createdTimestamp:Date.now(),inGuild:()=>true,
        deferReply:async()=>{interaction.deferred=true;},editReply:async payload=>{reply=payload;},options:{data:Object.entries(values).map(([name,value])=>({name,value})),getSubcommand:()=>sub,getRole:()=>role,getString:name=>values[name]??null,getInteger:name=>values[name]??null,getBoolean:name=>values[name]??null}};
      await music.run(interaction,action);return reply.content;
    };
    assert.match(await invoke('dj'),/Administrar servidor/);assert.equal(module.djSettings.get('guild').roleId,null);
    manager=true;assert.match(await invoke('dj'),/configurado/);assert.equal(module.djSettings.get('guild').roleId,'dj');
    role={id:'guild',managed:false};assert.match(await invoke('dj'),/no @everyone/);assert.equal(module.djSettings.get('guild').roleId,'dj');
    role={id:'bot-role',managed:true};assert.match(await invoke('dj'),/no @everyone/);
    manager=false;
    for(const action of ['detener','continuar','pausa','toggle','volumen','repetir','mezclar','quitar','panel-mode','panel-repeat','panel-volume-down','panel-volume-up','reproductor'])assert.match(await invoke(action),/requiere el rol DJ/,action);
    assert.match(await invoke('automix',{normalizar:false}),/requiere el rol DJ/);
    assert.match(await invoke('ecualizador',{modo:'original'}),/requiere el rol DJ/);
    assert.match(await invoke('automix'),/AutoMix/);assert.match(await invoke('ecualizador'),/Ecualizador/);
    memberRole=true;assert.match(await invoke('pausa'),/No hay un reproductor/);
    assert.match(await invoke('dj'),/Administrar servidor/);
    sub='estado';assert.match(await invoke('dj'),/Rol DJ/);
    manager=true;sub='desactivar';assert.match(await invoke('dj'),/desactivado/);assert.equal(module.djSettings.get('guild').roleId,null);
  }finally{
    await music?.close();db?.close();process.chdir(original);rmSync(directory,{recursive:true,force:true});
  }
});
