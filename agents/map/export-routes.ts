// Exports the party's walked routes (state/routes.json) as world-coordinate polylines for the
// website's share card: each route's ends come from the atlas and the line between them is
// the game's own walking path, so it follows roads and bridges.
//
//   bun agents/map/export-routes.ts [out.json]
//
import { writeFileSync } from 'fs';
import { findLongPath, initPathfinding } from '../../rs-sdk/sdk/pathfinding';
import { findPlace } from '../skills';
import { load } from '../store';

type Route = { from: string; to: string; trips: number };
const routes = Object.values(load<Record<string, Route>>('routes', {}));
initPathfinding();
const out: { from: string; to: string; trips: number; path: [number, number][] }[] = [];
const missing: string[] = [];
for (const r of routes) {
    const [a, b] = [findPlace(r.from), findPlace(r.to)];
    if (!a || !b) {
        missing.push(`${r.from} -> ${r.to}`);
        continue;
    }
    const path = findLongPath(0, a.x, a.z, b.x, b.z, 4000);
    if (!path.length) continue;
    out.push({ from: r.from, to: r.to, trips: r.trips, path: [[a.x, a.z], ...path.map(w => [w.x, w.z] as [number, number])] });
}
const file = process.argv[2] ?? 'routes-export.json';
writeFileSync(file, JSON.stringify(out));
console.log(`${out.length} routes (${out.reduce((n, r) => n + r.trips, 0)} trips) -> ${file}; no place for ${missing.length}: ${missing.slice(0, 5).join('; ')}`);
