import { Container, Graphics, Text } from 'pixi.js';
import { handAngles } from '../../presets/analog-clock/angles';
import { formatClock } from '../../presets/particle-clock/time';
import type { ParamSpec } from '../../runtime/types';
import { FONTS, RENDER_SIZE, style } from './textual';
import { hex, num, type ObjectDef } from './types';
import {
  WORD_GRID, WORDS, calendarMonth, countdown, easeToward, formatCountdown, parseTarget, sampleSystemValues, wordClockWords,
} from './widget-logic';

// ------------------------------------------------------------------ shared pieces

/** Optional frosted card behind a widget. */
const PANEL: ParamSpec[] = [
  { key: 'panel', label: 'Background card', type: 'bool', default: true },
  { key: 'panelColor', label: 'Card colour', type: 'color', default: '#0e1220' },
  { key: 'panelOpacity', label: 'Card opacity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.55 },
];

function drawPanel(g: Graphics, w: number, h: number, p: Record<string, unknown>): void {
  g.clear();
  if (!p.panel) return;
  const r = Math.min(w, h) * 0.08;
  g.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: hex(p.panelColor, 0x0e1220), alpha: num(p.panelOpacity, 0.55) });
  g.roundRect(-w / 2, -h / 2, w, h, r).stroke({ width: Math.max(1, Math.min(w, h) * 0.004), color: 0xffffff, alpha: 0.08 });
}

/** A text object rasterised once at a fixed size and scaled where it's placed. */
function label(): Text {
  const t = new Text({ text: '', style: { fontSize: RENDER_SIZE } });
  t.resolution = 2;
  t.anchor.set(0.5);
  return t;
}

/** Sets text and scales it so its height is `height` (keeping its aspect), never wider than `maxWidth`. */
function place(t: Text, text: string, x: number, y: number, height: number, maxWidth = Infinity): void {
  if (t.text !== text) t.text = text;
  t.scale.set(1);
  const b = t.getLocalBounds();
  const s = Math.min(height / Math.max(1, b.height), maxWidth / Math.max(1, b.width));
  t.scale.set(s);
  t.position.set(x, y);
}

// ------------------------------------------------------------------ analog clock

export const analogClock: ObjectDef = {
  type: 'analog-clock',
  label: 'Analog clock',
  category: 'Widgets',
  icon: '◴',
  defaultSize: [360, 360],
  props: [
    { key: 'look', label: 'Style', type: 'select', options: ['Classic', 'Minimal', 'Modern'], default: 'Classic' },
    { key: 'face', label: 'Face colour', type: 'color', default: '#11141e' },
    { key: 'faceOpacity', label: 'Face opacity', type: 'range', min: 0, max: 1, step: 0.05, default: 0.85 },
    { key: 'hands', label: 'Hands and marks', type: 'color', default: '#f2f4f8' },
    { key: 'accent', label: 'Second hand', type: 'color', default: '#ff5d5d' },
    { key: 'numerals', label: 'Numbers', type: 'select', options: ['None', '12, 3, 6, 9', 'All'], default: '12, 3, 6, 9' },
    { key: 'seconds', label: 'Second hand', type: 'bool', default: true },
    { key: 'sweep', label: 'Smooth second hand', type: 'bool', default: true },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI Light' },
  ],
  create() {
    const root = new Container();
    const dial = new Graphics();
    const numbers = new Container();
    const hour = new Graphics();
    const minute = new Graphics();
    const second = new Graphics();
    const cap = new Graphics();
    root.addChild(dial, numbers, hour, minute, second, cap);
    let sweep = true;

    /** A hand drawn pointing at 12, rotated each frame. */
    const drawHand = (g: Graphics, length: number, tail: number, width: number, color: number, round: boolean) => {
      g.clear();
      if (round) g.roundRect(-width / 2, -length, width, length + tail, width / 2).fill({ color });
      else g.poly([-width / 2, tail, width / 2, tail, width * 0.3, -length, -width * 0.3, -length]).fill({ color });
    };

    return {
      root,
      build(w, h, p) {
        const r = Math.min(w, h) / 2;
        const look = String(p.look);
        const ink = hex(p.hands, 0xf2f4f8);
        const accent = hex(p.accent, 0xff5d5d);
        sweep = Boolean(p.sweep);
        dial.clear();
        const faceAlpha = look === 'Minimal' ? num(p.faceOpacity, 0.85) * 0.4 : num(p.faceOpacity, 0.85);
        dial.circle(0, 0, r).fill({ color: hex(p.face, 0x11141e), alpha: faceAlpha });
        if (look === 'Classic') dial.circle(0, 0, r * 0.97).stroke({ width: r * 0.035, color: ink, alpha: 0.85 });
        for (let i = 0; i < 60; i++) {
          const major = i % 5 === 0;
          if (look === 'Minimal' && i % 15 !== 0) continue;
          const a = (i / 60) * Math.PI * 2;
          const sx = Math.sin(a);
          const cy = -Math.cos(a);
          if (look === 'Modern') {
            if (!major) continue;
            dial.circle(sx * r * 0.86, cy * r * 0.86, r * (i % 15 === 0 ? 0.04 : 0.024)).fill({ color: ink, alpha: 0.9 });
          } else {
            const inner = r * (major ? 0.78 : 0.86);
            dial.moveTo(sx * inner, cy * inner).lineTo(sx * r * 0.9, cy * r * 0.9)
              .stroke({ width: r * (major ? 0.025 : 0.008), color: ink, alpha: major ? 0.95 : 0.4, cap: 'round' });
          }
        }
        numbers.removeChildren().forEach((c) => c.destroy());
        if (p.numerals !== 'None') {
          for (let n = 1; n <= 12; n++) {
            if (p.numerals !== 'All' && n % 3 !== 0) continue;
            const a = (n / 12) * Math.PI * 2;
            const t = label();
            t.style = style({ font: p.font, color: p.hands, glow: 0 }, RENDER_SIZE);
            place(t, String(n), Math.sin(a) * r * 0.62, -Math.cos(a) * r * 0.62, r * 0.17);
            numbers.addChild(t);
          }
        }
        const modern = look === 'Modern';
        drawHand(hour, r * 0.5, r * 0.08, r * (modern ? 0.07 : 0.055), ink, modern);
        drawHand(minute, r * 0.76, r * 0.1, r * (modern ? 0.05 : 0.04), ink, modern);
        second.clear().roundRect(-r * 0.007, -r * 0.86, r * 0.014, r * 1.04, r * 0.007).fill({ color: accent });
        second.visible = Boolean(p.seconds);
        cap.clear().circle(0, 0, r * 0.045).fill({ color: p.seconds ? accent : ink });
      },
      update() {
        const a = handAngles(new Date(), sweep);
        hour.rotation = a.hour;
        minute.rotation = a.minute;
        second.rotation = a.second;
      },
    };
  },
};

// ------------------------------------------------------------------ flip clock

export const flipClock: ObjectDef = {
  type: 'flip-clock',
  label: 'Flip clock',
  category: 'Widgets',
  icon: '▤',
  defaultSize: [620, 220],
  props: [
    { key: 'format', label: 'Format', type: 'select', options: ['24-hour', '12-hour'], default: '24-hour' },
    { key: 'seconds', label: 'Show seconds', type: 'bool', default: false },
    { key: 'card', label: 'Card colour', type: 'color', default: '#1b1e29' },
    { key: 'cardOpacity', label: 'Card opacity', type: 'range', min: 0.2, max: 1, step: 0.05, default: 1 },
    { key: 'digits', label: 'Digit colour', type: 'color', default: '#f4f5f8' },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Bahnschrift' },
  ],
  create() {
    // Each digit sits on its own card; when it changes, the card folds shut and opens on the new digit.
    const root = new Container();
    interface Card { holder: Container; bg: Graphics; text: Text; value: string; next: string; flip: number }
    let cards: Card[] = [];
    const colons: Graphics[] = [];
    let props: Record<string, unknown> = {};
    let width = 1;
    let height = 1;
    const FLIP = 0.32;

    const layout = (pattern: string) => {
      root.removeChildren().forEach((c) => c.destroy({ children: true }));
      cards = [];
      colons.length = 0;
      const digits = pattern.replace(/[^0-9]/g, '').length;
      const separators = pattern.length - digits;
      const cw = Math.min(width / (digits + separators * 0.45 + (digits - 1) * 0.08), (height * 0.95) / 1.45);
      const ch = cw * 1.45;
      const gap = cw * 0.08;
      let x = -(digits * cw + separators * cw * 0.45 + (pattern.length - 1) * gap) / 2;
      for (const c of pattern) {
        if (/[0-9]/.test(c)) {
          const holder = new Container();
          const bg = new Graphics();
          bg.roundRect(-cw / 2, -ch / 2, cw, ch, cw * 0.12).fill({ color: hex(props.card, 0x1b1e29), alpha: num(props.cardOpacity, 1) });
          // The upper leaf catches a little more light than the lower one.
          bg.roundRect(-cw / 2, -ch / 2, cw, ch / 2, cw * 0.12).fill({ color: 0xffffff, alpha: 0.05 });
          bg.roundRect(-cw / 2, -ch / 2, cw, ch, cw * 0.12).stroke({ width: Math.max(1, cw * 0.012), color: 0xffffff, alpha: 0.08 });
          bg.rect(-cw / 2, -ch * 0.006, cw, ch * 0.012).fill({ color: 0x000000, alpha: 0.55 }); // hinge
          const text = label();
          text.style = style({ font: props.font, color: props.digits, glow: 0, bold: true }, RENDER_SIZE);
          place(text, c, 0, 0, ch * 0.72, cw * 0.8);
          holder.addChild(bg, text);
          holder.position.set(x + cw / 2, 0);
          root.addChild(holder);
          cards.push({ holder, bg, text, value: c, next: c, flip: -1 });
          x += cw + gap;
        } else {
          const dot = new Graphics();
          dot.circle(0, -ch * 0.16, cw * 0.07).circle(0, ch * 0.16, cw * 0.07).fill({ color: hex(props.digits, 0xf4f5f8), alpha: 0.8 });
          dot.position.set(x + cw * 0.225, 0);
          root.addChild(dot);
          colons.push(dot);
          x += cw * 0.45 + gap;
        }
      }
    };

    const timeText = () => formatClock(new Date(), props.format !== '12-hour', Boolean(props.seconds)).replace(/\s?[AP]M$/, '');
    let shownPattern = '';

    return {
      root,
      build(w, h, p) {
        width = w;
        height = h;
        props = p;
        const t = timeText();
        shownPattern = t;
        layout(t);
      },
      update(dt) {
        const t = timeText();
        // A different shape (e.g. "9:59" -> "10:00" in 12-hour time) needs a new layout.
        if (t.length !== shownPattern.length) {
          shownPattern = t;
          layout(t);
          return;
        }
        let i = 0;
        for (const c of t) {
          if (!/[0-9]/.test(c)) continue;
          const card = cards[i++];
          if (!card) continue;
          if (c !== card.next) {
            card.next = c;
            card.flip = 0;
          }
          if (card.flip >= 0) {
            card.flip += dt;
            const k = Math.min(1, card.flip / FLIP);
            if (k >= 0.5 && card.value !== card.next) {
              card.value = card.next;
              card.text.text = card.value;
            }
            card.holder.scale.y = Math.max(0.02, Math.abs(Math.cos(k * Math.PI)));
            if (k >= 1) {
              card.flip = -1;
              card.holder.scale.y = 1;
            }
          }
        }
      },
    };
  },
};

// ------------------------------------------------------------------ word clock

export const wordClock: ObjectDef = {
  type: 'word-clock',
  label: 'Word clock',
  category: 'Widgets',
  icon: '⌗',
  defaultSize: [440, 420],
  props: [
    { key: 'lit', label: 'Lit words', type: 'color', default: '#ffffff' },
    { key: 'dim', label: 'Other letters', type: 'range', min: 0, max: 0.6, step: 0.01, default: 0.14 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Bahnschrift' },
    ...PANEL,
  ],
  create() {
    // The time spelled out in five-minute steps: "IT IS TWENTY FIVE TO SEVEN".
    const root = new Container();
    const panel = new Graphics();
    const grid = new Container();
    root.addChild(panel, grid);
    const letters: Text[][] = [];
    let props: Record<string, unknown> = {};
    let shown = '';

    const relight = (force: boolean) => {
      const now = new Date();
      const words = wordClockWords(now.getHours(), now.getMinutes());
      const key = words.join(' ');
      if (!force && key === shown) return;
      shown = key;
      const lit = new Set<string>();
      for (const w of words) {
        const [row, col, len] = WORDS[w];
        for (let i = 0; i < len; i++) lit.add(`${row},${col + i}`);
      }
      letters.forEach((row, r) => row.forEach((t, c) => {
        const on = lit.has(`${r},${c}`);
        t.tint = on ? hex(props.lit, 0xffffff) : 0xffffff;
        t.alpha = on ? 1 : num(props.dim, 0.14);
      }));
    };

    return {
      root,
      build(w, h, p) {
        props = p;
        drawPanel(panel, w, h, p);
        grid.removeChildren().forEach((c) => c.destroy());
        letters.length = 0;
        const cell = Math.min((w * 0.88) / 11, (h * 0.88) / 10);
        WORD_GRID.forEach((row, r) => {
          const line: Text[] = [];
          [...row].forEach((ch, c) => {
            const t = label();
            // White text tinted per state, so relighting never re-rasterises the letters.
            t.style = style({ font: p.font, color: '#ffffff', glow: p.glow, bold: true }, RENDER_SIZE);
            place(t, ch, (c - 5) * cell, (r - 4.5) * cell, cell * 0.72);
            grid.addChild(t);
            line.push(t);
          });
          letters.push(line);
        });
        relight(true);
      },
      update() {
        relight(false);
      },
    };
  },
};

// ------------------------------------------------------------------ calendar

export const calendar: ObjectDef = {
  type: 'calendar',
  label: 'Calendar',
  category: 'Widgets',
  icon: '▦',
  defaultSize: [420, 380],
  props: [
    { key: 'color', label: 'Text colour', type: 'color', default: '#e8ecf5' },
    { key: 'accent', label: 'Today', type: 'color', default: '#7b61ff' },
    { key: 'mondayFirst', label: 'Weeks start on Monday', type: 'bool', default: true },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI' },
    ...PANEL,
  ],
  create() {
    const root = new Container();
    const panel = new Graphics();
    const marker = new Graphics();
    const texts = new Container();
    root.addChild(panel, marker, texts);
    let props: Record<string, unknown> = {};
    let w = 1;
    let h = 1;
    let shownDay = '';

    const render = () => {
      const now = new Date();
      shownDay = now.toDateString();
      const m = calendarMonth(now, Boolean(props.mondayFirst));
      texts.removeChildren().forEach((c) => c.destroy());
      marker.clear();
      const padX = w * 0.08;
      const rows = m.weeks.length + 2; // title + weekday names + weeks
      const rowH = (h * 0.86) / (rows + 0.4);
      const colW = (w - padX * 2) / 7;
      const top = -h * 0.43;
      const ink = String(props.color);
      const add = (s: string, x: number, y: number, size: number, alpha: number, bold = false, color = ink) => {
        const t = label();
        t.style = style({ font: props.font, color, glow: 0, bold }, RENDER_SIZE);
        place(t, s, x, y, size, colW * (s.length > 2 ? 7 : 0.9));
        t.alpha = alpha;
        texts.addChild(t);
      };
      add(m.title, 0, top + rowH * 0.5, rowH * 0.55, 1, true);
      m.weekdays.forEach((d, i) => add(d.slice(0, 2), -w / 2 + padX + colW * (i + 0.5), top + rowH * 1.5, rowH * 0.36, 0.55));
      m.weeks.forEach((week, r) => week.forEach((day, i) => {
        if (day === 0) return;
        const x = -w / 2 + padX + colW * (i + 0.5);
        const y = top + rowH * (r + 2.6);
        const today = day === m.today;
        if (today) marker.circle(x, y, Math.min(colW, rowH) * 0.44).fill({ color: hex(props.accent, 0x7b61ff) });
        add(String(day), x, y, rowH * 0.42, today ? 1 : 0.85, today, today ? '#ffffff' : ink);
      }));
    };

    let check = 0;
    return {
      root,
      build(width, height, p) {
        w = width;
        h = height;
        props = p;
        drawPanel(panel, w, h, p);
        render();
      },
      update(dt) {
        check += dt;
        if (check < 1) return;
        check = 0;
        if (new Date().toDateString() !== shownDay) render();
      },
    };
  },
};

// ------------------------------------------------------------------ system monitor

export const systemMonitor: ObjectDef = {
  type: 'system-monitor',
  label: 'System monitor',
  category: 'Widgets',
  icon: '◔',
  defaultSize: [520, 220],
  needs: 'system',
  props: [
    { key: 'look', label: 'Style', type: 'select', options: ['Rings', 'Bars'], default: 'Rings' },
    { key: 'cpu', label: 'CPU', type: 'bool', default: true },
    { key: 'memory', label: 'Memory', type: 'bool', default: true },
    { key: 'battery', label: 'Battery', type: 'bool', default: true },
    { key: 'cpuColor', label: 'CPU colour', type: 'color', default: '#5ee7ff' },
    { key: 'memoryColor', label: 'Memory colour', type: 'color', default: '#b388ff' },
    { key: 'batteryColor', label: 'Battery colour', type: 'color', default: '#7dff9a' },
    { key: 'color', label: 'Text colour', type: 'color', default: '#e8ecf5' },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI' },
    ...PANEL,
  ],
  create(ctx) {
    const root = new Container();
    const panel = new Graphics();
    const gauges = new Graphics();
    const texts = new Container();
    root.addChild(panel, gauges, texts);
    interface Gauge { key: 'cpu' | 'memory' | 'battery'; name: string; color: number; value: number; label: Text; caption: Text; x: number; shown: string }
    let list: Gauge[] = [];
    let props: Record<string, unknown> = {};
    let w = 1;
    let h = 1;
    let time = 0;

    const layout = () => {
      texts.removeChildren().forEach((c) => c.destroy());
      const system = ctx.live.system;
      const keys = (['cpu', 'memory', 'battery'] as const).filter((k) => props[k] && !(k === 'battery' && system && !system.hasBattery));
      const names = { cpu: 'CPU', memory: 'Memory', battery: 'Battery' };
      const colors = { cpu: props.cpuColor, memory: props.memoryColor, battery: props.batteryColor };
      const slot = (w * 0.9) / Math.max(1, keys.length);
      list = keys.map((key, i) => {
        const value = label();
        const caption = label();
        value.style = style({ font: props.font, color: props.color, glow: 0, bold: true }, RENDER_SIZE);
        caption.style = style({ font: props.font, color: props.color, glow: 0 }, RENDER_SIZE);
        caption.alpha = 0.65;
        texts.addChild(value, caption);
        return { key, name: names[key], color: hex(colors[key], 0xffffff), value: 0, label: value, caption, x: -w * 0.45 + slot * (i + 0.5), shown: '' };
      });
    };

    const draw = () => {
      gauges.clear();
      const slot = (w * 0.9) / Math.max(1, list.length);
      const rings = props.look !== 'Bars';
      for (const g of list) {
        const k = Math.max(0, Math.min(1, g.value / 100));
        if (rings) {
          const r = Math.min(slot * 0.38, h * 0.3);
          const cy = -h * 0.08;
          const lw = r * 0.16;
          gauges.circle(g.x, cy, r).stroke({ width: lw, color: g.color, alpha: 0.15 });
          // Start each arc at its own first point; otherwise Pixi joins it to the previous shape.
          if (k > 0.001) gauges.moveTo(g.x, cy - r).arc(g.x, cy, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2).stroke({ width: lw, color: g.color, cap: 'round' });
          const text = `${Math.round(g.value)}%`;
          if (text !== g.shown) {
            place(g.label, text, g.x, cy, r * 0.5, r * 1.3);
            g.shown = text;
          }
          place(g.caption, g.name, g.x, cy + r + h * 0.13, h * 0.1, slot * 0.9);
        } else {
          const bw = slot * 0.78;
          const bh = h * 0.1;
          const y = 0;
          gauges.roundRect(g.x - bw / 2, y, bw, bh, bh / 2).fill({ color: g.color, alpha: 0.15 });
          if (k > 0.001) gauges.roundRect(g.x - bw / 2, y, Math.max(bh, bw * k), bh, bh / 2).fill({ color: g.color });
          const text = `${Math.round(g.value)}%`;
          if (text !== g.shown) {
            place(g.label, text, g.x, -h * 0.18, h * 0.22, bw);
            g.shown = text;
          }
          place(g.caption, g.name, g.x, y + bh + h * 0.12, h * 0.1, bw);
        }
      }
    };

    let hadData = false;
    return {
      root,
      build(width, height, p) {
        w = width;
        h = height;
        props = p;
        drawPanel(panel, w, h, p);
        layout();
        draw();
      },
      update(dt) {
        time += dt;
        const system = ctx.live.system;
        // Real data appears once the desktop host sends it; until then (editor, previews) show samples.
        if (Boolean(system) !== hadData) {
          hadData = Boolean(system);
          layout();
        }
        const sample = sampleSystemValues(time);
        let moved = false;
        for (const g of list) {
          const target = system ? system[g.key] ?? 0 : sample[g.key];
          const next = easeToward(g.value, target, dt);
          // Redrawing (and re-measuring labels) only when a gauge visibly moves keeps an idle widget cheap.
          if (Math.abs(next - g.value) > 0.02) moved = true;
          g.value = next;
          const name = g.key === 'battery' && system?.charging ? 'Charging' : g.key === 'battery' ? 'Battery' : g.name;
          if (name !== g.name) {
            g.name = name;
            moved = true;
          }
        }
        if (moved) draw();
      },
    };
  },
};

// ------------------------------------------------------------------ countdown

export const countdownWidget: ObjectDef = {
  type: 'countdown',
  label: 'Countdown',
  category: 'Widgets',
  icon: '⧗',
  defaultSize: [560, 200],
  props: [
    { key: 'title', label: 'Title', type: 'text', default: 'New Year', maxLength: 60 },
    { key: 'target', label: 'Date (YYYY-MM-DD HH:MM)', type: 'text', default: '2027-01-01 00:00', maxLength: 16 },
    { key: 'doneText', label: 'When it arrives', type: 'text', default: 'Happy New Year!', maxLength: 60 },
    { key: 'seconds', label: 'Show seconds', type: 'bool', default: true },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI Light' },
    { key: 'color', label: 'Colour', type: 'color', default: '#e8f1ff' },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.5 },
    ...PANEL,
  ],
  create() {
    const root = new Container();
    const panel = new Graphics();
    const title = label();
    const value = label();
    root.addChild(panel, title, value);
    let props: Record<string, unknown> = {};
    let w = 1;
    let h = 1;
    let shown = '';

    const refresh = (force: boolean) => {
      const target = parseTarget(String(props.target ?? ''));
      const text = !target ? 'Set a date as YYYY-MM-DD'
        : (() => { const c = countdown(target, new Date()); return c.done ? String(props.doneText ?? '') : formatCountdown(c, Boolean(props.seconds)); })();
      if (!force && text === shown) return;
      shown = text;
      place(value, text || ' ', 0, h * 0.12, h * 0.36, w * 0.9);
    };

    return {
      root,
      build(width, height, p) {
        w = width;
        h = height;
        props = p;
        drawPanel(panel, w, h, p);
        title.style = style({ font: p.font, color: p.color, glow: 0 }, RENDER_SIZE);
        title.alpha = 0.75;
        value.style = style({ font: p.font, color: p.color, glow: p.glow }, RENDER_SIZE);
        place(title, String(p.title ?? '') || ' ', 0, -h * 0.26, h * 0.17, w * 0.9);
        refresh(true);
      },
      update() {
        refresh(false);
      },
    };
  },
};
