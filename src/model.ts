export const MAX_LOGICAL_DICE = 30;
export const MAX_PHYSICAL_BODIES = 30;
export const STORAGE_KEY = 'dice-atelier.collection.v1';

export type ShapeId = 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8' | 'd10' | 'd12' | 'd14' | 'd16' | 'd20' | 'd24' | 'd30' | 'd100';
export type MaterialId = 'porcelain' | 'satin' | 'crystal' | 'enamel';
export type TreatmentId = 'gilded' | 'engraved' | 'embossed';
export type LabelStyle = 'arabic' | 'roman' | 'custom';

export interface FaceDefinition {
  label: string;
  score: number;
}

export interface DieConfig {
  id: string;
  name: string;
  shape: ShapeId;
  color: string;
  size: number;
  material: MaterialId;
  transparency: number;
  iridescence: number;
  treatment: TreatmentId;
  labelStyle: LabelStyle;
  faces: FaceDefinition[];
}

export interface HandGroup {
  die: DieConfig;
  quantity: number;
  multiplier: number;
  offset: number;
}

export interface HandSnapshot {
  groups: HandGroup[];
  multiplier: number;
  offset: number;
}

export interface ModifierBreakdown {
  groups: Array<{ name: string; subtotal: number; multiplier: number; offset: number; adjusted: number; faces: FaceDefinition[] }>;
  groupSum: number;
  multiplier: number;
  offset: number;
  total: number;
}

export interface Polyhedron {
  vertices: [number, number, number][];
  faces: number[][];
  representation: string;
}

export interface FaceResult extends FaceDefinition {
  dieName: string;
}

type GeometryId = 'tetra' | 'cube' | 'octa' | 'deca' | 'dodeca' | 'icosa' | 'bipyramid12' | 'bipyramid15';
const shapeInfo: Record<ShapeId, { sides: number; geometry: GeometryId }> = {
  d2: { sides: 2, geometry: 'tetra' }, d3: { sides: 3, geometry: 'tetra' }, d4: { sides: 4, geometry: 'tetra' },
  d5: { sides: 5, geometry: 'cube' }, d6: { sides: 6, geometry: 'cube' }, d7: { sides: 7, geometry: 'icosa' },
  d8: { sides: 8, geometry: 'octa' }, d10: { sides: 10, geometry: 'deca' }, d12: { sides: 12, geometry: 'dodeca' },
  d14: { sides: 14, geometry: 'icosa' }, d16: { sides: 16, geometry: 'icosa' }, d20: { sides: 20, geometry: 'icosa' },
  d24: { sides: 24, geometry: 'bipyramid12' }, d30: { sides: 30, geometry: 'bipyramid15' }, d100: { sides: 100, geometry: 'deca' },
};

const phi = (1 + Math.sqrt(5)) / 2;
function bipyramidVertices(sides: number): [number, number, number][] {
  return [
    ...Array.from({ length: sides }, (_, index) => {
      const angle = index * Math.PI * 2 / sides;
      return [Math.cos(angle), 0, Math.sin(angle)] as [number, number, number];
    }),
    [0, 0.9, 0], [0, -0.9, 0],
  ];
}

function pentagonalTrapezohedron(): { vertices: [number, number, number][]; faces: number[][] } {
  const sides = 5;
  const antiprism: [number, number, number][] = Array.from({ length: sides * 2 }, (_, index) => {
    const lower = index >= sides;
    const side = index % sides;
    const angle = (side + (lower ? 0.5 : 0)) * Math.PI * 2 / sides;
    return [Math.cos(angle), lower ? -0.62 : 0.62, Math.sin(angle)] as [number, number, number];
  });
  const antiprismFaces: number[][] = [[0, 1, 2, 3, 4], [9, 8, 7, 6, 5]];
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    antiprismFaces.push([side, next, sides + side], [sides + side, sides + next, next]);
  }
  const vertices = antiprismFaces.map(face => {
    const [aIndex, bIndex, cIndex] = face;
    const [a, b, c] = [antiprism[aIndex], antiprism[bIndex], antiprism[cIndex]];
    let normal = normalize(cross(sub(b, a), sub(c, a)));
    if (dot(normal, a) < 0) normal = normal.map(value => -value) as [number, number, number];
    const distance = dot(normal, a);
    return normal.map(value => value / distance) as [number, number, number];
  });
  const faces = antiprism.map((_, vertexIndex) => {
    const incident = antiprismFaces.flatMap((face, faceIndex) => face.includes(vertexIndex) ? [faceIndex] : []);
    const center = centerOf(incident.map(index => vertices[index]));
    const normal = normalize(antiprism[vertexIndex]);
    const u = normalize(sub(vertices[incident[0]], center));
    const v = cross(normal, u);
    return incident.sort((a, b) => {
      const da = sub(vertices[a], center);
      const db = sub(vertices[b], center);
      return Math.atan2(dot(da, v), dot(da, u)) - Math.atan2(dot(db, v), dot(db, u));
    });
  });
  return { vertices, faces };
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: number[]) => Math.sqrt(dot(a, a));
const normalize = (a: number[]) => {
  const magnitude = length(a) || 1;
  return [a[0] / magnitude, a[1] / magnitude, a[2] / magnitude] as [number, number, number];
};
const centerOf = (vertices: number[][]) => vertices.reduce((sum, vertex) => [sum[0] + vertex[0] / vertices.length, sum[1] + vertex[1] / vertices.length, sum[2] + vertex[2] / vertices.length], [0, 0, 0]);

export function convexHull(source: number[][]): number[][][] {
  const unique = new Map<string, number[]>();
  for (const point of source) unique.set(point.map(value => value.toFixed(5)).join(','), point);
  const vertices = [...unique.values()];
  const planes = new Map<string, { normal: number[]; indices: Set<number> }>();
  for (let a = 0; a < vertices.length - 2; a++) {
    for (let b = a + 1; b < vertices.length - 1; b++) {
      for (let c = b + 1; c < vertices.length; c++) {
        let normal = normalize(cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])));
        if (length(normal) < 0.9) continue;
        const distance = dot(normal, vertices[a]);
        const sides = vertices.map(point => dot(normal, point) - distance);
        if (sides.some(value => value > 1e-5) && sides.some(value => value < -1e-5)) continue;
        if (dot(normal, centerOf(vertices)) > distance) normal = [-normal[0], -normal[1], -normal[2]];
        const plane = dot(normal, vertices[a]);
        const key = `${normal.map(value => value.toFixed(4)).join(',')}:${plane.toFixed(4)}`;
        const indices = new Set(vertices.flatMap((point, index) => Math.abs(dot(normal, point) - plane) < 1e-4 ? [index] : []));
        planes.set(key, { normal, indices });
      }
    }
  }
  return [...planes.values()].map(({ normal, indices }) => {
    const center = centerOf([...indices].map(index => vertices[index]));
    const first = vertices[[...indices][0]];
    const u = normalize(sub(first, center));
    const v = cross(normal, u);
    return [...indices].sort((a, b) => {
      const da = sub(vertices[a], center);
      const db = sub(vertices[b], center);
      return Math.atan2(dot(da, v), dot(da, u)) - Math.atan2(dot(db, v), dot(db, u));
    });
  }).map(face => face.map(index => vertices[index]));
}

const trapezohedron = pentagonalTrapezohedron();
const baseVertices: Record<GeometryId, [number, number, number][]> = {
  tetra: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  cube: Array.from({ length: 8 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1] as [number, number, number]),
  octa: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  deca: trapezohedron.vertices,
  dodeca: [],
  bipyramid12: bipyramidVertices(12),
  bipyramid15: bipyramidVertices(15),
  icosa: [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ],
};
const baseFaces: Partial<Record<GeometryId, number[][]>> = { deca: trapezohedron.faces };

export function getPolyhedron(shape: ShapeId): Polyhedron {
  const geometry = shapeInfo[shape].geometry;
  let seeds = baseVertices[geometry];
  if (geometry === 'dodeca') {
    const triangles = convexHull(baseVertices.icosa);
    seeds = triangles.map(triangle => normalize(centerOf(triangle)));
  }
  const facesAsPoints = baseFaces[geometry] ? [] : convexHull(seeds);
  const maxRadius = Math.max(...seeds.map(length));
  const vertices = geometry === 'deca'
    ? seeds.map(point => point.map(value => value / maxRadius) as [number, number, number])
    : [...new Map(seeds.map(point => [point.map(value => value.toFixed(5)).join(','), normalize(point)])).values()];
  const faces = baseFaces[geometry] ?? facesAsPoints.map(points => points.map(point => vertices.findIndex(vertex => length(sub(vertex, normalize(point))) < 1e-4)));
  return {
    vertices,
    faces,
    representation: shape === 'd10' || shape === 'd100'
      ? 'a convex ten-face pentagonal trapezohedron'
      : (shapeInfo[shape].sides === faces.length
        ? `a convex ${faces.length}-face solid`
        : `a convex ${faces.length}-face solid with repeated outcomes`),
  };
}

export function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return String(value);
  const values: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = value;
  return values.map(([amount, numeral]) => {
    const count = Math.floor(remaining / amount);
    remaining %= amount;
    return numeral.repeat(count);
  }).join('');
}

export function defaultFaces(shape: ShapeId, style: LabelStyle = 'arabic'): FaceDefinition[] {
  const sides = shapeInfo[shape].sides;
  return Array.from({ length: sides }, (_, index) => {
    if (shape === 'd100') {
      const value = index === 0 ? 100 : index;
      return { label: String(index).padStart(2, '0'), score: value };
    }
    const score = shape === 'd10' ? index : (index % sides) + 1;
    return { label: style === 'roman' ? romanNumeral(score) : String(score), score };
  });
}

export function createDie(shape: ShapeId = 'd6', overrides: Partial<DieConfig> = {}): DieConfig {
  const labelStyle = overrides.labelStyle ?? 'arabic';
  return {
    id: crypto.randomUUID(),
    name: `D${shape.slice(1)} in the making`,
    shape,
    color: '#c6a86a',
    size: 1,
    material: 'porcelain',
    transparency: 0,
    iridescence: 25,
    treatment: 'gilded',
    labelStyle,
    faces: defaultFaces(shape, labelStyle),
    ...overrides,
  };
}

export function outcomesForShape(die: DieConfig): number {
  return die.shape === 'd100' ? 100 : shapeInfo[die.shape].sides;
}

export interface FaceQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function restingFaceIndex(normals: [number, number, number][], quaternion: FaceQuaternion, bottomFace = false): number | null {
  if (normals.length < 2 || !Object.values(quaternion).every(Number.isFinite)) return null;
  const { x, y, z, w } = quaternion;
  const ranked = normals.map((normal, index) => {
    const worldY = 2 * (x * y + z * w) * normal[0]
      + (1 - 2 * (x * x + z * z)) * normal[1]
      + 2 * (y * z - x * w) * normal[2];
    return { index, score: bottomFace ? -worldY : worldY };
  }).sort((a, b) => b.score - a.score);
  return ranked[0].score - ranked[1].score < 0.025 ? null : ranked[0].index;
}

export function physicalBodyCount(die: DieConfig): number {
  return die.shape === 'd100' ? 2 : 1;
}

export function handCapacity(groups: HandGroup[]): { logical: number; physical: number; canAdd: boolean } {
  const logical = groups.reduce((sum, group) => sum + group.quantity, 0);
  const physical = groups.reduce((sum, group) => sum + group.quantity * physicalBodyCount(group.die), 0);
  return { logical, physical, canAdd: logical < MAX_LOGICAL_DICE && physical < MAX_PHYSICAL_BODIES };
}

export function addToHand(groups: HandGroup[], die: DieConfig): HandGroup[] {
  const capacity = handCapacity(groups);
  if (capacity.logical >= MAX_LOGICAL_DICE || capacity.physical + physicalBodyCount(die) > MAX_PHYSICAL_BODIES) {
    throw new Error(`Your hand is limited to ${MAX_LOGICAL_DICE} dice and ${MAX_PHYSICAL_BODIES} physical bodies.`);
  }
  const existing = groups.find(group => group.die.id === die.id);
  if (existing) return groups.map(group => group === existing ? { ...group, quantity: group.quantity + 1 } : group);
  return [...groups, { die: structuredClone(die), quantity: 1, multiplier: 1, offset: 0 }];
}

export function addManyToHand(groups: HandGroup[], die: DieConfig, quantity: number): HandGroup[] {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Choose a whole number of dice to add.');
  const capacity = handCapacity(groups);
  const physicalCount = physicalBodyCount(die);
  if (capacity.logical + quantity > MAX_LOGICAL_DICE || capacity.physical + quantity * physicalCount > MAX_PHYSICAL_BODIES) {
    throw new Error(`Your hand is limited to ${MAX_LOGICAL_DICE} dice and ${MAX_PHYSICAL_BODIES} physical bodies.`);
  }
  let next = groups;
  for (let index = 0; index < quantity; index++) next = addToHand(next, die);
  return next;
}

export function computeBreakdown(groups: HandGroup[], multiplier = 1, offset = 0, results?: FaceResult[][]): ModifierBreakdown {
  const detail = groups.map((group, index) => {
    const faces = results?.[index] ?? [];
    const subtotal = faces.reduce((sum, face) => sum + face.score, 0);
    return {
      name: group.die.name,
      subtotal,
      multiplier: group.multiplier,
      offset: group.offset,
      adjusted: subtotal * group.multiplier + group.offset,
      faces,
    };
  });
  const groupSum = detail.reduce((sum, group) => sum + group.adjusted, 0);
  return { groups: detail, groupSum, multiplier, offset, total: groupSum * multiplier + offset };
}

export function validateDie(value: unknown): value is DieConfig {
  if (!value || typeof value !== 'object') return false;
  const die = value as Partial<DieConfig>;
  if (typeof die.id !== 'string' || typeof die.name !== 'string' || !die.name.trim() || die.name.length > 32) return false;
  if (!(die.shape && die.shape in shapeInfo) || !/^#[0-9a-f]{6}$/i.test(die.color ?? '')) return false;
  if (typeof die.size !== 'number' || !Number.isFinite(die.size) || die.size < 0.6 || die.size > 1.4) return false;
  if (!['porcelain', 'satin', 'crystal', 'enamel'].includes(die.material ?? '')
    || !['gilded', 'engraved', 'embossed'].includes(die.treatment ?? '')
    || !['arabic', 'roman', 'custom'].includes(die.labelStyle ?? '')) return false;
  if (![die.transparency, die.iridescence].every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100)) return false;
  if (!Array.isArray(die.faces) || die.faces.length !== shapeInfo[die.shape].sides) return false;
  return die.faces.every(face => face && typeof face.label === 'string' && face.label.length <= 8 && typeof face.score === 'number' && Number.isFinite(face.score) && Math.abs(face.score) <= 1_000_000);
}
