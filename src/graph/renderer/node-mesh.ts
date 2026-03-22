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
      depthWrite: false,
    });
    // Inject per-instance opacity into the shader
    circleMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_pars_vertex>',
        `#include <color_pars_vertex>
        attribute float instanceOpacity;
        varying float vInstanceOpacity;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vInstanceOpacity = instanceOpacity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_pars_fragment>',
        `#include <color_pars_fragment>
        varying float vInstanceOpacity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `gl_FragColor = vec4(outgoingLight, diffuseColor.a * vInstanceOpacity);`
      );
    };
    this.mesh = new THREE.InstancedMesh(circleGeo, circleMat, this.capacity);
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;

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
    this.ringMesh.renderOrder = 3;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(3), 3
    );
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
    newMesh.frustumCulled = false;

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
      const s = node.size;
      this._mat.makeScale(s, s, s);
      this._mat.setPosition(node.x, node.y, node.z);
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

      const s = node.size;
      this._mat.makeScale(s, s, s);
      this._mat.setPosition(node.x, node.y, node.z);
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

  updatePositions(positions: Map<string, { x: number; y: number; z?: number }>, nodeMap: Map<string, RenderNode>) {
    for (const [id, pos] of positions) {
      const idx = this.nodeIndexMap.get(id);
      if (idx === undefined) continue;
      const size = nodeMap.get(id)?.size ?? 1;
      this._mat.makeScale(size, size, size);
      this._mat.setPosition(pos.x, pos.y, pos.z ?? 0);
      this.mesh.setMatrixAt(idx, this._mat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private ringCapacity = 1;

  private ensureRingCapacity(needed: number) {
    if (needed <= this.ringCapacity) return;
    this.ringCapacity = Math.max(needed, this.ringCapacity * 2);

    const parent = this.ringMesh.parent;
    const oldGeo = this.ringMesh.geometry;
    const oldMat = this.ringMesh.material;

    const newRing = new THREE.InstancedMesh(oldGeo, oldMat as THREE.Material, this.ringCapacity);
    newRing.renderOrder = this.ringMesh.renderOrder;
    newRing.frustumCulled = false;
    newRing.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.ringCapacity * 3), 3
    );

    if (parent) {
      parent.remove(this.ringMesh);
      parent.add(newRing);
    }
    this.ringMesh.dispose();
    (this as any).ringMesh = newRing;
  }

  setSelection(nodeIds: Set<string>, pathNodeIds: Set<string>, theme: RenderTheme) {
    const hasSelection = nodeIds.size > 0;
    const hasPath = pathNodeIds.size > 0;

    if (!hasSelection && !hasPath) {
      this.ringMesh.count = 0;
      for (const [, i] of this.nodeIndexMap) {
        this.opacityAttr.setX(i, 1.0);
      }
      this.opacityAttr.needsUpdate = true;
      return;
    }

    // Show rings for all selected nodes
    this.ensureRingCapacity(nodeIds.size);
    this._color.set(theme.selectionRingColor);
    let ringIdx = 0;
    for (const id of nodeIds) {
      const idx = this.nodeIndexMap.get(id);
      if (idx === undefined) continue;
      this.mesh.getMatrixAt(idx, this._mat);
      this.ringMesh.setMatrixAt(ringIdx, this._mat);
      this.ringMesh.instanceColor!.setXYZ(ringIdx, this._color.r, this._color.g, this._color.b);
      ringIdx++;
    }
    this.ringMesh.count = ringIdx;
    if (ringIdx > 0) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
      this.ringMesh.instanceColor!.needsUpdate = true;
    }

    // Set opacities: selected + path = full, everything else dimmed
    for (const [id, i] of this.nodeIndexMap) {
      if (nodeIds.has(id) || pathNodeIds.has(id)) {
        this.opacityAttr.setX(i, 1.0);
      } else {
        this.opacityAttr.setX(i, theme.nodeInactiveOpacity);
      }
    }
    this.opacityAttr.needsUpdate = true;

    // Tint path nodes with path color
    if (hasPath) {
      this._color.set(theme.pathColor);
      for (const id of pathNodeIds) {
        if (nodeIds.has(id)) continue; // selected nodes keep their active color
        const idx = this.nodeIndexMap.get(id);
        if (idx === undefined) continue;
        this.colorAttr.setXYZ(idx, this._color.r, this._color.g, this._color.b);
      }
      this.colorAttr.needsUpdate = true;
    }
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
