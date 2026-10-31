import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledge } from '../src/music/interaction.js';

test('la confirmación normal no hace consultas adicionales', async () => {
  let calls = 0;
  assert.equal(await acknowledge({ deferReply: async () => calls++ }), true);
  assert.equal(calls, 1);
});
test('recupera callback aceptado por Discord cuya respuesta se perdió', async () => {
  const interaction = {
    deferReply: async () => { throw Object.assign(Error('Unknown interaction'), { code: 10062 }); },
    webhook: { fetchMessage: async () => ({ flags: { bitfield: 128 } }) }
  };
  assert.equal(await acknowledge(interaction), true);
  assert.equal(interaction.deferred, true);
});
test('una interacción caducada sin respuesta no se ejecuta', async () => {
  const failure = Object.assign(Error('Unknown interaction'), { code: 10062 });
  const interaction = {
    deferReply: async () => { throw failure; },
    webhook: { fetchMessage: async () => { throw Error('Unknown webhook'); } }
  };
  await assert.rejects(acknowledge(interaction), error => error === failure);
});
test('no ejecuta otra vez una interacción ya completada', async () => {
  assert.equal(await acknowledge({
    deferReply: async () => { throw Error('already acknowledged'); },
    webhook: { fetchMessage: async () => ({ flags: { bitfield: 0 } }) }
  }), false);
});


test('los controles del panel confirman en privado sin publicar mensajes adicionales',async()=>{
 let received;await acknowledge({deferReply:async options=>{received=options;}},{ephemeral:true});
 assert.deepEqual(received,{flags:64});
});
