import { describe, expect, it } from 'vitest';
import deskWidgets from '../public/templates/desk-widgets.json?raw';
import wordClockTemplate from '../public/templates/word-clock.json?raw';
import { getObjectDef } from '../src/scene/objects/registry';
import {
  WORD_GRID, WORDS, calendarMonth, countdown, easeToward, formatCountdown, parseTarget, wordClockSentence, wordClockWords,
} from '../src/scene/objects/widget-logic';
import { parseScene } from '../src/scene/validate';
import { flipPhase, flipTime } from '../src/presets/flip-clock/flip';

describe('word clock', () => {
  it('uses an even 11 x 10 grid where every word is spelled where it says', () => {
    expect(WORD_GRID).toHaveLength(10);
    for (const row of WORD_GRID) expect(row).toHaveLength(11);
    for (const [word, [row, col, len]] of Object.entries(WORDS)) {
      expect(WORD_GRID[row].slice(col, col + len)).toBe(word.replace(/_MIN$/, ''));
    }
  });

  it.each([
    [11, 3, "IT IS ELEVEN O'CLOCK"],
    [11, 5, 'IT IS FIVE PAST ELEVEN'],
    [14, 15, 'IT IS A QUARTER PAST TWO'],
    [9, 29, 'IT IS TWENTY FIVE PAST NINE'],
    [9, 30, 'IT IS HALF PAST NINE'],
    [6, 37, 'IT IS TWENTY FIVE TO SEVEN'],
    [12, 45, 'IT IS A QUARTER TO ONE'],
    [23, 58, 'IT IS FIVE TO TWELVE'],
    [0, 0, "IT IS TWELVE O'CLOCK"],
  ])('%i:%i reads "%s"', (h, m, sentence) => {
    expect(wordClockSentence(h, m)).toBe(sentence);
  });

  it('never lights two words in the same cells', () => {
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        const cells = wordClockWords(h, m).flatMap((w) => {
          const [row, col, len] = WORDS[w];
          return Array.from({ length: len }, (_, i) => `${row},${col + i}`);
        });
        expect(new Set(cells).size).toBe(cells.length);
      }
    }
  });
});

describe('calendar', () => {
  it('lays out a month starting on Monday or Sunday', () => {
    const oct = calendarMonth(new Date(2026, 9, 28), true, 'en-GB'); // 1 Oct 2026 is a Thursday
    expect(oct.weeks[0]).toEqual([0, 0, 0, 1, 2, 3, 4]);
    expect(oct.weeks.at(-1)).toEqual([26, 27, 28, 29, 30, 31, 0]);
    expect(oct.today).toBe(28);
    expect(oct.weekdays[0]).toMatch(/^Mon/);
    expect(oct.title).toBe('October 2026');
    const sunday = calendarMonth(new Date(2026, 9, 1), false, 'en-GB');
    expect(sunday.weeks[0]).toEqual([0, 0, 0, 0, 1, 2, 3]);
    expect(sunday.weekdays[0]).toMatch(/^Sun/);
  });

  it('handles leap years and short months', () => {
    const feb = calendarMonth(new Date(2028, 1, 10), true);
    expect(Math.max(...feb.weeks.flat())).toBe(29);
    for (const week of feb.weeks) expect(week).toHaveLength(7);
  });
});

describe('countdown', () => {
  it('parses dates and refuses impossible ones', () => {
    expect(parseTarget('2027-01-01 00:00')?.getTime()).toBe(new Date(2027, 0, 1).getTime());
    expect(parseTarget(' 2027-3-5 ')?.getDate()).toBe(5);
    expect(parseTarget('2026-02-31')).toBeNull();
    expect(parseTarget('2026-01-01 25:00')).toBeNull();
    expect(parseTarget('next friday')).toBeNull();
  });

  it('counts down and stops at the target', () => {
    const now = new Date(2026, 9, 28, 11, 3, 49);
    const c = countdown(new Date(2027, 0, 1), now);
    expect(c).toEqual({ days: 64, hours: 12, minutes: 56, seconds: 11, done: false });
    expect(formatCountdown(c, true)).toBe('64 days  12:56:11');
    expect(formatCountdown({ ...c, days: 1 }, false)).toBe('1 day  12:56');
    expect(formatCountdown({ ...c, days: 0 }, true)).toBe('12:56:11');
    expect(countdown(new Date(2026, 0, 1), now).done).toBe(true);
  });

  it('eases gauges smoothly towards new readings', () => {
    expect(easeToward(0, 100, 0)).toBe(0);
    const v = easeToward(0, 100, 0.25);
    expect(v).toBeGreaterThan(50);
    expect(v).toBeLessThan(100);
  });
});

describe('flip clock preset', () => {
  it('shows hours without a leading zero in 12-hour time, with AM/PM', () => {
    expect(flipTime(new Date(2026, 0, 1, 19, 34, 5), false, false)).toEqual({ cards: ['7', '34'], meridiem: 'PM' });
    expect(flipTime(new Date(2026, 0, 1, 0, 5, 9), false, true)).toEqual({ cards: ['12', '05', '09'], meridiem: 'AM' });
    expect(flipTime(new Date(2026, 0, 1, 7, 5), true, false)).toEqual({ cards: ['07', '05'], meridiem: '' });
  });

  it('folds the top flap down, then opens the bottom flap', () => {
    expect(flipPhase(0)).toEqual({ topFlap: 1, bottomFlap: 0 });
    expect(flipPhase(0.25).topFlap).toBeCloseTo(Math.SQRT1_2);
    expect(flipPhase(0.5)).toEqual({ topFlap: 0, bottomFlap: 0 });
    expect(flipPhase(1).bottomFlap).toBeCloseTo(1);
    expect(flipPhase(2).bottomFlap).toBeCloseTo(1);
  });
});

describe('widget templates', () => {
  it.each([['Desk Widgets', deskWidgets], ['Word Clock', wordClockTemplate]])('%s uses only known objects', (_name, raw) => {
    const scene = parseScene(raw);
    expect(scene.objects.length).toBeGreaterThan(0);
    for (const o of scene.objects) expect(getObjectDef(o.type)).toBeDefined();
  });

  it('marks the system monitor as needing live system data', () => {
    expect(getObjectDef('system-monitor')?.needs).toBe('system');
    expect(getObjectDef('calendar')?.needs).toBeUndefined();
  });
});
