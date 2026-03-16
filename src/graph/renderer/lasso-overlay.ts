import * as THREE from 'three';

/**
 * CSS div overlay for lasso selection rectangle.
 * Doesn't interfere with the Three.js scene or label canvas.
 */
export class LassoOverlay {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.position = 'absolute';
    this.el.style.border = '2px dashed #6366f1';
    this.el.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
    this.el.style.pointerEvents = 'none';
    this.el.style.zIndex = '10';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  update(
    startWorld: { x: number; y: number },
    endWorld: { x: number; y: number },
    camera: THREE.OrthographicCamera,
    canvasW: number,
    canvasH: number
  ) {
    const s = this.worldToScreen(startWorld, camera, canvasW, canvasH);
    const e = this.worldToScreen(endWorld, camera, canvasW, canvasH);

    const left = Math.min(s.x, e.x);
    const top = Math.min(s.y, e.y);
    const width = Math.abs(e.x - s.x);
    const height = Math.abs(e.y - s.y);

    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    this.el.style.display = 'block';
  }

  hide() {
    this.el.style.display = 'none';
  }

  dispose() {
    this.el.remove();
  }

  private worldToScreen(
    world: { x: number; y: number },
    camera: THREE.OrthographicCamera,
    canvasW: number,
    canvasH: number
  ): { x: number; y: number } {
    const viewWidth = camera.right - camera.left;
    const viewHeight = camera.top - camera.bottom;
    const worldLeft = camera.position.x + camera.left;
    const worldTop = camera.position.y + camera.top;

    return {
      x: ((world.x - worldLeft) / viewWidth) * canvasW,
      y: ((worldTop - world.y) / viewHeight) * canvasH,
    };
  }
}
