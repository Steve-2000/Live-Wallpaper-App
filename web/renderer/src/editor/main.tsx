import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createHost } from './host';
import './editor.css';

const root = createRoot(document.getElementById('root')!);
const host = createHost();
// Optional deep link: ?select=<object id>&t=<seconds> opens with that object selected at that time.
const query = new URLSearchParams(location.search);
const initialTime = query.has('t') ? Math.max(0, Number(query.get('t')) || 0) : undefined;

root.render(<div className="boot">Loading scene…</div>);
host
  .load()
  .then((scene) => {
    const select = query.get('select');
    const selection = select && scene.objects.some((o) => o.id === select) ? [select] : [];
    root.render(<App initial={scene} host={host} initialSelection={selection} initialTime={initialTime} />);
  })
  .catch((err: Error) => root.render(<div className="boot error">Could not open this scene: {err.message}</div>));
