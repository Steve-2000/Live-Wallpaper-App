import { useState } from 'react';
import { CATEGORIES, OBJECT_DEFS } from '../../scene/objects/registry';

export const DRAG_TYPE = 'application/x-dreamcanvas-object';

interface Props {
  onAdd(type: string): void;
}

/** Left panel: every object type, grouped by category. Click to add at the centre, or drag onto the canvas. */
export function Library({ onAdd }: Props) {
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  return (
    <aside className="panel library" aria-label="Object library">
      <div className="panel-title">Library</div>
      <input className="search" type="search" placeholder="Search objects" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="library-scroll">
        {CATEGORIES.map((category) => {
          const defs = OBJECT_DEFS.filter((d) => d.category === category && (!term || d.label.toLowerCase().includes(term) || d.type.includes(term)));
          if (defs.length === 0) return null;
          return (
            <section key={category}>
              <h3>{category}</h3>
              <div className="library-grid">
                {defs.map((d) => (
                  <button
                    key={d.type}
                    className="library-item"
                    title={`Add ${d.label} (or drag onto the canvas)`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, d.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAdd(d.type)}
                  >
                    <span className="library-icon" aria-hidden>{d.icon}</span>
                    <span>{d.label}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
