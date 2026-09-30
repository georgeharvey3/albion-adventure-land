import { useEffect, useState } from 'react';

// Width alone picks the shell (issue #87, Q5 and Q9). From 1024 px the app
// shows the desktop shell; below it, the phone's sheet, and a portrait tablet
// gets the sheet too. A touch screen at 1024 px gets the desktop shell.
const DESKTOP = '(min-width:1024px)';

export function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(DESKTOP).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP);
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}
