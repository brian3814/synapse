import * as THREE from 'three';
import type { RenderNode, FrustumBounds, Modifiers, ViewMode } from './types';

const ZOOM_FACTOR = 1.2;
const MIN_ZOOM = 0.001;
const MAX_ZOOM = 1000;
const FIT_PADDING = 1.2;

// 3D orbit defaults
const DEFAULT_FOV = 60;
const MIN_ORBIT_RADIUS = 1;
const MAX_ORBIT_RADIUS = 5000;
const ORBIT_SPEED = 0.005;
const PAN3D_SPEED = 0.003;

export class CameraController {
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  private orthoCamera: THREE.OrthographicCamera;
  private perspCamera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private zoom = 1;
  viewMode: ViewMode = '2d';

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private cameraStartX = 0;
  private cameraStartY = 0;

  // Drag state (for node dragging, coordinated by renderer)
  isDragging = false;
  dragNodeId: string | null = null;

  // Lasso state
  private isLassoing = false;
  private lassoStart = { x: 0, y: 0 };
  private lassoEnd = { x: 0, y: 0 };

  // 3D orbit state
  private isOrbiting = false;
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitRadius = 200;
  private orbitTheta = 0; // azimuthal (horizontal)
  private orbitPhi = Math.PI / 3; // polar (vertical), start angled
  private orbitStartX = 0;
  private orbitStartY = 0;
  private orbitStartTheta = 0;
  private orbitStartPhi = 0;

  // Bound handlers for cleanup
  private onWheelBound: (e: WheelEvent) => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onContextMenuBound: (e: Event) => void;

  // External callbacks
  onDragMove?: (worldX: number, worldY: number) => void;
  onPointerMoveWorld?: (screenX: number, screenY: number) => void;
  onClick?: (screenX: number, screenY: number, modifiers: Modifiers) => void;
  onDragEnd?: (nodeId: string, worldX: number, worldY: number) => void;
  onLassoUpdate?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  onLassoEnd?: (start: { x: number; y: number }, end: { x: number; y: number }, modifiers: Modifiers) => void;
  onFrustumChange?: (bounds: FrustumBounds, zoom: number) => void;
  onFrustumChangeInternal?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // 2D camera
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.orthoCamera.position.set(0, 0, 10);
    this.orthoCamera.lookAt(0, 0, 0);

    // 3D camera
    const aspect = canvas.clientWidth / (canvas.clientHeight || 1);
    this.perspCamera = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.1, 10000);
    this.perspCamera.position.set(0, 100, 200);
    this.perspCamera.lookAt(0, 0, 0);

    this.camera = this.orthoCamera;
    this.updateFrustum();

    this.onWheelBound = this.onWheel.bind(this);
    this.onPointerDownBound = this.onPointerDown.bind(this);
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onPointerUpBound = this.onPointerUp.bind(this);
    this.onContextMenuBound = (e: Event) => { if (this.viewMode === '3d') e.preventDefault(); };

    canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointermove', this.onPointerMoveBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointerleave', this.onPointerUpBound);
    canvas.addEventListener('contextmenu', this.onContextMenuBound);
  }

  setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    if (mode === '3d') {
      this.camera = this.perspCamera;
      this.updateOrbitCamera();
    } else {
      this.camera = this.orthoCamera;
      this.updateFrustum();
    }
    this.fireFrustumChange();
  }

  private updateFrustum() {
    if (this.viewMode === '3d') return;
    const cam = this.orthoCamera;
    const aspect = this.canvas.clientWidth / (this.canvas.clientHeight || 1);
    const halfH = 1 / this.zoom;
    const halfW = halfH * aspect;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
  }

  private updateOrbitCamera() {
    const sinPhi = Math.sin(this.orbitPhi);
    const cosPhi = Math.cos(this.orbitPhi);
    const sinTheta = Math.sin(this.orbitTheta);
    const cosTheta = Math.cos(this.orbitTheta);

    this.perspCamera.position.set(
      this.orbitTarget.x + this.orbitRadius * sinPhi * sinTheta,
      this.orbitTarget.y + this.orbitRadius * cosPhi,
      this.orbitTarget.z + this.orbitRadius * sinPhi * cosTheta
    );
    this.perspCamera.lookAt(this.orbitTarget);
    this.perspCamera.updateProjectionMatrix();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    if (this.viewMode === '3d') {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.perspCamera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(plane, target);
      if (hit) return { x: target.x, y: target.z };
      return { x: 0, y: 0 };
    }

    const v = new THREE.Vector3(ndcX, ndcY, 0).unproject(this.orthoCamera);
    return { x: v.x, y: v.y };
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();

    if (this.viewMode === '3d') {
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.orbitRadius = Math.max(MIN_ORBIT_RADIUS, Math.min(MAX_ORBIT_RADIUS, this.orbitRadius * factor));
      this.updateOrbitCamera();
      this.fireFrustumChange();
      return;
    }

    const worldBefore = this.screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.updateFrustum();

    const worldAfter = this.screenToWorld(e.clientX, e.clientY);
    this.orthoCamera.position.x += worldBefore.x - worldAfter.x;
    this.orthoCamera.position.y += worldBefore.y - worldAfter.y;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  private clickStartScreen = { x: 0, y: 0 };
  private pointerMoved = false;
  private activeButton = 0;

  private onPointerDown(e: PointerEvent) {
    this.activeButton = e.button;
    this.clickStartScreen = { x: e.clientX, y: e.clientY };
    this.pointerMoved = false;

    // Lasso: shift+left-click in any mode
    if (e.button === 0 && e.shiftKey && !this.isDragging) {
      this.isLassoing = true;
      const world = this.screenToWorld(e.clientX, e.clientY);
      this.lassoStart = world;
      this.lassoEnd = world;
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this.viewMode === '3d') {
      if (e.button === 0 && !this.isDragging) {
        // Left-click: orbit
        this.isOrbiting = true;
        this.orbitStartX = e.clientX;
        this.orbitStartY = e.clientY;
        this.orbitStartTheta = this.orbitTheta;
        this.orbitStartPhi = this.orbitPhi;
        this.canvas.style.cursor = 'grab';
      } else if (e.button === 2) {
        // Right-click: pan in 3D
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.canvas.style.cursor = 'move';
      }
      return;
    }

    // 2D mode
    if (e.button !== 0) return;
    if (!this.isDragging) {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.cameraStartX = this.orthoCamera.position.x;
      this.cameraStartY = this.orthoCamera.position.y;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private onPointerMove(e: PointerEvent) {
    const dx = e.clientX - this.clickStartScreen.x;
    const dy = e.clientY - this.clickStartScreen.y;
    if (dx * dx + dy * dy > 9) this.pointerMoved = true;

    if (this.isLassoing) {
      this.lassoEnd = this.screenToWorld(e.clientX, e.clientY);
      this.onLassoUpdate?.(this.lassoStart, this.lassoEnd);
      return;
    }

    if (this.isDragging) {
      const world = this.screenToWorld(e.clientX, e.clientY);
      this.onDragMove?.(world.x, world.y);
      return;
    }

    if (this.viewMode === '3d') {
      if (this.isOrbiting) {
        const deltaX = e.clientX - this.orbitStartX;
        const deltaY = e.clientY - this.orbitStartY;
        this.orbitTheta = this.orbitStartTheta - deltaX * ORBIT_SPEED;
        this.orbitPhi = Math.max(0.1, Math.min(Math.PI - 0.1,
          this.orbitStartPhi - deltaY * ORBIT_SPEED));
        this.updateOrbitCamera();
        this.fireFrustumChange();
        return;
      }
      if (this.isPanning) {
        const deltaX = e.clientX - this.panStartX;
        const deltaY = e.clientY - this.panStartY;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;

        // Pan perpendicular to camera look direction
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        this.perspCamera.getWorldDirection(new THREE.Vector3());
        right.setFromMatrixColumn(this.perspCamera.matrixWorld, 0);
        up.setFromMatrixColumn(this.perspCamera.matrixWorld, 1);
        const scale = this.orbitRadius * PAN3D_SPEED;
        this.orbitTarget.addScaledVector(right, -deltaX * scale / this.canvas.clientWidth);
        this.orbitTarget.addScaledVector(up, deltaY * scale / this.canvas.clientHeight);
        this.updateOrbitCamera();
        this.fireFrustumChange();
        return;
      }
      this.onPointerMoveWorld?.(e.clientX, e.clientY);
      return;
    }

    // 2D mode
    if (this.isPanning) {
      const pixelToWorld = (this.orthoCamera.right - this.orthoCamera.left) / this.canvas.clientWidth;
      this.orthoCamera.position.x = this.cameraStartX - (e.clientX - this.panStartX) * pixelToWorld;
      this.orthoCamera.position.y = this.cameraStartY + (e.clientY - this.panStartY) * pixelToWorld;
      this.updateFrustum();
      this.fireFrustumChange();
      return;
    }

    this.onPointerMoveWorld?.(e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent) {
    if (this.isLassoing) {
      this.isLassoing = false;
      this.canvas.style.cursor = '';
      if (this.pointerMoved) {
        this.onLassoEnd?.(this.lassoStart, this.lassoEnd, {
          ctrl: e.metaKey || e.ctrlKey,
          shift: e.shiftKey,
        });
      }
      return;
    }

    if (this.isOrbiting) {
      this.isOrbiting = false;
      this.canvas.style.cursor = '';
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = '';
    }

    if (!this.pointerMoved && !this.isDragging && this.activeButton === 0) {
      this.onClick?.(e.clientX, e.clientY, {
        ctrl: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
      });
    }

    if (this.isDragging) {
      const nodeId = this.dragNodeId;
      this.isDragging = false;
      this.dragNodeId = null;
      if (nodeId) {
        const world = this.screenToWorld(e.clientX, e.clientY);
        this.onDragEnd?.(nodeId, world.x, world.y);
      }
    }
  }

  startDrag(nodeId: string) {
    this.isPanning = false;
    this.isOrbiting = false;
    this.isDragging = true;
    this.dragNodeId = nodeId;
    this.canvas.style.cursor = 'grabbing';
  }

  zoomIn() {
    if (this.viewMode === '3d') {
      this.orbitRadius = Math.max(MIN_ORBIT_RADIUS, this.orbitRadius / ZOOM_FACTOR);
      this.updateOrbitCamera();
      this.fireFrustumChange();
      return;
    }
    this.zoom = Math.min(MAX_ZOOM, this.zoom * ZOOM_FACTOR);
    this.updateFrustum();
    this.fireFrustumChange();
  }

  zoomOut() {
    if (this.viewMode === '3d') {
      this.orbitRadius = Math.min(MAX_ORBIT_RADIUS, this.orbitRadius * ZOOM_FACTOR);
      this.updateOrbitCamera();
      this.fireFrustumChange();
      return;
    }
    this.zoom = Math.max(MIN_ZOOM, this.zoom / ZOOM_FACTOR);
    this.updateFrustum();
    this.fireFrustumChange();
  }

  fitToView(nodes: RenderNode[], targetIds?: string[]) {
    const targets = targetIds ? nodes.filter((n) => targetIds.includes(n.id)) : nodes;
    if (targets.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const n of targets) {
      minX = Math.min(minX, n.x - n.size);
      maxX = Math.max(maxX, n.x + n.size);
      minY = Math.min(minY, n.y - n.size);
      maxY = Math.max(maxY, n.y + n.size);
      minZ = Math.min(minZ, (n.z ?? 0) - n.size);
      maxZ = Math.max(maxZ, (n.z ?? 0) + n.size);
    }

    if (this.viewMode === '3d') {
      this.orbitTarget.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * FIT_PADDING;
      this.orbitRadius = Math.max(MIN_ORBIT_RADIUS, extent * 1.5);
      this.orbitPhi = Math.PI / 3;
      this.orbitTheta = 0;
      this.updateOrbitCamera();
      this.fireFrustumChange();
      return;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = (maxX - minX) * FIT_PADDING;
    const height = (maxY - minY) * FIT_PADDING;

    const aspect = this.canvas.clientWidth / (this.canvas.clientHeight || 1);
    const viewW = Math.max(width, height * aspect);
    this.zoom = Math.max(MIN_ZOOM, 2 / viewW);

    this.orthoCamera.position.x = cx;
    this.orthoCamera.position.y = cy;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  getFrustumBounds(): FrustumBounds {
    if (this.viewMode === '3d') {
      // Approximate: return orbit target region
      const half = this.orbitRadius;
      return {
        minX: this.orbitTarget.x - half,
        maxX: this.orbitTarget.x + half,
        minY: this.orbitTarget.y - half,
        maxY: this.orbitTarget.y + half,
      };
    }
    return {
      minX: this.orthoCamera.position.x + this.orthoCamera.left,
      maxX: this.orthoCamera.position.x + this.orthoCamera.right,
      minY: this.orthoCamera.position.y + this.orthoCamera.bottom,
      maxY: this.orthoCamera.position.y + this.orthoCamera.top,
    };
  }

  getZoom(): number {
    return this.viewMode === '3d' ? 200 / this.orbitRadius : this.zoom;
  }

  private fireFrustumChange() {
    this.onFrustumChangeInternal?.();
    this.onFrustumChange?.(this.getFrustumBounds(), this.getZoom());
  }

  fitToRegion(minX: number, minY: number, maxX: number, maxY: number) {
    if (this.viewMode === '3d') {
      this.orbitTarget.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
      this.orbitRadius = Math.max(maxX - minX, maxY - minY) * 1.5;
      this.updateOrbitCamera();
      this.fireFrustumChange();
      return;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = (maxX - minX) * FIT_PADDING;
    const height = (maxY - minY) * FIT_PADDING;
    const aspect = this.canvas.clientWidth / (this.canvas.clientHeight || 1);
    const viewW = Math.max(width, height * aspect);
    this.zoom = Math.max(MIN_ZOOM, 2 / viewW);
    this.orthoCamera.position.x = cx;
    this.orthoCamera.position.y = cy;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  resize() {
    if (this.viewMode === '3d') {
      this.perspCamera.aspect = this.canvas.clientWidth / (this.canvas.clientHeight || 1);
      this.perspCamera.updateProjectionMatrix();
    }
    this.updateFrustum();
    this.fireFrustumChange();
  }

  dispose() {
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.canvas.removeEventListener('pointerleave', this.onPointerUpBound);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
  }
}
