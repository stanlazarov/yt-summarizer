/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "1:15" → 75, "1:02:05" → 3725. Returns null for anything that isn't a timestamp. */
export function parseTimestamp(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(trimmed)) return null;
  return trimmed.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}
