import { describe, expect, it } from 'vitest';
import { createDie, STORAGE_KEY, type DieConfig } from '../src/model';
import { loadCollection, saveCollection } from '../src/storage';

function memoryStorage(initial: Record<string, string> = {}): Storage {
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

describe('loadCollection', () => {
  it('returns an empty successful collection when storage has no saved value', () => {
    expect(loadCollection(memoryStorage())).toEqual({ status: 'ok', items: [] });
  });

  it('reports inaccessible storage without throwing', () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error('storage is disabled'); };

    expect(loadCollection(storage)).toEqual({ status: 'unavailable', items: [] });
  });

  it.each([
    ['malformed JSON', '{'],
    ['JSON null', 'null'],
    ['a JSON string', '"collection"'],
    ['a JSON number', '42'],
    ['a JSON array', '[]'],
    ['a missing version', '{"items":[]}'],
    ['an unsupported version', '{"version":2,"items":[]}'],
    ['a missing items property', '{"version":1}'],
    ['non-array items', '{"version":1,"items":{}}'],
  ])('rejects %s without discarding the saved bytes', (_reason, raw) => {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });

    expect(loadCollection(storage)).toEqual({ status: 'invalid', items: [] });
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('rejects collections above the item limit and any collection containing an invalid die', () => {
    const die = createDie('d4');
    const oversized = JSON.stringify({ version: 1, items: Array.from({ length: 201 }, () => die) });
    const partlyInvalid = JSON.stringify({ version: 1, items: [die, { ...die, size: 2 }] });

    expect(loadCollection(memoryStorage({ [STORAGE_KEY]: oversized }))).toEqual({ status: 'invalid', items: [] });
    expect(loadCollection(memoryStorage({ [STORAGE_KEY]: partlyInvalid }))).toEqual({ status: 'invalid', items: [] });
  });

  it('accepts the maximum collection size and a valid empty collection', () => {
    const die = createDie('d4');
    const raw = JSON.stringify({ version: 1, items: Array.from({ length: 200 }, () => die) });

    expect(loadCollection(memoryStorage({ [STORAGE_KEY]: raw })).status).toBe('ok');
    expect(loadCollection(memoryStorage({ [STORAGE_KEY]: '{"version":1,"items":[]}' })))
      .toEqual({ status: 'ok', items: [] });
  });
});

describe('saveCollection', () => {
  it('writes the versioned payload under the stable collection key', () => {
    const storage = memoryStorage();
    const items: DieConfig[] = [createDie('d8')];

    saveCollection(storage, items);

    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ version: 1, items }));
  });

  it('converts quota errors into an actionable storage message', () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };

    expect(() => saveCollection(storage, [])).toThrow(
      'This browser is out of local storage space. Free some space before saving.',
    );
  });

  it.each([
    ['a generic error', new Error('blocked')],
    ['a different DOMException', new DOMException('blocked', 'SecurityError')],
    ['a non-error value', 'blocked'],
  ])('converts %s into the generic storage message', (_reason, failure) => {
    const storage = memoryStorage();
    storage.setItem = () => { throw failure; };

    expect(() => saveCollection(storage, [])).toThrow(
      'This browser could not save your collection locally.',
    );
  });

  it('reports serialization failures through the same safe error contract', () => {
    const storage = memoryStorage();
    const circular = {} as DieConfig & { self?: unknown };
    circular.self = circular;

    expect(() => saveCollection(storage, [circular])).toThrow(
      'This browser could not save your collection locally.',
    );
  });
});
