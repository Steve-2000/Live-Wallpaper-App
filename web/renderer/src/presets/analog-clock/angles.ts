/** Hand angles in radians, clockwise from 12 o'clock. `sweep` moves the second hand smoothly. */
export function handAngles(date: Date, sweep: boolean): { hour: number; minute: number; second: number } {
  const ms = date.getMilliseconds();
  const s = date.getSeconds() + (sweep ? ms / 1000 : 0);
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  const turn = Math.PI * 2;
  return { hour: (h / 12) * turn, minute: (m / 60) * turn, second: (s / 60) * turn };
}
