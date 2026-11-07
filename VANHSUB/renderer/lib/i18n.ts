import vi from '../locales/vi.json';

/**
 * Simple i18n helper function — chỉ dùng tiếng Việt, không cần next-i18next
 * Sử dụng: t('common.appName') trả về 'VanhStudio'
 * 
 * Hỗ trợ dot notation để truy cập nested objects:
 * t('home.greeting_morning') -> "Chào buổi sáng"
 */
export function t(key: string, defaultValue?: string): string {
  const keys = key.split('.');
  let value: any = vi;

  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) {
      console.warn(`[i18n] Missing translation key: ${key}`);
      return defaultValue || key;
    }
  }

  if (typeof value !== 'string') {
    console.warn(`[i18n] Translation value is not a string for key: ${key}`);
    return defaultValue || key;
  }

  return value;
}

/**
 * Format time duration (milliseconds) to Vietnamese text
 * 5000 -> "5 giây"
 * 60000 -> "1 phút"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms / 100) * 100}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)} giây`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} phút`;
  return `${Math.round(ms / 3600000)} giờ`;
}

/**
 * Format time ago in Vietnamese
 * giống như formatTimeAgo ở home.tsx nhưng dùng helper này
 */
export function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return t('common.justNow');
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} ${t('common.minutesAgo')}`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ${t('common.hoursAgo')}`;

    return date.toLocaleDateString('vi-VN');
  } catch {
    return t('common.justNow');
  }
}

/**
 * Format file size to human-readable format
 * 1024 -> "1 KB"
 * 1048576 -> "1 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
}

/**
 * Format time string for subtitle display
 * 5000 (ms) -> "00:00:05"
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}
