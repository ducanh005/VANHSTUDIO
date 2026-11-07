import { setAudioPreviewSource, clearAudioPreviewSource } from './audioPreviewSource';

/**
 * Player "nghe thử toàn bộ 1 mạch" — singleton sống ngoài React,
 * nên việc chuyển tab (unmount TTSPage) không làm dừng playback.
 * Component subscribe để hiển thị tiến trình; quay lại tab cũ vẫn
 * thấy dòng đang phát tiếp diễn.
 */

export interface FullPreviewLine {
  lineNumber: number;
  text: string;
  /** Giọng dùng cho dòng này (đã gộp giọng riêng/giọng chung) */
  voice: string;
}

export interface FullPreviewFetchResult {
  audioBase64: string;
  mimeType: string;
}

export type FullPreviewFetch = (line: FullPreviewLine) => Promise<FullPreviewFetchResult>;

export interface FullPreviewState {
  playing: boolean;
  /** Số dòng của dòng đang phát (null khi dừng) */
  currentLine: number | null;
  total: number;
  /** Biến thiên mỗi lần phiên phát mới — để UI biết khi nào bắt đầu lại */
  session: number;
}

let state: FullPreviewState = {
  playing: false,
  currentLine: null,
  total: 0,
  session: 0,
};

const listeners = new Set<() => void>();
const audio: { el: HTMLAudioElement | null } = { el: null };
let abortRequested = false;

function setState(patch: Partial<FullPreviewState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function getAudio(): HTMLAudioElement {
  if (!audio.el) audio.el = new Audio();
  return audio.el;
}

export const fullPreviewPlayer = {
  getState(): FullPreviewState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Bắt đầu phát 1 mạch từ dòng startLine (1-based).
   * lines được chụp lại tại thời điểm bấm — đổi gán giọng trong lúc phát
   * không ảnh hưởng phiên đang chạy (bấm lại để nghe bản mới).
   */
  start(params: { lines: FullPreviewLine[]; fetchAudio: FullPreviewFetch }, startLine = 1) {
    if (state.playing) return;
    const { lines, fetchAudio } = params;
    if (lines.length === 0) return;

    abortRequested = false;
    getAudio().pause();
    setState({
      playing: true,
      currentLine: startLine,
      total: lines.length,
      session: state.session + 1,
    });

    void (async () => {
      try {
        // Tải trước dòng kế trong lúc dòng hiện tại phát để giảm khoảng lặng
        const fetchLine = (idx: number) => {
          const line = lines[idx - 1];
          return line ? fetchAudio(line) : null;
        };

        let current = fetchLine(startLine);
        for (let i = startLine; i <= lines.length; i++) {
          if (abortRequested) break;
          const res = await current;
          if (!res || abortRequested) break;
          setState({ currentLine: i });
          const next = i < lines.length ? fetchLine(i + 1) : null;

          const el = getAudio();
          setAudioPreviewSource(el, res);
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            el.onended = done;
            el.onerror = done;
            el.onpause = done; // stop() cũng thoát khỏi vòng lặp
            el.play().catch(done);
          });
          current = next;
        }
      } catch {
        // lỗi tải audio giữa chừng — dừng im lặng, UI tự thoát trạng thái playing
      } finally {
        clearAudioPreviewSource(getAudio());
        setState({ playing: false, currentLine: null });
      }
    })();
  },

  stop() {
    abortRequested = true;
    audio.el?.pause();
  },
};
