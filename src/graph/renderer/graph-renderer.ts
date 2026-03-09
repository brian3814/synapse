import * as THREE from 'three';
import type {
  RenderNode,
  RenderEdge,
  RenderTheme,
  GraphRendererOptions,
  GraphRendererInstance,
  GraphEventMap,
  GraphEventType,
} from './types';
import { NodeMesh } from './node-mesh';
import { EdgeMesh } from './edge-mesh';
import { LabelLayer } from './label-layer';
import { CameraController } from './camera-controller';
import { hitTest } from './hit-test';

const DEFAULT_THEME: RenderTheme = {
  canvasBackground: '#18181b',
  nodeColor: '#6366f1',
  nodeActiveColor: '#818cf8',
  nodeInactiveOpacity: 0.2,
  edgeColor: '#52525b',
  edgeActiveColor: '#a1a1aa',
  edgeInactiveOpacity: 0.1,
  selectionRingColor: '#818cf8',
  labelColor: '#e4e4e7',
  labelActiveColor: '#ffffff',
};

type EventCallback<T extends GraphEventType> = (event: GraphEventMap[T]) => void;

export class GraphRenderer implements GraphRendererInstance {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraController: CameraController;
  private nodeMesh: NodeMesh;
  private edgeMesh: EdgeMesh;
  private labelLayer: LabelLayer;
  private theme: RenderTheme;
  private animFrameId: number | null = null;
  private disposed = false;

  private nodes: RenderNode[] = [];
  private edges: RenderEdge[] = [];
  private nodeMap = new Map<string, RenderNode>();

  private selectedNodeId: string | null = null;
  private selectedEdgeId: string | null = null;
  private hoveredNodeId: string | null = null;

  // Event listeners
  private listeners = new Map<string, Set<EventCallback<any>>>();

  // Resize observer
  private resizeObserver: ResizeObserver;
  private container: HTMLElement;

  // Hover throttle
  private lastHoverTime = 0;
  private readonly HOVER_THROTTLE_MS = 33; // ~30fps

  constructor(container: HTMLElement, options: GraphRendererOptions = {}) {
    this.container = container;
    this.theme = { ...DEFAULT_THEME, ...options.theme };

    // Create Three.js renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(this.theme.canvasBackground);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.cameraController = new CameraController(this.renderer.domElement);

    // Meshes
    this.nodeMesh = new NodeMesh();
    this.edgeMesh = new EdgeMesh();

    this.scene.add(this.edgeMesh.linesMesh);
    this.scene.add(this.edgeMesh.arrowMesh);
    this.scene.add(this.nodeMesh.mesh);
    this.scene.add(this.nodeMesh.ringMesh);

    // Label layer: 2D canvas overlay (not a Three.js mesh)
    this.labelLayer = new LabelLayer(container);
    this.labelLayer.resize(container.clientWidth, container.clientHeight);

    // Wire up camera controller events
    this.cameraController.onClick = (sx, sy) => this.handleClick(sx, sy);
    this.cameraController.onPointerMoveWorld = (sx, sy) => this.handleHover(sx, sy);
    this.cameraController.onDragMove = (wx, wy) => this.handleDragMove(wx, wy);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    // Start animation loop
    this.animate();
  }

  private animate = () => {
    if (this.disposed) return;
    this.animFrameId = requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.cameraController.camera);
    // Redraw labels every frame so they track camera pan/zoom smoothly
    this.updateLabels();
  };

  private updateLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.labelLayer.update(
      this.nodes, this.theme, this.cameraController.camera, w, h
    );
  }

  setGraphData(nodes: RenderNode[], edges: RenderEdge[]) {
    this.nodes = nodes;
    this.edges = edges;
    this.nodeMap.clear();
    for (const n of nodes) {
      this.nodeMap.set(n.id, n);
    }

    this.nodeMesh.update(nodes);
    this.edgeMesh.update(edges, this.nodeMap, this.theme);

    // Re-apply selection
    this.applySelection();
  }

  updatePositions(positions: Map<string, { x: number; y: number }>) {
    // Update RenderNode positions
    for (const [id, pos] of positions) {
      const node = this.nodeMap.get(id);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
      }
    }

    this.nodeMesh.updatePositions(positions, this.nodes);
    this.edgeMesh.updatePositions(this.edges, this.nodeMap, this.theme);
  }

  setSelection(nodeId: string | null, edgeId: string | null) {
    this.selectedNodeId = nodeId;
    this.selectedEdgeId = edgeId;
    this.applySelection();
  }

  private applySelection() {
    this.nodeMesh.setSelection(this.selectedNodeId, this.theme);
    this.edgeMesh.setSelection(
      this.selectedEdgeId,
      this.selectedNodeId,
      this.edges,
      this.theme
    );
  }

  setHover(nodeId: string | null) {
    if (nodeId === this.hoveredNodeId) return;

    // Restore previous hover
    if (this.hoveredNodeId) {
      const prev = this.nodeMap.get(this.hoveredNodeId);
      if (prev) {
        this.nodeMesh.restoreColor(this.hoveredNodeId, prev.color);
      }
    }

    this.hoveredNodeId = nodeId;

    if (nodeId) {
      this.nodeMesh.setHover(nodeId, this.theme);
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.renderer.domElement.style.cursor = '';
    }
  }

  private handleClick(screenX: number, screenY: number) {
    const result = hitTest(
      screenX, screenY,
      this.nodes, this.edges, this.nodeMap,
      this.cameraController.camera,
      this.renderer.domElement
    );

    if (result.type === 'node' && result.id) {
      this.emit('nodeClick', { nodeId: result.id });
    } else if (result.type === 'edge' && result.id) {
      this.emit('edgeClick', { edgeId: result.id });
    } else {
      this.emit('canvasClick', {});
    }
  }

  private handleHover(screenX: number, screenY: number) {
    const now = performance.now();
    if (now - this.lastHoverTime < this.HOVER_THROTTLE_MS) return;
    this.lastHoverTime = now;

    const result = hitTest(
      screenX, screenY,
      this.nodes, this.edges, this.nodeMap,
      this.cameraController.camera,
      this.renderer.domElement
    );

    const newHover = result.type === 'node' ? result.id ?? null : null;
    if (newHover !== this.hoveredNodeId) {
      this.setHover(newHover);
      this.emit('nodeHover', { nodeId: newHover });
    }
  }

  private handleDragMove(worldX: number, worldY: number) {
    const nodeId = this.cameraController.dragNodeId;
    if (!nodeId) return;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    node.x = worldX;
    node.y = worldY;

    // Update visuals
    const pos = new Map([[nodeId, { x: worldX, y: worldY }]]);
    this.nodeMesh.updatePositions(pos, this.nodes);
    this.edgeMesh.updatePositions(this.edges, this.nodeMap, this.theme);
  }

  /** Start dragging a node (called from pointerdown hit test) */
  startNodeDrag(nodeId: string) {
    this.cameraController.startDrag(nodeId);
  }

  fitToView(nodeIds?: string[]) {
    this.cameraController.fitToView(this.nodes, nodeIds);
  }

  zoomIn() {
    this.cameraController.zoomIn();
  }

  zoomOut() {
    this.cameraController.zoomOut();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.cameraController.resize();
    this.labelLayer.resize(w, h);
  }

  // Event emitter
  on<T extends GraphEventType>(event: T, callback: EventCallback<T>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off<T extends GraphEventType>(event: T, callback: EventCallback<T>) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit<T extends GraphEventType>(event: T, data: GraphEventMap[T]) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  getNodes(): RenderNode[] {
    return this.nodes;
  }

  getNodeMap(): Map<string, RenderNode> {
    return this.nodeMap;
  }

  dispose() {
    this.disposed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    this.resizeObserver.disconnect();
    this.cameraController.dispose();
    this.nodeMesh.dispose();
    this.edgeMesh.dispose();
    this.labelLayer.dispose();
    // Force-release the WebGL context before disposing the renderer.
    // THREE.dispose() alone doesn't release the context on all platforms,
    // causing "context lost" blocks on Windows when contexts accumulate.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.listeners.clear();
  }
}
