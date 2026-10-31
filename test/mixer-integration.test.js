import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MixSession, wavHeader } from '../src/music/mixer.js';
import { DEFAULT_MIX } from '../src/music/mix-settings.js';

async function fixture(file, frequency) {
  const samples = 48000;
  const data = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const left = Math.round(Math.sin(i * 2 * Math.PI * frequency / 48000) * 12000);
    data.writeInt16LE(left, i * 4); data.writeInt16LE(-left, i * 4 + 2);
  }
  const header = wavHeader(); header.writeUInt32LE(data.length + 36, 4); header.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([header, data]));
}

for (const mode of ['normal', 'crossfade', 'smart', 'dj']) test(`mezcla real ${mode}: cola, solapamiento y sondeo sin consumir canciones`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tilin-mixer-'));
  const files = [path.join(directory, 'a.wav'), path.join(directory, 'b.wav')];
  let session;
  try {
    await Promise.all([fixture(files[0], 220), fixture(files[1], 440)]);
    const tracks = files.map((filePath, i) => ({ filePath, info: { length: 1000 }, analysis: { duration: 1, intro: 0, outro: 1, bpm: 120 + i * 4, confidence: 0.9, beatOffset: 0 } }));
    let nextCalls = 0;
    const transitions = [];
    session = new MixSession({ track: tracks[0], settings: { ...DEFAULT_MIX, mode }, pace: false,
      peek: () => nextCalls === 0 ? tracks[1] : null, ready: () => true, prepare: async () => {},
      next: async () => (++nextCalls === 1 ? tracks[1] : null), onTrack: (_, plan) => transitions.push(plan),
      onError: error => { throw error; }
    });
    const url = await session.url();
    const probe = await fetch(url).then(response => response.arrayBuffer());
    assert.equal(probe.byteLength, 44 + 3840);
    assert.equal(nextCalls, 0);
    session.activate();
    const result = Buffer.from(await fetch(url).then(response => response.arrayBuffer()));
    assert.equal(result.toString('ascii', 0, 4), 'RIFF');
    const duration = (result.length - 44) / (48000 * 4);
    if (mode === 'normal') assert.ok(duration >= 2 && duration < 2.1, `Normal truncated a song: ${duration}s`);
    else assert.ok(duration > 1.5 && duration < 1.99, `Expected a real overlap, got ${duration}s`);
    assert.equal(transitions[0].type, mode);
    if (mode === 'dj') assert.ok(transitions[0].rate < 1 && transitions[0].rate >= 0.92);
    assert.equal(nextCalls, 2);
    assert.equal(session.failure, undefined);
    assert.ok(result.some((value, i) => i > 44 && value !== 0));
  } finally {
    session?.stop();
    await new Promise(resolve => setTimeout(resolve, 100));
    await rm(directory, { recursive: true, force: true });
  }
});


test('playlist aleatoria en DJ: elige la compatible y reproduce todas una sola vez', async () => {
  const { MusicQueue } = await import('../src/music/queue.js');
  const directory = await mkdtemp(path.join(tmpdir(), 'tilin-order-'));
  let session;
  try {
    const filePath = path.join(directory,'tone.wav'); await fixture(filePath,330);
    const track = (id,bpm) => ({ encoded:id,filePath,info:{length:1000},shuffleGroup:'playlist',
      analysis:{duration:1,intro:0,outro:1,bpm,confidence:0.9,beatOffset:0} });
    const queue = new MusicQueue();queue.current=track('first',120);
    queue.tracks=[track('incompatible',155),track('compatible',122)];
    const settings={...DEFAULT_MIX,mode:'dj'};
    const played=[];
    const choose=()=>{queue.orderForMix(settings,session?.current?.rate || 1,()=>true);return queue.tracks[0];};
    session=new MixSession({track:queue.current,settings,pace:false,peek:choose,ready:()=>true,prepare:async()=>{},
      next:reason=>{choose();return queue.next(reason);},onTrack:(t,plan)=>played.push({id:t.encoded,plan}),onError:()=>{}});
    const url=await session.url();session.activate();
    await fetch(url).then(r=>r.arrayBuffer());
    assert.deepEqual(played.map(t=>t.id),['compatible','incompatible']);
    assert.equal(played[0].plan.type,'dj');
    assert.equal(queue.tracks.length,0);assert.equal(session.failure,undefined);
  } finally {
    session?.stop();await new Promise(resolve=>setTimeout(resolve,100));
    await rm(directory,{recursive:true,force:true});
  }
});
