import type { RenderNode } from './types';

export class SpatialHash {
  private cellSize: number;
  private cells = new Map<string, RenderNode[]>();

  constructor(cellSize = 10) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellCoords(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize),
    };
  }

  insert(node: RenderNode) {
    // Node can overlap up to 4 cells based on its size
    const r = node.size;
    const minC = this.cellCoords(node.x - r, node.y - r);
    const maxC = this.cellCoords(node.x + r, node.y + r);

    for (let cx = minC.cx; cx <= maxC.cx; cx++) {
      for (let cy = minC.cy; cy <= maxC.cy; cy++) {
        const k = this.key(cx, cy);
        let cell = this.cells.get(k);
        if (!cell) {
          cell = [];
          this.cells.set(k, cell);
        }
        cell.push(node);
      }
    }
  }

  remove(node: RenderNode) {
    const r = node.size;
    const minC = this.cellCoords(node.x - r, node.y - r);
    const maxC = this.cellCoords(node.x + r, node.y + r);

    for (let cx = minC.cx; cx <= maxC.cx; cx++) {
      for (let cy = minC.cy; cy <= maxC.cy; cy++) {
        const k = this.key(cx, cy);
        const cell = this.cells.get(k);
        if (cell) {
          const idx = cell.indexOf(node);
          if (idx !== -1) cell.splice(idx, 1);
          if (cell.length === 0) this.cells.delete(k);
        }
      }
    }
  }

  /** Query all candidate nodes near a world point. */
  query(wx: number, wy: number, radius: number): RenderNode[] {
    const minC = this.cellCoords(wx - radius, wy - radius);
    const maxC = this.cellCoords(wx + radius, wy + radius);
    const seen = new Set<string>();
    const result: RenderNode[] = [];

    for (let cx = minC.cx; cx <= maxC.cx; cx++) {
      for (let cy = minC.cy; cy <= maxC.cy; cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (!cell) continue;
        for (const node of cell) {
          if (!seen.has(node.id)) {
            seen.add(node.id);
            result.push(node);
          }
        }
      }
    }
    return result;
  }

  rebuild(nodes: RenderNode[]) {
    this.cells.clear();
    for (const node of nodes) {
      this.insert(node);
    }
  }

  clear() {
    this.cells.clear();
  }
}
