import { playableTrack } from './sources.js';

// Background work never takes the guild's command/playback lock. Both a
// transition and a preload wait for the same promise when they need a track.
export class TrackPreparation {
  constructor(node, load = playableTrack, onError = () => {}) {
    this.node = node;
    this.load = load;
    this.onError = onError;
    this.pending = new WeakMap();
    this.ready = new WeakSet();
    this.failed = new WeakSet();
    this.upcoming = [];
    this.worker = null;
    this.closed = false;
  }

  prepare(track) {
    if (this.ready.has(track)) return Promise.resolve(track);
    if (this.pending.has(track)) return this.pending.get(track);
    const task = Promise.resolve().then(() => this.load(this.node, track))
      .then(() => { this.ready.add(track); return track; })
      .finally(() => this.pending.delete(track));
    this.pending.set(track, task);
    return task;
  }

  prefetch(tracks, limit = 2) {
    if (this.closed) return;
    // Two songs normally; up to six candidates for a shuffled AutoMix batch.
    this.limit = Math.max(1, Math.min(6, limit));
    this.upcoming = tracks.slice(0, this.limit);
    if (this.worker) return;
    this.worker = this.pump().finally(() => {
      this.worker = null;
      // The queue can change in a promise continuation after pump has finished
      // its loop but before this cleanup runs. Do not lose that new lookahead.
      if (!this.closed && this.upcoming.some(item => !this.ready.has(item) && !this.failed.has(item))) {
        this.prefetch(this.upcoming, this.limit);
      }
    });
  }

  async pump() {
    while (!this.closed) {
      const track = this.upcoming.find(item => !this.ready.has(item) && !this.failed.has(item));
      if (!track) return;
      try { await this.prepare(track); }
      catch (error) {
        // Do not loop on a broken source. Foreground playback can retry later.
        this.failed.add(track);
        this.onError(error);
      }
    }
  }

  close() {
    this.closed = true;
    this.upcoming = [];
  }
}
