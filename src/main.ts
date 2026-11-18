import './style.css';
import {
  addManyToHand, addToHand, computeBreakdown, createDie, defaultFaces, handCapacity, MAX_LOGICAL_DICE, MAX_PHYSICAL_BODIES,
  outcomesForShape, validateDie, type DieConfig, type FaceDefinition, type HandGroup, type HandSnapshot, type LabelStyle, type ShapeId,
} from './model';
import { loadCollection, saveCollection } from './storage';
import { DiceScene } from './scene';

const $ = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element: #${id}`);
  return element as T;
};

const shapeButtons = $('shape-grid');
const collectionElement = $('collection');
const handList = $('hand-list');
const stage = $('stage');
const fallback = $('scene-fallback');
const rollOverlay = $('roll-overlay');
const toast = $('toast');
const warning = $('storage-warning');
const labelSelect = $('label-style') as HTMLSelectElement;
const faceMap = $('face-map') as HTMLTextAreaElement;
const customFaces = $('custom-faces') as HTMLDetailsElement;
const appShell = document.querySelector<HTMLElement>('.app-shell')!;
const resultPanel = $('results');
const resultDetails = $('result-details') as HTMLDetailsElement;
const resultChips = $('result-chips');
const resultTotal = $('result-total');

const popularShapes: ShapeId[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const otherShapes: ShapeId[] = ['d2', 'd3', 'd5', 'd7', 'd14', 'd16', 'd24', 'd30'];
const shapeTitles: Record<ShapeId, string> = {
  d2: 'd2', d3: 'd3', d4: 'd4', d5: 'd5', d6: 'd6', d7: 'd7', d8: 'd8', d10: 'd10',
  d12: 'd12', d14: 'd14', d16: 'd16', d20: 'd20', d24: 'd24', d30: 'd30', d100: 'd100',
};

let collection: DieConfig[] = [];
let currentDie = createDie('d6');
let selectedId: string | null = null;
let hand: HandGroup[] = [];
let showMore = false;
let storageBlocked = false;
let rolling = false;
let scene: DiceScene | null = null;
let toastTimer = 0;
let resultTimer = 0;
const quickDice = new Map<ShapeId, DieConfig>();
let lastSnapshot: HandSnapshot | null = null;
type FlickImpulse = { x: number; z: number; spin: number };

function snapshotHand(): HandSnapshot {
  return structuredClone({
    groups: hand,
    multiplier: Number(($('hand-multiplier') as HTMLSelectElement).value),
    offset: Number(($('hand-offset') as HTMLSelectElement).value),
  });
}

function stageCurrentHand(): void {
  if (rolling || appShell.dataset.view === 'design') return;
  lastSnapshot = null;
  scene?.stageHand(snapshotHand());
}

function previewCurrentDie(): void {
  if (!rolling && appShell.dataset.view === 'design') scene?.showDie(currentDie);
}

function showResults(): void {
  resultPanel.hidden = false;
  resultPanel.dataset.state = 'active';
  resultPanel.classList.remove('is-quiet');
  window.clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => {
    resultPanel.dataset.state = 'quiet';
    resultPanel.classList.add('is-quiet');
  }, 6500);
}

function showPendingResults(): void {
  resultDetails.open = false;
  resultChips.replaceChildren();
  resultTotal.textContent = 'Rolling…';
  $('result-content').replaceChildren();
  showResults();
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function setWarning(message?: string): void {
  warning.hidden = !message;
  warning.textContent = message ?? '';
}

function loadSavedCollection(): void {
  try {
    const result = loadCollection(window.localStorage);
    collection = result.items;
    if (result.status === 'invalid') {
      storageBlocked = true;
      setWarning('Saved collection data is invalid or from a newer version. It has been left untouched; this session will not overwrite it.');
    } else if (result.status === 'unavailable') {
      setWarning('Local storage is unavailable in this browser. You can create dice for this session, but they may not be saved.');
    }
  } catch {
    setWarning('Local storage is unavailable in this browser. You can create dice for this session, but they may not be saved.');
  }
}

function persistCollection(): boolean {
  if (storageBlocked) {
    showToast('Saved data was left untouched. Resolve the saved-data issue before replacing it.');
    return false;
  }
  try {
    saveCollection(window.localStorage, collection);
    setWarning();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This browser could not save your collection.';
    setWarning(message);
    showToast(message);
    return false;
  }
}

function renderCollection(): void {
  collectionElement.replaceChildren();
  $('collection-count').textContent = `${String(collection.length).padStart(2, '0')} PIECES`;
  renderQuickPicker();
  if (!collection.length) {
    const empty = document.createElement('span');
    empty.className = 'collection-empty';
    empty.textContent = 'A blank canvas, for now.';
    collectionElement.append(empty);
    return;
  }
  for (const die of collection) {
    const button = document.createElement('button');
    button.className = 'collection-chip';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(die.id === selectedId));
    button.title = `Edit ${die.name}`;
    const swatch = document.createElement('span');
    swatch.className = 'chip-swatch';
    swatch.style.backgroundColor = die.color;
    const name = document.createElement('span');
    name.textContent = die.name;
    button.append(swatch, name);
    button.addEventListener('click', () => selectDie(die));
    collectionElement.append(button);
  }
}

function renderQuickPicker(): void {
  const options = $('saved-die-options');
  options.replaceChildren();
  for (const die of collection) {
    const option = document.createElement('option');
    option.value = `saved:${die.id}`;
    option.textContent = `${die.name} · ${die.shape.toUpperCase()}`;
    options.append(option);
  }
  const picker = $('quick-die') as HTMLSelectElement;
  const savedValue = selectedId ? `saved:${selectedId}` : '';
  picker.value = savedValue && collection.some(die => `saved:${die.id}` === savedValue) ? savedValue : `default:${currentDie.shape}`;
}

function getQuickDie(): DieConfig {
  const selection = ($('quick-die') as HTMLSelectElement).value;
  if (selection.startsWith('saved:')) {
    const saved = collection.find(die => die.id === selection.slice(6));
    if (saved) return saved;
  }
  const shape = selection.slice('default:'.length) as ShapeId;
  if (!quickDice.has(shape)) quickDice.set(shape, createDie(shape, { id: `quick-${shape}`, name: shape.toUpperCase() }));
  return quickDice.get(shape)!;
}

function drawShapeButtons(): void {
  shapeButtons.replaceChildren();
  const choices = showMore ? [...popularShapes, ...otherShapes] : popularShapes;
  for (const shape of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shape-button';
    button.dataset.shape = shape;
    button.setAttribute('aria-pressed', String(currentDie.shape === shape));
    const title = document.createElement('strong');
    title.textContent = shapeTitles[shape];
    const category = document.createElement('small');
    category.textContent = shape === 'd100' ? 'PERCENTILE' : shape === 'd20' ? 'CLASSIC' : 'FACETS';
    button.append(title, category);
    button.addEventListener('click', () => changeShape(shape));
    shapeButtons.append(button);
  }
  const moreButton = $('more-shapes');
  moreButton.setAttribute('aria-expanded', String(showMore));
  moreButton.querySelector('span')!.textContent = showMore ? '−' : '＋';
  moreButton.firstChild!.textContent = showMore ? 'Fewer shapes ' : 'More shapes ';
}

function setFaceEditor(): void {
  faceMap.value = currentDie.faces.map(face => `${face.label}|${face.score}`).join('\n');
}

function fillEditor(): void {
  ($('die-name') as HTMLInputElement).value = currentDie.name;
  ($('die-color') as HTMLInputElement).value = currentDie.color;
  ($('die-material') as HTMLSelectElement).value = currentDie.material;
  ($('die-size') as HTMLInputElement).value = String(Math.round(currentDie.size * 100));
  ($('transparency') as HTMLInputElement).value = String(currentDie.transparency);
  ($('iridescence') as HTMLInputElement).value = String(currentDie.iridescence);
  ($('treatment') as HTMLSelectElement).value = currentDie.treatment;
  labelSelect.value = currentDie.labelStyle;
  customFaces.open = currentDie.labelStyle === 'custom';
  setFaceEditor();
  $('delete-die').toggleAttribute('hidden', !selectedId);
  $('save-die').innerHTML = selectedId ? 'Update your die <span>↗</span>' : 'Save to collection <span>↗</span>';
  $('transparency-output').textContent = `${currentDie.transparency}%`;
  $('iridescence-output').textContent = `${currentDie.iridescence}%`;
  $('size-output').textContent = `${Math.round(currentDie.size * 100)}%`;
  drawShapeButtons();
  renderCollection();
  previewCurrentDie();
  updateHandControls();
}

function selectDie(die: DieConfig): void {
  currentDie = structuredClone(die);
  selectedId = die.id;
  fillEditor();
  $('stage-caption').textContent = `${die.name} · a little piece of your imagination.`;
  $('add-to-hand').removeAttribute('disabled');
}

function changeShape(shape: ShapeId): void {
  const previous = currentDie;
  const style = previous.labelStyle === 'custom' ? 'arabic' : previous.labelStyle;
  const name = /^D\d+ in the making$/i.test(previous.name) ? `${shape.toUpperCase()} in the making` : previous.name;
  currentDie = { ...previous, name, shape, faces: defaultFaces(shape, style), labelStyle: style };
  selectedId = null;
  fillEditor();
  $('stage-caption').textContent = `${shape.toUpperCase()} · made for the moment.`;
}

function updateDie(update: (die: DieConfig) => DieConfig, redraw = true): void {
  currentDie = update(currentDie);
  if (selectedId) {
    const currentIndex = collection.findIndex(die => die.id === selectedId);
    if (currentIndex >= 0) collection[currentIndex] = structuredClone(currentDie);
  }
  if (redraw) {
    drawShapeButtons();
    renderCollection();
    previewCurrentDie();
  }
}

function renderHand(): void {
  handList.replaceChildren();
  if (!hand.length) {
    const empty = document.createElement('p');
    empty.className = 'hand-empty';
    empty.textContent = 'A handful of possibility. Add any die to begin.';
    handList.append(empty);
  }
  for (const group of hand) {
    const card = document.createElement('article');
    card.className = 'hand-item';
    const head = document.createElement('div');
    head.className = 'hand-item-head';
    const swatch = document.createElement('span');
    swatch.className = 'chip-swatch';
    swatch.style.backgroundColor = group.die.color;
    const nameBox = document.createElement('div');
    nameBox.className = 'hand-die-name';
    const name = document.createElement('strong');
    name.textContent = group.die.name;
    const meta = document.createElement('small');
    meta.textContent = `${group.die.shape.toUpperCase()} · ${group.quantity} in this group`;
    nameBox.append(name, meta);
    const quantity = document.createElement('div');
    quantity.className = 'quantity-control';
    const decrement = document.createElement('button');
    decrement.type = 'button';
    decrement.textContent = '−';
    decrement.setAttribute('aria-label', `Remove one ${group.die.name}`);
    decrement.addEventListener('click', () => changeQuantity(group.die.id, -1));
    const amount = document.createElement('span');
    amount.textContent = String(group.quantity);
    const increment = document.createElement('button');
    increment.type = 'button';
    increment.textContent = '+';
    increment.disabled = !handCapacity(hand).canAdd || handCapacity(hand).physical + (group.die.shape === 'd100' ? 2 : 1) > MAX_PHYSICAL_BODIES;
    increment.setAttribute('aria-label', `Add one ${group.die.name}`);
    increment.addEventListener('click', () => changeQuantity(group.die.id, 1));
    quantity.append(decrement, amount, increment);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-group';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${group.die.name} group`);
    remove.addEventListener('click', () => {
      hand = hand.filter(item => item.die.id !== group.die.id);
      renderHand();
    });
    head.append(swatch, nameBox, quantity, remove);

    const controls = document.createElement('details');
    controls.className = 'group-controls';
    const summary = document.createElement('summary');
    summary.textContent = 'Group modifier';
    const modifiers = document.createElement('div');
    modifiers.className = 'group-modifiers';
    modifiers.append(
      makeModifierSelect(`Multiplier`, group.multiplier, ['1', '2', '4'], value => setGroupModifier(group.die.id, 'multiplier', Number(value))),
      makeModifierSelect(`Offset`, group.offset, ['0', '2', '-1'], value => setGroupModifier(group.die.id, 'offset', Number(value))),
    );
    controls.append(summary, modifiers);
    card.append(head, controls);
    handList.append(card);
  }
  updateHandControls();
  stageCurrentHand();
}

function makeModifierSelect(label: string, value: number, options: string[], callback: (value: string) => void): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const select = document.createElement('select');
  select.setAttribute('aria-label', `${label} for this group`);
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option;
    element.textContent = label === 'Multiplier' ? `× ${option}` : `${Number(option) < 0 ? '−' : '+'} ${Math.abs(Number(option))}`;
    element.selected = Number(option) === value;
    select.append(element);
  }
  select.addEventListener('change', () => callback(select.value));
  wrapper.append(select);
  return wrapper;
}

function setGroupModifier(id: string, property: 'multiplier' | 'offset', value: number): void {
  hand = hand.map(group => group.die.id === id ? { ...group, [property]: value } : group);
  renderHand();
}

function changeQuantity(id: string, change: number): void {
  const group = hand.find(item => item.die.id === id);
  if (!group) return;
  if (change > 0) {
    try {
      hand = addToHand(hand, group.die);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The hand is full.');
    }
  } else if (group.quantity <= 1) {
    hand = hand.filter(item => item.die.id !== id);
  } else {
    hand = hand.map(item => item.die.id === id ? { ...item, quantity: item.quantity - 1 } : item);
  }
  renderHand();
}

function updateHandControls(): void {
  const capacity = handCapacity(hand);
  const selectedDie = getQuickDie();
  const quantityInput = $('quick-quantity') as HTMLInputElement;
  const availableByLogical = MAX_LOGICAL_DICE - capacity.logical;
  const availableByPhysical = Math.floor((MAX_PHYSICAL_BODIES - capacity.physical) / (selectedDie.shape === 'd100' ? 2 : 1));
  const maximumQuantity = Math.max(0, Math.min(availableByLogical, availableByPhysical));
  quantityInput.max = String(maximumQuantity);
  if (maximumQuantity > 0 && Number(quantityInput.value) > maximumQuantity) quantityInput.value = String(maximumQuantity);
  const quantity = Number(quantityInput.value);
  $('hand-count').textContent = `${capacity.logical} / ${MAX_LOGICAL_DICE}`;
  ($('add-to-hand') as HTMLButtonElement).disabled = rolling || maximumQuantity === 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > maximumQuantity;
  ($('throw-button') as HTMLButtonElement).disabled = !hand.length || rolling;
  ($('clear-hand') as HTMLButtonElement).disabled = !hand.length || rolling;
  const summary = hand.length
    ? `${capacity.logical} ${capacity.logical === 1 ? 'die' : 'dice'} · ${capacity.physical} physical ${capacity.physical === 1 ? 'body' : 'bodies'}`
    : 'Your hand is waiting for its first die.';
  $('hand-summary').textContent = summary;
}

function formatNumber(number: number): string {
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function renderResults(snapshot: HandSnapshot, faces: FaceDefinition[][]): void {
  const results = faces.map((group, index) => group.map(face => ({ ...face, dieName: snapshot.groups[index].die.name })));
  const breakdown = computeBreakdown(snapshot.groups, snapshot.multiplier, snapshot.offset, results);
  resultDetails.open = false;
  resultChips.replaceChildren();
  resultTotal.textContent = `Total ${formatNumber(breakdown.total)}`;
  const content = $('result-content');
  content.replaceChildren();
  const groupList = document.createElement('div');
  groupList.className = 'result-groups';
  breakdown.groups.forEach((group, index) => {
    const card = document.createElement('article');
    card.className = 'result-group';
    const heading = document.createElement('div');
    heading.className = 'result-group-head';
    const die = document.createElement('strong');
    die.textContent = `${snapshot.groups[index].quantity} × ${group.name}`;
    const subtotal = document.createElement('span');
    subtotal.textContent = `Faces subtotal ${formatNumber(group.subtotal)}`;
    heading.append(die, subtotal);
    const pills = document.createElement('div');
    pills.className = 'face-pills';
    group.faces.forEach(face => {
      const pill = document.createElement('span');
      pill.className = 'face-pill';
      pill.textContent = `${face.label} → ${formatNumber(face.score)}`;
      pill.title = `Face label ${face.label}; scoring value ${formatNumber(face.score)}`;
      pills.append(pill);
      resultChips.append(pill.cloneNode(true));
    });
    const math = document.createElement('div');
    math.className = 'group-math';
    math.textContent = `${formatNumber(group.subtotal)} × ${formatNumber(group.multiplier)} ${group.offset < 0 ? '−' : '+'} ${formatNumber(Math.abs(group.offset))} = ${formatNumber(group.adjusted)}`;
    card.append(heading, pills, math);
    groupList.append(card);
  });
  const total = document.createElement('div');
  total.className = 'total-row';
  const label = document.createElement('span');
  label.textContent = `${formatNumber(breakdown.groupSum)} × ${formatNumber(breakdown.multiplier)} ${breakdown.offset < 0 ? '−' : '+'} ${formatNumber(Math.abs(breakdown.offset))}`;
  const amount = document.createElement('strong');
  amount.textContent = formatNumber(breakdown.total);
  amount.setAttribute('aria-label', `Total score ${formatNumber(breakdown.total)}`);
  total.append(label, amount);
  groupList.append(total);
  content.append(groupList);
  $('result-title').textContent = 'The table has spoken.';
  $('result-status').textContent = 'RESTED · ACTUAL FACES';
  showResults();
}

function showCocked(): void {
  resultDetails.open = false;
  resultChips.replaceChildren();
  resultTotal.textContent = 'No score';
  const content = $('result-content');
  content.replaceChildren();
  const message = document.createElement('p');
  message.className = 'cocked-message';
  message.textContent = 'One or more dice stayed unsettled. No score was recorded. Clear a little space and throw again.';
  content.append(message);
  $('result-title').textContent = 'A cocked throw.';
  $('result-status').textContent = 'UNSETTLED · NO SCORE';
  showResults();
}

function throwHand(impulse?: FlickImpulse): void {
  if (!scene || !hand.length || rolling) {
    if (!scene) showToast('3D rendering is unavailable on this device.');
    return;
  }
  const snapshot = snapshotHand();
  lastSnapshot = snapshot;
  rolling = true;
  rollOverlay.hidden = false;
  $('roll-status').textContent = 'The dice are finding their feet…';
  updateHandControls();
  showPendingResults();
  $('result-title').textContent = 'The dice are in motion.';
  $('result-status').textContent = 'READING THE TABLE…';
  try {
    scene.throw(snapshot, result => {
      rolling = false;
      rollOverlay.hidden = true;
      updateHandControls();
      if (result.status === 'cocked') showCocked();
      else renderResults(snapshot, result.results);
    }, impulse);
  } catch (error) {
    rolling = false;
    rollOverlay.hidden = true;
    updateHandControls();
    const message = error instanceof Error ? error.message : 'The physics simulation could not start.';
    showToast(message);
    resultTotal.textContent = 'Throw failed';
    $('result-title').textContent = 'The table is quiet.';
    $('result-status').textContent = 'THROW FAILED';
  }
}

function bindEvents(): void {
  resultPanel.addEventListener('pointerenter', showResults);
  resultPanel.addEventListener('focusin', showResults);
  resultPanel.addEventListener('pointerdown', showResults);
  resultDetails.querySelector('summary')!.addEventListener('click', showResults);
  $('new-die').addEventListener('click', () => {
    currentDie = createDie('d6');
    selectedId = null;
    fillEditor();
    $('stage-caption').textContent = 'Your next story starts here.';
    ($('quick-die') as HTMLSelectElement).value = 'default:d6';
  });
  $('more-shapes').addEventListener('click', () => {
    showMore = !showMore;
    drawShapeButtons();
  });
  $('die-name').addEventListener('input', event => updateDie(die => ({ ...die, name: (event.currentTarget as HTMLInputElement).value.slice(0, 32) }), false));
  $('die-color').addEventListener('input', event => updateDie(die => ({ ...die, color: (event.currentTarget as HTMLInputElement).value }), true));
  $('die-material').addEventListener('change', event => updateDie(die => ({ ...die, material: (event.currentTarget as HTMLSelectElement).value as DieConfig['material'] }), true));
  $('die-size').addEventListener('input', event => {
    const size = Number((event.currentTarget as HTMLInputElement).value) / 100;
    updateDie(die => ({ ...die, size }), true);
    $('size-output').textContent = `${Math.round(size * 100)}%`;
  });
  $('transparency').addEventListener('input', event => {
    const transparency = Number((event.currentTarget as HTMLInputElement).value);
    updateDie(die => ({ ...die, transparency }), true);
    $('transparency-output').textContent = `${transparency}%`;
  });
  $('iridescence').addEventListener('input', event => {
    const iridescence = Number((event.currentTarget as HTMLInputElement).value);
    updateDie(die => ({ ...die, iridescence }), true);
    $('iridescence-output').textContent = `${iridescence}%`;
  });
  $('treatment').addEventListener('change', event => updateDie(die => ({ ...die, treatment: (event.currentTarget as HTMLSelectElement).value as DieConfig['treatment'] }), true));
  labelSelect.addEventListener('change', () => {
    const style = labelSelect.value as LabelStyle;
    if (style === 'custom') {
      currentDie = { ...currentDie, labelStyle: style };
    } else {
      const generated = defaultFaces(currentDie.shape, style);
      currentDie = { ...currentDie, labelStyle: style, faces: currentDie.faces.map((face, index) => ({ ...face, label: generated[index].label })) };
    }
    if (selectedId) {
      const index = collection.findIndex(die => die.id === selectedId);
      if (index >= 0) collection[index] = structuredClone(currentDie);
    }
    customFaces.open = style === 'custom';
    setFaceEditor();
    previewCurrentDie();
    renderCollection();
  });
  $('apply-face-map').addEventListener('click', () => {
    const lines = faceMap.value.split(/\r?\n/);
    const expected = outcomesForShape(currentDie);
    const parsed: FaceDefinition[] = [];
    for (const [index, rawLine] of lines.entries()) {
      if (!rawLine.trim()) continue;
      const splitAt = rawLine.lastIndexOf('|');
      if (splitAt < 1) {
        showToast(`Line ${index + 1} needs a label|score pair.`);
        return;
      }
      const label = rawLine.slice(0, splitAt).trim();
      const score = Number(rawLine.slice(splitAt + 1).trim());
      if (!label || label.length > 8 || !Number.isFinite(score) || Math.abs(score) > 1_000_000) {
        showToast(`Line ${index + 1} has an invalid label or score.`);
        return;
      }
      parsed.push({ label, score });
    }
    if (parsed.length !== expected) {
      showToast(`Add exactly ${expected} face lines before applying this mapping.`);
      return;
    }
    updateDie(die => ({ ...die, labelStyle: 'custom', faces: parsed }), true);
    labelSelect.value = 'custom';
    customFaces.open = true;
    showToast('Face labels and scoring values applied.');
  });
  $('save-die').addEventListener('click', () => {
    const nameInput = $('die-name') as HTMLInputElement;
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Give your die a name before saving.');
      nameInput.focus();
      return;
    }
    const id = selectedId ?? currentDie.id;
    const candidate: DieConfig = { ...currentDie, id, name };
    if (!validateDie(candidate)) {
      showToast('This die has an invalid face mapping and was not saved.');
      return;
    }
    const index = collection.findIndex(die => die.id === id);
    collection = index < 0 ? [...collection, candidate] : collection.map(die => die.id === id ? candidate : die);
    currentDie = structuredClone(candidate);
    selectedId = id;
    if (persistCollection()) {
      renderCollection();
      ($('quick-die') as HTMLSelectElement).value = `saved:${id}`;
      $('delete-die').removeAttribute('hidden');
      $('save-die').innerHTML = 'Update your die <span>↗</span>';
      showToast('Your die is saved in this browser.');
    }
  });
  $('delete-die').addEventListener('click', () => {
    if (!selectedId) return;
    const removed = selectedId;
    collection = collection.filter(die => die.id !== removed);
    hand = hand.filter(group => group.die.id !== removed);
    persistCollection();
    selectedId = null;
    currentDie = createDie(currentDie.shape);
    fillEditor();
    renderHand();
    showToast('Die removed from your local collection.');
  });
  $('add-to-hand').addEventListener('click', () => {
    const die = getQuickDie();
    const quantity = Number(($('quick-quantity') as HTMLInputElement).value);
    try {
      hand = addManyToHand(hand, die, quantity);
      renderHand();
      showToast(`${quantity} ${quantity === 1 ? 'die' : 'dice'} added to your hand.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Your hand is full.');
    }
  });
  $('clear-hand').addEventListener('click', () => {
    hand = [];
    lastSnapshot = null;
    renderHand();
    $('result-title').textContent = 'A moment before the roll';
    $('result-status').textContent = 'READY WHEN YOU ARE';
    $('result-content').innerHTML = '<span class="empty-result">Add a die to your hand, then let the table decide.</span>';
    window.clearTimeout(resultTimer);
    resultPanel.hidden = true;
  });
  $('throw-button').addEventListener('click', () => throwHand());
  $('hand-multiplier').addEventListener('change', () => {
    updateHandControls();
    stageCurrentHand();
  });
  $('hand-offset').addEventListener('change', () => {
    updateHandControls();
    stageCurrentHand();
  });
  $('quick-die').addEventListener('change', () => updateHandControls());
  $('quick-quantity').addEventListener('input', () => updateHandControls());
  $('theme-select').addEventListener('change', event => {
    const theme = (event.currentTarget as HTMLSelectElement).value;
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem('dice-atelier.theme.v1', theme); } catch { /* Theme choice is optional. */ }
  });
  document.querySelectorAll<HTMLButtonElement>('.surface-button').forEach(button => button.addEventListener('click', () => {
    const surface = button.dataset.surface as 'cloud' | 'table';
    scene?.setSurface(surface);
    stage.classList.toggle('surface-cloud', surface === 'cloud');
    stage.classList.toggle('surface-table', surface === 'table');
    document.querySelectorAll('.surface-button').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }));
  const setView = (view: 'play' | 'design') => {
    appShell.dataset.view = view;
    $('design-toggle').setAttribute('aria-label', view === 'play' ? 'Move left to the design table' : 'Return to the throw table');
    $('design-toggle').querySelector('small')!.textContent = view === 'play' ? 'DESIGN' : 'BACK';
    $('design-toggle').querySelector('span')!.textContent = view === 'play' ? '‹' : '›';
    $('design-toggle').setAttribute('aria-pressed', String(view === 'design'));
    scene?.setView(view);
    if (view === 'design') previewCurrentDie();
    else stageCurrentHand();
  };
  $('design-toggle').addEventListener('click', () => setView(appShell.dataset.view === 'design' ? 'play' : 'design'));
  $('close-design').addEventListener('click', () => setView('play'));
}

function initialize(): void {
  loadSavedCollection();
  renderCollection();
  drawShapeButtons();
  fillEditor();
  renderHand();
  bindEvents();
  try {
    scene = new DiceScene(stage);
    scene.setTableFlickCallback(impulse => throwHand(impulse));
    scene.setDragCallbacks(() => {
      if (!lastSnapshot) return false;
      rolling = true;
      rollOverlay.hidden = false;
      $('roll-status').textContent = 'A little flick, and away…';
      $('result-title').textContent = 'The dice are in motion.';
      $('result-status').textContent = 'READING THE TABLE…';
      showPendingResults();
      updateHandControls();
      return true;
    }, result => {
      rolling = false;
      rollOverlay.hidden = true;
      updateHandControls();
      if (result.status === 'cocked' || !lastSnapshot) showCocked();
      else renderResults(lastSnapshot, result.results);
    });
  } catch (error) {
    fallback.hidden = false;
    ($('throw-button') as HTMLButtonElement).disabled = true;
    const detail = error instanceof Error ? ` ${error.message}` : '';
    setWarning(`3D rendering could not start in this browser.${detail} Your collection editor is still available.`);
    console.error('Dice Atelier 3D scene failed to initialize:', error);
  }
  try {
    const theme = window.localStorage.getItem('dice-atelier.theme.v1');
    if (theme === 'ivory' || theme === 'gaming' || theme === 'fantasy') {
      document.documentElement.dataset.theme = theme;
      ($('theme-select') as HTMLSelectElement).value = theme;
    }
  } catch { /* The default theme works without storage. */ }
}

window.addEventListener('pagehide', () => scene?.dispose(), { once: true });
initialize();
