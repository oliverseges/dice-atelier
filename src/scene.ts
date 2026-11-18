import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  getPolyhedron, outcomesForShape, restingFaceIndex, type DieConfig, type FaceResult, type HandSnapshot, type Polyhedron,
} from './model';

type Surface = 'cloud' | 'table';
type SceneView = 'play' | 'design';
type Settled = { status: 'settled'; results: FaceResult[][] } | { status: 'cocked' };
type DiceEntry = { body: CANNON.Body; mesh: THREE.Group; die: DieConfig; groupIndex: number; dieIndex: number; role: 'single' | 'tens' | 'units'; polyhedron: Polyhedron; calmTime: number };
type PointedFace = { pointerId: number; entry: DiceEntry; startX: number; startY: number; startedAt: number; startPosition: CANNON.Vec3; plane: THREE.Plane; offset: THREE.Vector3 };
type ThrowImpulse = { x: number; z: number; spin: number };

function createSurfaceTexture(surface: Surface): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  if (surface === 'table') {
    gradient.addColorStop(0, '#73573e');
    gradient.addColorStop(0.5, '#695039');
    gradient.addColorStop(1, '#73573e');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    context.globalAlpha = 0.16;
    for (let i = 0; i < 180; i++) {
      context.strokeStyle = i % 2 ? '#f5d8a1' : '#26180e';
      context.lineWidth = Math.random() * 2 + 0.5;
      context.beginPath();
      const y = i * 3.1;
      context.moveTo(0, y);
      context.bezierCurveTo(120, y + Math.sin(i) * 15, 320, y - Math.cos(i) * 12, 512, y);
      context.stroke();
    }
  } else {
    gradient.addColorStop(0, '#fffefa');
    gradient.addColorStop(1, '#e9e3d8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    context.globalAlpha = 0.05;
    for (let i = 0; i < 1500; i++) {
      context.fillStyle = i % 2 ? '#988d7b' : '#ffffff';
      context.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function createEnvironment(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#d6d3ce');
  gradient.addColorStop(0.34, '#8e8b84');
  gradient.addColorStop(0.55, '#403b33');
  gradient.addColorStop(1, '#181713');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.9;
  for (const [x, y, width, height, color] of [
    [80, 95, 220, 22, '#fff3d4'], [405, 56, 160, 14, '#fff8e9'], [720, 125, 245, 20, '#e3edff'],
    [285, 185, 90, 8, '#d0b170'], [830, 226, 130, 9, '#e4d7b6'],
  ] as const) {
    const glow = context.createLinearGradient(x, y, x + width, y + height);
    glow.addColorStop(0, `${color}00`);
    glow.addColorStop(0.5, color);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.fillRect(x, y, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function materialFor(die: DieConfig): THREE.MeshPhysicalMaterial {
  const crystal = die.material === 'crystal';
  return new THREE.MeshPhysicalMaterial({
    color: die.color,
    metalness: die.material === 'satin' ? 0.82 : die.material === 'enamel' ? 0.32 : 0.06,
    roughness: die.material === 'satin' ? 0.23 : die.material === 'enamel' ? 0.2 : 0.24,
    clearcoat: die.material === 'enamel' ? 1 : crystal ? 0.72 : 0.8,
    clearcoatRoughness: 0.12,
    transmission: crystal ? 0.19 : 0,
    thickness: crystal ? 0.7 : 0,
    opacity: 1 - die.transparency / 150,
    transparent: die.transparency > 0,
    iridescence: die.iridescence / 100,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 430],
    side: THREE.DoubleSide,
  });
}

function labelTexture(label: string, treatment: DieConfig['treatment'], bodyColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const body = new THREE.Color(bodyColor);
  const ink = body.r * 0.2126 + body.g * 0.7152 + body.b * 0.0722 < 0.22 ? '#fff1cc' : '#211d17';
  context.clearRect(0, 0, 256, 256);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${Math.min(166, 332 / Math.max(1, label.length))}px "Iowan Old Style", "Georgia", serif`;
  if (treatment === 'engraved') {
    context.shadowColor = '#16120b';
    context.shadowBlur = 5;
    context.shadowOffsetY = 3;
    context.fillStyle = '#766344';
    context.fillText(label, 130, 130);
    context.shadowColor = '#fff4d6';
    context.shadowOffsetY = -2;
    context.fillStyle = ink;
    context.fillText(label, 128, 127);
  } else if (treatment === 'embossed') {
    context.shadowColor = '#fff4d6';
    context.shadowBlur = 6;
    context.shadowOffsetY = -3;
    context.fillStyle = '#fbf0d7';
    context.fillText(label, 128, 126);
    context.shadowColor = '#5c4829';
    context.shadowOffsetY = 3;
    context.fillStyle = ink;
    context.fillText(label, 127, 128);
  } else {
    context.shadowColor = '#1c1509';
    context.shadowBlur = 2;
    context.shadowOffsetY = 2;
    context.lineWidth = 7;
    context.strokeStyle = '#241a0b';
    context.strokeText(label, 128, 128);
    context.fillStyle = ink;
    context.fillText(label, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeDieMesh(die: DieConfig, polyhedron: Polyhedron, labelOverride?: (faceIndex: number) => string): THREE.Group {
  const group = new THREE.Group();
  const bevelPoints: THREE.Vector3[] = [];
  const material = materialFor(die);
  const addBadge = (label: string, position: THREE.Vector3, normal: THREE.Vector3, size: number) => {
    const texture = labelTexture(label, die.treatment, die.color);
    const relief = new THREE.CanvasTexture(texture.image as HTMLCanvasElement);
    relief.colorSpace = THREE.NoColorSpace;
    const gilded = die.treatment === 'gilded';
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(size * die.size, size * die.size),
      new THREE.MeshStandardMaterial({
        map: texture,
        bumpMap: relief,
        bumpScale: die.treatment === 'engraved' ? -0.025 : die.treatment === 'embossed' ? 0.025 : 0.012,
        color: '#ffffff',
        metalness: gilded ? 0.45 : 0.08,
        roughness: gilded ? 0.26 : 0.48,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        side: THREE.DoubleSide,
      }),
    );
    badge.position.copy(position).addScaledVector(normal, 0.012 * die.size);
    badge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.add(badge);
  };
  polyhedron.faces.forEach((face, faceIndex) => {
    const points = face.map(index => new THREE.Vector3(...polyhedron.vertices[index]).multiplyScalar(0.58 * die.size));
    const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    bevelPoints.push(...points.map(point => point.clone().lerp(center, 0.085)));
    const normal = new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])).normalize();
    if (normal.dot(center) < 0) normal.negate();
    if (die.shape === 'd4' && !labelOverride) {
      for (const vertexIndex of face) {
        const oppositeFaceIndex = polyhedron.faces.findIndex(candidate => !candidate.includes(vertexIndex));
        const label = die.faces[oppositeFaceIndex]?.label ?? '';
        const cornerPosition = points[face.indexOf(vertexIndex)].clone().lerp(center, 0.18);
        addBadge(label, cornerPosition, normal, 0.21);
      }
    } else {
      const label = labelOverride ? labelOverride(faceIndex) : die.faces[faceIndex % die.faces.length]?.label ?? '';
      const faceRadius = Math.min(...points.map((point, index) => {
        const edge = points[(index + 1) % points.length].clone().sub(point);
        return new THREE.Vector3().crossVectors(center.clone().sub(point), edge).length() / edge.length();
      }));
      addBadge(label, center, normal, faceRadius * 1.65 / die.size);
    }
  });
  const geometry = new ConvexGeometry(bevelPoints);
  const shell = new THREE.Mesh(geometry, material);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);
  group.userData.dispose = () => group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const faceMaterial = object.material as THREE.MeshStandardMaterial;
    faceMaterial.map?.dispose();
    faceMaterial.bumpMap?.dispose();
    faceMaterial.dispose();
  });
  return group;
}

function cannonShape(polyhedron: Polyhedron, die: DieConfig): CANNON.ConvexPolyhedron {
  return new CANNON.ConvexPolyhedron({
    vertices: polyhedron.vertices.map(vertex => new CANNON.Vec3(vertex[0] * 0.58 * die.size, vertex[1] * 0.58 * die.size, vertex[2] * 0.58 * die.size)),
    faces: polyhedron.faces,
  });
}

function topFace(body: CANNON.Body, polyhedron: Polyhedron, bottomFace = false): number | null {
  const normals = polyhedron.faces.map(face => {
    const a = polyhedron.vertices[face[0]];
    const b = polyhedron.vertices[face[1]];
    const c = polyhedron.vertices[face[2]];
    const ab = new CANNON.Vec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new CANNON.Vec3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const localNormal = ab.cross(ac).unit();
    if (localNormal.dot(new CANNON.Vec3(a[0], a[1], a[2])) < 0) localNormal.negate(localNormal);
    return [localNormal.x, localNormal.y, localNormal.z] as [number, number, number];
  });
  return restingFaceIndex(normals, body.quaternion, bottomFace);
}

export class DiceScene {
  private readonly scene = new THREE.Scene();
  private readonly designTable = new THREE.Group();
  private readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly dice: DiceEntry[] = [];
  private readonly dynamicObjects: THREE.Object3D[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private world: CANNON.World | null = null;
  private surface: Surface = 'cloud';
  private view: SceneView = 'play';
  private cameraTarget = new THREE.Vector3();
  private previewDie: THREE.Group | null = null;
  private previewConfig: DieConfig | null = null;
  private pointedFace: PointedFace | null = null;
  private animationFrame = 0;
  private cameraFrame = 0;
  private previousTime = 0;
  private elapsed = 0;
  private settledCallback: ((result: Settled) => void) | null = null;
  private finished = false;
  private staged = false;
  private disposed = false;
  private activeGroupCount = 0;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private onDragStart: (() => boolean) | null = null;
  private onDragComplete: ((result: Settled) => void) | null = null;
  private onTableFlick: ((impulse: ThrowImpulse) => void) | null = null;
  private tableGesture: { pointerId: number; x: number; y: number; time: number } | null = null;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private readonly handleWindowResize = () => this.resize();
  private readonly handlePointerDown = (event: PointerEvent) => this.pointerDown(event);
  private readonly handlePointerMove = (event: PointerEvent) => this.pointerMove(event);
  private readonly handlePointerUp = (event: PointerEvent) => this.pointerUp(event);
  private readonly handlePointerCancel = (event: PointerEvent) => this.pointerCancel(event);

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'dice-canvas';
    this.renderer.domElement.style.touchAction = 'none';
    Object.assign(this.renderer.domElement.style, { position: 'fixed', inset: '0', width: '100vw', height: '100dvh' });
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel);
    host.prepend(this.renderer.domElement);
    const environment = createEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = generator.fromEquirectangular(environment);
    this.scene.environment = this.environmentTarget.texture;
    environment.dispose();
    generator.dispose();
    this.scene.background = new THREE.Color('#d7d0c3');
    this.scene.add(new THREE.HemisphereLight(0xfff5e5, 0x625546, 2.05));
    const key = new THREE.DirectionalLight(0xffe0b0, 4.2);
    key.position.set(-4, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.001;
    key.shadow.radius = 4;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce9ff, 1.3);
    fill.position.set(5, 5, -4);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xffd48d, 23, 16, 2);
    rim.position.set(2, 5, 1);
    this.scene.add(rim);
    const softbox = new THREE.PointLight(0xe2edff, 16, 15, 2);
    softbox.position.set(-5, 4, -4);
    this.scene.add(softbox);
    this.setSurface('cloud');
    this.createDesignTable();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    window.addEventListener('resize', this.handleWindowResize);
    this.resize();
    this.render();
  }

  setSurface(surface: Surface): void {
    this.surface = surface;
    const old = this.scene.getObjectByName('throwing-surface');
    if (old) {
      this.scene.remove(old);
      const mesh = old as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshStandardMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({
        map: createSurfaceTexture(surface),
        roughness: surface === 'cloud' ? 0.86 : 0.72,
        metalness: surface === 'cloud' ? 0.02 : 0.04,
      }),
    );
    plane.name = 'throwing-surface';
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.04;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  private createDesignTable(): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#624c36', map: createSurfaceTexture('table'), roughness: 0.66, metalness: 0.03 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.22, 10.5), wood);
    top.position.set(-10.5, 0.05, 0);
    top.receiveShadow = true;
    top.castShadow = true;
    this.designTable.add(top);
    const legMaterial = new THREE.MeshStandardMaterial({ color: '#392c20', roughness: 0.58, metalness: 0.04 });
    for (const x of [-15.8, -5.2]) {
      for (const z of [-4.3, 4.3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.3, 0.38), legMaterial);
        leg.position.set(x, -1.15, z);
        leg.castShadow = true;
        this.designTable.add(leg);
      }
    }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(11.3, 0.42, 0.35), legMaterial);
    apron.position.set(-10.5, -0.28, 4.25);
    apron.castShadow = true;
    this.designTable.add(apron);
    const brass = new THREE.MeshStandardMaterial({ color: '#c6a56c', metalness: 0.76, roughness: 0.26 });
    for (const z of [-4.75, 4.75]) {
      const inlay = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.018, 0.035), brass);
      inlay.position.set(-10.5, 0.168, z);
      this.designTable.add(inlay);
    }
    const workRing = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.018, 8, 64), brass);
    workRing.rotation.x = Math.PI / 2;
    workRing.position.set(-10.5, 0.17, 0);
    this.designTable.add(workRing);
    const tray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.72, 0.08, 48),
      new THREE.MeshStandardMaterial({ color: '#9a7a4d', metalness: 0.68, roughness: 0.3 }),
    );
    tray.position.set(-14.65, 0.2, 1.65);
    tray.castShadow = true;
    tray.receiveShadow = true;
    this.designTable.add(tray);
    const trayInset = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 0.012, 48),
      new THREE.MeshStandardMaterial({ color: '#30302b', metalness: 0.3, roughness: 0.48 }),
    );
    trayInset.position.set(-14.65, 0.25, 1.65);
    this.designTable.add(trayInset);
    for (let mark = 0; mark <= 10; mark++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(mark % 5 === 0 ? 0.018 : 0.01, 0.012, mark % 5 === 0 ? 0.16 : 0.09), brass);
      tick.position.set(-15.45 + mark * 0.99, 0.17, 4.42);
      this.designTable.add(tick);
    }
    this.designTable.visible = this.view === 'design';
    this.scene.add(this.designTable);
  }

  setDragCallbacks(onStart: () => boolean, onComplete: (result: Settled) => void): void {
    this.onDragStart = onStart;
    this.onDragComplete = onComplete;
  }

  setTableFlickCallback(callback: (impulse: ThrowImpulse) => void): void {
    this.onTableFlick = callback;
  }

  setView(view: SceneView): void {
    if (this.view === view) return;
    this.view = view;
    this.frameCamera();
    this.designTable.visible = view === 'design';
    if (view === 'design' && !this.previewDie && this.previewConfig) this.createPreview();
    if (view === 'play' && this.previewDie) this.clearPreview();
    if (this.previewDie) this.positionPreview(this.previewDie);
    cancelAnimationFrame(this.cameraFrame);
    const startPosition = this.camera.position.clone();
    const startTarget = this.cameraTarget.clone();
    const mobile = this.host.clientWidth < 520;
    const targetX = view === 'design' ? (mobile ? -12.5 : -10.5) : 0;
    const endTarget = new THREE.Vector3(targetX, 0, 0);
    const endPosition = new THREE.Vector3(targetX, mobile ? 11.5 : 9, mobile ? 10.8 : 7);
    if (this.reduceMotion) {
      this.camera.position.copy(endPosition);
      this.cameraTarget.copy(endTarget);
      this.camera.lookAt(this.cameraTarget);
      this.render();
      return;
    }
    const startTime = performance.now();
    const animateCamera = (time: number) => {
      const progress = Math.min(1, (time - startTime) / 720);
      const eased = 1 - (1 - progress) ** 3;
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.cameraTarget.lerpVectors(startTarget, endTarget, eased);
      this.camera.lookAt(this.cameraTarget);
      this.render();
      if (progress < 1) this.cameraFrame = requestAnimationFrame(animateCamera);
      else this.cameraFrame = 0;
    };
    this.cameraFrame = requestAnimationFrame(animateCamera);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    cancelAnimationFrame(this.cameraFrame);
    this.cameraFrame = 0;
    const mobile = width < 520;
    const targetX = this.view === 'design' ? (mobile ? -12.5 : -10.5) : 0;
    this.cameraTarget.set(targetX, 0, 0);
    this.camera.position.set(targetX, mobile ? 11.5 : 9, mobile ? 10.8 : 7);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
    this.frameCamera();
    if (this.previewDie) this.positionPreview(this.previewDie);
    this.render();
  }

  private frameCamera(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (this.view === 'design') {
      this.camera.clearViewOffset();
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      return;
    }
    const mobile = width < 520;
    const playWidth = mobile ? width : Math.max(1, width - 310);
    const playHeight = mobile ? Math.max(1, height - 370) : height;
    this.camera.setViewOffset(playWidth, playHeight, 0, mobile ? -55 : 0, width, height);
  }

  showDie(die: DieConfig): void {
    this.clearDynamic();
    this.clearPreview();
    this.previewConfig = structuredClone(die);
    this.createPreview();
    this.render();
  }

  stageHand(snapshot: HandSnapshot): void {
    this.prepareHand(snapshot);
    this.simulateWithoutAnimation(this.world!);
    this.staged = true;
  }

  throw(snapshot: HandSnapshot, callback: (result: Settled) => void, impulse?: ThrowImpulse): void {
    this.prepareHand(snapshot);
    this.settledCallback = callback;
    if (impulse) {
      for (const entry of this.dice) {
        entry.body.velocity.set(impulse.x, 3.2, impulse.z);
        entry.body.angularVelocity.set(impulse.z * 2, impulse.spin, -impulse.x * 2);
      }
    }
    if (this.reduceMotion) {
      this.simulateWithoutAnimation(this.world!);
      return;
    }
    this.animationFrame = requestAnimationFrame(time => this.animate(time));
  }

  private prepareHand(snapshot: HandSnapshot): void {
    this.clearDynamic();
    this.clearPreview();
    this.settledCallback = null;
    this.finished = false;
    this.staged = false;
    this.activeGroupCount = snapshot.groups.length;
    this.elapsed = 0;
    this.previousTime = 0;
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true });
    const solver = new CANNON.GSSolver();
    solver.iterations = 12;
    world.solver = solver;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = this.surface === 'table' ? 0.38 : 0.24;
    world.defaultContactMaterial.restitution = 0.24;
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);
    const halfWidth = this.host.clientWidth < 520 ? 2.3 : 3.8;
    this.addWall(world, 0, -2.9, halfWidth * 2 + 1, 8, 0.3);
    this.addWall(world, 0, 2.9, halfWidth * 2 + 1, 8, 0.3);
    this.addWall(world, -halfWidth, 0, 0.3, 8, 6);
    this.addWall(world, halfWidth, 0, 0.3, 8, 6);
    this.world = world;
    this.dice.length = 0;
    const totalBodies = snapshot.groups.reduce((sum, group) => sum + group.quantity * (group.die.shape === 'd100' ? 2 : 1), 0);
    const columns = Math.min(this.host.clientWidth < 520 ? 2 : 5, Math.max(1, Math.ceil(Math.sqrt(totalBodies))));
    const rows = Math.min(4, Math.ceil(totalBodies / columns));

    let order = 0;
    snapshot.groups.forEach((group, groupIndex) => {
      for (let count = 0; count < group.quantity; count++) {
        if (group.die.shape === 'd100') {
          this.addDie(world, group.die, groupIndex, count, order++, 'tens', 'd10', totalBodies, columns, rows);
          this.addDie(world, group.die, groupIndex, count, order++, 'units', 'd10', totalBodies, columns, rows);
        } else {
          this.addDie(world, group.die, groupIndex, count, order++, 'single', group.die.shape, totalBodies, columns, rows);
        }
      }
    });
  }

  private simulateWithoutAnimation(world: CANNON.World): void {
    let calmTime = 0;
    for (let step = 0; step < 600; step++) {
      world.step(1 / 60);
      const allCalm = this.dice.every(entry => entry.body.velocity.length() < 0.11 && entry.body.angularVelocity.length() < 0.15 && entry.body.position.y > 0.25);
      calmTime = allCalm ? calmTime + 1 / 60 : 0;
      if (calmTime > 0.9) {
        this.dice.forEach(entry => entry.body.sleep());
        break;
      }
    }
    for (const { body, mesh } of this.dice) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
    this.renderer.render(this.scene, this.camera);
    const results = this.dice.every(entry => entry.body.sleepState === CANNON.Body.SLEEPING) ? this.readResults() : null;
    this.finish(results ? { status: 'settled', results } : { status: 'cocked' });
  }

  private addWall(world: CANNON.World, x: number, z: number, sx: number, sy: number, sz: number): void {
    world.addBody(new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)), position: new CANNON.Vec3(x, sy / 2, z) }));
  }

  private addDie(
    world: CANNON.World,
    die: DieConfig,
    groupIndex: number,
    dieIndex: number,
    order: number,
    role: DiceEntry['role'],
    shape: DieConfig['shape'],
    totalBodies: number,
    columns: number,
    rows: number,
  ): void {
    const polyhedron = getPolyhedron(shape);
    const display = role === 'tens'
      ? (index: number) => String((index % 10) * 10).padStart(2, '0')
      : role === 'units'
        ? (index: number) => String(index % 10)
        : undefined;
    const mesh = makeDieMesh(die, polyhedron, display);
    const body = new CANNON.Body({
      mass: 1,
      shape: cannonShape(polyhedron, die),
      allowSleep: true,
      sleepSpeedLimit: 0.16,
      sleepTimeLimit: 0.65,
      linearDamping: this.surface === 'table' ? 0.19 : 0.24,
      angularDamping: 0.27,
    });
    const row = Math.floor(order / columns) % rows;
    const column = order % columns;
    const bodiesInRow = Math.min(columns, totalBodies - Math.floor(order / columns) * columns);
    const spacing = 1.32;
    const x = (column - (bodiesInRow - 1) / 2) * spacing + (Math.random() - 0.5) * 0.08;
    const z = (row - (rows - 1) / 2) * spacing + (Math.random() - 0.5) * 0.08;
    body.position.set(x, 2.3 + Math.random() * 1.2 + Math.floor(order / (columns * rows)) * 1.6, z);
    body.velocity.set((Math.random() - 0.5) * 4.4, -0.6, (Math.random() - 0.5) * 4.4);
    body.angularVelocity.set((Math.random() - 0.5) * 13, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 13);
    world.addBody(body);
    mesh.position.set(body.position.x, body.position.y, body.position.z);
    this.scene.add(mesh);
    this.dice.push({ body, mesh, die, groupIndex, dieIndex, role, polyhedron, calmTime: 0 });
    this.dynamicObjects.push(mesh);
  }

  private updatePointer(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
      -((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pointerDown(event: PointerEvent): void {
    if (this.view !== 'play' || this.pointedFace || this.tableGesture || (!this.finished && this.world)) return;
    this.tableGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    if (!this.world || this.staged) return;
    this.updatePointer(event);
    const hit = this.raycaster.intersectObjects(this.dice.map(entry => entry.mesh), true)[0];
    if (!hit) return;
    const entry = this.dice.find(candidate => candidate.mesh === hit.object || candidate.mesh.children.includes(hit.object));
    if (!entry || entry.body.sleepState !== CANNON.Body.SLEEPING) return;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -entry.body.position.y);
    const point = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return;
    const position = new CANNON.Vec3(entry.body.position.x, entry.body.position.y, entry.body.position.z);
    const offset = new THREE.Vector3(position.x, position.y, position.z).sub(point);
    this.pointedFace = {
      pointerId: event.pointerId,
      entry,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      startPosition: position,
      plane,
      offset,
    };
    this.tableGesture = null;
    entry.body.wakeUp();
    entry.body.velocity.setZero();
    entry.body.angularVelocity.setZero();
    this.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.pointedFace;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.updatePointer(event);
    const point = this.raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return;
    point.add(drag.offset);
    drag.entry.body.position.set(
      THREE.MathUtils.clamp(point.x, -2.05, 2.05),
      Math.max(0.35, point.y),
      THREE.MathUtils.clamp(point.z, -2.05, 2.05),
    );
    drag.entry.body.velocity.setZero();
    drag.entry.body.angularVelocity.setZero();
    drag.entry.body.aabbNeedsUpdate = true;
    drag.entry.mesh.position.set(drag.entry.body.position.x, drag.entry.body.position.y, drag.entry.body.position.z);
    this.render();
    event.preventDefault();
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.tableGesture;
    if (gesture && gesture.pointerId === event.pointerId) {
      this.tableGesture = null;
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.hypot(dx, dy) >= 12) {
        const duration = Math.max(0.08, (performance.now() - gesture.time) / 1000);
        this.onTableFlick?.({ x: THREE.MathUtils.clamp(dx / duration / 180, -6, 6), z: THREE.MathUtils.clamp(dy / duration / 180, -6, 6), spin: THREE.MathUtils.clamp((dx - dy) / 60, -12, 12) });
      }
      return;
    }
    const drag = this.pointedFace;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.pointedFace = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 5 || !this.onDragStart?.()) {
      drag.entry.body.position.copy(drag.startPosition);
      drag.entry.body.sleep();
      drag.entry.mesh.position.set(drag.startPosition.x, drag.startPosition.y, drag.startPosition.z);
      this.render();
      return;
    }
    const elapsed = Math.max(0.06, (performance.now() - drag.startedAt) / 1000);
    const speed = Math.min(3.2, 0.38 / elapsed);
    const velocityX = THREE.MathUtils.clamp((drag.entry.body.position.x - drag.startPosition.x) * speed, -9, 9);
    const velocityZ = THREE.MathUtils.clamp((drag.entry.body.position.z - drag.startPosition.z) * speed, -9, 9);
    drag.entry.body.velocity.set(velocityX, 1.8 + Math.min(3.5, distance / 90), velocityZ);
    drag.entry.body.angularVelocity.set(velocityZ * 2.8 + 1.5, (velocityX - velocityZ) * 2, -velocityX * 2.8 - 1.5);
    drag.entry.body.wakeUp();
    drag.entry.calmTime = 0;
    this.elapsed = 0;
    this.previousTime = 0;
    this.finished = false;
    this.settledCallback = result => this.onDragComplete?.(result);
    this.animationFrame = requestAnimationFrame(time => this.animate(time));
    event.preventDefault();
  }

  private pointerCancel(event: PointerEvent): void {
    if (this.tableGesture?.pointerId === event.pointerId) {
      this.tableGesture = null;
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    const drag = this.pointedFace;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.pointedFace = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    drag.entry.body.position.copy(drag.startPosition);
    drag.entry.body.velocity.setZero();
    drag.entry.body.angularVelocity.setZero();
    drag.entry.body.sleep();
    drag.entry.mesh.position.set(drag.startPosition.x, drag.startPosition.y, drag.startPosition.z);
    this.render();
  }

  private animate(time: number): void {
    if (this.disposed || !this.world || this.finished) return;
    if (!this.previousTime) this.previousTime = time;
    const delta = Math.min((time - this.previousTime) / 1000, 0.05);
    this.previousTime = time;
    this.elapsed += delta;
    this.world.step(1 / 60, delta, 4);
    for (const entry of this.dice) {
      const { body, mesh } = entry;
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      const calm = body.velocity.length() < 0.11 && body.angularVelocity.length() < 0.15 && body.position.y > 0.25;
      entry.calmTime = calm ? entry.calmTime + delta : 0;
      if (entry.calmTime > 0.9) body.sleep();
    }
    this.renderer.render(this.scene, this.camera);
    if (this.elapsed > 0.75 && this.dice.every(entry => entry.body.sleepState === CANNON.Body.SLEEPING)) {
      const results = this.readResults();
      this.finish(results ? { status: 'settled', results } : { status: 'cocked' });
    } else if (this.elapsed > 10) {
      this.finish({ status: 'cocked' });
    } else {
      this.animationFrame = requestAnimationFrame(nextTime => this.animate(nextTime));
    }
  }

  private readResults(): FaceResult[][] | null {
    const groups: FaceResult[][] = Array.from({ length: this.activeGroupCount }, () => []);
    const d100ByDie = new Map<string, { tens?: number; units?: number; die: DieConfig; groupIndex: number }>();
    for (const entry of this.dice) {
      const faceIndex = topFace(entry.body, entry.polyhedron, entry.die.shape === 'd4');
      if (faceIndex === null) return null;
      if (entry.role === 'tens' || entry.role === 'units') {
        const key = `${entry.groupIndex}:${entry.dieIndex}`;
        const pair = d100ByDie.get(key) ?? { die: entry.die, groupIndex: entry.groupIndex };
        pair[entry.role] = faceIndex % 10;
        d100ByDie.set(key, pair);
      } else {
        const index = faceIndex % outcomesForShape(entry.die);
        const face = entry.die.faces[index];
        if (!face) return null;
        groups[entry.groupIndex].push({ ...face, dieName: entry.die.name });
      }
    }
    for (const pairs of d100ByDie.values()) {
      if (pairs.tens === undefined || pairs.units === undefined) return null;
      const outcomeIndex = pairs.tens * 10 + pairs.units;
      const face = pairs.die.faces[outcomeIndex];
      if (!face) return null;
      groups[pairs.groupIndex].push({ ...face, dieName: pairs.die.name });
    }
    return groups;
  }

  private createPreview(): void {
    if (!this.previewConfig || this.previewDie) return;
    const die = this.previewConfig;
    const polyhedron = getPolyhedron(die.shape);
    const mesh = makeDieMesh(die, polyhedron, die.shape === 'd100'
      ? faceIndex => String(Math.floor(faceIndex / Math.max(1, polyhedron.faces.length / 10)) * 10).padStart(2, '0')
      : undefined);
    mesh.rotation.set(0.28, 0.3, -0.2);
    this.previewDie = mesh;
    this.positionPreview(mesh);
    this.scene.add(mesh);
  }

  private positionPreview(preview: THREE.Group): void {
    const mobile = this.host.clientWidth < 520;
    const mobileDesign = mobile && this.view === 'design';
    preview.scale.setScalar(mobileDesign ? 0.56 : mobile ? 0.78 : 1.9);
    preview.position.set(mobileDesign ? -10.9 : this.view === 'design' ? -10.5 : 0, this.view === 'design' ? 0.85 : 0.65, 0);
  }

  private clearPreview(): void {
    if (!this.previewDie) return;
    this.scene.remove(this.previewDie);
    const dispose = this.previewDie.userData.dispose as (() => void) | undefined;
    dispose?.();
    this.previewDie = null;
  }

  private finish(result: Settled): void {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.animationFrame);
    const callback = this.settledCallback;
    this.settledCallback = null;
    callback?.(result);
  }

  private render(): void {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }

  private clearDynamic(): void {
    cancelAnimationFrame(this.animationFrame);
    this.world = null;
    this.pointedFace = null;
    this.tableGesture = null;
    this.settledCallback = null;
    this.dice.length = 0;
    for (const object of this.dynamicObjects) {
      this.scene.remove(object);
      const dispose = object.userData.dispose as (() => void) | undefined;
      dispose?.();
    }
    this.dynamicObjects.length = 0;
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    cancelAnimationFrame(this.cameraFrame);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.handlePointerCancel);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.handleWindowResize);
    this.clearDynamic();
    this.clearPreview();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.bumpMap?.dispose();
        material.dispose();
      }
    });
    this.environmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
