import * as THREE from 'three';
import type { RenderNode, FrustumBounds, Modifiers } from './types';

const ZOOM_FACTOR = 1.2;
const MIN_ZOOM = 0.001;
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

  // Lasso state
  private isLassoing = false;
  private lassoStart = { x: 0, y: 0 };
  private lassoEnd = { x: 0, y: 0 };

  // Bound handlers for cleanup
  private onWheelBound: (e: WheelEvent) => void;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;

  // External callbacks
  onNodeHitTest?: (screenX: number, screenY: number) => string | null;
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (worldX: number, worldY: number) => void;
  onPointerMoveWorld?: (screenX: number, screenY: number) => void;
  onClick?: (screenX: number, screenY: number, modifiers: Modifiers) => void;
  onDragEnd?: (nodeId: string, worldX: number, worldY: number) => void;
  onLassoUpdate?: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  onLassoEnd?: (start: { x: number; y: number }, end: { x: number; y: number }, modifiers: Modifiers) => void;
  onFrustumChange?: (bounds: FrustumBounds, zoom: number) => void;
  onFrustumChangeInternal?: () => void;
  onContextMenu?: (screenX: number, screenY: number) => void;

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
    this.onContextMenuBound = this.handleContextMenu.bind(this);

    canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointermove', this.onPointerMoveBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointerleave', this.onPointerUpBound);
    canvas.addEventListener('contextmenu', this.onContextMenuBound);
  }

  private updateFrustum() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const halfH = 1 / this.zoom;
    const halfW = halfH * aspect;

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

    const worldAfter = this.screenToWorld(e.clientX, e.clientY);
    this.camera.position.x += worldBefore.x - worldAfter.x;
    this.camera.position.y += worldBefore.y - worldAfter.y;
    this.updateFrustum();
    this.fireFrustumChange();
  }

  private clickStartScreen = { x: 0, y: 0 };
  private pointerMoved = false;
  private pendingDragNodeId: string | null = null; // node under pointer, awaiting movement threshold

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    this.clickStartScreen = { x: e.clientX, y: e.clientY };
    this.pointerMoved = false;
    this.pendingDragNodeId = null;

    if (e.shiftKey && !this.isDragging) {
      this.isLassoing = true;
      const world = this.screenToWorld(e.clientX, e.clientY);
      this.lassoStart = world;
      this.lassoEnd = world;
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (!this.isDragging) {
      // Check if pointer is on a node — don't start drag yet, wait for movement
      const nodeId = this.onNodeHitTest?.(e.clientX, e.clientY);
      if (nodeId) {
        this.pendingDragNodeId = nodeId;
        // Don't start pan either — wait for move threshold to decide
        return;
      }
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.cameraStartX = this.camera.position.x;
      this.cameraStartY = this.camera.position.y;
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

    // Promote pending drag to active drag once movement threshold is crossed
    if (this.pendingDragNodeId && this.pointerMoved) {
      this.startDrag(this.pendingDragNodeId);
      this.onDragStart?.(this.pendingDragNodeId);
      this.pendingDragNodeId = null;
    }

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

    this.onPointerMoveWorld?.(e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent) {
    const hadPendingDrag = this.pendingDragNodeId !== null;
    this.pendingDragNodeId = null;

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

    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = '';
    }

    if (!this.pointerMoved && !this.isDragging) {
      // Click — fire regardless of whether we had a pending drag (that means node was clicked without moving)
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

  private handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    this.onContextMenu?.(e.clientX, e.clientY);
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
    const targets = targetIds ? nodes.filter((n) => targetIds.includes(n.id)) : nodes;
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
    const maxFocusZoom = targets.length <= 3 ? 0.15 : MAX_ZOOM;
    this.zoom = Math.max(MIN_ZOOM, Math.min(maxFocusZoom, 2 / viewW));

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
    this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
  }
}
