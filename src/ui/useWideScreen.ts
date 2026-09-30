import { useEffect, useState } from 'react';

// Width alone picks the shell (issue #87, Q5 and Q9). From 1024 px the app
// shows the desktop shell; below it, the phone's sheet, and a portrait tablet
// gets the sheet too. A touch screen at 1024 px gets the desktop shell.
const DESKTOP = '(min-width:1024px)';

// From 760 px the sheet is a side panel on the right of the map, not a sheet
// at the bottom. It takes no drag (issue #110).
const SIDE_PANEL = '(min-width:760px)';

function useMediaQuery(media: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(media).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(media);
    if (!query) return;
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [media]);
  return matches;
}

export function useWideScreen(): boolean {
  return useMediaQuery(DESKTOP);
}

export function useSidePanel(): boolean {
  return useMediaQuery(SIDE_PANEL);
}
