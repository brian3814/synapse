import * as THREE from 'three';
import type { RenderNode, RenderEdge, RenderTheme, ZoomLevel } from './types';

const ARROW_RADIUS = 0.15;
const ARROW_HEIGHT = 0.3;
const ARROW_SEGMENTS = 4;

export class EdgeMesh {
  readonly linesMesh: THREE.LineSegments;
  readonly arrowMesh: THREE.InstancedMesh;

  private edgeIds: string[] = [];
  private edgeIndexMap = new Map<string, number>();
  private freeSlots: number[] = [];
  private edgeCount = 0;
  private directedCount = 0;
  private directedEdgeIndices: number[] = []; // maps arrow instance → edge index

  private positionAttr!: THREE.Float32BufferAttribute;
  private lineColorAttr!: THREE.Float32BufferAttribute;

  private readonly _color = new THREE.Color();
  private readonly _mat = new THREE.Matrix4();
  private readonly _quat = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _dir = new THREE.Vector3();

  constructor(initialCapacity = 4096) {
    // Line segments: 2 vertices per edge, 3 floats per vertex
    const lineGeo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.Float32BufferAttribute(
      new Float32Array(initialCapacity * 2 * 3), 3
    );
    this.lineColorAttr = new THREE.Float32BufferAttribute(
      new Float32Array(initialCapacity * 2 * 3), 3
    );
    lineGeo.setAttribute('position', this.positionAttr);
    lineGeo.setAttribute('color', this.lineColorAttr);

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
    });
    this.linesMesh = new THREE.LineSegments(lineGeo, lineMat);
    this.linesMesh.renderOrder = 0;
    this.linesMesh.frustumCulled = false;

    // Arrows: instanced cones for directed edges
    const arrowGeo = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, ARROW_SEGMENTS);
    // Cone tip is at +Y by default; setFromUnitVectors(+Y, dir) orients it correctly
    const arrowMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
    });
    this.arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, initialCapacity);
    this.arrowMesh.count = 0;
    this.arrowMesh.renderOrder = 2;
  }

  update(
    edges: RenderEdge[],
    nodeMap: Map<string, RenderNode>,
    theme: RenderTheme
  ) {
    const edgeCount = edges.length;
    this.edgeCount = edgeCount;
    this.edgeIds = [];
    this.edgeIndexMap.clear();
    this.freeSlots = [];
    this.directedEdgeIndices = [];
    this.directedCount = 0;

    // Grow buffers if needed
    if (edgeCount * 2 * 3 > this.positionAttr.array.length) {
      const newSize = Math.max(edgeCount * 2, (this.positionAttr.array.length / 6) * 2);
      this.positionAttr = new THREE.Float32BufferAttribute(
        new Float32Array(newSize * 2 * 3), 3
      );
      this.lineColorAttr = new THREE.Float32BufferAttribute(
        new Float32Array(newSize * 2 * 3), 3
      );
      this.linesMesh.geometry.setAttribute('position', this.positionAttr);
      this.linesMesh.geometry.setAttribute('color', this.lineColorAttr);
    }

    const defaultColor = new THREE.Color(theme.edgeColor);

    for (let i = 0; i < edgeCount; i++) {
      const edge = edges[i];
      this.edgeIds.push(edge.id);
      this.edgeIndexMap.set(edge.id, i);

      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) {
        // Missing endpoint - place at origin
        this.positionAttr.setXYZ(i * 2, 0, 0, 0);
        this.positionAttr.setXYZ(i * 2 + 1, 0, 0, 0);
      } else {
        // Clip line endpoints to node surfaces so edges don't pass through nodes
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radiiSum = src.size + tgt.size;
        if (dist > radiiSum && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          this.positionAttr.setXYZ(i * 2, src.x + nx * src.size, src.y + ny * src.size, 0);
          this.positionAttr.setXYZ(i * 2 + 1, tgt.x - nx * tgt.size, tgt.y - ny * tgt.size, 0);
        } else {
          // Nodes overlap — collapse to zero-length line
          this.positionAttr.setXYZ(i * 2, src.x, src.y, 0);
          this.positionAttr.setXYZ(i * 2 + 1, src.x, src.y, 0);
        }
      }

      // Color
      const c = edge.color ? this._color.set(edge.color) : defaultColor;
      this.lineColorAttr.setXYZ(i * 2, c.r, c.g, c.b);
      this.lineColorAttr.setXYZ(i * 2 + 1, c.r, c.g, c.b);

      // Track directed edges for arrows
      if (edge.directed && src && tgt) {
        this.directedEdgeIndices.push(i);
        this.directedCount++;
      }
    }

    this.linesMesh.geometry.setDrawRange(0, edgeCount * 2);
    this.positionAttr.needsUpdate = true;
    this.lineColorAttr.needsUpdate = true;

    // Update arrow instances
    this.updateArrows(edges, nodeMap, theme);
  }

  addEdges(
    edges: RenderEdge[],
    nodeMap: Map<string, RenderNode>,
    theme: RenderTheme
  ) {
    const needed = this.edgeCount + edges.length - this.freeSlots.length;
    // Grow line buffers if needed
    if (needed * 2 * 3 > this.positionAttr.array.length) {
      const newSize = Math.max(needed * 2, (this.positionAttr.array.length / 6) * 2);
      const newPos = new THREE.Float32BufferAttribute(new Float32Array(newSize * 2 * 3), 3);
      (newPos.array as Float32Array).set(this.positionAttr.array);
      const newColor = new THREE.Float32BufferAttribute(new Float32Array(newSize * 2 * 3), 3);
      (newColor.array as Float32Array).set(this.lineColorAttr.array);
      this.positionAttr = newPos;
      this.lineColorAttr = newColor;
      this.linesMesh.geometry.setAttribute('position', this.positionAttr);
      this.linesMesh.geometry.setAttribute('color', this.lineColorAttr);
    }

    const defaultColor = new THREE.Color(theme.edgeColor);

    for (const edge of edges) {
      let idx: number;
      if (this.freeSlots.length > 0) {
        idx = this.freeSlots.pop()!;
        this.edgeIds[idx] = edge.id;
      } else {
        idx = this.edgeCount;
        this.edgeCount++;
        this.edgeIds[idx] = edge.id;
      }
      this.edgeIndexMap.set(edge.id, idx);

      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (src && tgt) {
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radiiSum = src.size + tgt.size;
        if (dist > radiiSum && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          this.positionAttr.setXYZ(idx * 2, src.x + nx * src.size, src.y + ny * src.size, 0);
          this.positionAttr.setXYZ(idx * 2 + 1, tgt.x - nx * tgt.size, tgt.y - ny * tgt.size, 0);
        } else {
          this.positionAttr.setXYZ(idx * 2, src.x, src.y, 0);
          this.positionAttr.setXYZ(idx * 2 + 1, src.x, src.y, 0);
        }
      } else {
        this.positionAttr.setXYZ(idx * 2, 0, 0, 0);
        this.positionAttr.setXYZ(idx * 2 + 1, 0, 0, 0);
      }

      const c = edge.color ? this._color.set(edge.color) : defaultColor;
      this.lineColorAttr.setXYZ(idx * 2, c.r, c.g, c.b);
      this.lineColorAttr.setXYZ(idx * 2 + 1, c.r, c.g, c.b);
    }

    this.linesMesh.geometry.setDrawRange(0, this.edgeCount * 2);
    this.positionAttr.needsUpdate = true;
    this.lineColorAttr.needsUpdate = true;
  }

  removeEdges(ids: string[]) {
    for (const id of ids) {
      const idx = this.edgeIndexMap.get(id);
      if (idx === undefined) continue;
      // Zero both vertices to hide
      this.positionAttr.setXYZ(idx * 2, 0, 0, 0);
      this.positionAttr.setXYZ(idx * 2 + 1, 0, 0, 0);
      this.edgeIndexMap.delete(id);
      this.edgeIds[idx] = '';
      this.freeSlots.push(idx);
    }
    // Trim trailing free slots to prevent unbounded edgeCount growth
    while (this.edgeCount > 0 && this.edgeIds[this.edgeCount - 1] === '') {
      this.edgeCount--;
      const freeIdx = this.freeSlots.indexOf(this.edgeCount);
      if (freeIdx !== -1) this.freeSlots.splice(freeIdx, 1);
    }
    this.linesMesh.geometry.setDrawRange(0, this.edgeCount * 2);
    this.positionAttr.needsUpdate = true;
  }

  /** Rebuild arrow tracking from the current set of active edges (call after addEdges/removeEdges). */
  rebuildArrows(
    allEdges: RenderEdge[],
    nodeMap: Map<string, RenderNode>,
    theme: RenderTheme
  ) {
    this.directedEdgeIndices = [];
    this.directedCount = 0;
    for (const edge of allEdges) {
      if (!edge.directed) continue;
      const idx = this.edgeIndexMap.get(edge.id);
      if (idx === undefined) continue;
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) continue;
      this.directedEdgeIndices.push(idx);
      this.directedCount++;
    }
    this.updateArrows(allEdges, nodeMap, theme);
  }

  private updateArrows(
    edges: RenderEdge[],
    nodeMap: Map<string, RenderNode>,
    theme: RenderTheme
  ) {
    // Grow arrow mesh if needed
    if (this.directedCount > this.arrowMesh.count) {
      const parent = this.arrowMesh.parent;
      const oldGeo = this.arrowMesh.geometry;
      const oldMat = this.arrowMesh.material;
      const newMesh = new THREE.InstancedMesh(
        oldGeo, oldMat as THREE.Material,
        Math.max(this.directedCount, 256)
      );
      newMesh.renderOrder = this.arrowMesh.renderOrder;
      if (parent) {
        parent.remove(this.arrowMesh);
        parent.add(newMesh);
      }
      this.arrowMesh.dispose();
      (this as any).arrowMesh = newMesh;
    }

    this.arrowMesh.count = this.directedCount;

    if (!this.arrowMesh.instanceColor) {
      this.arrowMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(Math.max(this.directedCount, 256) * 3), 3
      );
    }

    const defaultColor = new THREE.Color(theme.edgeColor);

    for (let ai = 0; ai < this.directedCount; ai++) {
      const edgeIdx = this.directedEdgeIndices[ai];
      const edge = edges[edgeIdx];
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) continue;

      // Arrow direction: from source to target
      this._dir.set(tgt.x - src.x, tgt.y - src.y, 0);
      const len = this._dir.length();
      if (len < 0.001) continue;
      this._dir.normalize();

      // Position arrow at target end, offset by target node radius
      const offset = tgt.size + ARROW_HEIGHT * 0.5;
      const ax = tgt.x - this._dir.x * offset;
      const ay = tgt.y - this._dir.y * offset;

      // Quaternion to rotate from +Y to edge direction
      this._quat.setFromUnitVectors(this._up, this._dir);

      this._mat.compose(
        new THREE.Vector3(ax, ay, 0),
        this._quat,
        new THREE.Vector3(1, 1, 1)
      );
      this.arrowMesh.setMatrixAt(ai, this._mat);

      // Arrow color
      const c = edge.color ? this._color.set(edge.color) : defaultColor;
      this.arrowMesh.instanceColor!.setXYZ(ai, c.r, c.g, c.b);
    }

    if (this.directedCount > 0) {
      this.arrowMesh.instanceMatrix.needsUpdate = true;
      this.arrowMesh.instanceColor!.needsUpdate = true;
    }
  }

  updatePositions(
    edges: RenderEdge[],
    nodeMap: Map<string, RenderNode>,
    theme: RenderTheme
  ) {
    for (const edge of edges) {
      const idx = this.edgeIndexMap.get(edge.id);
      if (idx === undefined) continue;
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) continue;
      // Clip line endpoints to node surfaces
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radiiSum = src.size + tgt.size;
      if (dist > radiiSum && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.positionAttr.setXYZ(idx * 2, src.x + nx * src.size, src.y + ny * src.size, 0);
        this.positionAttr.setXYZ(idx * 2 + 1, tgt.x - nx * tgt.size, tgt.y - ny * tgt.size, 0);
      } else {
        this.positionAttr.setXYZ(idx * 2, src.x, src.y, 0);
        this.positionAttr.setXYZ(idx * 2 + 1, src.x, src.y, 0);
      }
    }
    this.positionAttr.needsUpdate = true;
    this.updateArrows(edges, nodeMap, theme);
  }

  setSelection(
    edgeId: string | null,
    selectedNodeId: string | null,
    edges: RenderEdge[],
    theme: RenderTheme
  ) {
    const defaultColor = new THREE.Color(theme.edgeColor);
    const activeColor = new THREE.Color(theme.edgeActiveColor);

    for (const edge of edges) {
      const idx = this.edgeIndexMap.get(edge.id);
      if (idx === undefined) continue;

      const isSelectedEdge = edgeId && edge.id === edgeId;
      const isConnectedToNode = selectedNodeId && (
        edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId
      );

      let c: THREE.Color;
      let opacity: number;

      if (isSelectedEdge || isConnectedToNode) {
        c = activeColor;
        opacity = 1.0;
      } else if (edgeId || selectedNodeId) {
        c = edge.color ? this._color.set(edge.color) : defaultColor;
        opacity = theme.edgeInactiveOpacity;
      } else {
        c = edge.color ? this._color.set(edge.color) : defaultColor;
        opacity = 1.0;
      }

      // Apply color with opacity baked in (since LineBasicMaterial doesn't support per-vertex opacity easily)
      // We'll just tint toward black for inactive
      const r = c.r * opacity;
      const g = c.g * opacity;
      const b = c.b * opacity;
      this.lineColorAttr.setXYZ(idx * 2, r, g, b);
      this.lineColorAttr.setXYZ(idx * 2 + 1, r, g, b);
    }
    this.lineColorAttr.needsUpdate = true;
  }

  setZoomLevel(level: ZoomLevel) {
    // Hide arrows at far/medium zoom for performance
    this.arrowMesh.visible = level === 'close';
  }

  getEdgeIdAt(index: number): string | undefined {
    return this.edgeIds[index];
  }

  getIndex(edgeId: string): number | undefined {
    return this.edgeIndexMap.get(edgeId);
  }

  getCount(): number {
    return this.edgeIds.length;
  }

  dispose() {
    this.linesMesh.geometry.dispose();
    (this.linesMesh.material as THREE.Material).dispose();
    this.arrowMesh.geometry.dispose();
    (this.arrowMesh.material as THREE.Material).dispose();
    this.arrowMesh.dispose();
  }
}
