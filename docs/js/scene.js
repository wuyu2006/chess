/* ==========================================================================
   GAMBIT · 3D room
   Poly Haven marble chess set, local PBR textures, cinematic lighting,
   spring-like piece motion and a tactile capture burst.
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FILES = 'abcdefgh';
const MODEL_URL = 'assets/models/chess_set/chess_set.gltf';
const SOURCE_SQUARE = 0.0578881;
const SOURCE_BOARD_TOP = 0.017392585;
const SCALE = 1 / SOURCE_SQUARE;
const BOARD_TOP = SOURCE_BOARD_TOP * SCALE;
const BOARD_HALF = 3.5;
const PIECE_TYPES = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const ACCENT = { w: 0xf2d08a, b: 0xa7b8ff };
const BASE_ROTATION = { w: 0, b: Math.PI };

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function squareToCoords(square) {
  if (typeof square !== 'string' || square.length < 2) return null;
  const file = FILES.indexOf(square[0].toLowerCase());
  const rank = Number(square[1]) - 1;
  if (file < 0 || rank < 0 || rank > 7) return null;
  return { file, rank };
}

function coordsToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}`;
}

function squarePosition(square) {
  const coords = squareToCoords(square);
  if (!coords) return new THREE.Vector3();
  return new THREE.Vector3(boardX(coords.file), BOARD_TOP, coords.rank - 3.5);
}

// White sits at -Z. With a camera looking toward +Z, screen-right is -X, so
// mirroring the file axis keeps the traditional a-file-on-the-left view.
const boardX = (file) => 3.5 - file;

function parseFenBoard(fen) {
  const placement = String(fen || '').split(' ')[0];
  const rows = placement.split('/');
  const result = [];
  if (rows.length !== 8) return result;
  for (let row = 0; row < 8; row += 1) {
    const rank = 7 - row;
    let file = 0;
    for (const char of rows[row]) {
      if (/[1-8]/.test(char)) {
        file += Number(char);
      } else if (/[prnbqkPRNBQK]/.test(char)) {
        const color = char === char.toUpperCase() ? 'w' : 'b';
        const type = char.toLowerCase();
        const square = coordsToSquare(file, rank);
        if (square) result.push({ square, color, type });
        file += 1;
      }
    }
  }
  return result;
}

function makeCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function textureFromCanvas(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function makeTileTexture(kind, renderer) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  if (kind === 'legal') {
    const gradient = ctx.createRadialGradient(128, 128, 2, 128, 128, 46);
    gradient.addColorStop(0, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 47, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'capture') {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 10;
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(128, 128, 82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(128, 128, 66, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'check') {
    const gradient = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,0.46)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 4;
    roundedRect(ctx, 12, 12, 232, 232, 26);
    ctx.stroke();
  } else {
    // selected / last / hover
    const strength = kind === 'select' ? 0.17 : kind === 'hover' ? 0.08 : 0.08;
    const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 178);
    gradient.addColorStop(0, `rgba(255,255,255,${strength})`);
    gradient.addColorStop(0.75, `rgba(255,255,255,${strength * 0.5})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    roundedRect(ctx, 10, 10, 236, 236, 26);
    ctx.fill();

    ctx.shadowColor = 'rgba(255,255,255,0.7)';
    ctx.shadowBlur = kind === 'select' ? 15 : 0;
    ctx.strokeStyle = kind === 'select' ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.32)';
    ctx.lineWidth = kind === 'select' ? 5 : 3;
    roundedRect(ctx, 14, 14, 228, 228, 22);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (kind === 'select') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [x, y] of [[14, 14], [242, 14], [14, 242], [242, 242]]) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return textureFromCanvas(canvas, renderer);
}

function makeGlowTexture(renderer) {
  const size = 128;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.58, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureFromCanvas(canvas, renderer);
}

function makeHaloTexture(renderer) {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
  gradient.addColorStop(0, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(0.52, 'rgba(255,255,255,0.07)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureFromCanvas(canvas, renderer);
}

/* -------------------------------------------------------------------------- */

export class ChessScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.onSquare = options.onSquare || (() => {});
    this.onHover = options.onHover || (() => {});
    this.onImpact = options.onImpact || (() => {});
    this.onReady = options.onReady || (() => {});
    this.ready = false;
    this.disposed = false;
    this.loadedPieces = [];
    this.pieces = new Map();
    this.tweens = new Set();
    this.effects = new Set();
    this.time = 0;
    this.viewColor = 'w';
    this.cameraTween = null;
    this.shake = null;
    this.checkSquare = null;
    this.checkMaterial = null;
    this.hoverSquare = null;
    this.pointerDown = null;
    this.lastHoverAt = 0;
    this.pieceHeight = { p: 0.95, n: 1.25, b: 1.45, r: 0.95, q: 1.65, k: 1.75 };
    this.prototypes = { w: {}, b: {} };

    this._initRenderer();
    this._initScene();
    this._initTextures();
    this._initRoom();
    this._initInteraction();
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _initRenderer() {
    const isMobile = window.matchMedia('(max-width: 700px)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.7 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x06070a, 1);

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(37, width / height, 0.1, 130);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.56;
    this.controls.zoomSpeed = 0.72;
    this.controls.minPolarAngle = 0.24;
    this.controls.maxPolarAngle = 1.37;
    this.controls.target.set(0, 0.24, 0);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene || new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), isMobile ? 0.12 : 0.16, 0.72, 1.05);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(width, height);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070a);
    this.scene.fog = new THREE.FogExp2(0x06070a, 0.0175);
    if (this.renderPass) {
      this.renderPass.scene = this.scene;
    }

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    try {
      const environment = new RoomEnvironment();
      this.envMap = pmrem.fromScene(environment, 0.045).texture;
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = 0.3;
      environment.dispose?.();
    } catch {
      // Environment lighting is a bonus; direct lights keep the board readable.
    } finally {
      pmrem.dispose();
    }

    const hemi = new THREE.HemisphereLight(0xa9b9d8, 0x0a0805, 0.35);
    this.scene.add(hemi);

    this.keyLight = new THREE.DirectionalLight(0xffefd3, 1.5);
    this.keyLight.position.set(-6.5, 13.5, -7.5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.left = -9;
    this.keyLight.shadow.camera.right = 9;
    this.keyLight.shadow.camera.top = 9;
    this.keyLight.shadow.camera.bottom = -9;
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 36;
    this.keyLight.shadow.bias = -0.0003;
    this.keyLight.shadow.normalBias = 0.016;
    this.keyLight.target.position.set(0, 0, 0);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const fill = new THREE.DirectionalLight(0x6d8ee8, 0.42);
    fill.position.set(7, 7, 8);
    fill.target.position.set(0, 0, 0);
    this.scene.add(fill);
    this.scene.add(fill.target);

    const top = new THREE.DirectionalLight(0xffffff, 0.38);
    top.position.set(2, 15, 1);
    top.target.position.set(0, 0, 0);
    this.scene.add(top);
    this.scene.add(top.target);

    this.warmPoint = new THREE.PointLight(0xffb96a, 18, 18, 2);
    this.warmPoint.position.set(-7, 3.4, -4);
    this.scene.add(this.warmPoint);

    this.coolPoint = new THREE.PointLight(0x6f8fff, 22, 20, 2);
    this.coolPoint.position.set(7, 4.5, 5);
    this.scene.add(this.coolPoint);

    this.tableGlow = new THREE.PointLight(0xd7ad64, 6, 11, 2);
    this.tableGlow.position.set(0, 1.4, 0);
    this.scene.add(this.tableGlow);

    this.boardGroup = new THREE.Group();
    this.boardGroup.name = 'board-group';
    this.scene.add(this.boardGroup);

    this.effectsGroup = new THREE.Group();
    this.effectsGroup.name = 'effects';
    this.scene.add(this.effectsGroup);

    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'highlights';
    this.highlightGroup.renderOrder = 3;
    this.scene.add(this.highlightGroup);

    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._lastTick = 0;
  }

  _initTextures() {
    this.textures = {
      select: makeTileTexture('select', this.renderer),
      last: makeTileTexture('last', this.renderer),
      hover: makeTileTexture('hover', this.renderer),
      legal: makeTileTexture('legal', this.renderer),
      capture: makeTileTexture('capture', this.renderer),
      check: makeTileTexture('check', this.renderer),
      glow: makeGlowTexture(this.renderer),
      halo: makeHaloTexture(this.renderer),
    };
    this.tileGeometry = new THREE.PlaneGeometry(1, 1);
    this.hoverTile = new THREE.Mesh(
      this.tileGeometry,
      new THREE.MeshBasicMaterial({
        map: this.textures.hover,
        color: 0xd8b46a,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.hoverTile.rotation.x = -Math.PI / 2;
    this.hoverTile.position.y = BOARD_TOP + 0.012;
    this.hoverTile.visible = false;
    this.hoverTile.renderOrder = 4;
    this.scene.add(this.hoverTile);
  }

  _initRoom() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(42, 96),
      new THREE.MeshStandardMaterial({
        color: 0x050609,
        roughness: 0.5,
        metalness: 0.18,
        envMapIntensity: 0.25,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.72;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const tableMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0a0b0f,
      roughness: 0.3,
      metalness: 0.28,
      clearcoat: 0.65,
      clearcoatRoughness: 0.34,
      envMapIntensity: 0.8,
    });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(10.6, 11.15, 0.7, 96, 1), tableMaterial);
    table.position.y = -0.35;
    table.receiveShadow = true;
    this.scene.add(table);

    const rimMaterial = new THREE.MeshBasicMaterial({
      color: 0x6f5832,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const radius of [8.9, 10.3]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.013, 8, 160), rimMaterial);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.006;
      this.scene.add(rim);
    }

    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(8.5, 96),
      new THREE.MeshBasicMaterial({
        map: this.textures.halo,
        color: 0xc89a4e,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.004;
    this.scene.add(halo);
    this.tableHalo = halo;

    this._createParticles();
  }

  _createParticles() {
    const count = 120;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const radius = 3.6 + Math.random() * 10.2;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.5 + Math.pow(Math.random(), 1.7) * 6.2;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xd8bd87,
      size: 0.052,
      map: this.textures.glow,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geometry, material);
    this.dust.userData.seeds = seeds;
    this.dust.renderOrder = 0;
    this.scene.add(this.dust);

    const starCount = 260;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const radius = 23 + Math.random() * 46;
      const angle = Math.random() * Math.PI * 2;
      starPositions[i * 3] = Math.cos(angle) * radius;
      starPositions[i * 3 + 1] = 0.5 + Math.random() * 25;
      starPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x9aa5be,
        size: 0.14,
        map: this.textures.glow,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.scene.add(this.stars);
  }

  _prepareMaterial(material) {
    if (!material) return;
    material.envMapIntensity = Math.max(material.envMapIntensity || 0, 0.95);
    material.shadowSide = THREE.FrontSide;
    const maps = [material.map, material.normalMap, material.roughnessMap, material.metalnessMap];
    for (const map of maps) {
      if (map) map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
  }

  async load(onProgress = () => {}) {
    onProgress(8, '正在打开模型');
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        MODEL_URL,
        resolve,
        (event) => {
          if (!event.total) return;
          const percent = 8 + Math.round((event.loaded / event.total) * 68);
          onProgress(Math.min(percent, 76), '正在读取大理石纹理');
        },
        (error) => reject(error),
      );
    });

    onProgress(82, '正在布置棋子');
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const nodes = [];
    root.traverse((node) => {
      if (!node.name) return;
      if (node.name === 'board' || node.name.startsWith('piece_')) nodes.push(node);
    });

    const boardNode = nodes.find((node) => node.name === 'board') || null;
    if (boardNode) {
      const board = boardNode.clone(true);
      board.position.set(0, 0, 0);
      board.rotation.set(0, 0, 0);
      board.scale.setScalar(SCALE);
      board.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = child.material?.clone ? child.material.clone() : child.material;
        this._prepareMaterial(child.material);
        if (child.material) {
          child.material.envMapIntensity = 0.7;
          child.material.roughness = Math.max(0.28, child.material.roughness ?? 0.28);
        }
      });
      this.boardGroup.add(board);
      this.boardMesh = board;
    }

    for (const node of nodes) {
      if (!node.name.startsWith('piece_')) continue;
      const lower = node.name.toLowerCase();
      const color = lower.includes('_white') ? 'w' : lower.includes('_black') ? 'b' : null;
      const typeName = Object.keys(PIECE_TYPES).find((name) => lower.includes(name));
      if (!color || !typeName) continue;
      const type = PIECE_TYPES[typeName];
      if (this.prototypes[color][type]) continue;
      const prototype = node.clone(true);
      prototype.position.set(0, 0, 0);
      prototype.rotation.set(0, 0, 0);
      prototype.scale.set(1, 1, 1);
      prototype.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        this._prepareMaterial(child.material);
      });
      this.prototypes[color][type] = prototype;
      const box = new THREE.Box3().setFromObject(prototype);
      if (box.max.y > box.min.y) {
        this.pieceHeight[type] = (box.max.y - box.min.y) * SCALE;
      }
    }

    if (!this.prototypes.w.k || !this.prototypes.b.k) {
      throw new Error('棋子的 3D 模型未能正确载入。');
    }

    this.loadedPieces = nodes;
    this.ready = true;
    onProgress(100, '准备就绪');
    this.setView('w', { instant: true });
    this.onReady();
    return this;
  }

  _makePiece(color, type) {
    const prototype = this.prototypes[color]?.[type];
    if (!prototype) throw new Error(`Missing piece prototype: ${color}/${type}`);
    const group = new THREE.Group();
    group.name = `piece_${color}_${type}`;
    const mesh = prototype.clone(true);
    mesh.scale.setScalar(SCALE);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    group.add(mesh);
    group.rotation.y = BASE_ROTATION[color] || 0;
    group.userData = { color, type, piece: true };
    return group;
  }

  _addPiece(color, type, square) {
    const group = this._makePiece(color, type);
    const position = squarePosition(square);
    group.position.copy(position);
    group.userData.square = square;
    this.scene.add(group);
    const record = { color, type, square, group };
    this.pieces.set(square, record);
    return record;
  }

  _removePieceRecord(record) {
    if (!record) return;
    this.scene.remove(record.group);
    this.pieces.delete(record.square);
  }

  setFen(fen, { instant = true } = {}) {
    for (const record of [...this.pieces.values()]) {
      this.scene.remove(record.group);
    }
    this.pieces.clear();
    for (const item of parseFenBoard(fen)) {
      this._addPiece(item.color, item.type, item.square);
    }
    if (instant) {
      this.hoverSquare = null;
      this.hoverTile.visible = false;
    }
    this.clearHighlights();
    return this;
  }

  getPieceAt(square) {
    return this.pieces.get(square) || null;
  }

  setCursor(value = 'default') {
    this.canvas.style.cursor = value;
  }

  setHoverSquare(square) {
    if (square === this.hoverSquare) return;
    this.hoverSquare = square;
    if (!square || !this.ready) {
      this.hoverTile.visible = false;
      this.setCursor(this.ready ? 'default' : 'wait');
      return;
    }
    const coords = squareToCoords(square);
    this.hoverTile.position.set(boardX(coords.file), BOARD_TOP + 0.012, coords.rank - 3.5);
    this.hoverTile.visible = true;
    this.setCursor('pointer');
  }

  clearHighlights() {
    for (const child of [...this.highlightGroup.children]) {
      this.highlightGroup.remove(child);
      if (child.userData.localMaterial) child.material.dispose();
    }
    this.checkMaterial = null;
    this.checkMesh = null;
  }

  _addHighlight(square, kind, { color = 0xd8b46a, opacity = 1, scale = 1, y = 0.012 } = {}) {
    const coords = squareToCoords(square);
    if (!coords) return null;
    const texture = this.textures[kind] || this.textures.last;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.tileGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(scale);
    mesh.position.set(boardX(coords.file), BOARD_TOP + y, coords.rank - 3.5);
    mesh.renderOrder = 5;
    mesh.userData.localMaterial = true;
    this.highlightGroup.add(mesh);
    return mesh;
  }

  _clearSelection() {
    for (const child of [...this.highlightGroup.children]) {
      if (child.userData.highlightKind !== 'selection') continue;
      this.highlightGroup.remove(child);
      child.material.dispose();
    }
  }

  clearSelection() {
    this._clearSelection();
  }

  setSelection(square, targets = []) {
    this._clearSelection();
    if (!square) return;
    const selected = this._addHighlight(square, 'select', { color: 0xf1d18c, opacity: 0.94 });
    if (selected) selected.userData.highlightKind = 'selection';
    for (const target of targets) {
      const targetSquare = typeof target === 'string' ? target : target.square;
      const capture = typeof target === 'string' ? false : Boolean(target.capture);
      const mesh = this._addHighlight(targetSquare, capture ? 'capture' : 'legal', {
        color: capture ? 0xf5c56d : 0x79d6b5,
        opacity: capture ? 0.88 : 0.9,
      });
      if (mesh) mesh.userData.highlightKind = 'selection';
    }
  }

  setLastMove(from, to) {
    for (const child of [...this.highlightGroup.children]) {
      if (child.userData.highlightKind === 'last') {
        this.highlightGroup.remove(child);
        child.material.dispose();
      }
    }
    for (const square of [from, to]) {
      if (!square) continue;
      const mesh = this._addHighlight(square, 'last', {
        color: 0x7da6c9,
        opacity: square === to ? 0.36 : 0.28,
      });
      if (mesh) mesh.userData.highlightKind = 'last';
    }
  }

  setCheck(square) {
    this.checkSquare = square;
    this.checkMaterial = null;
    this.checkMesh = null;
    for (const child of [...this.highlightGroup.children]) {
      if (child.userData.highlightKind === 'check') {
        this.highlightGroup.remove(child);
        child.material.dispose();
      }
    }
    if (!square) return;
    const mesh = this._addHighlight(square, 'check', { color: 0xff5d4f, opacity: 0.9 });
    if (mesh) {
      mesh.userData.highlightKind = 'check';
      this.checkMesh = mesh;
      this.checkMaterial = mesh.material;
    }
  }

  /* ------------------------------------------------------------------------
     Camera & room framing
     ------------------------------------------------------------------------ */

  _safeArea() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const stage = document.getElementById('centerStage');
    if (!stage) return { widthRatio: 0.9, heightRatio: 0.84 };
    const rect = stage.getBoundingClientRect();
    let visibleHeight = rect.height;
    // On compact layouts the player/control dock is fixed over the bottom of
    // the stage. Reserve that strip so the board never sits underneath it.
    if (width <= 980) {
      const dock = document.querySelector('.left-panel');
      if (dock) {
        const dockRect = dock.getBoundingClientRect();
        if (dockRect.height > 0 && dockRect.top > rect.top) {
          visibleHeight = Math.min(visibleHeight, dockRect.top - rect.top - 8);
        }
      }
    }
    return {
      widthRatio: clamp(rect.width / width, 0.4, 1),
      heightRatio: clamp(visibleHeight / height, 0.45, 1),
    };
  }

  _computeFit() {
    const aspect = Math.max(0.35, this.camera.aspect);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const safe = this._safeArea();
    const vertical = Math.tan(fov / 2);
    const widthDistance = (4.94 * 1.04) / (vertical * aspect * safe.widthRatio);
    const heightDistance = (3.28 * 1.12) / (vertical * safe.heightRatio);
    const distance = clamp(Math.max(widthDistance, heightDistance), 10.8, 48);
    const elevation = THREE.MathUtils.degToRad(41);
    const target = new THREE.Vector3(0, 0.24, 0);
    const horizontal = Math.sin(Math.acos(Math.sin(elevation))) * distance;
    const position = new THREE.Vector3(
      0,
      target.y + Math.sin(elevation) * distance,
      this.viewColor === 'w' ? -horizontal : horizontal,
    );
    return { position, target, distance };
  }

  setView(color = this.viewColor, { instant = false, duration = 900 } = {}) {
    this.viewColor = color === 'b' ? 'b' : 'w';
    const fit = this._computeFit();
    this.fitDistance = fit.distance;
    if (this.controls) {
      this.controls.minDistance = Math.max(7, fit.distance * 0.46);
      this.controls.maxDistance = fit.distance * 2.1;
    }
    if (instant) {
      this.cameraTween = null;
      this.camera.position.copy(fit.position);
      this.controls.target.copy(fit.target);
      this.camera.lookAt(this.controls.target);
      this.controls.enabled = true;
      this.controls.update();
      return;
    }
    this._startCameraTween(fit.position, fit.target, duration / 1000);
  }

  toggleView() {
    this.setView(this.viewColor === 'w' ? 'b' : 'w');
  }

  _startCameraTween(position, target, duration) {
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startSpherical = new THREE.Spherical().setFromVector3(startPosition.clone().sub(startTarget));
    const endSpherical = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    let deltaTheta = endSpherical.theta - startSpherical.theta;
    while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
    while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
    this.cameraTween = {
      elapsed: 0,
      duration,
      startTarget,
      endTarget: target.clone(),
      startSpherical,
      endSpherical,
      deltaTheta,
      lift: 0.055,
    };
    this.controls.enabled = false;
  }

  _updateCameraTween(dt) {
    const tween = this.cameraTween;
    if (!tween) return;
    tween.elapsed += dt;
    const raw = clamp(tween.elapsed / tween.duration, 0, 1);
    const t = easeInOutCubic(raw);
    const target = new THREE.Vector3().lerpVectors(tween.startTarget, tween.endTarget, t);
    const radius = lerp(tween.startSpherical.radius, tween.endSpherical.radius, t);
    const phi = lerp(tween.startSpherical.phi, tween.endSpherical.phi, t) - Math.sin(Math.PI * raw) * tween.lift;
    const theta = tween.startSpherical.theta + tween.deltaTheta * t;
    const offset = new THREE.Vector3().setFromSphericalCoords(radius, phi, theta);
    this.camera.position.copy(target).add(offset);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    if (raw >= 1) {
      this.cameraTween = null;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  /* ------------------------------------------------------------------------
     Input
     ------------------------------------------------------------------------ */

  _initInteraction() {
    this._onPointerDown = (event) => {
      if (!this.ready || event.button > 0) return;
      this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    this._onPointerUp = (event) => {
      if (!this.ready || !this.pointerDown) return;
      const down = this.pointerDown;
      this.pointerDown = null;
      if (event.button > 0) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > 7 || performance.now() - down.time > 900) return;
      const square = this._pickSquare(event);
      if (square) this.onSquare(square);
    };
    this._onPointerMove = (event) => {
      if (!this.ready) return;
      if (event.pointerType !== 'mouse') return;
      if (event.buttons) {
        if (this.hoverTile.visible) this.setHoverSquare(null);
        return;
      }
      const now = performance.now();
      if (now - this.lastHoverAt < 16) return;
      this.lastHoverAt = now;
      const square = this._pickSquare(event);
      this.setHoverSquare(square);
      this.onHover(square);
    };
    this._onPointerLeave = () => {
      this.pointerDown = null;
      this.setHoverSquare(null);
      this.onHover(null);
    };
    this._onContextMenu = (event) => event.preventDefault();
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
    this.controls.addEventListener('start', () => {
      this.hasInteracted = true;
    });
  }

  _setPointerFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pickSquare(event) {
    if (!this.ready) return null;
    this._setPointerFromEvent(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const groups = [...this.pieces.values()].map((record) => record.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData?.square) node = node.parent;
      if (node?.userData?.square) return node.userData.square;
    }

    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, point)) return null;
    const file = Math.floor(4 - point.x);
    const rank = Math.floor(point.z + 4);
    return coordsToSquare(file, rank);
  }

  /* ------------------------------------------------------------------------
     Render loop & lifecycle
     ------------------------------------------------------------------------ */

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this._lastTick = performance.now();
    this._boundTick = () => this._tick();
    this._raf = requestAnimationFrame(this._boundTick);
  }

  _tick() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = this._lastTick ? Math.min((now - this._lastTick) / 1000, 0.05) : 0;
    this._lastTick = now;
    this.time += dt;
    if (this.cameraTween) this._updateCameraTween(dt);
    else this.controls.update();
    this._updateTweens(dt);
    this._updateEffects(dt);
    this._updateParticles(dt);

    if (this.checkMaterial) {
      const pulse = 0.62 + Math.sin(this.time * 4.8) * 0.25;
      this.checkMaterial.opacity = pulse;
      if (this.checkMesh) {
        const scale = 1 + Math.sin(this.time * 3.4) * 0.035;
        this.checkMesh.scale.setScalar(scale);
      }
    }

    const basePosition = this.camera.position.clone();
    let shakeActive = false;
    if (this.shake) {
      this.shake.time -= dt;
      if (this.shake.time <= 0) {
        this.shake = null;
      } else {
        shakeActive = true;
        const strength = this.shake.strength * (this.shake.time / this.shake.duration);
        this.camera.position.x += (Math.random() * 2 - 1) * strength;
        this.camera.position.y += (Math.random() * 2 - 1) * strength * 0.55;
        this.camera.position.z += (Math.random() * 2 - 1) * strength;
      }
    }

    this.composer.render();
    if (shakeActive) this.camera.position.copy(basePosition);
    this._raf = requestAnimationFrame(this._boundTick);
  }

  _updateParticles(dt) {
    if (this.dust) {
      this.dust.rotation.y += dt * 0.012;
      this.dust.position.y = Math.sin(this.time * 0.16) * 0.035;
    }
    if (this.stars) this.stars.rotation.y -= dt * 0.0022;
    if (this.tableHalo) this.tableHalo.material.opacity = 0.27 + Math.sin(this.time * 0.6) * 0.025;
    if (this.hoverTile?.visible) {
      this.hoverTile.material.opacity = 0.36 + Math.sin(this.time * 2.4) * 0.08;
    }
  }

  addShake(duration = 0.34, strength = 0.16) {
    if (this.shake) {
      this.shake.time = Math.max(this.shake.time, duration);
      this.shake.duration = Math.max(this.shake.duration, duration);
      this.shake.strength = Math.max(this.shake.strength, strength);
    } else {
      this.shake = { time: duration, duration, strength };
    }
  }

  resize() {
    if (this.disposed) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mobile = width <= 700;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.7 : 2));
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (this.controls) {
      const fit = this._computeFit();
      this.fitDistance = fit.distance;
      this.controls.minDistance = Math.max(7, fit.distance * 0.46);
      this.controls.maxDistance = fit.distance * 2.1;
      if (!this.hasInteracted && this.ready) this.setView(this.viewColor, { instant: true });
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    this.controls?.dispose();
    this.composer?.dispose?.();
    this.renderer?.dispose();
  }

  /* ------------------------------------------------------------------------
     Piece animation
     ------------------------------------------------------------------------ */

  _addTween(duration, update, complete) {
    const tween = {
      elapsed: 0,
      duration: Math.max(0.016, duration),
      update,
      complete,
    };
    this.tweens.add(tween);
    return tween;
  }

  _updateTweens(dt) {
    for (const tween of [...this.tweens]) {
      tween.elapsed = Math.min(tween.duration, tween.elapsed + dt);
      const raw = tween.elapsed / tween.duration;
      tween.update?.(raw, tween.elapsed);
      if (raw >= 1) {
        this.tweens.delete(tween);
        tween.complete?.();
      }
    }
  }

  _animateRook(rook, duration) {
    if (!rook?.from || !rook?.to) return Promise.resolve();
    const record = this.pieces.get(rook.from);
    if (!record) return Promise.resolve();
    this.pieces.delete(rook.from);
    record.square = rook.to;
    record.group.userData.square = rook.to;
    this.pieces.set(rook.to, record);
    const start = record.group.position.clone();
    const target = squarePosition(rook.to);
    const startRotation = record.group.rotation.y;
    return new Promise((resolve) => {
      const delay = duration * 0.1;
      this._addTween(duration * 0.9, (raw) => {
        if (raw === 0) return;
        const adjusted = clamp((raw - delay) / (1 - delay), 0, 1);
        const e = easeInOutCubic(adjusted);
        record.group.position.set(
          lerp(start.x, target.x, e),
          BOARD_TOP + Math.sin(Math.PI * adjusted) * 0.34,
          lerp(start.z, target.z, e),
        );
        record.group.rotation.y = startRotation + Math.sin(Math.PI * adjusted) * 0.1;
      }, () => {
        record.group.position.copy(target);
        record.group.rotation.set(0, BASE_ROTATION[record.color] || 0, 0);
        resolve();
      });
    });
  }

  /**
   * Animate a legal move. The caller has already validated it with chess.js.
   * Returns a promise that resolves when the piece (and promotion) settles.
   */
  animateMove({ from, to, promotion = null, captured = null, rook = null } = {}) {
    if (!this.ready) return Promise.resolve(null);
    const record = this.pieces.get(from);
    if (!record) return Promise.resolve(null);

    const isKnight = record.type === 'n';
    const start = record.group.position.clone();
    const target = squarePosition(to);
    const distance = Math.hypot(target.x - start.x, target.z - start.z);
    const duration = isKnight ? 0.78 : 0.54 + Math.min(0.16, distance * 0.024);
    const lift = isKnight ? 1.48 : 0.3 + Math.min(0.34, distance * 0.045);
    const startRotation = record.group.rotation.y;
    const startScale = record.group.scale.clone();

    let captureSquare = captured?.square || null;
    if (!captureSquare && this.pieces.has(to) && to !== from) captureSquare = to;
    const capturedRecord = captureSquare ? this.pieces.get(captureSquare) : null;
    if (capturedRecord) this.pieces.delete(captureSquare);

    this.pieces.delete(from);
    record.square = to;
    record.group.userData.square = to;
    this.pieces.set(to, record);

    let captureTriggered = false;
    let landingTriggered = false;
    const movePromise = new Promise((resolve) => {
      this._addTween(duration, (raw) => {
        const t = clamp(raw, 0, 1);
        const eased = easeInOutCubic(t);
        const swing = Math.sin(Math.PI * t);
        const lateral = isKnight ? 0.045 : 0.06;
        record.group.position.set(
          lerp(start.x, target.x, eased) + swing * lateral * Math.sign(target.z - start.z || 1),
          BOARD_TOP + swing * lift,
          lerp(start.z, target.z, eased) - swing * lateral * Math.sign(target.x - start.x || 1),
        );
        record.group.rotation.y = startRotation + swing * (isKnight ? 0.2 : 0.075) * (target.x < start.x ? -1 : 1);
        record.group.rotation.z = swing * 0.018;
        if (t > 0.55) {
          record.group.scale.set(
            startScale.x * (1 + (t - 0.55) * 0.035),
            startScale.y * (1 - (t - 0.55) * 0.025),
            startScale.z * (1 + (t - 0.55) * 0.035),
          );
        }

        if (capturedRecord && !captureTriggered && t >= 0.58) {
          captureTriggered = true;
          const impactPosition = capturedRecord.group.position.clone();
          this.scene.remove(capturedRecord.group);
          this._captureBurst(capturedRecord, impactPosition);
          this.onImpact('capture', {
            square: captureSquare,
            color: capturedRecord.color,
            type: capturedRecord.type,
          });
        }

        if (t >= 1 && !landingTriggered) {
          landingTriggered = true;
          record.group.position.copy(target);
          record.group.rotation.set(0, BASE_ROTATION[record.color] || 0, 0);
          record.group.scale.copy(startScale);
          this._landingBurst(to, record.color, Boolean(capturedRecord));
          this.onImpact('place', { square: to, capture: Boolean(capturedRecord) });
        }
      }, resolve);
    });

    const rookPromise = this._animateRook(rook, duration);

    return Promise.all([movePromise, rookPromise]).then(async () => {
      let finalRecord = record;
      if (promotion) {
        finalRecord = await this._promote(record, promotion);
      }
      return { square: to, record: finalRecord };
    });
  }

  async _promote(record, promotion) {
    const square = record.square;
    const color = record.color;
    this.scene.remove(record.group);
    this.pieces.delete(square);
    const promoted = this._addPiece(color, promotion, square);
    const group = promoted.group;
    group.scale.setScalar(0.08);
    this.onImpact('promotion', { square, color, type: promotion });
    this._ringBurst(square, ACCENT[color], {
      maxScale: 2.6,
      life: 0.7,
      opacity: 0.8,
      width: 0.09,
    });
    await new Promise((resolve) => {
      this._addTween(0.5, (raw) => {
        const scale = Math.max(0.08, easeOutBack(raw));
        group.scale.setScalar(scale);
        group.position.y = BOARD_TOP + Math.sin(Math.PI * raw) * 0.16;
      }, () => {
        group.scale.setScalar(1);
        group.position.y = BOARD_TOP;
        resolve();
      });
    });
    return promoted;
  }

  /* ------------------------------------------------------------------------
     Effects
     ------------------------------------------------------------------------ */

  _ensureShardResources() {
    if (this.shardGeometries) return;
    this.shardGeometries = [
      new THREE.TetrahedronGeometry(0.13, 0),
      new THREE.BoxGeometry(0.2, 0.16, 0.12),
      new THREE.OctahedronGeometry(0.11, 0),
    ];
    this.shardMaterials = {
      w: [
        new THREE.MeshStandardMaterial({ color: 0xe6dfd0, roughness: 0.36, metalness: 0.08, envMapIntensity: 0.9 }),
        new THREE.MeshStandardMaterial({ color: 0xcbb894, roughness: 0.44, metalness: 0.06 }),
        new THREE.MeshStandardMaterial({
          color: 0xe9c87c,
          roughness: 0.23,
          metalness: 0.75,
          emissive: 0x8d5f20,
          emissiveIntensity: 0.35,
        }),
      ],
      b: [
        new THREE.MeshStandardMaterial({ color: 0x202026, roughness: 0.32, metalness: 0.14, envMapIntensity: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.26, metalness: 0.22 }),
        new THREE.MeshStandardMaterial({
          color: 0xd6b36a,
          roughness: 0.2,
          metalness: 0.86,
          emissive: 0x7f571b,
          emissiveIntensity: 0.42,
        }),
      ],
    };
  }

  _sparkBurst(position, color, count = 22, spread = 2.8) {
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = position.y + 0.2 + Math.random() * 0.55;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.3;
      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          1 + Math.random() * spread,
          (Math.random() - 0.5) * spread,
        ),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.1,
      map: this.textures.glow,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 8;
    this.effectsGroup.add(points);
    let age = 0;
    const life = 0.95;
    const effect = {
      update: (dt) => {
        age += dt;
        const attribute = geometry.attributes.position;
        for (let i = 0; i < count; i += 1) {
          const v = velocities[i];
          v.y -= 7.2 * dt;
          attribute.array[i * 3] += v.x * dt;
          attribute.array[i * 3 + 1] += v.y * dt;
          attribute.array[i * 3 + 2] += v.z * dt;
        }
        attribute.needsUpdate = true;
        material.opacity = Math.max(0, 1 - age / life) * 0.95;
        material.size = 0.1 * (1 - age / life * 0.45);
        return age < life;
      },
      dispose: () => {
        this.effectsGroup.remove(points);
        geometry.dispose();
        material.dispose();
      },
    };
    this.effects.add(effect);
  }

  _ringBurst(square, color, { maxScale = 3.5, life = 0.5, opacity = 0.7, width = 0.05 } = {}) {
    const coords = squareToCoords(square);
    if (!coords) return;
    const inner = 0.18;
    const outer = inner + width;
    const geometry = new THREE.RingGeometry(inner, outer, 72);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(boardX(coords.file), BOARD_TOP + 0.014, coords.rank - 3.5);
    mesh.renderOrder = 7;
    this.effectsGroup.add(mesh);
    let age = 0;
    const effect = {
      update: (dt) => {
        age += dt;
        const t = clamp(age / life, 0, 1);
        mesh.scale.setScalar(1 + easeOutCubic(t) * maxScale);
        material.opacity = (1 - t) * opacity;
        return age < life;
      },
      dispose: () => {
        this.effectsGroup.remove(mesh);
        geometry.dispose();
        material.dispose();
      },
    };
    this.effects.add(effect);
  }

  _landingBurst(square, color, heavy = false) {
    this._ringBurst(square, heavy ? ACCENT[color] : 0xb6c9db, {
      maxScale: heavy ? 3.2 : 1.4,
      life: heavy ? 0.46 : 0.3,
      opacity: heavy ? 0.5 : 0.32,
      width: 0.045,
    });
    const coords = squareToCoords(square);
    if (!coords) return;
    const position = new THREE.Vector3(boardX(coords.file), BOARD_TOP + 0.1, coords.rank - 3.5);
    const count = 7;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = position.x + (Math.random() - 0.5) * 0.35;
      positions[i * 3 + 1] = BOARD_TOP + 0.08;
      positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.35;
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.25 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9));
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: heavy ? ACCENT[color] : 0xb6c9db,
      size: heavy ? 0.065 : 0.04,
      map: this.textures.glow,
      transparent: true,
      opacity: heavy ? 0.65 : 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 7;
    this.effectsGroup.add(points);
    let age = 0;
    const life = heavy ? 0.7 : 0.4;
    const effect = {
      update: (dt) => {
        age += dt;
        const attribute = geometry.attributes.position;
        for (let i = 0; i < count; i += 1) {
          const v = velocities[i];
          v.y -= 2.4 * dt;
          attribute.array[i * 3] += v.x * dt;
          attribute.array[i * 3 + 1] += v.y * dt;
          attribute.array[i * 3 + 2] += v.z * dt;
        }
        attribute.needsUpdate = true;
        material.opacity = Math.max(0, 1 - age / life) * (heavy ? 0.65 : 0.4);
        return age < life;
      },
      dispose: () => {
        this.effectsGroup.remove(points);
        geometry.dispose();
        material.dispose();
      },
    };
    this.effects.add(effect);
  }

  _captureBurst(record, position) {
    this._ensureShardResources();
    const color = record.color;
    const height = this.pieceHeight[record.type] || 1;
    const group = new THREE.Group();
    group.position.copy(position);
    this.effectsGroup.add(group);

    const shardCount = 28;
    const shards = [];
    for (let i = 0; i < shardCount; i += 1) {
      const materialSet = this.shardMaterials[color];
      const isGold = i % 5 === 0;
      const material = materialSet[isGold ? 2 : i % 2];
      const geometry = this.shardGeometries[i % this.shardGeometries.length];
      const mesh = new THREE.Mesh(geometry, material);
      const radius = color === 'w' ? 0.24 : 0.25;
      mesh.position.set(
        (Math.random() - 0.5) * radius * 1.5,
        0.12 + Math.random() * Math.max(0.25, height * 0.62),
        (Math.random() - 0.5) * radius * 1.5,
      );
      const baseScale = (isGold ? 0.5 : 0.8) + Math.random() * (isGold ? 0.5 : 0.9);
      mesh.scale.setScalar(baseScale);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.castShadow = true;
      group.add(mesh);
      const outward = new THREE.Vector3(mesh.position.x, 0, mesh.position.z);
      if (outward.lengthSq() < 0.001) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      outward.normalize();
      shards.push({
        mesh,
        baseScale,
        velocity: new THREE.Vector3(
          outward.x * (1.5 + Math.random() * 3.4) + (Math.random() - 0.5) * 1.6,
          2.2 + Math.random() * 4.1,
          outward.z * (1.5 + Math.random() * 3.4) + (Math.random() - 0.5) * 1.6,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 16,
        ),
      });
    }

    // A flash core and expanding ground rings sell the impact.
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe7b1,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), flashMaterial);
    flash.position.y = Math.max(0.4, height * 0.42);
    flash.renderOrder = 8;
    group.add(flash);

    const light = new THREE.PointLight(ACCENT[color], 54, 8, 2);
    light.position.y = Math.max(0.4, height * 0.35);
    group.add(light);

    this._ringBurst(record.square, ACCENT[color], {
      maxScale: 5.0,
      life: 0.56,
      opacity: 0.72,
      width: 0.055,
    });
    this._ringBurst(record.square, 0xf6ead2, {
      maxScale: 2.5,
      life: 0.32,
      opacity: 0.8,
      width: 0.035,
    });
    this._sparkBurst(position.clone().add(new THREE.Vector3(0, 0.35, 0)), color === 'w' ? 0xffd997 : 0xc2cbff, 30, 3.4);
    this.addShake(0.36, 0.14);

    let age = 0;
    const life = 1.45;
    const effect = {
      update: (dt) => {
        age += dt;
        const t = clamp(age / life, 0, 1);
        for (const shard of shards) {
          shard.velocity.y -= 8.8 * dt;
          shard.mesh.position.addScaledVector(shard.velocity, dt);
          shard.mesh.rotation.x += shard.spin.x * dt;
          shard.mesh.rotation.y += shard.spin.y * dt;
          shard.mesh.rotation.z += shard.spin.z * dt;
          const fade = t > 0.72 ? Math.max(0.01, 1 - (t - 0.72) / 0.28) : 1;
          shard.mesh.scale.setScalar(shard.baseScale * fade);
        }
        const flashT = clamp(age / 0.32, 0, 1);
        flash.scale.setScalar(1 + flashT * 3.2);
        flashMaterial.opacity = (1 - flashT) * 0.9;
        light.intensity = Math.max(0, 54 * (1 - flashT) ** 2);
        return age < life;
      },
      dispose: () => {
        this.effectsGroup.remove(group);
        flash.geometry.dispose();
        flashMaterial.dispose();
      },
    };
    this.effects.add(effect);
  }

  _updateEffects(dt) {
    for (const effect of [...this.effects]) {
      let alive = true;
      try {
        alive = effect.update(dt);
      } catch {
        alive = false;
      }
      if (!alive) {
        this.effects.delete(effect);
        effect.dispose?.();
      }
    }
  }
}
