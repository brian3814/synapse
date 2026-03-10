import * as THREE from 'three';
import type { RenderNode, RenderTheme } from './types';

const SEGMENTS = 32;

export class NodeMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly ringMesh: THREE.InstancedMesh;

  private capacity: number;
  private count = 0;
  private colorAttr: THREE.InstancedBufferAttribute;
  private opacityAttr: THREE.InstancedBufferAttribute;
  private nodeIds: string[] = [];
  private nodeIndexMap = new Map<string, number>();
  private freeSlots: number[] = [];

  // Reusable temporaries
  private readonly _mat = new THREE.Matrix4();
  private readonly _color = new THREE.Color();
  private readonly _ringMat = new THREE.Matrix4();

  constructor(initialCapacity = 1024) {
    this.capacity = initialCapacity;

    // Node circles
    const circleGeo = new THREE.CircleGeometry(1, SEGMENTS);
    const circleMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
    });
    this.mesh = new THREE.InstancedMesh(circleGeo, circleMat, this.capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;

    // Per-instance color
    this.colorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3), 3
    );
    this.mesh.instanceColor = this.colorAttr;

    // Per-instance opacity
    this.opacityAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity), 1
    );
    this.mesh.geometry.setAttribute('instanceOpacity', this.opacityAttr);

    // Selection ring
    const ringGeo = new THREE.RingGeometry(1.0, 1.3, SEGMENTS);
    const ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, 1);
    this.ringMesh.count = 0;
    this.ringMesh.renderOrder = 0;
  }

  private grow(needed: number) {
    if (needed <= this.capacity) return;
    this.capacity = Math.max(needed, this.capacity * 2);

    // Rebuild instanced mesh
    const oldMat = this.mesh.material;
    const oldGeo = this.mesh.geometry;
    const parent = this.mesh.parent;

    const newMesh = new THREE.InstancedMesh(oldGeo, oldMat as THREE.Material, this.capacity);
    newMesh.renderOrder = this.mesh.renderOrder;

    // Copy existing transforms
    for (let i = 0; i < this.count; i++) {
      this.mesh.getMatrixAt(i, this._mat);
      newMesh.setMatrixAt(i, this._mat);
    }

    // Rebuild color attribute
    const newColors = new Float32Array(this.capacity * 3);
    newColors.set(this.colorAttr.array.slice(0, this.count * 3));
    const newColorAttr = new THREE.InstancedBufferAttribute(newColors, 3);
    newMesh.instanceColor = newColorAttr;

    // Rebuild opacity attribute
    const newOpacity = new Float32Array(this.capacity);
    newOpacity.set(this.opacityAttr.array.slice(0, this.count));
    const newOpacityAttr = new THREE.InstancedBufferAttribute(newOpacity, 1);
    newMesh.geometry.setAttribute('instanceOpacity', newOpacityAttr);

    if (parent) {
      parent.remove(this.mesh);
      parent.add(newMesh);
    }

    this.mesh.dispose();
    // Replace references - use Object.assign pattern for readonly
    (this as any).mesh = newMesh;
    this.colorAttr = newColorAttr;
    this.opacityAttr = newOpacityAttr;
    newMesh.count = this.count;
  }

  update(nodes: RenderNode[]) {
    this.grow(nodes.length);
    this.count = nodes.length;
    this.mesh.count = nodes.length;
    this.nodeIds = [];
    this.nodeIndexMap.clear();
    this.freeSlots = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      this.nodeIds.push(node.id);
      this.nodeIndexMap.set(node.id, i);

      // Position + scale
      this._mat.makeScale(node.size, node.size, 1);
      this._mat.setPosition(node.x, node.y, 0);
      this.mesh.setMatrixAt(i, this._mat);

      // Color
      this._color.set(node.color);
      this.colorAttr.setXYZ(i, this._color.r, this._color.g, this._color.b);

      // Opacity (default 1)
      this.opacityAttr.setX(i, 1.0);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
  }

  addNodes(nodes: RenderNode[]) {
    const needed = this.count + nodes.length - this.freeSlots.length;
    if (needed > this.capacity) this.grow(needed);

    for (const node of nodes) {
      let idx: number;
      if (this.freeSlots.length > 0) {
        idx = this.freeSlots.pop()!;
        this.nodeIds[idx] = node.id;
      } else {
        idx = this.count;
        this.count++;
        this.nodeIds[idx] = node.id;
      }
      this.nodeIndexMap.set(node.id, idx);

      this._mat.makeScale(node.size, node.size, 1);
      this._mat.setPosition(node.x, node.y, 0);
      this.mesh.setMatrixAt(idx, this._mat);

      this._color.set(node.color);
      this.colorAttr.setXYZ(idx, this._color.r, this._color.g, this._color.b);
      this.opacityAttr.setX(idx, 1.0);
    }

    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
  }

  removeNodes(ids: string[]) {
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const id of ids) {
      const idx = this.nodeIndexMap.get(id);
      if (idx === undefined) continue;
      this.mesh.setMatrixAt(idx, zeroMat);
      this.nodeIndexMap.delete(id);
      this.nodeIds[idx] = '';
      this.freeSlots.push(idx);
    }
    // Trim trailing free slots to prevent unbounded count growth
    while (this.count > 0 && this.nodeIds[this.count - 1] === '') {
      this.count--;
      // Remove this index from freeSlots
      const freeIdx = this.freeSlots.indexOf(this.count);
      if (freeIdx !== -1) this.freeSlots.splice(freeIdx, 1);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  updatePositions(positions: Map<string, { x: number; y: number }>, nodeMap: Map<string, RenderNode>) {
    for (const [id, pos] of positions) {
      const idx = this.nodeIndexMap.get(id);
      if (idx === undefined) continue;
      const size = nodeMap.get(id)?.size ?? 1;
      this._mat.makeScale(size, size, 1);
      this._mat.setPosition(pos.x, pos.y, 0);
      this.mesh.setMatrixAt(idx, this._mat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setSelection(nodeId: string | null, theme: RenderTheme) {
    if (!nodeId) {
      this.ringMesh.count = 0;
      // Reset all opacities to 1
      for (const [, i] of this.nodeIndexMap) {
        this.opacityAttr.setX(i, 1.0);
      }
      this.opacityAttr.needsUpdate = true;
      return;
    }

    const idx = this.nodeIndexMap.get(nodeId);
    if (idx === undefined) {
      this.ringMesh.count = 0;
      return;
    }

    // Show selection ring
    this.mesh.getMatrixAt(idx, this._mat);
    this.ringMesh.setMatrixAt(0, this._mat);
    this.ringMesh.count = 1;
    this.ringMesh.instanceMatrix.needsUpdate = true;

    // Set ring color
    this._color.set(theme.selectionRingColor);
    if (!this.ringMesh.instanceColor) {
      this.ringMesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(3), 3
      );
    }
    this.ringMesh.instanceColor.setXYZ(0, this._color.r, this._color.g, this._color.b);
    this.ringMesh.instanceColor.needsUpdate = true;

    // Dim non-selected nodes
    for (const [, i] of this.nodeIndexMap) {
      this.opacityAttr.setX(i, i === idx ? 1.0 : theme.nodeInactiveOpacity);
    }
    this.opacityAttr.needsUpdate = true;
  }

  setHover(nodeId: string | null, theme: RenderTheme) {
    // On hover, we change the color of the hovered node to activeColor
    if (nodeId) {
      const idx = this.nodeIndexMap.get(nodeId);
      if (idx !== undefined) {
        this._color.set(theme.nodeActiveColor);
        this.colorAttr.setXYZ(idx, this._color.r, this._color.g, this._color.b);
        this.colorAttr.needsUpdate = true;
      }
    }
  }

  restoreColor(nodeId: string, originalColor: string) {
    const idx = this.nodeIndexMap.get(nodeId);
    if (idx === undefined) return;
    this._color.set(originalColor);
    this.colorAttr.setXYZ(idx, this._color.r, this._color.g, this._color.b);
    this.colorAttr.needsUpdate = true;
  }

  getNodeIdAt(index: number): string | undefined {
    return this.nodeIds[index];
  }

  getIndex(nodeId: string): number | undefined {
    return this.nodeIndexMap.get(nodeId);
  }

  getCount(): number {
    return this.count;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    this.ringMesh.dispose();
  }
}
