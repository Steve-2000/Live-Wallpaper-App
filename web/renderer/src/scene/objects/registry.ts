import { bird, butterfly, cat, fish } from './animals';
import { particles } from './effects';
import { grass, mountains, river, tree } from './nature';
import { cloud, moon, sun } from './sky';
import { clock, shape, text } from './textual';
import type { ObjectCategory, ObjectDef } from './types';
import { analogClock, calendar, countdownWidget, flipClock, systemMonitor, wordClock } from './widgets';

/** Every object type the editor library offers; scenes refer to them by `type`. */
export const OBJECT_DEFS: ObjectDef[] = [
  moon, sun, cloud,
  tree, mountains, grass, river,
  bird, butterfly, fish, cat,
  particles,
  text, clock,
  analogClock, flipClock, wordClock, calendar, systemMonitor, countdownWidget,
  shape,
];

export const CATEGORIES: ObjectCategory[] = ['Sky', 'Nature', 'Animals', 'Effects', 'Text & Clocks', 'Widgets', 'Shapes'];

const byType = new Map(OBJECT_DEFS.map((d) => [d.type, d]));

export function getObjectDef(type: string): ObjectDef | undefined {
  return byType.get(type);
}
