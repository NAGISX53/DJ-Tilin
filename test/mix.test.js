import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhythm, summarize, normalizationGain } from '../src/music/analysis.js';
import { transitionPlan, StereoBlend } from '../src/music/transition.js';
import { mixSettings } from '../src/music/mix-settings.js';

test('el análisis encuentra un pulso periódico y rechaza el silencio', () => {
  const step = 0.01;
  const energy = Array.from({ length: 6000 }, (_, i) => i % 50 < 4 ? 0.7 : 0.01);
  const result = rhythm(energy, step);
  assert.ok(Math.abs(result.bpm - 120) < 2);
  assert.ok(result.confidence >= 0.3);
  assert.equal(rhythm(Array(4000).fill(0), step).confidence, 0);
});

test('smart y DJ se limitan a ritmos compatibles y respetan la opción de sincronizar', () => {
  const a = { bpm: 120, confidence: 0.8, duration: 180, beatOffset: 0.1 };
  const b = { bpm: 124, confidence: 0.8, duration: 200, intro: 0.2, beatOffset: 0.15 };
  const settings = mixSettings({ mode: 'dj' });
  const dj = transitionPlan(a, b, settings);
  assert.equal(dj.type, 'dj');
  assert.ok(Math.abs(dj.incomingRate * b.bpm - a.bpm) < 0.001);
  assert.ok(dj.incomingRate >= 0.92 && dj.incomingRate <= 1.08);
  assert.equal(transitionPlan(a, { ...b, bpm: 90 }, settings).type, 'crossfade');
  assert.equal(transitionPlan(a, { ...b, confidence: 0.05 }, settings).type, 'crossfade');
  assert.equal(transitionPlan(a, b, { ...settings, syncBpm: false }).incomingRate, 1);
  assert.equal(transitionPlan(a, b, { ...settings, mode: 'normal' }).seconds, 0);
});

test('normalizar evita amplificación excesiva y respeta el pico verdadero', () => {
  assert.equal(normalizationGain({ loudness: -30, peakDb: -0.5 }, false), 1);
  assert.ok(normalizationGain({ loudness: -30, peakDb: -0.5 }, true) < 1);
  assert.ok(normalizationGain({ loudness: -30, peakDb: -20 }, true) <= 10 ** (6 / 20));
  const energy = [0, 0, ...Array(500).fill(0.2), 0, 0];
  assert.ok(summarize(energy, 12).intro > 0);
});

test('mezclar señales correlacionadas no satura ni convierte el estéreo en mono', () => {
  const a = new Float32Array(1920), b = new Float32Array(1920);
  for (let i = 0; i < 1920; i += 2) { a[i] = 0.9; b[i] = 0.9; a[i + 1] = 0.2; b[i + 1] = -0.2; }
  const mix = new StereoBlend();
  for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
    const frame = mix.frame(a, b, progress);
    for (let i = 0; i < frame.length; i += 2) assert.ok(Math.abs(frame.readInt16LE(i)) <= Math.ceil(32767 * 0.9));
    assert.notEqual(frame.readInt16LE(0), frame.readInt16LE(2));
  }
});

test('valida todas las opciones antes de guardar AutoMix', () => {
  assert.throws(() => mixSettings({ seconds: 99 }));
  assert.throws(() => mixSettings({ mode: 'fake' }));
  assert.throws(() => mixSettings({ normalize: 'true' }));
  assert.throws(() => mixSettings({ token: 'x' }));
  assert.equal(mixSettings({ seconds: 15 }).seconds, 15);
});
