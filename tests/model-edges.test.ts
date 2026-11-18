import { describe, expect, it } from 'vitest';
import {
  addManyToHand,
  addToHand,
  computeBreakdown,
  createDie,
  defaultFaces,
  getPolyhedron,
  handCapacity,
  outcomesForShape,
  physicalBodyCount,
  romanNumeral,
  validateDie,
  type DieConfig,
  type HandGroup,
  type ShapeId,
} from '../src/model';

const shapes: ShapeId[] = [
  'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd10', 'd12', 'd14',
  'd16', 'd20', 'd24', 'd30', 'd100',
];

describe('model defaults and shape metadata', () => {
  it('creates default dice and applies only the requested overrides', () => {
    expect(createDie()).toMatchObject({
      shape: 'd6',
      name: 'D6 in the making',
      size: 1,
      labelStyle: 'arabic',
    });
    const die = createDie('d4', { labelStyle: 'roman', name: 'Pocket die', size: 1.4 });

    expect(die).toMatchObject({
      name: 'Pocket die',
      shape: 'd4',
      color: '#c6a86a',
      size: 1.4,
      material: 'porcelain',
      transparency: 0,
      iridescence: 25,
      treatment: 'gilded',
      labelStyle: 'roman',
      faces: [
        { label: 'I', score: 1 }, { label: 'II', score: 2 },
        { label: 'III', score: 3 }, { label: 'IV', score: 4 },
      ],
    });
    expect(die.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(validateDie(die)).toBe(true);

    const overriddenFaces = [{ label: 'ONE', score: -5 }];
    expect(createDie('d2', { id: 'fixed', faces: overriddenFaces }).faces).toBe(overriddenFaces);
  });

  it('formats Roman numerals and preserves values outside the supported integer range', () => {
    expect(romanNumeral(3999)).toBe('MMMCMXCIX');
    expect(romanNumeral(944)).toBe('CMXLIV');
    for (const value of [0, -1, 4000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(romanNumeral(value)).toBe(String(value));
    }
  });

  it('generates the special d10 and d100 outcomes and reports body counts', () => {
    expect(defaultFaces('d10')).toEqual(
      Array.from({ length: 10 }, (_, score) => ({ label: String(score), score })),
    );
    expect(defaultFaces('d10', 'roman')[0]).toEqual({ label: '0', score: 0 });
    expect(defaultFaces('d100').slice(0, 3)).toEqual([
      { label: '00', score: 100 }, { label: '01', score: 1 }, { label: '02', score: 2 },
    ]);

    for (const shape of shapes) {
      const die = createDie(shape);
      expect(outcomesForShape(die)).toBe(shape === 'd100' ? 100 : die.faces.length);
      expect(physicalBodyCount(die)).toBe(shape === 'd100' ? 2 : 1);
    }
  });

  it('describes exact, repeated-outcome, and d10-family representations', () => {
    expect(getPolyhedron('d6').representation).toBe('a convex 6-face solid');
    expect(getPolyhedron('d7').representation).toBe('a convex 20-face solid with repeated outcomes');
    expect(getPolyhedron('d10').representation).toBe('a convex ten-face pentagonal trapezohedron');
    expect(getPolyhedron('d100').representation).toBe('a convex ten-face pentagonal trapezohedron');
  });
});

describe('hand and modifier edge behavior', () => {
  it('counts an empty hand and permits the final d100 body-cap slot', () => {
    expect(handCapacity([])).toEqual({ logical: 0, physical: 0, canAdd: true });

    let groups: HandGroup[] = [];
    for (let index = 0; index < 14; index++) {
      groups = addToHand(groups, createDie('d100', { id: `percentile-${index}` }));
    }
    expect(handCapacity(groups)).toEqual({ logical: 14, physical: 28, canAdd: true });

    groups = addToHand(groups, createDie('d100', { id: 'last-percentile' }));
    expect(handCapacity(groups)).toEqual({ logical: 15, physical: 30, canAdd: false });
    expect(() => addToHand(groups, createDie('d6'))).toThrow(/limited/);
  });

  it('rejects adding a two-body die when only one physical slot remains', () => {
    const groups: HandGroup[] = [
      { die: createDie('d100'), quantity: 13, multiplier: 1, offset: 0 },
      { die: createDie('d6'), quantity: 3, multiplier: 1, offset: 0 },
    ];
    expect(handCapacity(groups)).toEqual({ logical: 16, physical: 29, canAdd: true });
    expect(() => addToHand(groups, createDie('d100'))).toThrow(/limited/);
  });

  it('increments an existing group without mutating its prior state', () => {
    const die = createDie('d6', { id: 'same-die' });
    const original: HandGroup[] = [{ die, quantity: 2, multiplier: 3, offset: -4 }];
    const updated = addToHand(original, die);

    expect(updated).toEqual([{ die, quantity: 3, multiplier: 3, offset: -4 }]);
    expect(updated).not.toBe(original);
    expect(original[0].quantity).toBe(2);
  });

  it('copies a newly added die so later edits do not mutate the caller’s die', () => {
    const die = createDie('d4', { id: 'to-copy' });
    const added = addToHand([], die);

    expect(added).toHaveLength(1);
    expect(added[0].die).not.toBe(die);
    expect(added[0].die.faces).not.toBe(die.faces);
    added[0].die.faces[0].score = 99;
    expect(die.faces[0].score).toBe(1);
  });

  it('computes empty/default modifiers and tolerates missing results for a group', () => {
    expect(computeBreakdown([])).toEqual({
      groups: [], groupSum: 0, multiplier: 1, offset: 0, total: 0,
    });

    const groups: HandGroup[] = [
      { die: createDie('d4', { name: 'No result' }), quantity: 1, multiplier: 2, offset: 3 },
      { die: createDie('d6', { name: 'One result' }), quantity: 1, multiplier: 0, offset: -2 },
    ];
    expect(computeBreakdown(groups)).toMatchObject({
      groups: [{ subtotal: 0, adjusted: 3 }, { subtotal: 0, adjusted: -2 }],
      groupSum: 1,
      total: 1,
    });
    expect(computeBreakdown(groups, 3, 5, [undefined as never, [
      { dieName: 'One result', label: '4', score: 4 },
    ]])).toMatchObject({
      groups: [{ subtotal: 0, adjusted: 3 }, { subtotal: 4, adjusted: -2 }],
      groupSum: 1,
      multiplier: 3,
      offset: 5,
      total: 8,
    });
  });

  it('adds a requested quantity to an existing group or creates one new group', () => {
    const existingDie = createDie('d6', { id: 'existing', name: 'Existing die' });
    const otherDie = createDie('d8', { id: 'new', name: 'New die' });
    const groups: HandGroup[] = [
      { die: existingDie, quantity: 2, multiplier: 3, offset: -1 },
    ];

    const sameGroup = addManyToHand(groups, existingDie, 4);
    expect(sameGroup).toHaveLength(1);
    expect(sameGroup[0]).toMatchObject({
      die: existingDie, quantity: 6, multiplier: 3, offset: -1,
    });

    const differentGroup = addManyToHand(groups, otherDie, 3);
    expect(differentGroup).toHaveLength(2);
    expect(differentGroup[0]).toEqual(groups[0]);
    expect(differentGroup[1]).toMatchObject({
      die: otherDie, quantity: 3, multiplier: 1, offset: 0,
    });
    expect(differentGroup[1].die).not.toBe(otherDie);
    expect(groups[0].quantity).toBe(2);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid bulk quantity %s without changing the existing hand',
    quantity => {
      const groups: HandGroup[] = [{
        die: createDie('d6', { id: 'unchanged' }),
        quantity: 2,
        multiplier: 2,
        offset: 5,
      }];
      const originalGroup = groups[0];

      expect(() => addManyToHand(groups, createDie('d4'), quantity)).toThrow(
        'Choose a whole number of dice to add.',
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]).toBe(originalGroup);
      expect(groups[0].quantity).toBe(2);
    },
  );

  it('allows the exact logical cap and rejects an over-cap addition atomically', () => {
    const die = createDie('d6', { id: 'logical-cap' });
    const groups: HandGroup[] = [{ die, quantity: 28, multiplier: 1, offset: 0 }];
    const atCap = addManyToHand(groups, die, 2);

    expect(handCapacity(atCap)).toEqual({ logical: 30, physical: 30, canAdd: false });
    expect(() => addManyToHand(atCap, die, 1)).toThrow(/limited/);
    expect(atCap).toHaveLength(1);
    expect(atCap[0].quantity).toBe(30);
  });

  it('allows d100s to fill the physical cap and atomically rejects an over-cap batch', () => {
    const die = createDie('d100', { id: 'percentile-cap' });
    const groups: HandGroup[] = [{ die, quantity: 14, multiplier: 1, offset: 0 }];
    const atCap = addManyToHand(groups, die, 1);

    expect(handCapacity(atCap)).toEqual({ logical: 15, physical: 30, canAdd: false });
    expect(() => addManyToHand(groups, die, 2)).toThrow(/limited/);
    expect(groups).toHaveLength(1);
    expect(groups[0].quantity).toBe(14);
    expect(() => addManyToHand(atCap, die, 1)).toThrow(/limited/);
    expect(atCap[0].quantity).toBe(15);
  });
});

describe('die validation boundaries', () => {
  const validDie = (): DieConfig => createDie('d4');
  const rejected = (change: (die: Record<string, unknown>) => void) => {
    const die = validDie() as unknown as Record<string, unknown>;
    change(die);
    expect(validateDie(die)).toBe(false);
  };

  it('rejects non-objects, malformed names, and invalid identifiers', () => {
    for (const value of [null, undefined, false, 5, 'die']) expect(validateDie(value)).toBe(false);
    rejected(die => { die.id = 1; });
    rejected(die => { die.name = 1; });
    rejected(die => { die.name = '   '; });
    rejected(die => { die.name = 'x'.repeat(33); });
    expect(validateDie(createDie('d4', { name: 'x'.repeat(32) }))).toBe(true);
  });

  it('rejects unknown shapes and malformed colors', () => {
    rejected(die => { die.shape = ''; });
    rejected(die => { die.shape = 0; });
    rejected(die => { die.shape = 'd99'; });
    rejected(die => { die.shape = 'toString'; });
    rejected(die => { die.color = undefined; });
    rejected(die => { die.color = 'c6a86a'; });
    rejected(die => { die.color = '#abc'; });
    expect(validateDie(createDie('d4', { color: '#A1b2C3' }))).toBe(true);
  });

  it('enforces finite size at both inclusive limits', () => {
    for (const size of [0.6, 1, 1.4]) {
      expect(validateDie(createDie('d4', { size }))).toBe(true);
    }
    for (const size of [undefined, '1', Number.NaN, Number.POSITIVE_INFINITY, 0.599, 1.401]) {
      rejected(die => { die.size = size; });
    }
  });

  it('rejects unsupported material, treatment, and label-style values', () => {
    rejected(die => { die.material = 'wood'; });
    rejected(die => { die.treatment = 'painted'; });
    rejected(die => { die.labelStyle = 'binary'; });
  });

  it('rejects omitted material, treatment, and label-style values independently', () => {
    rejected(die => { die.material = undefined; });
    rejected(die => { die.treatment = undefined; });
    rejected(die => { die.labelStyle = undefined; });
  });

  it('requires finite transparency and iridescence within inclusive percentage bounds', () => {
    for (const property of ['transparency', 'iridescence']) {
      for (const value of [0, 50, 100]) {
        expect(validateDie(createDie('d4', { [property]: value }))).toBe(true);
      }
      for (const value of [undefined, '50', Number.NaN, Number.NEGATIVE_INFINITY, -1, 101]) {
        rejected(die => { die[property] = value; });
      }
    }
  });

  it('validates face arrays, labels, and finite bounded scores', () => {
    rejected(die => { die.faces = null; });
    rejected(die => { die.faces = [{ label: 'only one', score: 1 }]; });

    for (const face of [
      null,
      { label: 5, score: 1 },
      { label: 'x'.repeat(9), score: 1 },
      { label: 'ok', score: '1' },
      { label: 'ok', score: Number.NaN },
      { label: 'ok', score: 1_000_001 },
      { label: 'ok', score: -1_000_001 },
    ]) {
      rejected(die => { die.faces = [face, ...validDie().faces.slice(1)]; });
    }

    for (const score of [-1_000_000, 0, 1_000_000]) {
      const die = validDie();
      die.faces[0] = { label: '12345678', score };
      expect(validateDie(die)).toBe(true);
    }
  });
});
