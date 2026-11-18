import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as model from '../src/model';
import { createDie, getPolyhedron, restingFaceIndex, type DieConfig, type FaceResult, type HandSnapshot } from '../src/model';
import { DiceScene } from '../src/scene';

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();

  class MockRenderer {
    readonly domElement = document.createElement('canvas');
    readonly shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly render = vi.fn((scene?: THREE.Scene, camera?: THREE.Camera) => {
      scene?.updateMatrixWorld(true);
      camera?.updateMatrixWorld(true);
    });
    readonly dispose = vi.fn();
  }

  class MockPMREMGenerator {
    fromEquirectangular() { return new actual.WebGLRenderTarget(16, 16); }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: MockRenderer, PMREMGenerator: MockPMREMGenerator };
});

interface MockRenderer {
  domElement: HTMLCanvasElement;
  setPixelRatio: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

interface SceneInternals {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: MockRenderer;
  dice: Array<{ body: CANNON.Body; mesh: THREE.Group; die: DieConfig; role: string; polyhedron: ReturnType<typeof getPolyhedron> }>;
  previewDie: THREE.Group | null;
  cameraTarget: THREE.Vector3;
  surface: string;
  view: string;
  finished: boolean;
  elapsed: number;
  previousTime: number;
  world: CANNON.World | null;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  animate: (time: number) => void;
  createPreview: () => void;
  finish: (result: { status: 'cocked' } | { status: 'settled'; results: FaceResult[][] }) => void;
  readResults: () => Array<Array<{ label: string; score: number; dieName: string }>> | null;
}

const scenes: DiceScene[] = [];
const observers: MockResizeObserver[] = [];
const renderedCanvasText: string[] = [];
const renderedCanvasInk: Array<string | CanvasGradient | CanvasPattern> = [];
let reduceMotion = true;
let frameCallbacks: Map<number, FrameRequestCallback> | undefined;
let nextFrameId: number;
let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

class MockResizeObserver {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function sceneState(scene: DiceScene): SceneInternals {
  return scene as unknown as SceneInternals;
}

function snapshot(die: DieConfig, quantity = 1): HandSnapshot {
  return { groups: [{ die, quantity, multiplier: 1, offset: 0 }], multiplier: 1, offset: 0 };
}

function makeHost(width = 800, height = 600): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  document.body.append(host);
  return host;
}

function createScene(width?: number, height?: number): DiceScene {
  const scene = new DiceScene(makeHost(width, height));
  scenes.push(scene);
  return scene;
}

function faceNormals(shape: DieConfig['shape']): [number, number, number][] {
  const { vertices, faces } = getPolyhedron(shape);
  return faces.map(face => {
    const [a, b, c] = face.slice(0, 3).map(index => vertices[index]);
    const ab = new CANNON.Vec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new CANNON.Vec3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const normal = ab.cross(ac).unit();
    if (normal.dot(new CANNON.Vec3(a[0], a[1], a[2])) < 0) normal.negate(normal);
    return [normal.x, normal.y, normal.z];
  });
}

function setPointerBounds(canvas: HTMLCanvasElement): void {
  canvas.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const capturedPointers = new Set<number>();
  canvas.setPointerCapture = vi.fn(pointerId => { capturedPointers.add(pointerId); });
  canvas.hasPointerCapture = vi.fn(pointerId => capturedPointers.has(pointerId));
  canvas.releasePointerCapture = vi.fn(pointerId => { capturedPointers.delete(pointerId); });
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function screenCenter(state: SceneInternals, canvas: HTMLCanvasElement): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  const projected = state.dice[0].mesh.position.clone().project(state.camera);
  return {
    x: bounds.left + ((projected.x + 1) / 2) * bounds.width,
    y: bounds.top + ((1 - projected.y) / 2) * bounds.height,
  };
}

function installAnimationFrames(): (time: number) => number {
  frameCallbacks = new Map();
  nextFrameId = 1;
  originalRequestAnimationFrame = window.requestAnimationFrame;
  originalCancelAnimationFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = callback => {
    const id = nextFrameId++;
    frameCallbacks!.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => { frameCallbacks!.delete(id); };
  return (time: number) => {
    const next = frameCallbacks!.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) return 0;
    frameCallbacks!.delete(next[0]);
    next[1](time);
    return frameCallbacks!.size;
  };
}

function canvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(function (this: CanvasRenderingContext2D, text: string) {
      renderedCanvasText.push(text);
      renderedCanvasInk.push(this.fillStyle);
    }),
    strokeText: vi.fn((text: string) => { renderedCanvasText.push(text); }),
  } as unknown as CanvasRenderingContext2D;
}

function useDeterministicRandom(seed = 17): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  });
}

beforeEach(() => {
  observers.length = 0;
  renderedCanvasText.length = 0;
  renderedCanvasInk.length = 0;
  reduceMotion = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: reduceMotion, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: MockResizeObserver,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext());
});

afterEach(() => {
  scenes.splice(0).forEach(scene => scene.dispose());
  document.body.replaceChildren();
  if (frameCallbacks) {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  }
  vi.restoreAllMocks();
});

describe('DiceScene browser lifecycle and presentation', () => {
  it('uses light inlay on dark bodies and dark ink on light bodies for every face treatment', () => {
    const scene = createScene();
    for (const treatment of ['gilded', 'engraved', 'embossed'] as const) {
      scene.showDie(createDie('d6', { color: '#112233', treatment }));
      expect(renderedCanvasInk.at(-1)).toBe('#fff1cc');
      scene.showDie(createDie('d6', { color: '#eee8d8', treatment }));
      expect(renderedCanvasInk.at(-1)).toBe('#211d17');
    }
  });

  it('creates a responsive canvas, replaces the selected surface, and switches the preview between play and design', () => {
    const scene = createScene(430, 700);
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;

    expect(canvas.className).toBe('dice-canvas');
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(state.renderer.setSize).toHaveBeenLastCalledWith(430, 700, false);
    expect(observers[0].observe).toHaveBeenCalledTimes(1);
    expect(state.camera.aspect).toBeCloseTo(430 / 330);
    expect(state.scene.getObjectByName('throwing-surface')).toBeTruthy();

    const host = canvas.parentElement!;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 330 });
    observers[0].trigger();
    expect(state.renderer.setSize).toHaveBeenLastCalledWith(390, 330, false);
    expect(state.camera.aspect).toBeCloseTo(390);

    scene.setView('play');
    scene.setView('design');
    expect(state.cameraTarget.x).toBe(-12.5);
    expect(state.previewDie).toBeNull();
    observers[0].trigger();
    expect(state.cameraTarget.x).toBe(-12.5);
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });
    observers[0].trigger();
    expect(state.cameraTarget.x).toBe(-10.5);
    scene.setView('play');
    expect(state.cameraTarget.x).toBe(0);
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
    observers[0].trigger();
    expect(state.cameraTarget.x).toBe(0);

    const cloud = state.scene.getObjectByName('throwing-surface') as THREE.Mesh;
    const cloudMaterial = cloud.material as THREE.MeshStandardMaterial;
    scene.setSurface('table');
    const table = state.scene.getObjectByName('throwing-surface') as THREE.Mesh;
    expect(table).not.toBe(cloud);
    expect((table.material as THREE.MeshStandardMaterial).roughness).toBe(0.72);
    expect(cloudMaterial.map?.image).toBeInstanceOf(HTMLCanvasElement);
    expect(state.surface).toBe('table');

    scene.showDie(createDie('d6', { material: 'crystal', transparency: 45, iridescence: 80 }));
    const preview = state.previewDie!;
    expect(preview.position.x).toBe(0);
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
    observers[0].trigger();
    expect(preview.scale.x).toBe(1.9);
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 390 });
    observers[0].trigger();
    expect(preview.scale.x).toBe(0.78);
    const shell = preview.children.at(-1) as THREE.Mesh;
    expect(shell.material).toMatchObject({ transparent: true, transmission: 0.19, iridescence: 0.8 });

    scene.setView('design');
    expect(state.cameraTarget.x).toBe(-12.5);
    expect(preview.position.x).toBe(-10.9);
    expect(preview.scale.x).toBe(0.56);
    expect(state.camera.position.y).toBe(11.5);
    scene.setView('play');
    expect(state.cameraTarget.x).toBe(0);
    expect(state.previewDie).toBeNull();
    expect(state.scene.children).not.toContain(preview);
  });

  it('renders material and face-treatment choices in the active preview', () => {
    const scene = createScene();
    const state = sceneState(scene);

    for (const [material, expectedMetalness, expectedRoughness, expectedCoat] of [
      ['porcelain', 0.06, 0.24, 0.8],
      ['satin', 0.82, 0.23, 0.8],
      ['enamel', 0.32, 0.2, 1],
      ['crystal', 0.06, 0.24, 0.72],
    ] as const) {
      scene.showDie(createDie('d6', { material }));
      const shell = state.previewDie!.children.at(-1) as THREE.Mesh;
      expect(shell.material).toMatchObject({
        metalness: expectedMetalness,
        roughness: expectedRoughness,
        clearcoat: expectedCoat,
      });
    }

    for (const treatment of ['gilded', 'engraved', 'embossed'] as const) {
      scene.showDie(createDie('d4', { treatment }));
      const badges = state.previewDie!.children.filter(child => child instanceof THREE.Mesh);
      expect(badges.length).toBeGreaterThan(1);
      const badgeMaterials = badges.slice(0, -1).map(badge => (badge as THREE.Mesh).material as THREE.MeshStandardMaterial);
      expect(badgeMaterials.every(material => material.transparent && material.map && material.bumpMap)).toBe(true);
    }
  });

  it('uses a safe pixel ratio when the browser reports no device pixel ratio', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });

    const scene = createScene();

    expect(sceneState(scene).renderer.setPixelRatio).toHaveBeenCalledWith(1);
  });

  it('renders the d4 opposite-vertex badges in the public design preview', () => {
    const scene = createScene();
    const die = createDie('d4', { name: 'Corner-labelled d4' });

    scene.showDie(die);

    const meshes = sceneState(scene).previewDie!.children.filter(child => child instanceof THREE.Mesh);
    const faceBadges = meshes.filter(mesh => mesh.geometry instanceof THREE.PlaneGeometry);
    expect(faceBadges).toHaveLength(12);
    expect(faceBadges.every(mesh => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      return material.map instanceof THREE.CanvasTexture;
    })).toBe(true);
    expect(meshes).toHaveLength(13);
    expect(meshes.at(-1)?.geometry).toBeInstanceOf(THREE.BufferGeometry);
  });

  it('renders tens labels 00 through 90 in the public d100 preview', () => {
    const scene = createScene();
    scene.showDie(createDie('d100', { name: 'Percentile preview' }));

    const previewMeshes = sceneState(scene).previewDie!.children.filter(child => child instanceof THREE.Mesh);
    const faceBadges = previewMeshes.filter(mesh => mesh.geometry instanceof THREE.PlaneGeometry);
    const expectedLabels = Array.from({ length: 10 }, (_, index) => String(index * 10).padStart(2, '0'));

    expect(faceBadges).toHaveLength(10);
    expect(new Set(renderedCanvasText)).toEqual(new Set(expectedLabels));
    expect(previewMeshes).toHaveLength(11);
  });

  it('keeps badge normals outward when a polyhedron has inward face winding', () => {
    const polyhedron = getPolyhedron('d6');
    const inward = { ...polyhedron, faces: polyhedron.faces.map(face => [...face].reverse()) };
    vi.spyOn(model, 'getPolyhedron').mockReturnValue(inward);
    const scene = createScene();

    scene.showDie(createDie('d6'));

    const badges = sceneState(scene).previewDie!.children
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .filter(mesh => mesh.geometry instanceof THREE.PlaneGeometry);
    expect(badges).toHaveLength(6);
    for (const badge of badges) {
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(badge.quaternion);
      expect(normal.dot(badge.position)).toBeGreaterThan(0);
    }
  });

  it('renders an empty label instead of crashing when a malformed die lacks face labels', () => {
    const scene = createScene();
    const incompleteD4 = createDie('d4');
    incompleteD4.faces = [];
    scene.showDie(incompleteD4);
    expect(renderedCanvasText).toContain('');

    const incompleteD6 = createDie('d6');
    incompleteD6.faces = [];
    scene.showDie(incompleteD6);
    expect(renderedCanvasText).toContain('');
  });

  it('enters design view safely before a die preview has been selected', () => {
    const scene = createScene();
    const state = sceneState(scene);

    scene.setView('design');

    expect(state.view).toBe('design');
    expect(state.previewDie).toBeNull();
    expect(state.scene.getObjectByName('throwing-surface')).toBeTruthy();
  });

  it('does not create a preview without a configuration or duplicate an existing preview', () => {
    const scene = createScene();
    const state = sceneState(scene);

    state.createPreview();
    expect(state.previewDie).toBeNull();

    scene.showDie(createDie('d6'));
    const preview = state.previewDie;
    state.createPreview();

    expect(state.previewDie).toBe(preview);
    expect(state.scene.children.filter(child => child === preview)).toHaveLength(1);
  });

  it('disposes preview geometries and light-reactive texture maps when replacing a die', () => {
    const scene = createScene();
    const state = sceneState(scene);
    scene.showDie(createDie('d6'));
    const badge = state.previewDie!.children.find(child =>
      child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry) as THREE.Mesh;
    const material = badge.material as THREE.MeshStandardMaterial;
    const geometryDispose = vi.spyOn(badge.geometry, 'dispose');
    const mapDispose = vi.spyOn(material.map!, 'dispose');
    const bumpDispose = vi.spyOn(material.bumpMap!, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');

    scene.showDie(createDie('d8'));

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(mapDispose).toHaveBeenCalledOnce();
    expect(bumpDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it('ignores stale animation callbacks for empty, completed, and disposed scenes', () => {
    const scene = createScene();
    const state = sceneState(scene);
    const renderCount = () => state.renderer.render.mock.calls.length;
    let before = renderCount();

    state.animate(16);
    expect(renderCount()).toBe(before);

    scene.throw(snapshot(createDie('d6')), () => {});
    before = renderCount();
    state.animate(32);
    expect(renderCount()).toBe(before);

    scene.dispose();
    before = renderCount();
    state.animate(48);
    expect(renderCount()).toBe(before);
  });

  it('keeps completion idempotent after notifying the throw callback', () => {
    const scene = createScene();
    const state = sceneState(scene);
    const callback = vi.fn();

    scene.throw(snapshot(createDie('d6')), callback);
    const firstResult = callback.mock.calls[0][0];
    expect(callback).toHaveBeenCalledOnce();
    state.finish({ status: 'cocked' });

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(firstResult);
  });

  it('animates view changes, resizes the camera, and disposes resources and listeners idempotently', () => {
    reduceMotion = false;
    const advanceFrame = installAnimationFrames();
    const scene = createScene(800, 600);
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    const host = canvas.parentElement!;

    scene.showDie(createDie('d8'));
    vi.spyOn(performance, 'now').mockReturnValue(100);
    scene.setView('design');
    expect(state.cameraTarget.x).toBe(0);
    expect(frameCallbacks?.size).toBe(1);
    advanceFrame(460);
    expect(state.cameraTarget.x).toBeLessThan(0);
    advanceFrame(820);
    expect(state.cameraTarget.x).toBe(-10.5);
    expect(frameCallbacks?.size).toBe(0);

    observers[0].disconnect.mockClear();
    scene.dispose();
    scene.dispose();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(state.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(canvas.isConnected).toBe(false);
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('recreates the selected preview when returning to the design view after a throw', () => {
    const scene = createScene();
    const state = sceneState(scene);
    const die = createDie('d6', { name: 'Workshop die' });

    scene.showDie(die);
    expect(state.previewDie).not.toBeNull();
    scene.throw({ groups: [], multiplier: 1, offset: 0 }, () => {});
    expect(state.previewDie).toBeNull();

    scene.setView('design');
    expect(state.view).toBe('design');
    expect(state.previewDie).not.toBeNull();
    expect(state.previewDie!.position.x).toBe(-10.5);

    scene.setView('play');
    expect(state.view).toBe('play');
    expect(state.previewDie).toBeNull();
  });
});

describe('DiceScene physical outcomes', () => {
  it('reports the face actually resting upward for a real cannon-es d6 throw', () => {
    useDeterministicRandom();
    const scene = createScene();
    const die = createDie('d6', { name: 'Copper d6', faces: [
      { label: 'NORTH', score: -11 }, { label: 'EAST', score: 0 }, { label: 'SOUTH', score: 17 },
      { label: 'WEST', score: 28 }, { label: 'ZENITH', score: 99 }, { label: 'NADIR', score: 42 },
    ] });
    let result: unknown;

    scene.throw(snapshot(die), value => { result = value; });

    const entry = sceneState(scene).dice[0];
    expect(result).toMatchObject({ status: 'settled' });
    expect(entry.body.sleepState).toBe(CANNON.Body.SLEEPING);
    const faceIndex = restingFaceIndex(faceNormals('d6'), entry.body.quaternion);
    expect(faceIndex).not.toBeNull();
    expect(result).toEqual({
      status: 'settled',
      results: [[{ ...die.faces[faceIndex!], dieName: 'Copper d6' }]],
    });
  });

  it('settles a physical throw on the tabletop surface', () => {
    const scene = createScene();
    scene.setSurface('table');
    useDeterministicRandom();
    const die = createDie('d6', { name: 'Tabletop d6' });
    let result: unknown;

    scene.throw(snapshot(die), value => { result = value; });

    const entry = sceneState(scene).dice[0];
    const faceIndex = restingFaceIndex(faceNormals('d6'), entry.body.quaternion);
    expect(result).toMatchObject({ status: 'settled' });
    expect(faceIndex).not.toBeNull();
    expect(result).toEqual({
      status: 'settled',
      results: [[{ ...die.faces[faceIndex!], dieName: 'Tabletop d6' }]],
    });
  });

  it('scores a physical d4 from the unique bottom face, not the top normal', () => {
    useDeterministicRandom();
    const scene = createScene();
    const die = createDie('d4', { name: 'Tetrahedron', faces: [
      { label: 'BASE-A', score: 101 }, { label: 'BASE-B', score: 202 },
      { label: 'BASE-C', score: 303 }, { label: 'BASE-D', score: 404 },
    ] });
    let result: unknown;

    scene.throw(snapshot(die), value => { result = value; });

    const entry = sceneState(scene).dice[0];
    expect(result).toMatchObject({ status: 'settled' });
    const bottomFace = restingFaceIndex(faceNormals('d4'), entry.body.quaternion, true);
    expect(entry.mesh.children.filter(child =>
      child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry)).toHaveLength(12);
    expect(bottomFace).not.toBeNull();
    expect(result).toEqual({
      status: 'settled',
      results: [[{ ...die.faces[bottomFace!], dieName: 'Tetrahedron' }]],
    });
  });

  it('reorients inward collider normals before selecting a face score', () => {
    const scene = createScene();
    const die = createDie('d6', { name: 'Reversed winding' });
    scene.throw(snapshot(die), () => {});

    const entry = sceneState(scene).dice[0];
    const normals = faceNormals('d6');
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(...normals[0]),
      new THREE.Vector3(0, 1, 0),
    );
    entry.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    entry.body.sleep();
    entry.polyhedron = {
      ...entry.polyhedron,
      faces: entry.polyhedron.faces.map(face => [...face].reverse()),
    };
    const faceIndex = restingFaceIndex(normals, entry.body.quaternion);

    expect(faceIndex).not.toBeNull();
    expect(sceneState(scene).readResults()).toEqual([[
      { ...die.faces[faceIndex!], dieName: 'Reversed winding' },
    ]]);
  });

  it('combines the actual tens and units d10 face indices into one d100 result', () => {
    useDeterministicRandom();
    const scene = createScene();
    const die = createDie('d100', {
      name: 'Percentile pair',
      faces: Array.from({ length: 100 }, (_, index) => ({
        label: `CUSTOM-OUTCOME-${String(index).padStart(3, '0')}`,
        score: 500 + index * 37,
      })),
    });
    let result: unknown;

    scene.throw(snapshot(die), value => { result = value; });

    const state = sceneState(scene);
    const entries = state.dice;
    expect(entries.map(entry => entry.role)).toEqual(['tens', 'units']);
    expect(entries).toHaveLength(2);
    const initialTens = restingFaceIndex(faceNormals('d10'), entries[0].body.quaternion);
    const initialUnits = restingFaceIndex(faceNormals('d10'), entries[1].body.quaternion);
    expect(result).toMatchObject({ status: 'settled' });
    expect(initialTens).not.toBeNull();
    expect(initialUnits).not.toBeNull();
    expect(result).toEqual({
      status: 'settled',
      results: [[{ ...die.faces[initialTens! * 10 + initialUnits!], dieName: 'Percentile pair' }]],
    });
    const physicalOutcome = initialTens! * 10 + initialUnits!;
    expect(result).toMatchObject({
      status: 'settled',
      results: [[{
        label: `CUSTOM-OUTCOME-${String(physicalOutcome).padStart(3, '0')}`,
        score: 500 + physicalOutcome * 37,
        dieName: 'Percentile pair',
      }]],
    });

    // d10 is an approximate solid and real throws may be edge-cocked. Use explicit,
    // unambiguous face orientations to isolate and verify the actual pair mapping.
    const mappedFaceIndices: number[] = [];
    for (const entry of entries) {
      const normals = faceNormals('d10');
      const faceIndex = normals.findIndex(normal => {
        const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normal), new THREE.Vector3(0, 1, 0));
        entry.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        const restingIndex = restingFaceIndex(normals, entry.body.quaternion);
        if (restingIndex === null) return false;
        mappedFaceIndices.push(restingIndex);
        return true;
      });
      expect(faceIndex).toBeGreaterThanOrEqual(0);
    }
    const mappedResults = state.readResults();
    const outcomeIndex = mappedFaceIndices[0] * 10 + mappedFaceIndices[1];
    expect(mappedResults).toEqual([[{ ...die.faces[outcomeIndex], dieName: 'Percentile pair' }]]);
    expect(mappedResults?.[0]).toHaveLength(1);
  });

  it('reports an incomplete physical d100 pair as cocked rather than an empty success', () => {
    reduceMotion = false;
    installAnimationFrames();
    const scene = createScene();
    const result = vi.fn();
    scene.throw(snapshot(createDie('d100')), result);

    const state = sceneState(scene);
    const entry = state.dice[0];
    state.dice.pop();
    const normals = faceNormals('d10');
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(...normals[0]),
      new THREE.Vector3(0, 1, 0),
    );
    entry.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    entry.body.sleep();
    vi.spyOn(state.world!, 'step').mockImplementation(() => {});
    state.elapsed = 0.8;
    state.previousTime = 16;
    expect(restingFaceIndex(normals, entry.body.quaternion)).not.toBeNull();

    state.animate(32);

    expect(result).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledWith({ status: 'cocked' });
  });

  it('rejects malformed face arrays instead of returning a missing-score success', () => {
    const scene = createScene();
    const incompleteD6 = createDie('d6');
    incompleteD6.faces = [];
    let result: unknown;

    scene.throw(snapshot(incompleteD6), value => { result = value; });

    expect(renderedCanvasText).toContain('');
    expect(result).toEqual({ status: 'cocked' });
    const d6State = sceneState(scene);
    const d6Entry = d6State.dice[0];
    const d6Normals = faceNormals('d6');
    const d6Rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(...d6Normals[0]),
      new THREE.Vector3(0, 1, 0),
    );
    d6Entry.body.quaternion.set(d6Rotation.x, d6Rotation.y, d6Rotation.z, d6Rotation.w);
    expect(restingFaceIndex(d6Normals, d6Entry.body.quaternion)).not.toBeNull();
    expect(d6State.readResults()).toBeNull();

    const incompleteD100 = createDie('d100');
    incompleteD100.faces = [];
    scene.throw(snapshot(incompleteD100), () => {});
    const state = sceneState(scene);
    const normals = faceNormals('d10');
    for (const entry of state.dice) {
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(...normals[0]),
        new THREE.Vector3(0, 1, 0),
      );
      entry.body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    expect(state.dice).toHaveLength(2);
    expect(state.readResults()).toBeNull();
  });

  it('settles an empty hand without inventing results', () => {
    const scene = createScene();
    let result: unknown;

    scene.throw({ groups: [], multiplier: 1, offset: 0 }, value => { result = value; });

    expect(result).toEqual({ status: 'settled', results: [] });
  });

  it('reports an edge-balanced resting die as cocked instead of inventing a face', () => {
    reduceMotion = false;
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const result = vi.fn();

    scene.throw(snapshot(createDie('d6')), result);

    const body = sceneState(scene).dice[0].body;
    const normals = faceNormals('d6');
    const adjacent = normals.find((normal, index) =>
      normals.slice(index + 1).some(other => Math.abs(normal[0] * other[0] + normal[1] * other[1] + normal[2] * other[2]) < 1e-8));
    const other = normals.find(normal => adjacent
      && Math.abs(adjacent[0] * normal[0] + adjacent[1] * normal[1] + adjacent[2] * normal[2]) < 1e-8);
    expect(adjacent).toBeDefined();
    expect(other).toBeDefined();

    const tiedLocalUp = new THREE.Vector3(...adjacent!).add(new THREE.Vector3(...other!)).normalize();
    const edgeBalancedRotation = new THREE.Quaternion().setFromUnitVectors(tiedLocalUp, new THREE.Vector3(0, 1, 0));
    body.position.set(0, 0.6, 0);
    body.quaternion.set(edgeBalancedRotation.x, edgeBalancedRotation.y, edgeBalancedRotation.z, edgeBalancedRotation.w);
    body.sleep();
    expect(restingFaceIndex(normals, body.quaternion)).toBeNull();

    for (let frame = 0; frame < 70 && frameCallbacks?.size; frame++) {
      advanceFrame((frame + 1) * 16.67);
    }

    expect(result).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledWith({ status: 'cocked' });
  });

  it('returns cocked when the real reduced-motion simulation never settles', () => {
    const realStep = CANNON.World.prototype.step;
    vi.spyOn(CANNON.World.prototype, 'step').mockImplementation(function (
      this: CANNON.World,
      delta: number,
      timeSinceLastCalled?: number,
      maxSubSteps?: number,
    ) {
      realStep.call(this, delta, timeSinceLastCalled, maxSubSteps);
      const rollingBody = this.bodies.find(body => body.mass > 0);
      if (rollingBody) {
        rollingBody.wakeUp();
        rollingBody.velocity.set(4, 0, 0);
        rollingBody.angularVelocity.set(1, 2, 3);
      }
    });
    const scene = createScene();
    const result = vi.fn();

    scene.throw(snapshot(createDie('d6')), result);

    expect(sceneState(scene).dice).toHaveLength(1);
    expect(sceneState(scene).dice[0].body.sleepState).not.toBe(CANNON.Body.SLEEPING);
    expect(result).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledWith({ status: 'cocked' });
  });

  it('sleeps an individually calm body while another die is still moving', () => {
    reduceMotion = false;
    useDeterministicRandom();
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const result = vi.fn();

    scene.throw(snapshot(createDie('d6'), 2), result);

    const entries = sceneState(scene).dice;
    const calmBody = entries[0].body;
    const movingBody = entries[1].body;
    calmBody.position.set(-3.2, 0.62, 0);
    calmBody.velocity.setZero();
    calmBody.angularVelocity.setZero();
    calmBody.sleepTimeLimit = 5;
    calmBody.wakeUp();
    movingBody.position.set(3.2, 2, 0);

    for (let frame = 0; frame < 240 && calmBody.sleepState !== CANNON.Body.SLEEPING; frame++) {
      movingBody.wakeUp();
      movingBody.velocity.set(4, 0, 0);
      movingBody.angularVelocity.set(1, 2, 3);
      advanceFrame((frame + 1) * 16.67);
    }

    expect(calmBody.sleepState).toBe(CANNON.Body.SLEEPING);
    expect(movingBody.sleepState).not.toBe(CANNON.Body.SLEEPING);
    expect(result).not.toHaveBeenCalled();

    for (let frame = 240; frame < 900 && frameCallbacks?.size; frame++) {
      advanceFrame((frame + 1) * 16.67);
    }

    expect(result).toHaveBeenCalledOnce();
    expect(result.mock.calls[0][0]).toMatchObject({ status: 'settled' });
  });

  it('animates a physical throw and returns its derived face through the throw callback', () => {
    reduceMotion = false;
    useDeterministicRandom();
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const die = createDie('d6', { name: 'Animated d6' });
    let result: unknown;

    scene.throw(snapshot(die), value => { result = value; });
    expect(frameCallbacks?.size).toBe(1);
    for (let frame = 0; frame < 700 && frameCallbacks?.size; frame++) {
      advanceFrame((frame + 1) * 16.67);
    }

    const entry = sceneState(scene).dice[0];
    expect(result).toMatchObject({ status: 'settled' });
    const faceIndex = restingFaceIndex(faceNormals('d6'), entry.body.quaternion);
    expect(faceIndex).not.toBeNull();
    expect(result).toEqual({
      status: 'settled',
      results: [[{ ...die.faces[faceIndex!], dieName: 'Animated d6' }]],
    });
    expect(frameCallbacks?.size).toBe(0);
  });

  it('reports an unsettled throw as cocked when the real animation exceeds its deadline', () => {
    reduceMotion = false;
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const result = vi.fn();

    scene.throw(snapshot(createDie('d6')), result);
    const body = sceneState(scene).dice[0].body;
    let time = 50;
    let framesAdvanced = 0;

    // Keep a real physics body moving so the normal settled-result path cannot
    // finish first; advance animation time in realistic, capped 50 ms steps.
    for (let frame = 0; frame < 220 && frameCallbacks?.size; frame++) {
      body.wakeUp();
      body.velocity.set(4, 0, 0);
      body.angularVelocity.set(1, 2, 3);
      advanceFrame(time);
      framesAdvanced++;
      time += 50;
    }

    expect(result).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledWith({ status: 'cocked' });
    expect(framesAdvanced).toBeGreaterThan(200);
    expect(frameCallbacks?.size).toBe(0);
  });
});

describe('DiceScene pointer workflows', () => {
  it('settles both physical percentile bodies repeatedly without synthesizing outcomes', () => {
    for (const seed of [1, 17, 29, 51, 83, 127]) {
      useDeterministicRandom(seed);
      const scene = createScene(1440, 900);
      const result = vi.fn();
      const die = createDie('d100');
      scene.throw(snapshot(die), result);
      const state = sceneState(scene);
      expect(state.dice).toHaveLength(2);
      expect(result, `seed ${seed}`).toHaveBeenCalledWith(expect.objectContaining({ status: 'settled' }));
      const tens = restingFaceIndex(faceNormals('d10'), state.dice[0].body.quaternion);
      const units = restingFaceIndex(faceNormals('d10'), state.dice[1].body.quaternion);
      expect(tens).not.toBeNull();
      expect(units).not.toBeNull();
      expect(result.mock.calls[0][0].results).toEqual([[{
        ...die.faces[tens! * 10 + units!], dieName: die.name,
      }]]);
    }
  });

  it('starts a directional table flick before the first throw and ignores taps or cancelled gestures', () => {
    const scene = createScene();
    const canvas = sceneState(scene).renderer.domElement;
    setPointerBounds(canvas);
    const flick = vi.fn();
    scene.setTableFlickCallback(flick);
    vi.spyOn(performance, 'now').mockReturnValue(100);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 200, 500));
    canvas.dispatchEvent(pointerEvent('pointerdown', 99, 500, 100));
    expect(canvas.setPointerCapture).toHaveBeenCalledOnce();
    canvas.dispatchEvent(pointerEvent('pointerup', 99, 500, 100));
    expect(flick).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointerEvent('pointerup', 1, 500, 100));
    expect(flick).toHaveBeenCalledWith({ x: 6, z: -6, spin: 700 / 60 });
    expect(canvas.hasPointerCapture(1)).toBe(false);
    canvas.dispatchEvent(pointerEvent('pointerdown', 2, 200, 500));
    canvas.dispatchEvent(pointerEvent('pointerup', 2, 202, 501));
    expect(flick).toHaveBeenCalledOnce();
    canvas.dispatchEvent(pointerEvent('pointerdown', 3, 200, 500));
    canvas.releasePointerCapture(3);
    canvas.dispatchEvent(pointerEvent('pointercancel', 3, 500, 100));
    canvas.dispatchEvent(pointerEvent('pointerup', 3, 500, 100));
    expect(flick).toHaveBeenCalledOnce();
  });

  it('shows every staged hand body without producing a score, then uses a flick impulse in real physics', () => {
    reduceMotion = false;
    useDeterministicRandom();
    installAnimationFrames();
    const scene = createScene(1440, 900);
    const state = sceneState(scene);
    const hand: HandSnapshot = {
      groups: [
        { die: createDie('d20'), quantity: 3, multiplier: 1, offset: 0 },
        { die: createDie('d6'), quantity: 2, multiplier: 1, offset: 0 },
      ], multiplier: 1, offset: 0,
    };
    scene.stageHand(hand);
    expect(state.dice).toHaveLength(5);
    expect(frameCallbacks?.size).toBe(0);
    for (const entry of state.dice) {
      expect(entry.body.sleepState).toBe(CANNON.Body.SLEEPING);
      expect(entry.mesh.position.y).toBeGreaterThan(0.25);
      expect(entry.mesh.position.y).toBeLessThan(0.85);
      const screen = entry.mesh.position.clone().project(state.camera);
      expect(Math.abs(screen.x)).toBeLessThan(0.9);
      expect(Math.abs(screen.y)).toBeLessThan(0.9);
    }
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);
    const flick = vi.fn();
    scene.setTableFlickCallback(flick);
    const center = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, center.x, center.y));
    canvas.dispatchEvent(pointerEvent('pointerup', 1, center.x + 100, center.y - 100));
    expect(flick).toHaveBeenCalledOnce();
    const result = vi.fn();
    scene.throw(hand, result, { x: 2, z: -3, spin: 5 });
    expect(state.dice).toHaveLength(5);
    for (const entry of state.dice) {
      expect(entry.body.velocity.toArray()).toEqual([2, 3.2, -3]);
      expect(entry.body.angularVelocity.toArray()).toEqual([-6, 5, -4]);
    }
    expect(result).not.toHaveBeenCalled();
  });

  it('ignores a table flick without a registered handler and releases lost captures safely', () => {
    const scene = createScene();
    const canvas = sceneState(scene).renderer.domElement;
    setPointerBounds(canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 400, 500));
    canvas.releasePointerCapture(1);
    expect(() => canvas.dispatchEvent(pointerEvent('pointerup', 1, 300, 100))).not.toThrow();
    window.dispatchEvent(new Event('resize'));
    expect(sceneState(scene).renderer.setSize).toHaveBeenLastCalledWith(800, 600, false);
  });

  it('keeps every mixed-hand body inside the mobile camera frame after real physics settles', () => {
    useDeterministicRandom();
    const scene = createScene(390, 844);
    const state = sceneState(scene);
    const hand: HandSnapshot = {
      groups: [
        { die: createDie('d20'), quantity: 3, multiplier: 1, offset: 0 },
        { die: createDie('d6'), quantity: 2, multiplier: 1, offset: 0 },
      ], multiplier: 1, offset: 0,
    };
    const result = vi.fn();
    scene.throw(hand, result);
    expect(result).toHaveBeenCalledWith(expect.objectContaining({ status: 'settled' }));
    expect(state.dice).toHaveLength(5);
    for (const entry of state.dice) {
      for (const vertex of entry.polyhedron.vertices) {
        const point = new THREE.Vector3(...vertex).multiplyScalar(0.58 * entry.die.size)
          .applyQuaternion(entry.mesh.quaternion).add(entry.mesh.position).project(state.camera);
        expect(Math.abs(point.x)).toBeLessThan(1);
        expect(Math.abs(point.y)).toBeLessThan(1);
      }
    }
  });

  it('captures an initial table flick but not gestures while the design table is active', () => {
    const scene = createScene();
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 400, 300));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(10);
    canvas.dispatchEvent(pointerEvent('pointercancel', 10, 400, 300));
    (canvas.setPointerCapture as ReturnType<typeof vi.fn>).mockClear();

    scene.throw(snapshot(createDie('d6')), () => {});
    const entry = state.dice[0];
    const starting = entry.body.position.clone();
    scene.setView('design');
    canvas.dispatchEvent(pointerEvent('pointerdown', 11, 400, 300));

    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    expect(entry.body.position.distanceTo(starting)).toBeLessThan(1e-8);
    expect(entry.body.sleepState).toBe(CANNON.Body.SLEEPING);
  });

  it('ignores pointer-down during a roll, on empty table space, and on an awake die', () => {
    reduceMotion = false;
    useDeterministicRandom();
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);
    let result: unknown;

    scene.throw(snapshot(createDie('d6')), value => { result = value; });
    const rollingCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 20, rollingCenter.x, rollingCenter.y));
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();

    for (let frame = 0; frame < 700 && frameCallbacks?.size; frame++) {
      advanceFrame((frame + 1) * 16.67);
    }
    expect(result).toMatchObject({ status: 'settled' });

    canvas.dispatchEvent(pointerEvent('pointerdown', 21, 0, 0));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(21);
    canvas.dispatchEvent(pointerEvent('pointercancel', 21, 0, 0));

    const body = state.dice[0].body;
    body.wakeUp();
    const awakeCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 22, awakeCenter.x, awakeCenter.y));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(22);
  });

  it('ignores a pointer hit when the drag ray is parallel to the die plane', () => {
    const scene = createScene();
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);
    scene.throw(snapshot(createDie('d6')), () => {});

    const entry = state.dice[0];
    vi.spyOn(state.raycaster, 'intersectObjects').mockReturnValue([
      { object: entry.mesh } as unknown as THREE.Intersection,
    ]);
    const planeIntersection = vi.spyOn(state.raycaster.ray, 'intersectPlane').mockReturnValue(null);

    canvas.dispatchEvent(pointerEvent('pointerdown', 31, 400, 300));

    expect(planeIntersection).toHaveBeenCalledOnce();
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(31);
    expect(entry.body.sleepState).toBe(CANNON.Body.SLEEPING);
  });

  it('restores a short pointer tap and reports an accepted drag only after physics settles', () => {
    useDeterministicRandom();
    const advanceFrame = installAnimationFrames();
    const scene = createScene();
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);
    const die = createDie('d6');
    scene.throw(snapshot(die), () => {});

    const starting = state.dice[0].body.position.clone();
    const center = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, center.x, center.y));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    canvas.dispatchEvent(pointerEvent('pointermove', 99, center.x + 80, center.y));
    canvas.dispatchEvent(pointerEvent('pointerup', 99, center.x + 80, center.y));
    expect(state.dice[0].body.position.distanceTo(starting)).toBeLessThan(1e-8);
    expect(canvas.hasPointerCapture(1)).toBe(true);

    // Pointer capture can be lost when the browser changes focus mid-gesture.
    canvas.releasePointerCapture(1);
    (canvas.releasePointerCapture as ReturnType<typeof vi.fn>).mockClear();
    canvas.dispatchEvent(pointerEvent('pointerup', 1, center.x + 1, center.y));
    expect(state.dice[0].body.position.distanceTo(starting)).toBeLessThan(1e-8);
    expect(state.dice[0].body.sleepState).toBe(CANNON.Body.SLEEPING);
    expect(canvas.releasePointerCapture).not.toHaveBeenCalled();

    const noHandlerStart = state.dice[0].body.position.clone();
    const noHandlerCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 7, noHandlerCenter.x, noHandlerCenter.y));
    vi.spyOn(state.raycaster.ray, 'intersectPlane').mockReturnValueOnce(null);
    canvas.dispatchEvent(pointerEvent('pointermove', 7, noHandlerCenter.x, -600));
    expect(state.dice[0].body.position.distanceTo(noHandlerStart)).toBeLessThan(1e-8);
    canvas.dispatchEvent(pointerEvent('pointermove', 7, noHandlerCenter.x + 60, noHandlerCenter.y));
    expect(state.dice[0].body.position.distanceTo(noHandlerStart)).toBeGreaterThan(0.2);
    canvas.dispatchEvent(pointerEvent('pointerup', 7, noHandlerCenter.x + 60, noHandlerCenter.y));
    expect(state.dice[0].body.position.distanceTo(noHandlerStart)).toBeLessThan(1e-8);
    expect(state.dice[0].body.sleepState).toBe(CANNON.Body.SLEEPING);

    const onDragStart = vi.fn(() => true);
    const onDragComplete = vi.fn();
    scene.setDragCallbacks(onDragStart, onDragComplete);
    const updatedCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 2, updatedCenter.x, updatedCenter.y));
    canvas.dispatchEvent(pointerEvent('pointermove', 2, updatedCenter.x + 70, updatedCenter.y - 20));
    const draggedPosition = state.dice[0].body.position.clone();
    canvas.dispatchEvent(pointerEvent('pointerup', 2, updatedCenter.x + 70, updatedCenter.y - 20));

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(draggedPosition.distanceTo(starting)).toBeGreaterThan(0.2);
    expect(state.dice[0].body.sleepState).not.toBe(CANNON.Body.SLEEPING);
    expect(onDragComplete).not.toHaveBeenCalled();
    for (let frame = 0; frame < 700 && frameCallbacks?.size; frame++) advanceFrame((frame + 1) * 16.67);
    expect(onDragComplete).toHaveBeenCalledOnce();
    expect(onDragComplete.mock.calls[0][0]).toMatchObject({ status: 'settled' });
  });

  it('cancels a pointer drag and leaves the die at its starting position', () => {
    useDeterministicRandom();
    const scene = createScene();
    const state = sceneState(scene);
    const canvas = state.renderer.domElement;
    setPointerBounds(canvas);
    scene.throw(snapshot(createDie('d6')), () => {});

    const starting = state.dice[0].body.position.clone();
    const center = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 4, center.x, center.y));
    canvas.dispatchEvent(pointerEvent('pointercancel', 99, center.x + 80, center.y));
    expect(state.dice[0].body.sleepState).not.toBe(CANNON.Body.SLEEPING);
    canvas.dispatchEvent(pointerEvent('pointermove', 4, center.x + 80, center.y));
    canvas.dispatchEvent(pointerEvent('pointercancel', 4, center.x + 80, center.y));

    expect(state.dice[0].body.position.distanceTo(starting)).toBeLessThan(1e-8);
    expect(state.dice[0].body.velocity.length()).toBe(0);
    expect(state.dice[0].body.sleepState).toBe(CANNON.Body.SLEEPING);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(4);

    const lostCaptureStart = state.dice[0].body.position.clone();
    const lostCaptureCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 6, lostCaptureCenter.x, lostCaptureCenter.y));
    canvas.dispatchEvent(pointerEvent('pointermove', 6, lostCaptureCenter.x + 55, lostCaptureCenter.y));
    canvas.releasePointerCapture(6);
    (canvas.releasePointerCapture as ReturnType<typeof vi.fn>).mockClear();
    canvas.dispatchEvent(pointerEvent('pointercancel', 6, lostCaptureCenter.x + 55, lostCaptureCenter.y));
    expect(canvas.releasePointerCapture).not.toHaveBeenCalled();
    expect(state.dice[0].body.position.distanceTo(lostCaptureStart)).toBeLessThan(1e-8);
    expect(state.dice[0].body.sleepState).toBe(CANNON.Body.SLEEPING);

    const rejectDrag = vi.fn(() => false);
    const completion = vi.fn();
    scene.setDragCallbacks(rejectDrag, completion);
    const beforeRejectedDrag = state.dice[0].body.position.clone();
    const retryCenter = screenCenter(state, canvas);
    canvas.dispatchEvent(pointerEvent('pointerdown', 5, retryCenter.x, retryCenter.y));
    canvas.dispatchEvent(pointerEvent('pointermove', 5, retryCenter.x + 60, retryCenter.y));
    canvas.dispatchEvent(pointerEvent('pointerup', 5, retryCenter.x + 60, retryCenter.y));
    expect(rejectDrag).toHaveBeenCalledOnce();
    expect(state.dice[0].body.position.distanceTo(beforeRejectedDrag)).toBeLessThan(1e-8);
    expect(state.dice[0].body.sleepState).toBe(CANNON.Body.SLEEPING);
    expect(completion).not.toHaveBeenCalled();
  });
});
