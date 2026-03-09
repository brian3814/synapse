import * as THREE from 'three';
import type { RenderNode, RenderTheme } from './types';

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
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (nodes.length === 0) return;

    ctx.font = `${FONT_SIZE * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.labelColor;

    // Compute view bounds for frustum culling
    const viewWidth = camera.right - camera.left;
    const viewHeight = camera.top - camera.bottom;

    // Only show labels when zoomed in enough (skip when too many visible)
    // At wide zoom, labels become unreadable noise
    const maxLabelsToRender = 200;
    let rendered = 0;

    for (const node of nodes) {
      if (rendered >= maxLabelsToRender) break;

      // Project world position to screen
      const screenX = ((node.x - camera.left) / viewWidth) * canvasWidth;
      const screenY = ((camera.top - node.y) / viewHeight) * canvasHeight;

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

  dispose() {
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
