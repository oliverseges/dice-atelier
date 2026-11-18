import { describe, expect, it } from 'vitest';
import {
  addToHand, computeBreakdown, createDie, defaultFaces, getPolyhedron, handCapacity, MAX_LOGICAL_DICE, outcomesForShape,
  validateDie, type DieConfig, type FaceResult, type HandGroup,
} from '../src/model';
import { loadCollection, saveCollection } from '../src/storage';

function makeStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    clear: () => values.clear(),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
}

describe('physical face models', () => {
  it('creates outward-facing convex geometry for every curated representation', () => {
    for (const shape of ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20', 'd24', 'd30', 'd100'] as const) {
      const polyhedron = getPolyhedron(shape);
      expect(polyhedron.faces.length).toBeGreaterThan(3);
      for (const face of polyhedron.faces) {
        const [a, b, c] = face.slice(0, 3).map(index => polyhedron.vertices[index]);
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const centroid = face.reduce((sum, index) => {
          const point = polyhedron.vertices[index];
          return [sum[0] + point[0] / face.length, sum[1] + point[1] / face.length, sum[2] + point[2] / face.length];
        }, [0, 0, 0]);
        expect(normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2]).toBeGreaterThan(0);
      }
    }
  });

  it('keeps custom labels separate from numeric scores', () => {
    const die = createDie('d4', { faces: [{ label: 'ᚠ', score: -3 }, { label: 'II', score: 9 }, { label: '✦', score: 0 }, { label: 'A', score: 25 }] });
    expect(validateDie(die)).toBe(true);
    expect(die.faces.map(face => [face.label, face.score])).toEqual([['ᚠ', -3], ['II', 9], ['✦', 0], ['A', 25]]);
    expect(defaultFaces('d4', 'roman').map(face => face.label)).toEqual(['I', 'II', 'III', 'IV']);
  });

  it('applies group offsets once, before the optional hand modifier', () => {
    const groups: HandGroup[] = [
      { die: createDie('d6', { id: 'a', name: 'A' }), quantity: 2, multiplier: 2, offset: 2 },
      { die: createDie('d4', { id: 'b', name: 'B' }), quantity: 1, multiplier: 1, offset: -1 },
    ];
    const results: FaceResult[][] = [
      [{ dieName: 'A', label: '2', score: 2 }, { dieName: 'A', label: '3', score: 3 }],
      [{ dieName: 'B', label: '4', score: 4 }],
    ];
    expect(computeBreakdown(groups, 4, 2, results)).toMatchObject({
      groups: [{ subtotal: 5, adjusted: 12 }, { subtotal: 4, adjusted: 3 }],
      groupSum: 15, total: 62,
    });
  });

  it('maps d100 00 plus 0 to 100 and retains 100 custom outcomes', () => {
    const die = createDie('d100');
    expect(die.faces[0]).toEqual({ label: '00', score: 100 });
    expect(die.faces).toHaveLength(100);
    die.faces[0] = { label: 'CENTURY', score: 777 };
    expect(validateDie(die)).toBe(true);
    expect(outcomesForShape(die)).toBe(100);
    expect(die.faces[0]).toEqual({ label: 'CENTURY', score: 777 });
  });

  it('enforces logical and physical hand caps, including two-body d100s', () => {
    const regular = createDie('d6');
    let groups: HandGroup[] = [];
    for (let i = 0; i < MAX_LOGICAL_DICE; i++) groups = addToHand(groups, { ...regular, id: `d${i}` });
    expect(handCapacity(groups).canAdd).toBe(false);
    expect(() => addToHand(groups, regular)).toThrow(/limited/);
    groups = [];
    for (let i = 0; i < 15; i++) groups = addToHand(groups, { ...createDie('d100'), id: `p${i}` });
    expect(handCapacity(groups)).toMatchObject({ logical: 15, physical: 30, canAdd: false });
  });
});

describe('local collection persistence', () => {
  it('round-trips validated versioned collections', () => {
    const storage = makeStorage();
    const items: DieConfig[] = [createDie('d8')];
    saveCollection(storage, items);
    expect(loadCollection(storage)).toEqual({ status: 'ok', items });
  });

  it('does not overwrite malformed collection data', () => {
    const storage = makeStorage({ 'dice-atelier.collection.v1': '{"version":8,"items":[]}' });
    expect(loadCollection(storage).status).toBe('invalid');
    expect(storage.getItem('dice-atelier.collection.v1')).toBe('{"version":8,"items":[]}');
  });

  it('surfaces storage quota failures', () => {
    const storage = makeStorage();
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    expect(() => saveCollection(storage, [])).toThrow(/out of local storage space/);
  });
});
