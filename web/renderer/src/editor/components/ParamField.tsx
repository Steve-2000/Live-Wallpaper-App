import type { ParamSpec, ParamValue } from '../../runtime/types';

interface Props {
  spec: ParamSpec;
  value: ParamValue | undefined;
  onChange(value: ParamValue): void;
}

/** One editable setting, rendered according to its type. */
export function ParamField({ spec, value, onChange }: Props) {
  const id = `p-${spec.key}`;
  switch (spec.type) {
    case 'range': {
      const v = typeof value === 'number' ? value : spec.default;
      const decimals = spec.step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(spec.step)));
      return (
        <label className="field" htmlFor={id}>
          <span className="field-row">
            <span>{spec.label}</span>
            <span className="field-value">{v.toFixed(decimals)}</span>
          </span>
          <input id={id} type="range" min={spec.min} max={spec.max} step={spec.step} value={v}
            onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    }
    case 'color': {
      const v = typeof value === 'string' ? value : spec.default;
      return (
        <label className="field field-inline" htmlFor={id}>
          <span>{spec.label}</span>
          <span className="color-input">
            <input id={id} type="color" value={v} onChange={(e) => onChange(e.target.value)} />
            <code>{v.toUpperCase()}</code>
          </span>
        </label>
      );
    }
    case 'bool':
      return (
        <label className="field field-inline toggle" htmlFor={id}>
          <span>{spec.label}</span>
          <input id={id} type="checkbox" checked={typeof value === 'boolean' ? value : spec.default}
            onChange={(e) => onChange(e.target.checked)} />
        </label>
      );
    case 'select':
      return (
        <label className="field" htmlFor={id}>
          <span>{spec.label}</span>
          <select id={id} value={typeof value === 'string' ? value : spec.default} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case 'text':
      return (
        <label className="field" htmlFor={id}>
          <span>{spec.label}</span>
          <input id={id} type="text" maxLength={spec.maxLength ?? 200} value={typeof value === 'string' ? value : spec.default}
            onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
}
