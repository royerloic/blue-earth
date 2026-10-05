import type { FaultSegment } from '../okada'

/**
 * Historical tsunami sources as SIMPLIFIED planar-segment models: trench-following segments
 * with uniform slip, of the right order for length, width, slip, depth and geometry for each
 * event. They reproduce the large-scale tsunami (directivity, arrival times) but are not the
 * published finite-fault inversions. See docs/PRESETS.md.
 */
export interface TsunamiPreset {
  id: string
  name: string
  /** Origin time (UTC), also used for the sun. */
  date: string
  magnitude: string
  note: string
  view: { lat: number; lon: number; alt: number }
  segments?: FaultSegment[]
  /** Toy sources: a Gaussian η change instead of a fault. */
  impulse?: { lat: number; lon: number; amplitude: number; radiusCells: number }
}

const km = 1000
const seg = (lat: number, lon: number, strike: number, dip: number, lengthKm: number, widthKm: number, slip: number, topKm = 5, rake = 90): FaultSegment => ({
  lat,
  lon,
  strike,
  dip,
  rake,
  length: lengthKm * km,
  width: widthKm * km,
  slip,
  top: topKm * km,
})

export const PRESETS: TsunamiPreset[] = [
  {
    id: 'sumatra2004',
    name: '2004 Sumatra–Andaman',
    date: '2004-12-26T00:58:53Z',
    magnitude: 'Mw 9.1',
    note: '~1300 km rupture along the Sunda and Andaman trenches; waves reached Sri Lanka in ~2 h and Somalia in ~7 h.',
    view: { lat: 6, lon: 88, alt: 9000 },
    segments: [
      seg(3.3, 94.2, 325, 12, 250, 150, 15),
      seg(5.6, 93.0, 335, 12, 250, 150, 15),
      seg(7.9, 92.4, 345, 12, 250, 130, 12),
      seg(10.4, 92.0, 355, 12, 270, 120, 8),
      seg(12.9, 92.3, 10, 12, 250, 100, 5),
    ],
  },
  {
    id: 'tohoku2011',
    name: '2011 Tōhoku',
    date: '2011-03-11T05:46:24Z',
    magnitude: 'Mw 9.0',
    note: 'Very large slip near the Japan trench; the tsunami crossed the Pacific to Hawaii (~7–8 h) and Chile (~21–22 h).',
    view: { lat: 30, lon: 175, alt: 16000 },
    segments: [seg(38.3, 143.8, 200, 10, 200, 80, 35, 1), seg(38.54, 142.95, 200, 15, 400, 120, 8, 14.9)],
  },
  {
    id: 'valdivia1960',
    name: '1960 Valdivia, Chile',
    date: '1960-05-22T19:11:14Z',
    magnitude: 'Mw 9.5',
    note: 'The largest earthquake ever recorded; the tsunami struck Hilo (~15 h) and Japan (~22 h).',
    view: { lat: -20, lon: -110, alt: 18000 },
    segments: [seg(-39.5, -74.3, 7, 20, 500, 180, 25), seg(-43.9, -75.0, 7, 20, 450, 180, 20)],
  },
  {
    id: 'alaska1964',
    name: '1964 Great Alaska',
    date: '1964-03-28T03:36:16Z',
    magnitude: 'Mw 9.2',
    note: 'Megathrust beneath Prince William Sound and Kodiak; tsunami damage as far as California.',
    view: { lat: 45, lon: -150, alt: 12000 },
    segments: [seg(59.0, -145.5, 240, 9, 300, 200, 18), seg(56.8, -151.5, 225, 9, 350, 150, 10)],
  },
  {
    id: 'maule2010',
    name: '2010 Maule, Chile',
    date: '2010-02-27T06:34:11Z',
    magnitude: 'Mw 8.8',
    note: 'Central Chile megathrust; the Pacific-wide tsunami was well recorded by DART buoys.',
    view: { lat: -30, lon: -95, alt: 12000 },
    segments: [seg(-35.9, -73.9, 18, 18, 500, 150, 10)],
  },
  {
    id: 'cascadia',
    name: 'Cascadia M9 (scenario)',
    date: '1700-01-27T05:00:00Z',
    magnitude: 'Mw ~9 (scenario)',
    note: 'A full-margin rupture like the one of January 1700, whose "orphan tsunami" reached Japan.',
    view: { lat: 42, lon: -140, alt: 12000 },
    segments: [seg(42.5, -124.9, 355, 10, 500, 90, 18), seg(46.8, -125.3, 355, 10, 500, 90, 18)],
  },
  {
    id: 'asteroid',
    name: 'Asteroid impact (toy)',
    date: '2026-07-09T23:00:00Z',
    magnitude: 'toy',
    note: 'A deep cavity in the mid-Pacific. Illustrative only, not an impact model.',
    view: { lat: 5, lon: -160, alt: 14000 },
    impulse: { lat: 5, lon: -160, amplitude: -300, radiusCells: 4 },
  },
]
