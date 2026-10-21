import assert from 'node:assert/strict';
import { subscribeVideoPreviewClock, type PreviewFrameScheduler } from '../renderer/lib/videoPreviewClock';

class Video extends EventTarget {
  currentTime = 0;
  paused = true;
  ended = false;
  emit(type: string) { this.dispatchEvent(new Event(type)); }
}

class Frames implements PreviewFrameScheduler {
  nextId = 0;
  callbacks = new Map<number, FrameRequestCallback>();
  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id: number) { this.callbacks.delete(id); }
  paint() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(0);
  }
}

const video = new Video();
const frames = new Frames();
const times: number[] = [];
const subtitles = [{ startMs: 1000, endMs: 1100 }, { startMs: 1100, endMs: 1200 }];
let active = -1;
const stop = subscribeVideoPreviewClock(video as unknown as HTMLVideoElement, time => {
  times.push(time);
  active = subtitles.findIndex(line => time >= line.startMs && time < line.endMs);
}, frames);
assert.deepEqual(times, [0]);
assert.equal(frames.callbacks.size, 0, 'Paused video needs no animation loop');

video.paused = false;
video.emit('play');
video.emit('playing');
video.emit('timeupdate');
assert.equal(frames.callbacks.size, 1, 'Media events must not start duplicate loops');

// No timeupdate events between these paints: even a 100ms caption must show.
video.currentTime = 1;
frames.paint();
assert.equal(active, 0);
video.currentTime = 1.1;
frames.paint();
assert.equal(active, 1, 'Switch captions at their shared boundary');
video.currentTime = 1.2;
frames.paint();
assert.equal(active, -1, 'Remove captions at the end boundary');

const count = times.length;
frames.paint();
assert.equal(times.length, count, 'A stalled media clock must not advance or republish');
video.currentTime = 2.75;
frames.paint();
assert.equal(times.at(-1), 2750, 'Follow actual media time after speed changes or delayed paints');

video.paused = true;
video.currentTime = 2.8;
video.emit('pause');
assert.equal(times.at(-1), 2800);
assert.equal(frames.callbacks.size, 0);
video.currentTime = 1.05;
video.emit('seeking');
assert.equal(active, 0, 'Seeking while paused updates captions immediately');
video.currentTime = 1.15;
video.emit('seeked');
assert.equal(active, 1);

video.paused = false;
video.emit('play');
const staleCallback = [...frames.callbacks.values()][0];
stop();
assert.equal(frames.callbacks.size, 0);
const stoppedCount = times.length;
video.currentTime = 10;
video.emit('timeupdate');
staleCallback(0);
assert.equal(times.length, stoppedCount, 'Old video/tab must not publish after cleanup');
assert.equal(frames.callbacks.size, 0);

const resumed: number[] = [];
const stopResumed = subscribeVideoPreviewClock(video as unknown as HTMLVideoElement, time => resumed.push(time), frames);
assert.deepEqual(resumed, [10000], 'Reattaching reads the current video position');
video.ended = true;
video.emit('ended');
assert.equal(frames.callbacks.size, 0);
stopResumed();
console.log('PASS: caption boundaries without timeupdate, seek, pause, actual media time, single loop and cleanup');
