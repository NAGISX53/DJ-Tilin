import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describeSpectrum,estimateKey,harmonicRelation,energyDifference,analysisDescription,FRAME_SIZE,SPECTRAL_RATE} from '../src/music/spectral.js';
import {analyze} from '../src/music/analysis.js';
import {bestNext} from '../src/music/ordering.js';
import {transitionPlan} from '../src/music/transition.js';
import {DEFAULT_MIX} from '../src/music/mix-settings.js';
import {MusicQueue} from '../src/music/queue.js';
import {musicCommands} from '../src/commands/music.js';

const chord=(notes,amplitude=0.5)=>Float32Array.from({length:FRAME_SIZE},(_,i)=>notes.reduce((s,n)=>s+Math.sin(2*Math.PI*440*2**((n-69)/12)*i/SPECTRAL_RATE),0)/notes.length*amplitude);
const major=[[60,64,67],[60,64,67],[65,69,72],[67,71,74],[60,64,67]];
const minor=[[57,60,64],[57,60,64],[62,65,69],[64,67,71],[57,60,64]];
const frames=(progression,shift=0,amplitude=0.5)=>Array.from({length:15},(_,i)=>chord(progression[i%5].map(n=>n+shift),amplitude));
const key=(tonic,mode='major',confidence=0.9)=>({tonic,mode,confidence});
const settings={...DEFAULT_MIX,mode:'dj'};
const song=(id,patch={})=>({info:{title:id},shuffleGroup:'batch',analysis:{duration:180,bpm:120,confidence:0.9,key:key(0),energy:0.6,...patch}});

test('FFT y cromas identifican progresiones mayores y menores transpuestas, no solo notas aisladas',()=>{
  for(const shift of [0,2,5,9])for(const [progression,tonic,mode] of [[major,0,'major'],[minor,9,'minor']]){
    const result=describeSpectrum(frames(progression,shift),Array(500).fill(.2));
    assert.equal(result.key?.tonic,(tonic+shift)%12);assert.equal(result.key.mode,mode);assert(result.key.confidence>=.45);
  }
});
test('silencio, cromas uniformes, muestras insuficientes y ruido no se anuncian como una tonalidad segura',()=>{
  assert.equal(describeSpectrum(Array.from({length:6},()=>new Float32Array(FRAME_SIZE)),Array(500).fill(0)).key,null);
  assert.equal(estimateKey(Array(12).fill(1)).key,null);assert.equal(estimateKey([6,0,0,0,0,0,0,0,0,0,0,0]).key,null);
  assert.equal(describeSpectrum(frames(major).slice(0,3),Array(500).fill(.2)).key,null);
  let seed=9;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};
  const noisy=Array.from({length:8},()=>Float32Array.from({length:FRAME_SIZE},()=>random()-.5));
  assert.equal(describeSpectrum(noisy,Array(500).fill(.2)).key,null);
});
test('la energía y tonalidad no dependen de subir el volumen de la misma señal',()=>{
  const a=describeSpectrum(frames(major,0,.5),Array.from({length:500},(_,i)=>i%30<3?.3:.05));
  const b=describeSpectrum(frames(major,0,.05),Array.from({length:500},(_,i)=>(i%30<3?.3:.05)*.1));
  assert.equal(a.key.tonic,b.key.tonic);assert.equal(a.energy,b.energy);assert(a.energy>=0&&a.energy<=1);
});
test('relaciones armónicas reconocen misma tonalidad, relativa, vecina y distante sin confiar en análisis débil',()=>{
  assert.equal(harmonicRelation(key(0),key(0)).kind,'same');
  assert.equal(harmonicRelation(key(0),key(9,'minor')).kind,'relative');
  assert.equal(harmonicRelation(key(0),key(7)).kind,'neighbor');
  assert.equal(harmonicRelation(key(0),key(5)).kind,'neighbor');
  assert.equal(harmonicRelation(key(0),key(6)).kind,'distant');
  assert.equal(harmonicRelation(key(0),key(6,'major',.1)).kind,'unknown');
  assert.equal(harmonicRelation(null,key(0)).kind,'unknown');
  assert.equal(energyDifference(null,.5),null);assert.equal(energyDifference(.2,.8),.6000000000000001);
});
test('la selección combina tempo, tonalidad y energía sin perder temas ni cruzar peticiones manuales',()=>{
  const current=song('current'),bad=song('bad',{key:key(6)}),good=song('good',{bpm:122}),energyJump=song('jump',{energy:.05});
  assert.equal(bestNext(current,[bad,good],settings),good);
  assert.equal(bestNext(current,[energyJump,good],settings),good);
  const queue=new MusicQueue();queue.current=current;queue.tracks=[bad,good];queue.orderForMix(settings,1,()=>true);
  assert.deepEqual(queue.tracks.map(t=>t.info.title),['good','bad']);
  const manual={...bad,shuffleGroup:null};queue.tracks=[manual,good];queue.orderForMix(settings,1,()=>true);assert.equal(queue.tracks[0],manual);
  assert.equal(bestNext(current,[good],settings,1,()=>false),null);
});
test('sin BPM fiable aún usa tonalidad o energía; con datos desconocidos conserva el orden',()=>{
  const current=song('current',{bpm:null,confidence:0});
  assert.equal(bestNext(current,[song('bad',{key:key(6),bpm:null,confidence:0}),song('good',{bpm:null,confidence:0})],settings).info.title,'good');
  assert.equal(bestNext(song('none',{key:null,energy:null,bpm:null,confidence:0}),[song('none2',{key:null,energy:null,bpm:null,confidence:0})],settings),null);
});
test('tonalidades distantes o saltos de energía acortan solapamiento sin alterar el tono ni el margen de tempo',()=>{
  const current=song('current').analysis;
  const distant=transitionPlan(current,song('next',{key:key(6),bpm:124}).analysis,settings);
  assert.equal(distant.harmonic,'distant');assert(distant.seconds<=3);assert(distant.adjustment);assert(distant.incomingRate>=.92&&distant.incomingRate<=1.08);
  const jump=transitionPlan(current,song('jump',{energy:0.05}).analysis,settings);assert(jump.seconds<=3);
  const compatible=transitionPlan(current,song('same').analysis,settings);assert(compatible.seconds>3);assert.equal(compatible.adjustment,null);
  assert.equal(transitionPlan(current,song('bad',{key:key(6)}).analysis,{...settings,mode:'normal'}).seconds,0);
  assert.equal(transitionPlan(current,song('bad',{key:key(6)}).analysis,{...settings,mode:'crossfade'}).seconds,6);
});
test('el informe distingue datos estimados, incertidumbre y falta de análisis',()=>{
  assert.match(analysisDescription(null),/Preparando/);
  assert.match(analysisDescription({bpm:null,key:null,energy:null}),/Tonalidad incierta/);
  assert.match(analysisDescription({bpm:120,confidence:.9,key:{label:'Do mayor'},energy:.6}),/120 BPM.*Do mayor.*estimada.*60\/100/);
  assert(musicCommands.find(c=>c.data.name==='analisis'));
});

test('análisis real FFmpeg + worker conserva BPM/LUFS, añade tonalidad y reutiliza caché v4',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'tilin-spectrum-')),file=path.join(directory,'known-major.wav');
  const cacheDirectory=fileURLToPath(new URL('../runtime/analysis/',import.meta.url));let cacheFile;
  try{
    const chords=[major[0],major[0],major[0],major[2],major[3],major[0],major[0],major[0]];
    const samples=SPECTRAL_RATE*16,data=Buffer.alloc(samples*2),header=Buffer.alloc(44);
    header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(SPECTRAL_RATE,24);header.writeUInt32LE(SPECTRAL_RATE*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
    for(let i=0;i<samples;i++){
      const notes=chords[Math.floor(i/(SPECTRAL_RATE*2))];const pulse=.55+.45*(Math.floor(i/(SPECTRAL_RATE*.5))%2);
      const sample=notes.reduce((sum,n)=>sum+Math.sin(2*Math.PI*440*2**((n-69)/12)*i/SPECTRAL_RATE),0)/3*.5*pulse;
      data.writeInt16LE(Math.round(sample*32767),i*2);
    }
    await writeFile(file,Buffer.concat([header,data]));
    let ticks=0;const timer=setInterval(()=>ticks++,5);
    let result;try{result=await analyze({filePath:file,info:{length:16000}});}finally{clearInterval(timer);}
    assert.equal(result.key?.tonic,0);assert.equal(result.key.mode,'major');assert(result.duration>=15.9);assert(Number.isFinite(result.loudness));assert(Number.isFinite(result.energy));assert(result.spectralFrames>=4);assert(ticks>0);
    const {createHash}=await import('node:crypto');cacheFile=path.join(cacheDirectory,createHash('sha256').update(path.resolve(file)).digest('hex').slice(0,32)+'.json');
    const cached=JSON.parse(await readFile(cacheFile,'utf8'));assert(cached.signature.endsWith(':v4'));
    assert.deepEqual(await analyze({filePath:file,info:{length:16000}}),result);
  }finally{if(cacheFile)await rm(cacheFile,{force:true});await rm(directory,{recursive:true,force:true});}
});
