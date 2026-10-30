import { describe, it, expect } from 'vitest';
import { getCity } from '../src/sim/city';

describe('city', () => {
  const city = getCity();
  it('has twelve districts and a connected road network', () => {
    expect(city.districts.length).toBe(12);
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      for (const eid of city.adj[n]) { const e = city.edges[eid]; const o = e.a === n ? e.b : e.a; if (!seen.has(o)) { seen.add(o); stack.push(o); } }
    }
    expect(seen.size).toBe(city.nodes.length);
  });
  it('every district has nodes and station sites', () => {
    for (const d of city.districts) {
      expect(city.nodesInDistrict[d.id].length).toBeGreaterThan(20);
      expect(city.sites[`fire:${d.id}`]).toBeDefined();
    }
  });
});
