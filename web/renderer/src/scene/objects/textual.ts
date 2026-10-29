import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { formatClock, formatDate } from '../../presets/particle-clock/time';
import { hex, num, type ObjectDef } from './types';

export const FONTS = ['Segoe UI', 'Segoe UI Light', 'Consolas', 'Georgia', 'Impact', 'Bahnschrift', 'Trebuchet MS', 'Courier New'];

export function style(p: Record<string, unknown>, size: number): TextStyle {
  const color = hex(p.color, 0xffffff);
  const glow = num(p.glow, 0.5);
  return new TextStyle({
    fontFamily: String(p.font ?? 'Segoe UI'),
    fontSize: size,
    fontWeight: p.bold ? '700' : '400',
    fill: color,
    align: 'center',
    letterSpacing: num(p.spacing, 0),
    dropShadow: glow > 0 ? { color, blur: size * 0.25 * glow, distance: 0, alpha: Math.min(1, glow), angle: 0 } : false,
  });
}

/** Scales a text block uniformly so it fits (and fills) the object's box. */
export function fit(t: Container, w: number, h: number) {
  t.scale.set(1);
  const b = t.getLocalBounds();
  const s = Math.min(w / Math.max(1, b.width), h / Math.max(1, b.height));
  t.scale.set(s);
  t.position.set(-(b.x + b.width / 2) * s, -(b.y + b.height / 2) * s);
}

export const RENDER_SIZE = 96; // text is rasterised at this size, then scaled to the box

export const text: ObjectDef = {
  type: 'text',
  label: 'Text',
  category: 'Text & Clocks',
  icon: 'T',
  defaultSize: [600, 120],
  props: [
    { key: 'text', label: 'Text', type: 'text', default: 'DreamCanvas', maxLength: 200 },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI' },
    { key: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
    { key: 'bold', label: 'Bold', type: 'bool', default: true },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.4 },
    { key: 'spacing', label: 'Letter spacing', type: 'range', min: -5, max: 40, step: 1, default: 2 },
  ],
  create() {
    const root = new Container();
    const label = new Text({ text: '', style: { fontSize: RENDER_SIZE } });
    label.resolution = 2;
    root.addChild(label);
    return {
      root,
      build(w, h, p) {
        label.style = style(p, RENDER_SIZE);
        label.text = String(p.text ?? '') || ' ';
        fit(label, w, h);
      },
      update() {},
    };
  },
};

export const clock: ObjectDef = {
  type: 'clock',
  label: 'Digital clock',
  category: 'Text & Clocks',
  icon: '◷',
  defaultSize: [520, 200],
  props: [
    { key: 'format', label: 'Format', type: 'select', options: ['24-hour', '12-hour'], default: '24-hour' },
    { key: 'seconds', label: 'Show seconds', type: 'bool', default: false },
    { key: 'date', label: 'Show date', type: 'bool', default: true },
    { key: 'font', label: 'Font', type: 'select', options: FONTS, default: 'Segoe UI Light' },
    { key: 'color', label: 'Colour', type: 'color', default: '#e8f1ff' },
    { key: 'bold', label: 'Bold', type: 'bool', default: false },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6 },
    { key: 'spacing', label: 'Letter spacing', type: 'range', min: -5, max: 40, step: 1, default: 4 },
  ],
  create() {
    // Shows accurate local time; the text is only rebuilt when the displayed value changes.
    const root = new Container();
    const block = new Container();
    const time = new Text({ text: '', style: { fontSize: RENDER_SIZE } });
    const date = new Text({ text: '', style: { fontSize: RENDER_SIZE * 0.32 } });
    time.resolution = date.resolution = 2;
    block.addChild(time, date);
    root.addChild(block);
    let props: Record<string, unknown> = {};
    let w = 100;
    let h = 100;
    let shown = '';
    const refresh = (force: boolean) => {
      const now = new Date();
      const t = formatClock(now, props.format !== '12-hour', Boolean(props.seconds));
      const d = props.date ? formatDate(now) : '';
      const key = t + '|' + d;
      if (!force && key === shown) return;
      shown = key;
      time.text = t;
      date.text = d;
      date.visible = d !== '';
      time.anchor.set(0.5, 0);
      date.anchor.set(0.5, 0);
      date.y = time.height * 1.02;
      fit(block, w, h);
    };
    return {
      root,
      build(width, height, p) {
        w = width;
        h = height;
        props = p;
        time.style = style(p, RENDER_SIZE);
        date.style = style({ ...p, bold: false }, RENDER_SIZE * 0.32);
        refresh(true);
      },
      update() {
        refresh(false);
      },
    };
  },
};

export const shape: ObjectDef = {
  type: 'shape',
  label: 'Shape',
  category: 'Shapes',
  icon: '◆',
  defaultSize: [200, 200],
  props: [
    { key: 'kind', label: 'Shape', type: 'select', options: ['rectangle', 'ellipse', 'triangle', 'star', 'ring'], default: 'ellipse' },
    { key: 'fill', label: 'Fill colour', type: 'color', default: '#7b61ff' },
    { key: 'fillOpacity', label: 'Fill opacity', type: 'range', min: 0, max: 1, step: 0.05, default: 1 },
    { key: 'stroke', label: 'Outline colour', type: 'color', default: '#ffffff' },
    { key: 'strokeWidth', label: 'Outline width', type: 'range', min: 0, max: 40, step: 1, default: 0 },
    { key: 'corner', label: 'Corner radius', type: 'range', min: 0, max: 200, step: 1, default: 16 },
    { key: 'spin', label: 'Spin', type: 'range', min: -2, max: 2, step: 0.05, default: 0 },
  ],
  create() {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    let spin = 0;
    return {
      root,
      build(w, h, p) {
        spin = num(p.spin, 0);
        g.clear();
        const fill = { color: hex(p.fill, 0x7b61ff), alpha: num(p.fillOpacity, 1) };
        const sw = num(p.strokeWidth, 0);
        switch (String(p.kind)) {
          case 'rectangle': g.roundRect(-w / 2, -h / 2, w, h, Math.min(num(p.corner, 16), w / 2, h / 2)); break;
          case 'triangle': g.poly([0, -h / 2, w / 2, h / 2, -w / 2, h / 2]); break;
          case 'star': g.star(0, 0, 5, Math.min(w, h) / 2, Math.min(w, h) / 4.6, 0); break;
          case 'ring':
            g.ellipse(0, 0, w / 2, h / 2).fill(fill);
            g.ellipse(0, 0, w * 0.32, h * 0.32).cut();
            if (sw > 0) g.ellipse(0, 0, w / 2, h / 2).stroke({ width: sw, color: hex(p.stroke) });
            return;
          default: g.ellipse(0, 0, w / 2, h / 2);
        }
        g.fill(fill);
        if (sw > 0) g.stroke({ width: sw, color: hex(p.stroke), alignment: 1 });
      },
      update(_dt, t) {
        g.rotation = spin * t;
      },
    };
  },
};
