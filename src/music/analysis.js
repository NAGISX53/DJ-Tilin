import ffmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, stat, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { SPECTRAL_RATE, FRAME_SIZE, MAX_FRAMES } from './spectral.js';

const directory = fileURLToPath(new URL('../../runtime/analysis/', import.meta.url));
const running = new Map();
const RATE = SPECTRAL_RATE, WINDOW = 256;
let spectralQueue=Promise.resolve();

function spectralFeatures(frames,energy) {
  const job=spectralQueue.then(()=>new Promise((resolve,reject)=>{
    let received=false;
    const worker=new Worker(new URL('./spectral-worker.js',import.meta.url),{
      workerData:{frames,energy},transferList:frames.map(frame=>frame.buffer),
      execArgv:[]
    });
    const timer=setTimeout(()=>{reject(Error('Tiempo de análisis tonal agotado.'));void worker.terminate();},15000).unref();
    worker.once('message',value=>{received=true;clearTimeout(timer);resolve(value);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',()=>{clearTimeout(timer);if(!received)reject(Error('No pude completar el análisis tonal.'));});
  }));
  spectralQueue=job.catch(()=>{});
  return job;
}

export function rhythm(energy, step = WINDOW / RATE) {
  if (energy.length * step < 12) return { bpm: null, confidence: 0, beatOffset: 0 };
  const onset = energy.map((level, i) => Math.max(0, level - (energy[i - 1] || 0)));
  const mean = onset.reduce((sum, value) => sum + value, 0) / onset.length;
  if (mean < 1e-7) return { bpm: null, confidence: 0, beatOffset: 0 };
  const minimum = Math.floor(60 / 180 / step), maximum = Math.ceil(60 / 60 / step);
  const scores = [];
  let best = { lag: 0, score: 0 };
  for (let lag = minimum; lag <= maximum; lag++) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = lag; i < onset.length; i++) {
      const a = onset[i] - mean, b = onset[i - lag] - mean;
      dot += a * b; normA += a * a; normB += b * b;
    }
    const score = dot / (Math.sqrt(normA * normB) || 1);
    scores.push(score);
    if (score > best.score) best = { lag, score };
  }
  if (!best.lag) return { bpm: null, confidence: 0, beatOffset: 0 };
  // Estimate phase by accumulating onset strength over the entire recording.
  const phases = Array(best.lag).fill(0);
  onset.forEach((value, i) => { phases[i % best.lag] += value; });
  const phase = phases.indexOf(Math.max(...phases));
  const average = scores.reduce((sum, score) => sum + Math.max(0, score), 0) / scores.length;
  const confidence = Math.max(0, Math.min(1, (best.score - average) * 1.7));
  return { bpm: 60 / (best.lag * step), confidence, beatOffset: phase * step };
}

export function summarize(energy, duration, loudness = null, peakDb = null) {
  const maximum = energy.reduce((best, value) => Math.max(best, value), 0);
  const threshold = Math.max(0.00015, maximum * 0.008);
  let first = energy.findIndex(value => value > threshold);
  if (first < 0) first = 0;
  let last = energy.length - 1;
  while (last > first && energy[last] <= threshold) last--;
  const step = WINDOW / RATE;
  const intro = Math.min(8, first * step);
  const outro = Math.max(intro + 1, Math.min(duration, (last + 1) * step));
  return { duration, intro, outro, loudness, peakDb, ...rhythm(energy) };
}

export async function analyze(track) {
  if (track.analysis) return track.analysis;
  if (!track.filePath) return null;
  const file = await stat(track.filePath);
  const key = createHash('sha256').update(path.resolve(track.filePath)).digest('hex').slice(0, 32);
  const cachedFile = path.join(directory, `${key}.json`);
  const signature = `${file.size}:${file.mtimeMs}:v4`;
  const saved = await readFile(cachedFile, 'utf8').then(JSON.parse).catch(() => null);
  if (saved?.signature === signature) { track.analysis = saved.analysis; return saved.analysis; }
  if (!running.has(track.filePath)) {
    const work = scan(track.filePath,track.info?.length / 1000).then(async analysis => {
      await mkdir(directory, { recursive: true });
      const temporary = `${cachedFile}.tmp`;
      await writeFile(temporary, JSON.stringify({ signature, analysis }));
      await rename(temporary, cachedFile);
      return analysis;
    }).finally(() => running.delete(track.filePath));
    running.set(track.filePath, work);
  }
  track.analysis = await running.get(track.filePath);
  return track.analysis;
}

async function scan(filename,duration) {
  const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-nostats', '-threads', '1', '-i', filename,
    '-vn', '-filter_threads', '1', '-af', 'ebur128=peak=true', '-ar', String(RATE), '-ac', '1', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
  let stderr = '', pending = Buffer.alloc(0), sum = 0, samples = 0, count = 0;
  const energy = [];
  const frames=[];
  const hop=Math.max(RATE*2,Number.isFinite(duration)?Math.ceil(duration*RATE/MAX_FRAMES):0);
  let nextFrameStart=0,frame=new Float32Array(FRAME_SIZE),frameCount=0;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-24000); });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error('No pude analizar el audio.')));
  });
  // Attach a handler immediately, including while stdout is being consumed.
  finished.catch(() => {});
  const timer = setTimeout(() => child.kill(), 90_000).unref();
  try {
    for await (const data of child.stdout) {
      const buffer = pending.length ? Buffer.concat([pending, data]) : data;
      const end = buffer.length - buffer.length % 4;
      for (let i = 0; i < end; i += 4) {
        const value = buffer.readFloatLE(i);
        if(frames.length<MAX_FRAMES&&samples>=nextFrameStart){
          frame[frameCount++]=value;
          if(frameCount===FRAME_SIZE){frames.push(frame);frame=new Float32Array(FRAME_SIZE);frameCount=0;nextFrameStart+=hop;}
        }
        sum += value * value; samples++; count++;
        if (count === WINDOW) { energy.push(Math.sqrt(sum / count)); count = 0; sum = 0; }
      }
      pending = buffer.subarray(end);
    }
    await finished;
    if (count) energy.push(Math.sqrt(sum / count));
    const integrated = [...stderr.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].at(-1);
    const peak = [...stderr.matchAll(/Peak:\s*(-?[\d.]+) dBFS/g)].at(-1);
    const features=await spectralFeatures(frames,energy).catch(error=>{
      console.warn('[AutoMix] '+error.message);return {key:null,tonalConfidence:0,energy:null};
    });
    return {...summarize(energy, samples / RATE, integrated ? Number(integrated[1]) : null, peak ? Number(peak[1]) : null),...features};
  } finally { clearTimeout(timer); child.kill(); }
}

export function normalizationGain(analysis, enabled) {
  if (!enabled || !analysis || !Number.isFinite(analysis.loudness)) return 1;
  const peakAllowance = Number.isFinite(analysis.peakDb) ? -2 - analysis.peakDb : 0;
  const db = Math.min(6, -16 - analysis.loudness, peakAllowance);
  return 10 ** (Math.max(-18, db) / 20);
}
