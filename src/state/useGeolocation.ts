import { useEffect } from 'react';
import { useStore } from './store';
import { copy } from '../copy';

// Live location via watchPosition (spec §8). Handles permission-denied and
// low-accuracy gracefully — on failure the user can drop a manual "I am here"
// pin (handled in the map / store), so the near-me loop still works.

export function useGeolocation(): void {
  const setLivePosition = useStore((s) => s.setLivePosition);
  const setGeoError = useStore((s) => s.setGeoError);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError(copy.location.unsupported);
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLivePosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          manual: false,
        });
      },
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? copy.location.denied
            : copy.location.unavailable;
        setGeoError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [setLivePosition, setGeoError]);
}
