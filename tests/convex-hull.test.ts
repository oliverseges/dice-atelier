import { describe, expect, it } from 'vitest';
import { convexHull } from '../src/model';

describe('convex hull geometry', () => {
  it('ignores collinear triples and duplicate vertices while retaining the hull', () => {
    const faces = convexHull([
      [0, 0, 0],
      [2, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 1],
    ]);

    expect(faces).toHaveLength(4);
    expect(faces.every(face => face.length >= 3 && face.every(point => point.every(Number.isFinite)))).toBe(true);
  });
});
