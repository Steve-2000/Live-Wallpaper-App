/** The groups shown on the cards, e.g. hours "7", minutes "34", and "PM". */
export interface FlipTime {
  cards: string[];
  meridiem: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 12-hour time shows "7" (no leading zero) like a real flip clock; 24-hour shows "07". */
export function flipTime(date: Date, use24h: boolean, seconds: boolean): FlipTime {
  const h = date.getHours();
  const hours = use24h ? pad(h) : String(h % 12 || 12);
  const cards = [hours, pad(date.getMinutes())];
  if (seconds) cards.push(pad(date.getSeconds()));
  return { cards, meridiem: use24h ? '' : h < 12 ? 'AM' : 'PM' };
}

/**
 * Where the flip animation is at `k` (0..1): the falling top flap shrinks to the hinge during the
 * first half, the rising bottom flap opens from the hinge during the second half.
 */
export function flipPhase(k: number): { topFlap: number; bottomFlap: number } {
  const t = Math.min(1, Math.max(0, k));
  // Ease so the flap accelerates as it falls and settles as it lands.
  const fall = t < 0.5 ? Math.cos((t / 0.5) * (Math.PI / 2)) : 0;
  const land = t >= 0.5 ? Math.sin(((t - 0.5) / 0.5) * (Math.PI / 2)) : 0;
  return { topFlap: fall, bottomFlap: land };
}
