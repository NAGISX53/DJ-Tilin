import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/validate-config.js';
import { GuildLock, MusicQueue } from '../src/music/queue.js';
const config={discord:{token:'test-token',clientId:'111111111111111111',ownerId:'222222222222222222'},dashboard:{port:3000}};
test('el servidor de origen es opcional y los ID inválidos se rechazan',()=>{
  assert.doesNotThrow(()=>validateConfig(config));
  assert.throws(()=>validateConfig({...config,discord:{...config.discord,guildId:'invalid'}}),/DISCORD_GUILD_ID/);
});
test('una operación lenta de otro servidor no bloquea ni modifica la cola local',async()=>{
  const lock=new GuildLock(), a=new MusicQueue(), b=new MusicQueue();
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const slow=lock.run('a',async()=>{await gate;a.add([{info:{title:'A'}}],'user-a');a.next();});
  await lock.run('b',()=>{b.add([{info:{title:'B'}}],'user-b');b.next();b.repeat='track';});
  assert.equal(b.current.info.title,'B');assert.equal(a.current,null);
  release();await slow;assert.equal(a.current.info.title,'A');assert.equal(a.repeat,'off');
});
