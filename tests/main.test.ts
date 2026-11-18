import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDie, STORAGE_KEY, type DieConfig, type FaceDefinition, type HandSnapshot,
} from '../src/model';

type SceneResult = { status: 'settled'; results: FaceDefinition[][] } | { status: 'cocked' };
type ResultCallback = (result: SceneResult) => void;

const sourceHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const bodyMarkup = new DOMParser().parseFromString(sourceHtml, 'text/html').body;
bodyMarkup.querySelector('script')?.remove();

const sceneHarness: {
  instance: MockScene | null;
  constructorError: unknown;
  throwError: unknown;
  throwCalls: Array<{ snapshot: HandSnapshot; callback: ResultCallback }>;
  onDragStart?: () => boolean;
  onDragComplete?: ResultCallback;
} = {
  instance: null,
  constructorError: null,
  throwError: null,
  throwCalls: [],
};

class MockScene {
  showDie = vi.fn((_die: DieConfig) => {});
  setSurface = vi.fn((_surface: 'cloud' | 'table') => {});
  setView = vi.fn((_view: 'play' | 'design') => {});
  setDragCallbacks = vi.fn((onStart: () => boolean, onComplete: ResultCallback) => {
    sceneHarness.onDragStart = onStart;
    sceneHarness.onDragComplete = onComplete;
  });
  throw = vi.fn((snapshot: HandSnapshot, callback: ResultCallback) => {
    sceneHarness.throwCalls.push({ snapshot, callback });
    if (sceneHarness.throwError) throw sceneHarness.throwError;
  });
  dispose = vi.fn();

  constructor(_stage: HTMLElement) {
    if (sceneHarness.constructorError) throw sceneHarness.constructorError;
    sceneHarness.instance = this;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = id.startsWith('#') || id.startsWith('.') || id.startsWith('[')
    ? document.querySelector(id)
    : document.getElementById(id);
  if (!found) throw new Error(`Test fixture is missing #${id}`);
  return found as T;
}

function click(id: string): void {
  element<HTMLButtonElement>(id).click();
}

function setValue(id: string, value: string, eventType: 'input' | 'change' = 'change'): void {
  const control = element<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  control.value = value;
  control.dispatchEvent(new Event(eventType, { bubbles: true }));
}

function savedCollection(items: DieConfig[]): string {
  return JSON.stringify({ version: 1, items });
}

async function boot(options: {
  collection?: string;
  collectionItems?: DieConfig[];
  theme?: string;
  omitElement?: string;
  saveError?: unknown;
  invalidDie?: boolean;
  addManyError?: unknown;
  addOneError?: unknown;
} = {}): Promise<void> {
  window.localStorage.clear();
  if (options.collection !== undefined) window.localStorage.setItem(STORAGE_KEY, options.collection);
  if (options.theme !== undefined) window.localStorage.setItem('dice-atelier.theme.v1', options.theme);

  document.body.innerHTML = bodyMarkup.innerHTML;
  if (options.omitElement) document.getElementById(options.omitElement)?.remove();
  document.documentElement.removeAttribute('data-theme');
  vi.resetModules();
  vi.doUnmock('../src/scene');
  vi.doUnmock('../src/storage');
  vi.doUnmock('../src/model');
  vi.doMock('../src/scene', () => ({ DiceScene: MockScene }));
  if (Object.hasOwn(options, 'saveError')) {
    vi.doMock('../src/storage', async importOriginal => {
      const actual = await importOriginal<typeof import('../src/storage')>();
      return {
        ...actual,
        ...(options.collectionItems
          ? { loadCollection: () => ({ status: 'ok' as const, items: options.collectionItems! }) }
          : {}),
        saveCollection: () => { throw options.saveError; },
      };
    });
  } else if (options.collectionItems) {
    vi.doMock('../src/storage', async importOriginal => {
      const actual = await importOriginal<typeof import('../src/storage')>();
      return {
        ...actual,
        loadCollection: () => ({ status: 'ok' as const, items: options.collectionItems! }),
      };
    });
  }
  if (options.invalidDie || Object.hasOwn(options, 'addManyError') || Object.hasOwn(options, 'addOneError')) {
    vi.doMock('../src/model', async importOriginal => {
      const actual = await importOriginal<typeof import('../src/model')>();
      return {
        ...actual,
        ...(options.invalidDie ? { validateDie: () => false } : {}),
        ...(Object.hasOwn(options, 'addManyError')
          ? { addManyToHand: () => { throw options.addManyError; } }
          : {}),
        ...(Object.hasOwn(options, 'addOneError')
          ? { addToHand: () => { throw options.addOneError; } }
          : {}),
      };
    });
  }
  await import('../src/main');
}

function dieResult(label: string, score: number): FaceDefinition {
  return { label, score };
}

beforeEach(() => {
  vi.restoreAllMocks();
  sceneHarness.instance = null;
  sceneHarness.constructorError = null;
  sceneHarness.throwError = null;
  sceneHarness.throwCalls = [];
  sceneHarness.onDragStart = undefined;
  sceneHarness.onDragComplete = undefined;
  document.body.innerHTML = bodyMarkup.innerHTML;
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('../src/scene');
  vi.doUnmock('../src/storage');
  vi.doUnmock('../src/model');
});

describe('Dice Atelier main interface', () => {
  it('starts on the default d6 and adds the selected default shape to the hand', async () => {
    await boot();

    expect(element<HTMLSelectElement>('quick-die').value).toBe('default:d6');
    expect(element<HTMLButtonElement>('throw-button').disabled).toBe(true);

    setValue('quick-die', 'default:d4');
    click('add-to-hand');

    expect(element('.hand-item').textContent).toContain('D4');
    expect(element('#hand-count').textContent).toBe('1 / 30');
    expect(element<HTMLButtonElement>('throw-button').disabled).toBe(false);
    expect(element('#hand-summary').textContent).toContain('1 physical body');
  });

  it('offers saved dice in the picker and adds the selected saved die', async () => {
    const saved = createDie('d8', { id: 'saved-moon', name: 'Moonstone' });
    await boot({ collection: savedCollection([saved]) });

    const picker = element<HTMLSelectElement>('quick-die');
    expect(picker.querySelector('option[value="saved:saved-moon"]')?.textContent).toBe('Moonstone · D8');
    picker.value = 'saved:saved-moon';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    click('add-to-hand');

    expect(element('.hand-item').textContent).toContain('Moonstone');
    expect(element('.hand-item').textContent).toContain('D8 · 1 in this group');
  });

  it('loads a saved collection selection into the editor and updates that die when saved', async () => {
    const saved = createDie('d8', { id: 'saved-moon', name: 'Moonstone' });
    const untouched = createDie('d4', { id: 'saved-keep', name: 'Keep Me' });
    await boot({ collection: savedCollection([saved, untouched]) });

    element<HTMLButtonElement>('.collection-chip').click();
    expect(element<HTMLInputElement>('die-name').value).toBe('Moonstone');
    expect(element('#stage-caption').textContent).toContain('Moonstone');
    setValue('die-name', 'Blue Moon', 'input');
    click('save-die');

    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { items: DieConfig[] };
    expect(data.items).toHaveLength(2);
    expect(data.items[0].id).toBe('saved-moon');
    expect(data.items[0].name).toBe('Blue Moon');
    expect(data.items[1]).toMatchObject({ id: 'saved-keep', name: 'Keep Me' });
  });

  it('adds a requested quantity and enforces logical and physical hand capacity', async () => {
    await boot();
    setValue('quick-die', 'default:d100');
    setValue('quick-quantity', '16', 'input');

    expect(element<HTMLInputElement>('quick-quantity').value).toBe('15');
    expect(element<HTMLInputElement>('quick-quantity').max).toBe('15');
    expect(element<HTMLButtonElement>('add-to-hand').disabled).toBe(false);
    click('add-to-hand');

    expect(element('#hand-count').textContent).toBe('15 / 30');
    expect(element('#hand-summary').textContent).toBe('15 dice · 30 physical bodies');
    expect(element<HTMLButtonElement>('add-to-hand').disabled).toBe(true);

    setValue('quick-die', 'default:d6');
    expect(element<HTMLInputElement>('quick-quantity').max).toBe('0');
    expect(element<HTMLButtonElement>('add-to-hand').disabled).toBe(true);
    setValue('quick-quantity', '0', 'input');
    expect(element<HTMLButtonElement>('add-to-hand').disabled).toBe(true);
  });

  it('enforces the 30-body cap when increasing an existing group and permits removing dice', async () => {
    await boot();
    setValue('quick-quantity', '30', 'input');
    click('add-to-hand');

    const addOne = element<HTMLButtonElement>('.hand-item button[aria-label="Add one D6"]');
    expect(addOne.disabled).toBe(true);
    expect(element('#hand-count').textContent).toBe('30 / 30');

    element<HTMLButtonElement>('.hand-item button[aria-label="Remove one D6"]').click();
    expect(element('#hand-count').textContent).toBe('29 / 30');
    expect(element<HTMLButtonElement>('.hand-item button[aria-label="Add one D6"]').disabled).toBe(false);
  });

  it('applies group modifiers before hand modifiers and displays actual face labels and scores', async () => {
    await boot();
    setValue('quick-quantity', '2', 'input');
    click('add-to-hand');
    const firstGroup = element<HTMLElement>('.hand-item');
    firstGroup.querySelector<HTMLSelectElement>('select[aria-label="Multiplier for this group"]')!.value = '2';
    firstGroup.querySelector<HTMLSelectElement>('select[aria-label="Multiplier for this group"]')!
      .dispatchEvent(new Event('change', { bubbles: true }));
    firstGroup.querySelector<HTMLSelectElement>('select[aria-label="Offset for this group"]')!.value = '2';
    firstGroup.querySelector<HTMLSelectElement>('select[aria-label="Offset for this group"]')!
      .dispatchEvent(new Event('change', { bubbles: true }));

    setValue('quick-die', 'default:d4');
    setValue('quick-quantity', '1', 'input');
    click('add-to-hand');
    const secondGroup = document.querySelectorAll<HTMLElement>('.hand-item')[1];
    secondGroup.querySelector<HTMLSelectElement>('select[aria-label="Offset for this group"]')!.value = '-1';
    secondGroup.querySelector<HTMLSelectElement>('select[aria-label="Offset for this group"]')!
      .dispatchEvent(new Event('change', { bubbles: true }));
    setValue('hand-multiplier', '2');
    setValue('hand-offset', '-1');
    click('throw-button');

    expect(sceneHarness.throwCalls).toHaveLength(1);
    expect(sceneHarness.throwCalls[0].snapshot.groups.map(group => [group.die.shape, group.quantity, group.multiplier, group.offset]))
      .toEqual([['d6', 2, 2, 2], ['d4', 1, 1, -1]]);
    expect(element('#roll-overlay').hasAttribute('hidden')).toBe(false);

    sceneHarness.throwCalls[0].callback({
      status: 'settled',
      results: [[dieResult('Ace', 3), dieResult('Two', 5)], [dieResult('IV', 4)]],
    });

    expect(element('#result-title').textContent).toBe('The table has spoken.');
    expect(element('#result-status').textContent).toBe('RESTED · ACTUAL FACES');
    expect(element('.result-content').textContent).toContain('Ace → 3');
    expect(element('.result-content').textContent).toContain('Two → 5');
    expect(element('.result-content').textContent).toContain('Faces subtotal 8');
    expect(element('.result-content').textContent).toContain('8 × 2 + 2 = 18');
    expect(element('.result-content').textContent).toContain('4 × 1 − 1 = 3');
    expect(element('.total-row strong').textContent).toBe('41');
  });

  it('updates and saves edited die size, color, and material', async () => {
    await boot();
    setValue('die-name', '  Copper Comet  ', 'input');
    setValue('die-size', '125', 'input');
    setValue('die-color', '#123456', 'input');
    setValue('die-material', 'satin');
    expect(element('#size-output').textContent).toBe('125%');
    click('save-die');

    let data = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { items: DieConfig[] };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      name: 'Copper Comet', size: 1.25, color: '#123456', material: 'satin',
    });
    expect(element('.collection-chip').textContent).toContain('Copper Comet');

    setValue('die-size', '130', 'input');
    click('save-die');
    data = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { items: DieConfig[] };
    expect(data.items).toHaveLength(1);
    expect(data.items[0].size).toBe(1.3);
  });

  it('applies a complete custom face map and persists independent labels and scores', async () => {
    await boot();
    setValue('label-style', 'custom');
    setValue('face-map', 'Ace|0\nTwo|2\nThree|3\nFour|4\nFive|5\nSix|6', 'input');
    click('apply-face-map');

    expect(element<HTMLSelectElement>('label-style').value).toBe('custom');
    expect(element<HTMLDetailsElement>('custom-faces').open).toBe(true);
    expect(element('#toast').textContent).toBe('Face labels and scoring values applied.');
    setValue('die-name', 'Marked Cube', 'input');
    click('save-die');

    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { items: DieConfig[] };
    expect(data.items[0].faces[0]).toEqual({ label: 'Ace', score: 0 });
    expect(data.items[0].faces[5]).toEqual({ label: 'Six', score: 6 });
  });

  it.each([
    ['malformed pair', 'No separator\n2|2\n3|3\n4|4\n5|5\n6|6', 'Line 1 needs a label|score pair.'],
    ['invalid score', 'Ace|NaN\n2|2\n3|3\n4|4\n5|5\n6|6', 'Line 1 has an invalid label or score.'],
    ['too many characters', '123456789|1\n2|2\n3|3\n4|4\n5|5\n6|6', 'Line 1 has an invalid label or score.'],
    ['wrong face count', 'Ace|1\nTwo|2', 'Add exactly 6 face lines before applying this mapping.'],
  ])('rejects a custom face map with %s and preserves the current mapping', async (_case, map, warning) => {
    await boot();
    const before = element<HTMLTextAreaElement>('face-map').value;
    setValue('face-map', map, 'input');
    click('apply-face-map');

    expect(element('#toast').textContent).toBe(warning);
    expect(element<HTMLSelectElement>('label-style').value).toBe('arabic');
    expect(element<HTMLTextAreaElement>('face-map').value).toBe(map);
    expect(before).not.toBe(map);
  });

  it('warns about invalid saved data and does not overwrite its original bytes', async () => {
    const raw = '{not valid collection JSON';
    await boot({ collection: raw });
    const warning = element<HTMLElement>('storage-warning');
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toContain('invalid or from a newer version');

    setValue('die-name', 'Safe Draft', 'input');
    click('save-die');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(element('#toast').textContent).toContain('left untouched');
  });

  it('warns when local storage is unavailable during initialization', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await boot();

    expect(element('#storage-warning').textContent).toContain('Local storage is unavailable');
    expect(element('#storage-warning').hidden).toBe(false);
  });

  it('reports a storage write failure without claiming the die was saved', async () => {
    await boot();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    setValue('die-name', 'Full Storage', 'input');
    click('save-die');

    expect(element('#storage-warning').textContent).toContain('out of local storage space');
    expect(element('#toast').textContent).toContain('out of local storage space');
    expect(document.querySelector('.collection-chip')).toBeNull();
  });

  it('restores a supported theme and persists a new selection', async () => {
    await boot({ theme: 'gaming' });
    expect(document.documentElement.dataset.theme).toBe('gaming');
    expect(element<HTMLSelectElement>('theme-select').value).toBe('gaming');

    setValue('theme-select', 'fantasy');
    expect(document.documentElement.dataset.theme).toBe('fantasy');
    expect(window.localStorage.getItem('dice-atelier.theme.v1')).toBe('fantasy');
  });

  it('ignores an unknown saved theme and still applies the current surface selection', async () => {
    await boot({ theme: 'not-a-theme' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(element<HTMLSelectElement>('theme-select').value).toBe('ivory');

    const tableButtons = [...document.querySelectorAll<HTMLButtonElement>('.surface-button[data-surface="table"]')];
    tableButtons[0].click();
    expect(sceneHarness.instance!.setSurface).toHaveBeenCalledWith('table');
    expect(element('#stage').classList.contains('surface-table')).toBe(true);
    expect(element('#stage').classList.contains('surface-cloud')).toBe(false);
    expect(tableButtons[0].getAttribute('aria-pressed')).toBe('true');
    expect(tableButtons[1].getAttribute('aria-pressed')).toBe('false');
    expect([...document.querySelectorAll<HTMLButtonElement>('.surface-button[data-surface="cloud"]')]
      .every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('switches between play and design views using both view controls', async () => {
    await boot();
    click('design-toggle');

    expect(document.querySelector<HTMLElement>('.app-shell')?.dataset.view).toBe('design');
    expect(element('design-toggle').getAttribute('aria-label')).toBe('Return to the throw table');
    expect(sceneHarness.instance!.setView).toHaveBeenLastCalledWith('design');

    click('close-design');
    expect(document.querySelector<HTMLElement>('.app-shell')?.dataset.view).toBe('play');
    expect(element('design-toggle').getAttribute('aria-label')).toBe('Move left to the design table');
    expect(sceneHarness.instance!.setView).toHaveBeenLastCalledWith('play');
  });

  it('shows a cocked result without fabricating a score', async () => {
    await boot();
    click('add-to-hand');
    click('throw-button');
    sceneHarness.throwCalls[0].callback({ status: 'cocked' });

    expect(element('#result-title').textContent).toBe('A cocked throw.');
    expect(element('#result-status').textContent).toBe('UNSETTLED · NO SCORE');
    expect(element('.cocked-message').textContent).toContain('No score was recorded');
  });

  it('handles drag callbacks only after a throw snapshot exists and renders the dragged result', async () => {
    await boot();
    expect(sceneHarness.onDragStart!()).toBe(false);

    click('add-to-hand');
    click('throw-button');
    expect(sceneHarness.onDragStart!()).toBe(true);
    expect(element('#roll-overlay').hasAttribute('hidden')).toBe(false);
    sceneHarness.onDragComplete!({ status: 'settled', results: [[dieResult('Six', 6)]] });

    expect(element('#roll-overlay').hasAttribute('hidden')).toBe(true);
    expect(element('.total-row strong').textContent).toBe('6');
    expect(element('#result-status').textContent).toBe('RESTED · ACTUAL FACES');
  });

  it('reports a failed throw and restores hand controls', async () => {
    await boot();
    click('add-to-hand');
    sceneHarness.throwError = new Error('Physics could not start');
    click('throw-button');

    expect(element('#result-title').textContent).toBe('The table is quiet.');
    expect(element('#result-status').textContent).toBe('THROW FAILED');
    expect(element('#toast').textContent).toBe('Physics could not start');
    expect(element('#roll-overlay').hasAttribute('hidden')).toBe(true);
    expect(element<HTMLButtonElement>('throw-button').disabled).toBe(false);
  });

  it('keeps the editor usable and explains the fallback if the 3D scene is unavailable', async () => {
    sceneHarness.constructorError = new Error('WebGL unavailable');
    await boot();

    expect(element('#scene-fallback').hidden).toBe(false);
    expect(element('#storage-warning').textContent).toContain('WebGL unavailable');
    expect(element<HTMLButtonElement>('throw-button').disabled).toBe(true);
    setValue('die-name', 'Offline Die', 'input');
    click('save-die');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).items[0].name).toBe('Offline Die');
  });

  it('does not throw when asked to clear an already empty hand', async () => {
    await boot();
    click('clear-hand');
    expect(element('#hand-count').textContent).toBe('0 / 30');
    expect(element('#result-title').textContent).toBe('A moment before the roll');
    expect(element('.empty-result').textContent).toContain('Add a die to your hand');
  });

  it('expands shape choices, updates the die identity, and starts a fresh draft', async () => {
    await boot();
    const moreShapes = element<HTMLButtonElement>('more-shapes');
    moreShapes.click();

    expect(moreShapes.getAttribute('aria-expanded')).toBe('true');
    expect(element('[data-shape="d30"]')).not.toBeNull();
    element<HTMLButtonElement>('[data-shape="d4"]').click();
    expect(element<HTMLInputElement>('die-name').value).toBe('D4 in the making');
    expect(element('#stage-caption').textContent).toContain('D4 · made for the moment');

    setValue('label-style', 'roman');
    element<HTMLButtonElement>('[data-shape="d8"]').click();
    expect(element<HTMLInputElement>('die-name').value).toBe('D8 in the making');
    expect(element<HTMLTextAreaElement>('face-map').value.split('\n')[0]).toBe('I|1');

    setValue('die-name', 'A named relic', 'input');
    element<HTMLButtonElement>('[data-shape="d10"]').click();
    expect(element<HTMLInputElement>('die-name').value).toBe('A named relic');
    setValue('label-style', 'custom');
    element<HTMLButtonElement>('[data-shape="d6"]').click();
    expect(element<HTMLSelectElement>('label-style').value).toBe('arabic');
    expect(element<HTMLInputElement>('die-name').value).toBe('A named relic');

    moreShapes.click();
    expect(moreShapes.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-shape="d30"]')).toBeNull();
    click('new-die');
    expect(element<HTMLInputElement>('die-name').value).toBe('D6 in the making');
    expect(element<HTMLSelectElement>('quick-die').value).toBe('default:d6');
    expect(element('#stage-caption').textContent).toBe('Your next story starts here.');
  });

  it('keeps every curated shape selectable in the hand picker', async () => {
    await boot();
    element<HTMLButtonElement>('#more-shapes').click();
    element<HTMLButtonElement>('[data-shape="d14"]').click();

    expect(element<HTMLSelectElement>('quick-die').value).toBe('default:d14');
    click('add-to-hand');
    expect(element('.hand-item .hand-die-name strong').textContent).toBe('D14');
  });

  it('supports increment, decrement, group removal, stale controls, and clearing a populated hand', async () => {
    await boot();
    click('add-to-hand');
    let group = element<HTMLElement>('.hand-item');
    const increment = group.querySelector<HTMLButtonElement>('[aria-label="Add one D6"]')!;
    increment.click();
    expect(element('.hand-item .hand-die-name small').textContent).toBe('D6 · 2 in this group');

    element<HTMLButtonElement>('.hand-item [aria-label="Remove one D6"]').click();
    expect(element('.hand-item .hand-die-name small').textContent).toBe('D6 · 1 in this group');
    group = element<HTMLElement>('.hand-item');
    const staleIncrement = group.querySelector<HTMLButtonElement>('[aria-label="Add one D6"]')!;
    group.querySelector<HTMLButtonElement>('[aria-label="Remove one D6"]')!.click();
    expect(document.querySelector('.hand-item')).toBeNull();
    staleIncrement.click();
    expect(document.querySelector('.hand-item')).toBeNull();

    click('add-to-hand');
    element<HTMLButtonElement>('.remove-group').click();
    expect(element('#hand-count').textContent).toBe('0 / 30');
    click('add-to-hand');
    click('clear-hand');
    expect(element('#hand-count').textContent).toBe('0 / 30');
    expect(element('#result-title').textContent).toBe('A moment before the roll');
    expect(element('#clear-hand').hasAttribute('disabled')).toBe(true);
  });

  it('reports add-one capacity failures and safely handles a non-Error dependency failure', async () => {
    await boot();
    setValue('quick-quantity', '30', 'input');
    click('add-to-hand');
    const addOne = element<HTMLButtonElement>('.hand-item [aria-label="Add one D6"]');
    addOne.disabled = false;
    addOne.click();
    expect(element('#toast').textContent).toContain('limited to 30 dice');
    expect(element('#hand-count').textContent).toBe('30 / 30');

    await boot({ addOneError: 'unexpected dependency failure' });
    click('add-to-hand');
    element<HTMLButtonElement>('.hand-item [aria-label="Add one D6"]').click();
    expect(element('#toast').textContent).toBe('The hand is full.');
    expect(element('.hand-item .hand-die-name small').textContent).toBe('D6 · 1 in this group');
  });

  it('rejects a stale saved-die picker entry without losing the usable default die', async () => {
    await boot();
    const picker = element<HTMLSelectElement>('quick-die');
    const staleOption = document.createElement('option');
    staleOption.value = 'saved:xxd6';
    staleOption.textContent = 'Previously saved die';
    picker.append(staleOption);
    picker.value = staleOption.value;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    click('add-to-hand');

    expect(element('.hand-item .hand-die-name strong').textContent).toBe('D6');
    expect(element('#hand-count').textContent).toBe('1 / 30');
  });

  it('keeps face-map whitespace harmless and rejects blank labels and out-of-range scores', async () => {
    await boot();
    setValue('face-map', 'Ace|0\nTwo|2\nThree|3\nFour|4\nFive|5\nSix|6\n   ', 'input');
    click('apply-face-map');
    expect(element('#toast').textContent).toBe('Face labels and scoring values applied.');

    setValue('face-map', ' |1\nTwo|2\nThree|3\nFour|4\nFive|5\nSix|6', 'input');
    click('apply-face-map');
    expect(element('#toast').textContent).toBe('Line 1 has an invalid label or score.');
    setValue('face-map', 'Ace|1000001\nTwo|2\nThree|3\nFour|4\nFive|5\nSix|6', 'input');
    click('apply-face-map');
    expect(element('#toast').textContent).toBe('Line 1 has an invalid label or score.');
    expect(element<HTMLSelectElement>('label-style').value).toBe('custom');
    expect(element<HTMLTextAreaElement>('face-map').value.startsWith('Ace|1000001')).toBe(true);
  });

  it('formats fractional result scores and resets a completed throw when the hand is cleared', async () => {
    await boot();
    click('add-to-hand');
    click('throw-button');
    sceneHarness.throwCalls[0].callback({
      status: 'settled',
      results: [[dieResult('Half', 1.25)]],
    });
    expect(element('.face-pill').textContent).toBe('Half → 1.25');
    expect(element('.total-row strong').textContent).toBe('1.25');

    click('clear-hand');
    expect(element('#result-title').textContent).toBe('A moment before the roll');
    expect(element('#result-status').textContent).toBe('READY WHEN YOU ARE');
    expect(element('.empty-result').textContent).toContain('Add a die to your hand');
  });

  it('covers empty-name and defensive invalid-die save feedback', async () => {
    await boot();
    setValue('die-name', '', 'input');
    click('save-die');
    expect(element('#toast').textContent).toBe('Give your die a name before saving.');
    expect(document.activeElement).toBe(element('die-name'));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await boot({ invalidDie: true });
    setValue('die-name', 'Not accepted', 'input');
    click('save-die');
    expect(element('#toast').textContent).toBe('This die has an invalid face mapping and was not saved.');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('deletes a selected saved die and removes its group from the hand', async () => {
    const saved = createDie('d4', { id: 'to-delete', name: 'Temporary' });
    await boot({ collection: savedCollection([saved]) });
    element<HTMLButtonElement>('.collection-chip').click();
    const picker = element<HTMLSelectElement>('quick-die');
    picker.value = 'saved:to-delete';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    click('add-to-hand');
    click('delete-die');

    expect(element('#collection-count').textContent).toBe('00 PIECES');
    expect(document.querySelector('.collection-chip')).toBeNull();
    expect(element('#hand-count').textContent).toBe('0 / 30');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).items).toEqual([]);
    expect(element('#toast').textContent).toBe('Die removed from your local collection.');
  });

  it('ignores a delete action with no selected die', async () => {
    await boot();
    click('delete-die');
    expect(element('#collection-count').textContent).toBe('00 PIECES');
    expect(element('#toast').textContent).toBe('');
  });

  it('shows the non-Error fallback when the collection persistence adapter fails unusually', async () => {
    await boot({ saveError: 'storage adapter failed' });
    setValue('die-name', 'Unpersisted', 'input');
    click('save-die');
    expect(element('#storage-warning').textContent).toBe('This browser could not save your collection.');
    expect(element('#toast').textContent).toBe('This browser could not save your collection.');
  });

  it('saves a theme choice in the interface even when optional storage writes fail', async () => {
    await boot();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    setValue('theme-select', 'fantasy');
    expect(document.documentElement.dataset.theme).toBe('fantasy');
  });

  it('shows the storage warning if obtaining localStorage itself throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    try {
      document.body.innerHTML = bodyMarkup.innerHTML;
      vi.resetModules();
      vi.doMock('../src/scene', () => ({ DiceScene: MockScene }));
      await import('../src/main');
      expect(element('#storage-warning').textContent).toContain('Local storage is unavailable');
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('reports scene-unavailable and empty-hand throw attempts, and blocks re-entrant throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sceneHarness.constructorError = new Error('WebGL unavailable');
    await boot();
    element<HTMLButtonElement>('throw-button').disabled = false;
    click('throw-button');
    expect(element('#toast').textContent).toBe('3D rendering is unavailable on this device.');

    sceneHarness.constructorError = null;
    await boot();
    element<HTMLButtonElement>('throw-button').disabled = false;
    click('throw-button');
    expect(sceneHarness.throwCalls).toHaveLength(0);
    expect(element('#result-title').textContent).toBe('A moment before the roll');
    click('add-to-hand');
    click('throw-button');
    element<HTMLButtonElement>('throw-button').disabled = false;
    click('throw-button');
    expect(sceneHarness.throwCalls).toHaveLength(1);
    expect(element('#result-title').textContent).toBe('The dice are in motion.');
  });

  it('uses the generic throw-failure message for a non-Error thrown value', async () => {
    await boot();
    click('add-to-hand');
    sceneHarness.throwError = 'physics failed';
    click('throw-button');
    expect(element('#toast').textContent).toBe('The physics simulation could not start.');
    expect(element('#result-status').textContent).toBe('THROW FAILED');
  });

  it('emits a cocked drag completion when no throw snapshot exists and disposes the scene on pagehide', async () => {
    await boot();
    sceneHarness.onDragComplete!({ status: 'settled', results: [] });
    expect(element('#result-title').textContent).toBe('A cocked throw.');

    window.dispatchEvent(new Event('pagehide'));
    expect(sceneHarness.instance!.dispose).toHaveBeenCalledOnce();
  });

  it('covers both label preset paths and skips scene redraw while a throw is in progress', async () => {
    const saved = createDie('d6', { id: 'preset-die', name: 'Preset Die' });
    await boot({ collection: savedCollection([saved]) });
    element<HTMLButtonElement>('.collection-chip').click();
    const showDieCount = sceneHarness.instance!.showDie.mock.calls.length;
    setValue('label-style', 'roman');
    expect(element<HTMLTextAreaElement>('face-map').value.split('\n')[0]).toBe('I|1');
    expect(sceneHarness.instance!.showDie.mock.calls.length).toBeGreaterThan(showDieCount);

    click('add-to-hand');
    click('throw-button');
    const rollingShowDieCount = sceneHarness.instance!.showDie.mock.calls.length;
    setValue('label-style', 'arabic');
    expect(sceneHarness.instance!.showDie.mock.calls.length).toBe(rollingShowDieCount);
    expect(element<HTMLSelectElement>('label-style').value).toBe('arabic');
    sceneHarness.throwCalls[0].callback({ status: 'cocked' });
  });

  it('hides transient toast feedback after its announced interval', async () => {
    vi.useFakeTimers();
    await boot();
    setValue('die-name', 'Timed Toast', 'input');
    click('save-die');
    expect(element('#toast').classList.contains('visible')).toBe(true);
    vi.advanceTimersByTime(2600);
    expect(element('#toast').classList.contains('visible')).toBe(false);
  });

  it('fails initialization clearly when required page markup is missing', async () => {
    await expect(boot({ omitElement: 'shape-grid' })).rejects.toThrow('Missing interface element: #shape-grid');
  });

  it('updates and announces transparency, iridescence, and face treatment selections', async () => {
    await boot();
    setValue('transparency', '42', 'input');
    setValue('iridescence', '73', 'input');
    setValue('treatment', 'embossed');

    expect(element('#transparency-output').textContent).toBe('42%');
    expect(element('#iridescence-output').textContent).toBe('73%');
    expect(sceneHarness.instance!.showDie).toHaveBeenLastCalledWith(expect.objectContaining({
      transparency: 42, iridescence: 73, treatment: 'embossed',
    }));
  });

  it('renders an available increment control for a d100 without exceeding physical capacity', async () => {
    await boot();
    setValue('quick-die', 'default:d100');
    click('add-to-hand');
    expect(element('#hand-summary').textContent).toBe('1 die · 2 physical bodies');
    expect(element<HTMLButtonElement>('.hand-item [aria-label="Add one D100"]').disabled).toBe(false);
  });

  it('leaves other groups unchanged when decrementing one of several groups', async () => {
    await boot();
    setValue('quick-quantity', '2', 'input');
    click('add-to-hand');
    setValue('quick-die', 'default:d4');
    setValue('quick-quantity', '1', 'input');
    click('add-to-hand');

    element<HTMLButtonElement>('.hand-item button[aria-label="Remove one D6"]').click();
    expect(document.querySelectorAll('.hand-item')).toHaveLength(2);
    expect(document.querySelectorAll('.hand-item .hand-die-name small')[0].textContent).toBe('D6 · 1 in this group');
    expect(document.querySelectorAll('.hand-item .hand-die-name small')[1].textContent).toBe('D4 · 1 in this group');
  });

  it('falls back to a safe message if bulk addition throws a non-Error value', async () => {
    await boot({ addManyError: new Error('bulk add rejected') });
    click('add-to-hand');
    expect(element('#toast').textContent).toBe('bulk add rejected');
    expect(document.querySelector('.hand-item')).toBeNull();

    await boot({ addManyError: 'unexpected bulk-add failure' });
    click('add-to-hand');
    expect(element('#toast').textContent).toBe('Your hand is full.');
    expect(document.querySelector('.hand-item')).toBeNull();
  });

  it('ignores a saved-die selection that disappears while the editor is open', async () => {
    const sharedItems = [createDie('d6', { id: 'external-delete', name: 'External Die' })];
    await boot({ collectionItems: sharedItems });
    element<HTMLButtonElement>('.collection-chip').click();
    sharedItems.splice(0, 1);

    setValue('die-color', '#334455', 'input');
    expect(document.querySelector('.collection-chip')).toBeNull();
    setValue('label-style', 'roman');
    expect(element<HTMLSelectElement>('label-style').value).toBe('roman');
    expect(element<HTMLTextAreaElement>('face-map').value.split('\n')[0]).toBe('I|1');
  });

  it('does not redraw the preview when resetting or editing the die mid-throw', async () => {
    await boot();
    click('add-to-hand');
    click('throw-button');
    const rendersBefore = sceneHarness.instance!.showDie.mock.calls.length;
    setValue('die-color', '#445566', 'input');
    expect(sceneHarness.instance!.showDie.mock.calls.length).toBe(rendersBefore);
    click('new-die');
    expect(sceneHarness.instance!.showDie.mock.calls.length).toBe(rendersBefore);
    sceneHarness.throwCalls[0].callback({ status: 'cocked' });
  });

  it('lets the view toggle return to play after opening design', async () => {
    await boot();
    click('design-toggle');
    expect(document.querySelector<HTMLElement>('.app-shell')?.dataset.view).toBe('design');
    click('design-toggle');
    expect(document.querySelector<HTMLElement>('.app-shell')?.dataset.view).toBe('play');
    expect(sceneHarness.instance!.setView).toHaveBeenLastCalledWith('play');
  });

  it('adds a new die without disturbing unrelated saved dice', async () => {
    const unrelated = createDie('d4', { id: 'keep-this', name: 'Keep This' });
    await boot({ collection: savedCollection([unrelated]) });
    setValue('die-name', 'New Addition', 'input');
    click('save-die');

    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { items: DieConfig[] };
    expect(data.items).toHaveLength(2);
    expect(data.items[0].id).toBe('keep-this');
    expect(data.items[1].name).toBe('New Addition');
  });

  it('uses the initialization fallback when the scene throws a non-Error value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sceneHarness.constructorError = 'no rendering context';
    await boot();
    expect(element('#scene-fallback').hidden).toBe(false);
    expect(element('#storage-warning').textContent).toContain('3D rendering could not start');
    expect(element('#storage-warning').textContent).not.toContain('no rendering context');
  });
});
