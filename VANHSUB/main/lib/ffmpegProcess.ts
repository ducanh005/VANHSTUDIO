import { execFile } from 'node:child_process';
import { getFfmpegBinPath } from '../asr/audioExtractor';
import { CancelledError } from './cancel';
import { killProcessTree } from './processTree';

/** Run without a shell and keep cancellation effective until the child exits. */
export async function runFfmpeg(args: string[], options?: { shouldStop?: () => boolean }): Promise<void> {
  if (options?.shouldStop?.()) throw new CancelledError();
  await new Promise<void>((resolve, reject) => {
    const child = execFile(getFfmpegBinPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error) => {
      if (timer) clearInterval(timer);
      if (options?.shouldStop?.()) reject(new CancelledError());
      else if (error) reject(error);
      else resolve();
    });
    const timer = options?.shouldStop
      ? setInterval(() => {
          if (options.shouldStop?.()) killProcessTree(child);
        }, 150)
      : undefined;
  });
}
