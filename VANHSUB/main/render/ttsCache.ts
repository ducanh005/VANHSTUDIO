import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Seed only manifest-referenced masters, while keeping previous runs independent. */
export function createTtsRunDirectory(projectDir: string, previousDir?: string): string {
  const dir = path.join(projectDir, 'tts_audio', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  if (!previousDir || !fs.existsSync(previousDir)) return dir;
  let manifest: Record<string, { isGroupMember?: boolean; leaderIndex?: number }>;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(previousDir, 'manifest.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return dir;
  } catch { return dir; }
  const names = new Set<string>();
  for (const [index, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== 'object' || !/^\d+$/.test(index)) continue;
    const leader = entry.isGroupMember ? entry.leaderIndex : Number(index);
    if (!Number.isSafeInteger(leader) || (leader ?? 0) < 1) continue;
    names.add(`subtitle_${String(leader).padStart(4, '0')}.mp3`);
  }
  for (const name of names) {
    const source = path.join(previousDir, name);
    if (fs.existsSync(source) && fs.lstatSync(source).isFile()) {
      // Hard links would let a regenerated master overwrite a completed prior run.
      fs.copyFileSync(source, path.join(dir, name));
    }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}
