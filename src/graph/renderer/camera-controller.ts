import * as THREE from 'three';
import type { RenderNode, FrustumBounds } from './types';

const ZOOM_FACTOR = 1.2;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 1000;
const FIT_PADDING = 1.2;

export class CameraController {
  readonly camera: THREE.OrthographicCamera;
  private canvas: HTMLCanvasElement;
  private zoom = 1;

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private cameraStartX = 0;
  private cameraStartY = 0;

  // Drag state (for node dragging, coordinated by renderer)
  isDragging = false;
  dragNodeId: string | null = null;

  // Bound handlers for cleanup
  private onWheelBound: (e: WheelEvent) => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;

  // External callbacks
  onDragMove?: (worldX: number, worldY: number) => void;
  onPointerMoveWorld?: (screenX: number, screenY: number) => void;
  onClick?: (screenX: number, screenY: number) => void;
  onFrustumChange?: (bounds: FrustumBounds, zoom: number) => void;
  onFrustumChangeInternal?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);
    this.updateFrustum();

    this.onWheelBound = this.onWheel.bind(this);
    this.onPointerDownBound = this.onPointerDown.bind(this);
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onPointerUpBound = this.onPointerUp.bind(this);

    canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointermove', this.onPointerMoveBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointerleave', this.onPointerUpBound);
  }

  private updateFrustum() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const halfH = 1 / this.zoom;
    const halfW = halfH * aspect;

    // Symmetric frustum — camera.position handles panning via the view matrix.
    // Baking position into left/right/top/bottom double-counts the offset
    // (view matrix + projection matrix), causing label ↔ 3D desync.
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;
    const v = new THREE.Vector3(ndcX, ndcY, 0).unproject(this.camera);
    return { x: v.x, y: v.y };
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();

    const worldBefore = this.screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.updateFrustum();

    // Keep cursor world position stable
    const worldAfter = this.screenToWorld(e.clientX, e.clientY);
    this.camera.position.x += worldBefore.x - worldAfter.x;
    this.camera.position.y += worldBefore.y - worldAfter.y;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  private clickStartScreen = { x: 0, y: 0 };
  private pointerMoved = false;

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    this.clickStartScreen = { x: e.clientX, y: e.clientY };
    this.pointerMoved = false;

    if (!this.isDragging) {
      // Start pan
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.cameraStartX = this.camera.position.x;
      this.cameraStartY = this.camera.position.y;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  private onPointerMove(e: PointerEvent) {
    // Detect if pointer has moved significantly (for click vs drag detection)
    const dx = e.clientX - this.clickStartScreen.x;
    const dy = e.clientY - this.clickStartScreen.y;
    if (dx * dx + dy * dy > 9) this.pointerMoved = true;

    if (this.isDragging) {
      const world = this.screenToWorld(e.clientX, e.clientY);
      this.onDragMove?.(world.x, world.y);
      return;
    }

    if (this.isPanning) {
      const pixelToWorld = (this.camera.right - this.camera.left) / this.canvas.clientWidth;
      this.camera.position.x = this.cameraStartX - (e.clientX - this.panStartX) * pixelToWorld;
      this.camera.position.y = this.cameraStartY + (e.clientY - this.panStartY) * pixelToWorld;
      this.updateFrustum();
      this.fireFrustumChange();
      return;
    }

    // Hover
    this.onPointerMoveWorld?.(e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent) {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = '';
    }

    if (!this.pointerMoved && !this.isDragging) {
      this.onClick?.(e.clientX, e.clientY);
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.dragNodeId = null;
    }
  }

  startDrag(nodeId: string) {
    this.isPanning = false;
    this.isDragging = true;
    this.dragNodeId = nodeId;
    this.canvas.style.cursor = 'grabbing';
  }

  zoomIn() {
    this.zoom = Math.min(MAX_ZOOM, this.zoom * ZOOM_FACTOR);
    this.updateFrustum();
    this.fireFrustumChange();
  }

  zoomOut() {
    this.zoom = Math.max(MIN_ZOOM, this.zoom / ZOOM_FACTOR);
    this.updateFrustum();
    this.fireFrustumChange();
  }

  fitToView(nodes: RenderNode[], targetIds?: string[]) {
    const targets = targetIds
      ? nodes.filter((n) => targetIds.includes(n.id))
      : nodes;

    if (targets.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const n of targets) {
      minX = Math.min(minX, n.x - n.size);
      maxX = Math.max(maxX, n.x + n.size);
      minY = Math.min(minY, n.y - n.size);
      maxY = Math.max(maxY, n.y + n.size);
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = (maxX - minX) * FIT_PADDING;
    const height = (maxY - minY) * FIT_PADDING;

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const viewW = Math.max(width, height * aspect);
    this.zoom = Math.max(MIN_ZOOM, 2 / viewW);

    this.camera.position.x = cx;
    this.camera.position.y = cy;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  getFrustumBounds(): FrustumBounds {
    return {
      minX: this.camera.position.x + this.camera.left,
      maxX: this.camera.position.x + this.camera.right,
      minY: this.camera.position.y + this.camera.bottom,
      maxY: this.camera.position.y + this.camera.top,
    };
  }

  getZoom(): number {
    return this.zoom;
  }

  private fireFrustumChange() {
    this.onFrustumChangeInternal?.();
    this.onFrustumChange?.(this.getFrustumBounds(), this.zoom);
  }

  fitToRegion(minX: number, minY: number, maxX: number, maxY: number) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = (maxX - minX) * FIT_PADDING;
    const height = (maxY - minY) * FIT_PADDING;

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const viewW = Math.max(width, height * aspect);
    this.zoom = Math.max(MIN_ZOOM, 2 / viewW);

    this.camera.position.x = cx;
    this.camera.position.y = cy;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  resize() {
    this.updateFrustum();
    this.fireFrustumChange();
  }

  dispose() {
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.canvas.removeEventListener('pointerleave', this.onPointerUpBound);
  }
}
