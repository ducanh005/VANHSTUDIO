/** A script must contain readable narration in every segment, not only punctuation/emoji.
 * @param {unknown} lines
 * @returns {boolean}
 */
export function hasUsableScript(lines) {
  return Array.isArray(lines) && lines.length > 0 && lines.every(line =>
    line && typeof line.text === 'string' && /[\p{L}\p{N}]/u.test(line.text));
}

/** @param {unknown} lines */
export function assertUsableScript(lines) {
  if (!hasUsableScript(lines)) throw new Error('Kịch bản phải có ít nhất một phân đoạn và lời thoại đọc được trong từng dòng.');
}
