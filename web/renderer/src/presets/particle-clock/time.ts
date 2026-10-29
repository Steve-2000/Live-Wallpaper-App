const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time, e.g. "09:05:07", "9:05 PM". */
export function formatClock(date: Date, use24h: boolean, showSeconds: boolean): string {
  let hours = date.getHours();
  let suffix = '';
  if (!use24h) {
    suffix = hours >= 12 ? ' PM' : ' AM';
    hours = hours % 12 || 12;
  }
  const hh = use24h ? pad(hours) : String(hours);
  const base = `${hh}:${pad(date.getMinutes())}`;
  return (showSeconds ? `${base}:${pad(date.getSeconds())}` : base) + suffix;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
