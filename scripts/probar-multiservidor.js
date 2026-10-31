// Integration: two isolated Lavalink players, no Discord voice connections.
import { config } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=(config.lavalink.secure?'https':'http')+'://'+config.lavalink.host+':'+config.lavalink.port;
const headers={Authorization:config.lavalink.password,'Content-Type':'application/json'};
const request=async(route,method='GET',body)=>{
 const r=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error(r.status+' '+await r.text());return r.status===204?null:r.json();
};
const ws=new WebSocket(base.replace(/^http/,'ws')+'/v4/websocket',{headers:{Authorization:config.lavalink.password,'User-Id':'333333333333333333','Client-Name':'DJ-Tilin-MultiGuild-Test/1.0'}});
const timeout=setTimeout(()=>{console.error('Timeout');process.exit(1);},20000);
let session;
const ids=['111111111111111111','222222222222222222'];
try {
 session=await new Promise((resolve,reject)=>{ws.on('message',raw=>{const m=JSON.parse(raw);if(m.op==='ready')resolve(m.sessionId);});ws.once('error',reject);});
 const name=fs.readdirSync('runtime/audio').find(f=>f.endsWith('.audio'));
 if(!name)throw Error('Reproduce al menos una canción para disponer de audio en caché.');
 const loaded=await request('/v4/loadtracks?identifier='+encodeURIComponent(path.resolve('runtime/audio/'+name)));
 assert.equal(loaded.loadType,'track');
 for(const [i,guildId] of ids.entries()){
  await request('/v4/tilin/audio','PUT',{guildId,bitrate:i?384000:96000});
  await request('/v4/sessions/'+session+'/players/'+guildId,'PATCH',{track:{encoded:loaded.data.encoded},volume:50,filters:{pluginFilters:{tilinQuality:{guildId}}}});
 }
 await new Promise(resolve=>setTimeout(resolve,1800));
 const statuses=await Promise.all(ids.map(id=>request('/v4/tilin/audio?guildId='+id)));
 console.log(JSON.stringify(statuses));
 assert(statuses.every(p=>p.encodedFrames>0),'El filtro no asignó el perfil de audio');
 assert.equal(statuses[0].lastPacketBytes,240);assert.equal(statuses[1].lastPacketBytes,960);
 await request('/v4/tilin/audio','PUT',{guildId:ids[0],bitrate:64000});
 for(const id of ids)await request('/v4/sessions/'+session+'/players/'+id,'PATCH',{position:15000});
 await new Promise(resolve=>setTimeout(resolve,1000));
 const next=await Promise.all(ids.map(id=>request('/v4/tilin/audio?guildId='+id)));
 assert.equal(next[0].lastPacketBytes,160);assert.equal(next[1].lastPacketBytes,960);
 console.log('OK: dos reproductores Lavalink mantienen 96/384 kbps y luego 64/384 kbps.');
}finally{
 if(session)for(const id of ids){await request('/v4/sessions/'+session+'/players/'+id,'DELETE').catch(()=>{});await request('/v4/tilin/audio','DELETE',{guildId:id}).catch(()=>{});}
 ws.close();clearTimeout(timeout);
}
