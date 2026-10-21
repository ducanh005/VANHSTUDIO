export interface PreviewFrameScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
}

/** Read the media clock each paint; timeupdate alone can leave captions stale. */
export function subscribeVideoPreviewClock(
  video: HTMLVideoElement,
  onTimeMs: (timeMs: number) => void,
  scheduler: PreviewFrameScheduler = window,
): () => void {
  let frameId: number | null = null;
  let disposed = false;
  let lastTimeMs: number | undefined;

  const publish = () => {
    const timeMs = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime * 1000) : 0;
    if (timeMs !== lastTimeMs) {
      lastTimeMs = timeMs;
      onTimeMs(timeMs);
    }
  };

  const cancelFrame = () => {
    if (frameId !== null) scheduler.cancelAnimationFrame(frameId);
    frameId = null;
  };

  const update = () => {
    if (disposed) return;
    publish();
    if (video.paused || video.ended) {
      cancelFrame();
    } else if (frameId === null) {
      frameId = scheduler.requestAnimationFrame(() => {
        frameId = null;
        update();
      });
    }
  };

  const events = [
    'play', 'playing', 'pause', 'ended', 'seeking', 'seeked',
    'loadedmetadata', 'emptied', 'timeupdate', 'ratechange',
  ];
  for (const event of events) video.addEventListener(event, update);
  update();

  return () => {
    disposed = true;
    cancelFrame();
    for (const event of events) video.removeEventListener(event, update);
  };
}
