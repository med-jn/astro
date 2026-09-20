import * as Astronomy from 'astronomy-engine';
import type { ObserverLocation } from '../types/astro';

export const DEFAULT_OBSERVER: ObserverLocation = {
  // تونس العاصمة كموقع افتراضي
  latitudeDeg: 36.8065,
  longitudeDeg: 10.1815,
  elevationM: 20,
};

export function toAstronomyObserver(location: ObserverLocation): Astronomy.Observer {
  return new Astronomy.Observer(location.latitudeDeg, location.longitudeDeg, location.elevationM);
}
