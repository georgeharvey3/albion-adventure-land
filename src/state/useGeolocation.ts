import { useEffect } from 'react';
import { useStore } from './store';

// Live location via watchPosition (spec §8). Handles permission-denied and
// low-accuracy gracefully — on failure the user can drop a manual "I am here"
// pin (handled in the map / store), so the near-me loop still works.

export function useGeolocation(): void {
  const setLivePosition = useStore((s) => s.setLivePosition);
  const setGeoError = useStore((s) => s.setGeoError);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation not supported on this device.');
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
            ? 'Location permission denied — drop a pin to set "I am here".'
            : 'Location unavailable — drop a pin to set "I am here".';
        setGeoError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [setLivePosition, setGeoError]);
}
