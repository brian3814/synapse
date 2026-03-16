import * as THREE from 'three';
import type { RenderNode, RenderTheme, ZoomLevel, ViewMode } from './types';

const FONT_SIZE = 11;
const FONT = `${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const LABEL_Y_OFFSET_PX = 14; // pixels below node center

/**
 * Label layer using a 2D canvas overlay on top of the WebGL canvas.
 * This avoids needing custom shaders or per-instance UV mapping.
 * Labels are drawn with native canvas text rendering (CSP-safe, fast).
 */
export class LabelLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private zoomLevel: ZoomLevel = 'close';
  private viewMode: ViewMode = '2d';
  private readonly _v3 = new THREE.Vector3();

  // Dirty tracking: skip redraw if world-space view bounds and node count haven't changed
  private lastWorldLeft = NaN;
  private lastWorldRight = NaN;
  private lastWorldTop = NaN;
  private lastWorldBottom = NaN;
  private lastNodeCount = -1;
  dirty = true;

  constructor(container: HTMLElement) {
    this.dpr = window.devicePixelRatio || 1;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
  }

  setZoomLevel(level: ZoomLevel) {
    this.zoomLevel = level;
  }

  setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.dirty = true;
  }

  resize(width: number, height: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
  }

  update(
    nodes: RenderNode[],
    theme: RenderTheme,
    camera: THREE.Camera,
    canvasWidth: number,
    canvasHeight: number
  ) {
    const ctx = this.ctx;
    const dpr = this.dpr;

    // Compute world-space view bounds for dirty check
    let worldLeft: number, worldRight: number, worldTop: number, worldBottom: number;
    if (camera instanceof THREE.OrthographicCamera) {
      worldLeft = camera.position.x + camera.left;
      worldRight = camera.position.x + camera.right;
      worldTop = camera.position.y + camera.top;
      worldBottom = camera.position.y + camera.bottom;
    } else {
      // For perspective camera, use matrixWorld elements as a robust proxy
      const m = camera.matrixWorldInverse.elements;
      worldLeft = m[0] + m[4];
      worldRight = m[1] + m[5];
      worldTop = m[2] + m[6];
      worldBottom = m[12] + m[13];
    }

    // Skip if world bounds and data haven't changed
    if (
      !this.dirty &&
      worldLeft === this.lastWorldLeft &&
      worldRight === this.lastWorldRight &&
      worldTop === this.lastWorldTop &&
      worldBottom === this.lastWorldBottom &&
      nodes.length === this.lastNodeCount
    ) {
      return;
    }
    this.lastWorldLeft = worldLeft;
    this.lastWorldRight = worldRight;
    this.lastWorldTop = worldTop;
    this.lastWorldBottom = worldBottom;
    this.lastNodeCount = nodes.length;
    this.dirty = false;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Skip labels at far/medium zoom — they become unreadable noise
    if (this.zoomLevel === 'far' || this.zoomLevel === 'medium') return;

    if (nodes.length === 0) return;

    ctx.font = `${FONT_SIZE * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.labelColor;

    // View bounds for 2D projection
    let viewWidth = 0, viewHeight = 0;
    if (camera instanceof THREE.OrthographicCamera) {
      viewWidth = (camera.position.x + camera.right) - (camera.position.x + camera.left);
      viewHeight = (camera.position.y + camera.top) - (camera.position.y + camera.bottom);
    }

    // Only show labels when zoomed in enough (skip when too many visible)
    // At wide zoom, labels become unreadable noise
    const maxLabelsToRender = 200;
    let rendered = 0;

    for (const node of nodes) {
      if (rendered >= maxLabelsToRender) break;

      let screenX: number, screenY: number;

      if (this.viewMode === '3d') {
        this._v3.set(node.x, node.y, node.z ?? 0);
        this._v3.project(camera);
        if (this._v3.z > 1) continue; // behind camera
        screenX = (this._v3.x * 0.5 + 0.5) * canvasWidth;
        screenY = (-this._v3.y * 0.5 + 0.5) * canvasHeight;
      } else {
        const ortho = camera as THREE.OrthographicCamera;
        const wLeft = ortho.position.x + ortho.left;
        const wTop = ortho.position.y + ortho.top;
        screenX = ((node.x - wLeft) / viewWidth) * canvasWidth;
        screenY = ((wTop - node.y) / viewHeight) * canvasHeight;
      }

      // Frustum cull
      if (screenX < -50 || screenX > canvasWidth + 50 ||
          screenY < -20 || screenY > canvasHeight + 20) {
        continue;
      }

      ctx.fillText(
        node.label,
        screenX * dpr,
        (screenY + LABEL_Y_OFFSET_PX) * dpr
      );
      rendered++;
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose() {
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
