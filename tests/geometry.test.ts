import { describe, expect, it } from 'vitest';
import { convexHull, createDie, getPolyhedron, outcomesForShape, restingFaceIndex, type ShapeId } from '../src/model';

function faceNormals(shape: ShapeId): [number, number, number][] {
  const { vertices, faces } = getPolyhedron(shape);
  return faces.map(face => {
    const [a, b, c] = face.slice(0, 3).map(index => vertices[index]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const magnitude = Math.hypot(...normal);
    const unit = normal.map(value => value / magnitude);
    const direction = unit[0] * a[0] + unit[1] * a[1] + unit[2] * a[2];
    return (direction < 0 ? unit.map(value => -value) : unit) as [number, number, number];
  });
}

function rotateTo(from: number[], to: number[]): { x: number; y: number; z: number; w: number } {
  const axis = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (dot < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  const scale = Math.sqrt((1 + dot) * 2);
  const quaternion = { x: axis[0] / scale, y: axis[1] / scale, z: axis[2] / scale, w: scale / 2 };
  const norm = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  return { x: quaternion.x / norm, y: quaternion.y / norm, z: quaternion.z / norm, w: quaternion.w / norm };
}

describe('physical outcome coverage', () => {
  it('returns no hull faces when fewer than three unique vertices are supplied', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[1, 0, 0]])).toEqual([]);
    expect(convexHull([[1, 0, 0], [0, 1, 0]])).toEqual([]);
  });

  it('returns no hull faces for distinct collinear vertices', () => {
    expect(convexHull([
      [-2, 0, 0],
      [-1, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ])).toEqual([]);
  });

  it('gives every advertised outcome at least one actual face', () => {
    const shapes: ShapeId[] = ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd10', 'd12', 'd14', 'd16', 'd20', 'd24', 'd30'];
    for (const shape of shapes) {
      const outcomes = outcomesForShape(createDie(shape));
      const reachable = new Set(getPolyhedron(shape).faces.map((_, faceIndex) => faceIndex % outcomes));
      expect([...reachable].sort((a, b) => a - b), shape).toEqual(Array.from({ length: outcomes }, (_, index) => index));
    }
    expect(getPolyhedron('d24').faces).toHaveLength(24);
    expect(getPolyhedron('d30').faces).toHaveLength(30);
  });

  it('maps every percentile pair to its own d100 outcome', () => {
    const reachable = new Set(Array.from({ length: 10 }, (_, tens) =>
      Array.from({ length: 10 }, (_, units) => tens * 10 + units)).flat());
    expect(reachable.size).toBe(100);
    expect([...reachable].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(createDie('d100').faces[0]).toEqual({ label: '00', score: 100 });
  });

  it('returns the same closed convex ten-kite-face pentagonal trapezohedron for d10 and d100', () => {
    const d10 = getPolyhedron('d10');
    const d100 = getPolyhedron('d100');

    expect(d10).toEqual(d100);
    expect(d10.representation).toBe('a convex ten-face pentagonal trapezohedron');
    expect(d10.vertices).toHaveLength(12);
    expect(d10.faces).toHaveLength(10);

    const vertexUse = Array<number>(d10.vertices.length).fill(0);
    for (const face of d10.faces) {
      expect(face).toHaveLength(4);
      expect(new Set(face).size).toBe(4);
      for (const index of face) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(d10.vertices.length);
        vertexUse[index]++;
      }

      const [a, b, c] = face.slice(0, 3).map(index => d10.vertices[index]);
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const normalLength = Math.hypot(...normal);
      expect(normalLength).toBeGreaterThan(0);
      const unitNormal = normal.map(value => value / normalLength);
      const signedDistance = unitNormal[0] * a[0] + unitNormal[1] * a[1] + unitNormal[2] * a[2];
      expect(signedDistance).toBeGreaterThan(0);
      for (const index of face) {
        const vertex = d10.vertices[index];
        expect(unitNormal[0] * vertex[0] + unitNormal[1] * vertex[1] + unitNormal[2] * vertex[2])
          .toBeCloseTo(signedDistance, 8);
      }
      for (const vertex of d10.vertices) {
        expect(unitNormal[0] * vertex[0] + unitNormal[1] * vertex[1] + unitNormal[2] * vertex[2])
          .toBeLessThanOrEqual(signedDistance + 1e-8);
      }
    }

    expect(vertexUse.filter(count => count === 3)).toHaveLength(10);
    expect(vertexUse.filter(count => count === 5)).toHaveLength(2);
  });

  it('reads a tetrahedral d4 from its unique resting bottom face', () => {
    const normals = faceNormals('d4');
    normals.forEach((normal, faceIndex) => {
      const orientation = rotateTo(normal, [0, -1, 0]);
      expect(restingFaceIndex(normals, orientation, true)).toBe(faceIndex);
    });
  });

  it('rejects ambiguous resting edges instead of selecting the first matching face', () => {
    const tiedNormals: [number, number, number][] = [[0, 1, 0], [0, 1, 0]];
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    expect(restingFaceIndex(tiedNormals, identity)).toBeNull();
    expect(restingFaceIndex(tiedNormals, identity, true)).toBeNull();
  });

  it('rejects incomplete face-normal sets and non-finite orientations', () => {
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    const normals: [number, number, number][] = [[0, 1, 0], [0, -1, 0]];

    expect(restingFaceIndex([], identity)).toBeNull();
    expect(restingFaceIndex([normals[0]], identity)).toBeNull();
    expect(restingFaceIndex(normals, { ...identity, z: Number.NaN })).toBeNull();
  });
});
