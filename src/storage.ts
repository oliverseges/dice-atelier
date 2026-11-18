import { STORAGE_KEY, validateDie, type DieConfig } from './model';

export type LoadCollection = { status: 'ok'; items: DieConfig[] } | { status: 'invalid'; items: [] } | { status: 'unavailable'; items: DieConfig[] };

export function loadCollection(storage: Storage): LoadCollection {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'unavailable', items: [] };
  }
  if (raw === null) return { status: 'ok', items: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1 || !Array.isArray((parsed as { items?: unknown }).items)) {
      return { status: 'invalid', items: [] };
    }
    const items = (parsed as { items: unknown[] }).items;
    if (items.length > 200 || !items.every(validateDie)) return { status: 'invalid', items: [] };
    return { status: 'ok', items };
  } catch {
    return { status: 'invalid', items: [] };
  }
}

export function saveCollection(storage: Storage, items: DieConfig[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items }));
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'This browser is out of local storage space. Free some space before saving.'
      : 'This browser could not save your collection locally.');
  }
}
