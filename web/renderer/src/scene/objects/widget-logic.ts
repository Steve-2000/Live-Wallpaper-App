// Pure logic behind the widgets (no drawing), so it can be tested directly.

// ------------------------------------------------------------------ word clock

/** An 11×10 letter grid; the filler letters only keep the rows even. */
export const WORD_GRID = [
  'ITLISASTIME',
  'ACQUARTERDC',
  'TWENTYFIVEX',
  'HALFSTENFTO',
  'PASTERUNINE',
  'ONESIXTHREE',
  'FOURFIVETWO',
  'EIGHTELEVEN',
  'SEVENTWELVE',
  'TENSEOCLOCK',
];

/** Where each word sits in the grid: [row, first column, length]. */
export const WORDS: Record<string, [number, number, number]> = {
  IT: [0, 0, 2], IS: [0, 3, 2],
  A: [1, 0, 1], QUARTER: [1, 2, 7],
  TWENTY: [2, 0, 6], FIVE_MIN: [2, 6, 4],
  HALF: [3, 0, 4], TEN_MIN: [3, 5, 3], TO: [3, 9, 2],
  PAST: [4, 0, 4], NINE: [4, 7, 4],
  ONE: [5, 0, 3], SIX: [5, 3, 3], THREE: [5, 6, 5],
  FOUR: [6, 0, 4], FIVE: [6, 4, 4], TWO: [6, 8, 3],
  EIGHT: [7, 0, 5], ELEVEN: [7, 5, 6],
  SEVEN: [8, 0, 5], TWELVE: [8, 5, 6],
  TEN: [9, 0, 3], OCLOCK: [9, 5, 6],
};

const HOURS = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
const MINUTE_WORDS: Record<number, string[]> = {
  0: ['OCLOCK'],
  5: ['FIVE_MIN', 'PAST'],
  10: ['TEN_MIN', 'PAST'],
  15: ['A', 'QUARTER', 'PAST'],
  20: ['TWENTY', 'PAST'],
  25: ['TWENTY', 'FIVE_MIN', 'PAST'],
  30: ['HALF', 'PAST'],
  35: ['TWENTY', 'FIVE_MIN', 'TO'],
  40: ['TWENTY', 'TO'],
  45: ['A', 'QUARTER', 'TO'],
  50: ['TEN_MIN', 'TO'],
  55: ['FIVE_MIN', 'TO'],
};

/** The words lit for a time, in five-minute steps ("IT IS TWENTY FIVE TO SEVEN"). */
export function wordClockWords(hours: number, minutes: number): string[] {
  const step = Math.floor(minutes / 5) * 5;
  const hour = HOURS[((step >= 35 ? hours + 1 : hours) % 12 + 12) % 12];
  const words = MINUTE_WORDS[step];
  // O'CLOCK reads after the hour; the others before it.
  return step === 0 ? ['IT', 'IS', hour, ...words] : ['IT', 'IS', ...words, hour];
}

/** The same time as a sentence, e.g. for accessibility labels and tests. */
export function wordClockSentence(hours: number, minutes: number): string {
  return wordClockWords(hours, minutes).map((w) => (w === 'OCLOCK' ? "O'CLOCK" : w.replace(/_MIN$/, ''))).join(' ');
}

// ------------------------------------------------------------------ calendar

export interface CalendarMonth {
  title: string;
  weekdays: string[];
  /** Weeks of 7 cells; 0 = outside the month. */
  weeks: number[][];
  /** Day of the month that is today, or 0 when today isn't in this month. */
  today: number;
}

export function calendarMonth(date: Date, mondayFirst: boolean, locale?: string): CalendarMonth {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (first.getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
  const weeks: number[][] = [];
  let week: number[] = new Array(offset).fill(0);
  for (let d = 1; d <= days; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push([...week, ...new Array(7 - week.length).fill(0)]);
  // Weekday initials in the user's language, starting from Sunday 2023-01-01.
  const names = Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((i + (mondayFirst ? 1 : 0)) % 7)).toLocaleDateString(locale, { weekday: 'short' }));
  return {
    title: first.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    weekdays: names,
    weeks,
    today: date.getDate(),
  };
}

// ------------------------------------------------------------------ countdown

/** "2026-12-31" or "2026-12-31 23:30" (local time); null if it isn't a real date. */
export function parseTarget(text: string): Date | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h = '0', mi = '0'] = m.slice(1);
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Reject roll-overs such as 2026-02-31.
  return date.getMonth() === Number(mo) - 1 && date.getDate() === Number(d) && Number(h) < 24 ? date : null;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

export function countdown(target: Date, now: Date): CountdownParts {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: false,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "12 days  04:15:09", "1 day  00:00", "03:12:45". */
export function formatCountdown(p: CountdownParts, showSeconds: boolean): string {
  const clock = showSeconds ? `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}` : `${pad(p.hours)}:${pad(p.minutes)}`;
  return p.days > 0 ? `${p.days} day${p.days === 1 ? '' : 's'}  ${clock}` : clock;
}

// ------------------------------------------------------------------ system monitor

/** Gentle easing towards a new reading so gauges glide instead of jumping. */
export function easeToward(current: number, target: number, dt: number, rate = 4): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Plausible, slowly varying values for the editor preview, where no host data exists. */
export function sampleSystemValues(t: number): { cpu: number; memory: number; battery: number } {
  return {
    cpu: 18 + 12 * Math.sin(t * 0.7) + 6 * Math.sin(t * 2.3),
    memory: 54 + 3 * Math.sin(t * 0.2),
    battery: 76,
  };
}
