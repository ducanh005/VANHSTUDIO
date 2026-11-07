const sources = new WeakMap<HTMLAudioElement, string>();

/** Use the existing blob: media capability; do not relax the renderer CSP. */
export function setAudioPreviewSource(audio: HTMLAudioElement, result: { audioBase64: string; mimeType: string }): void {
  const bytes = Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0));
  const next = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
  clearAudioPreviewSource(audio);
  sources.set(audio, next);
  audio.src = next;
}

export function clearAudioPreviewSource(audio: HTMLAudioElement): void {
  audio.pause();
  const previous = sources.get(audio);
  if (previous) {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(previous);
    sources.delete(audio);
  }
}
