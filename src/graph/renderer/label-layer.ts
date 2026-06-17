import * as THREE from 'three';
import type { RenderNode, RenderTheme, ZoomLevel } from './types';
import { selectVisibleLabels } from './label-visibility';

const FONT_SIZE = 16;
const LABEL_Y_OFFSET_PX = 18;

export class LabelLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private zoomLevel: ZoomLevel = 'close';
  private rawZoom = 1;

  private lastWorldLeft = NaN;
  private lastWorldRight = NaN;
  private lastWorldTop = NaN;
  private lastWorldBottom = NaN;
  private lastNodeCount = -1;
  private lastRawZoom = NaN;
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

  setRawZoom(zoom: number) {
    if (zoom !== this.rawZoom) {
      this.rawZoom = zoom;
      this.dirty = true;
    }
  }

  resize(width: number, height: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
  }

  update(
    nodes: RenderNode[],
    theme: RenderTheme,
    camera: THREE.OrthographicCamera,
    canvasWidth: number,
    canvasHeight: number
  ) {
    const ctx = this.ctx;
    const dpr = this.dpr;

    const worldLeft = camera.position.x + camera.left;
    const worldRight = camera.position.x + camera.right;
    const worldTop = camera.position.y + camera.top;
    const worldBottom = camera.position.y + camera.bottom;

    if (
      !this.dirty &&
      worldLeft === this.lastWorldLeft &&
      worldRight === this.lastWorldRight &&
      worldTop === this.lastWorldTop &&
      worldBottom === this.lastWorldBottom &&
      nodes.length === this.lastNodeCount &&
      this.rawZoom === this.lastRawZoom
    ) {
      return;
    }
    this.lastWorldLeft = worldLeft;
    this.lastWorldRight = worldRight;
    this.lastWorldTop = worldTop;
    this.lastWorldBottom = worldBottom;
    this.lastNodeCount = nodes.length;
    this.lastRawZoom = this.rawZoom;
    this.dirty = false;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (nodes.length === 0) return;

    const viewWidth = worldRight - worldLeft;
    const viewHeight = worldTop - worldBottom;

    // Frustum-cull nodes first
    const culled: RenderNode[] = [];
    for (const node of nodes) {
      const screenX = ((node.x - worldLeft) / viewWidth) * canvasWidth;
      const screenY = ((worldTop - node.y) / viewHeight) * canvasHeight;
      if (screenX >= -50 && screenX <= canvasWidth + 50 &&
          screenY >= -20 && screenY <= canvasHeight + 20) {
        culled.push(node);
      }
    }

    const visible = selectVisibleLabels(culled, this.rawZoom);
    if (visible.length === 0) return;

    ctx.font = `${FONT_SIZE * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    let currentOpacity = -1;
    for (const { node, opacity } of visible) {
      if (opacity !== currentOpacity) {
        currentOpacity = opacity;
        ctx.globalAlpha = opacity;
        ctx.fillStyle = theme.labelColor;
      }

      const screenX = ((node.x - worldLeft) / viewWidth) * canvasWidth;
      const screenY = ((worldTop - node.y) / viewHeight) * canvasHeight;

      ctx.fillText(
        node.name,
        screenX * dpr,
        (screenY + LABEL_Y_OFFSET_PX) * dpr
      );
    }

    ctx.globalAlpha = 1.0;
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
