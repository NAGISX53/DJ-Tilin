import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import ffmpeg from 'ffmpeg-static';
import { normalizationGain } from './analysis.js';
import { StereoBlend, transitionPlan } from './transition.js';

const RATE = 48000, SAMPLES = 960, CHANNELS = 2, FRAME_FLOAT_BYTES = SAMPLES * CHANNELS * 4;
const routes = new Map();
let server, listening;

export function wavHeader() {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(0xFFFFFFFF, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(0xFFFFFFFF, 40);
  return header;
}

async function bridge() {
  if (!listening) listening = new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const session = routes.get(request.url);
      if (!session || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', Connection: 'close' });
      if (request.method === 'HEAD') { response.end(); return; }
      response.write(wavHeader());
      if (!session.active) {
        // Lavalink probes the container before opening its playback connection.
        // A probe must never consume real samples or advance the playlist.
        response.end(Buffer.alloc(3840));
      } else session.connect(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.unref(); resolve(); });
  });
  await listening;
  return server.address().port;
}

class Decoder {
  constructor(track, cue, rate, gain, end) {
    const seconds = Math.max(0.02, (end - cue) / rate);
    this.child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '1',
      '-ss', String(Math.max(0, cue)), '-i', track.filePath, '-vn', '-filter_threads', '1',
      '-af', `atempo=${rate},volume=${gain}`, '-t', String(seconds), '-ar', String(RATE), '-ac', '2', '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    this.buffer = Buffer.alloc(0);
    this.iterator = this.child.stdout[Symbol.asyncIterator]();
    this.stderr = '';
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data.toString()).slice(-2000); });
    this.child.on('error', error => { this.failure = error; });
    this.child.on('close', code => { if (code && !this.stopped) this.failure = Error('FFmpeg no pudo decodificar la canción.'); });
    this.frames = 0;
  }
  async frame() {
    while (this.buffer.length < FRAME_FLOAT_BYTES && !this.ended && !this.stopped) {
      const part = await this.iterator.next();
      if (part.done) this.ended = true;
      else this.buffer = this.buffer.length ? Buffer.concat([this.buffer, part.value]) : part.value;
    }
    if (this.failure) throw this.failure;
    if (!this.buffer.length) return null;
    const output = new Float32Array(SAMPLES * CHANNELS);
    const bytes = Math.min(this.buffer.length - this.buffer.length % 4, FRAME_FLOAT_BYTES);
    for (let offset = 0; offset < bytes; offset += 4) output[offset / 4] = this.buffer.readFloatLE(offset);
    this.buffer = this.buffer.subarray(bytes);
    this.frames++;
    return output;
  }
  stop() { this.stopped = true; this.child.stdout.destroy(); this.child.kill(); }
}

export class MixSession {
  constructor({ track, settings, peek, ready, prepare, next, onTrack, onError, pace = true }) {
    this.firstTrack = track;
    this.settings = { ...settings };
    this.peek = peek; this.ready = ready; this.prepare = prepare; this.next = next;
    this.onTrack = onTrack; this.onError = onError;
    this.pace = pace;
    this.abort = new AbortController();
    this.blender = new StereoBlend();
    this.path = `/music/${randomBytes(24).toString('hex')}.wav`;
    this.active = false; this.finished = false; this.stopped = false; this.paused = false;
    this.rendered = 0; this.lastTransition = null;
  }
  async url() {
    const port = await bridge(); routes.set(this.path, this);
    return `http://127.0.0.1:${port}${this.path}`;
  }
  activate() { this.active = true; }
  configure(settings) { this.settings = { ...settings }; }
  pause(value) { this.paused = value; }
  skip() { this.skipRequested = true; }
  get position() {
    return this.current ? Math.floor((this.current.cue + this.current.decoder.frames * 0.02 * this.current.rate) * 1000) : 0;
  }
  open(track, plan = { cue: 0, incomingRate: 1 }) {
    const analysis = track.analysis;
    const smart = ['smart', 'dj'].includes(this.settings.mode);
    const cue = smart ? Math.max(plan.cue || 0, analysis?.intro || 0) : 0;
    const end = smart ? analysis?.outro : analysis?.duration;
    const duration = end || track.info.length / 1000;
    const rate = plan.incomingRate || 1;
    if (!track.filePath || !duration) throw Error('Esta canción no tiene audio local apto para mezclar.');
    return { track, cue, end: duration, rate,
      decoder: new Decoder(track, cue, rate, normalizationGain(analysis, this.settings.normalize), duration) };
  }
  connect(response) {
    if (this.response || this.stopped || this.finished) { response.end(); return; }
    this.response = response;
    response.on('close', () => { if (!this.finished && !this.stopped) this.stop(); });
    this.run().catch(error => {
      if (!this.stopped) { this.failure = error; this.finished = true; this.onError?.(error); }
    }).finally(() => {
      this.current?.decoder.stop(); this.fade?.outgoing.decoder.stop();
      this.finished = true; routes.delete(this.path); response.end();
    });
  }
  async output(buffer) {
    if (this.stopped) throw Error('Mezclador detenido.');
    while (this.paused && !this.stopped) { await delay(25, undefined, { signal: this.abort.signal }); this.deadline = performance.now(); }
    if (!this.response.write(buffer)) await new Promise((resolve, reject) => {
      const drain = () => { cleanup(); resolve(); };
      const close = () => { cleanup(); reject(Error('Conexión de mezcla cerrada.')); };
      const cleanup = () => { this.response.off('drain', drain); this.response.off('close', close); };
      this.response.once('drain', drain); this.response.once('close', close);
    });
    this.rendered++;
    this.deadline += 20;
    if (this.deadline < performance.now() - 200) this.deadline = performance.now();
    if (this.pace) await delay(Math.max(0, this.deadline - performance.now()), undefined, { signal: this.abort.signal });
  }
  async waitForPreparation(track) {
    let done = false, error;
    this.prepare(track).then(() => { done = true; }, failure => { error = failure; done = true; });
    while (!done && !this.stopped) await this.output(Buffer.alloc(3840));
    if (error) throw error;
    if (this.stopped) throw Error('Mezclador detenido.');
  }
  async change(reason, plan, seconds) {
    let track = await this.next(reason);
    if (!track) return false;
    const outgoing = this.current;
    this.fade?.outgoing.decoder.stop(); this.fade = null;
    while (track && !this.ready(track)) {
      outgoing?.decoder.stop();
      try { await this.waitForPreparation(track); break; }
      catch (error) {
        if (this.stopped) throw error;
        this.onError?.(error);
        track = await this.next('loadFailed');
      }
    }
    if (!track) return false;
    const selectedPlan = plan && (!plan.expectedTrack || plan.expectedTrack === track) ? plan : transitionPlan(outgoing?.track.analysis, track.analysis, this.settings, outgoing?.rate || 1);
    this.current = this.open(track, selectedPlan);
    const duration = seconds ?? selectedPlan.seconds;
    if (outgoing && !outgoing.decoder.stopped && duration > 0) {
      this.fade = { outgoing, frame: 0, total: Math.max(1, Math.round(duration / 0.02)) };
    } else outgoing?.decoder.stop();
    this.lastTransition = { type: selectedPlan.type, seconds: duration, rate: this.current.rate,
      bpm: track.analysis?.bpm || null, confidence: track.analysis?.confidence || 0, fallback: selectedPlan.fallback };
    this.onTrack?.(track, this.lastTransition);
    return true;
  }
  async run() {
    this.deadline = performance.now();
    this.current = this.open(this.firstTrack);
    while (!this.stopped) {
      while (this.paused && !this.stopped) { await delay(25, undefined, { signal: this.abort.signal }); this.deadline = performance.now(); }
      if (this.skipRequested) {
        this.skipRequested = false;
        if (!await this.change('stopped', null, this.settings.mode === 'normal' ? 0 : 0.35)) break;
      }
      if (!this.fade && this.settings.mode !== 'normal') {
        const upcoming = this.peek();
        if (upcoming && this.ready(upcoming)) {
          const plan = transitionPlan(this.current.track.analysis, upcoming.analysis, this.settings, this.current.rate);
          const total = (this.current.end - this.current.cue) / this.current.rate;
          let start = Math.max(0, total - plan.seconds);
          if (['smart', 'dj'].includes(plan.type) && this.settings.syncBpm && this.current.track.analysis?.bpm) {
            const beat = 60 / (this.current.track.analysis.bpm * this.current.rate);
            const phase = ((this.current.track.analysis.beatOffset || 0) - this.current.cue) / this.current.rate;
            start = Math.min(total - 0.1, phase + Math.ceil((start - phase) / beat) * beat);
          }
          const elapsed = this.current.decoder.frames * 0.02;
          if (elapsed >= start) {
            if (!await this.change('finished', { ...plan, expectedTrack: upcoming }, Math.max(0.1, total - elapsed))) break;
          }
        }
      }
      const incoming = await this.current.decoder.frame();
      if (this.fade) {
        const previous = await this.fade.outgoing.decoder.frame();
        this.blender.progressStep = 1 / this.fade.total;
        await this.output(this.blender.frame(previous, incoming, this.fade.frame / this.fade.total));
        if (++this.fade.frame >= this.fade.total || !previous) { this.fade.outgoing.decoder.stop(); this.fade = null; }
      } else if (incoming) {
        this.blender.progressStep = 0;
        await this.output(this.blender.frame(incoming));
      } else {
        if (!await this.change('finished', { type: 'normal', seconds: 0, cue: 0, incomingRate: 1, fallback: null }, 0)) break;
      }
    }
    this.finished = true;
  }
  stop() {
    this.stopped = true; this.abort.abort(); routes.delete(this.path);
    this.current?.decoder.stop(); this.fade?.outgoing.decoder.stop();
    this.response?.end();
  }
}
