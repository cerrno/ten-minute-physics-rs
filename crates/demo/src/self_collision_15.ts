import GUI from 'lil-gui';
import * as THREE from 'three';

import { SelfCollisionSimulation } from '../pkg';
import { memory } from '../pkg/index_bg.wasm';
import { Demo, Scene, SceneConfig, Grabber } from './lib';

type SelfCollisionDemoProps = {
    triangles: number;
    vertices: number;
    animate: boolean;
    hangFromTop: boolean;
    handleCollisions: boolean;
    showEdges: boolean;
    substeps: number;
    bendingCompliance: number;
    stretchCompliance: number;
    shearCompliance: number;
};

const SelfCollisionDemoConfig: SceneConfig = {
    cameraZ: 0.5,
    cameraLookAt: new THREE.Vector3(0, 0.1, 0),
}

class SelfCollisionDemo implements Demo<SelfCollisionSimulation, SelfCollisionDemoProps> {
    sim: SelfCollisionSimulation;
    scene: Scene;
    props: SelfCollisionDemoProps;

    private grabber: Grabber;
    private edgeMesh: THREE.LineSegments;
    private frontMesh: THREE.Mesh;
    private backMesh: THREE.Mesh;
    private positions: Float32Array;

    constructor(rust_wasm: any, canvas: HTMLCanvasElement, scene: Scene, folder: GUI) {
        this.sim = new rust_wasm.SelfCollisionSimulation(canvas);
        this.scene = scene;
        this.initControls(folder, canvas);
    }

    init() {
        this.initMesh();
    }

    update() {
        if (this.props.animate) {
            this.sim.step();
            this.updateMesh();
            this.grabber.increaseTime(this.sim.dt());
        }
    }

    reset() {
        this.sim.reset();
        this.updateMesh();
    }

    private initControls(folder: GUI, canvas: HTMLCanvasElement) {
        this.props = {
            triangles: this.sim.num_tris(),
            vertices: this.sim.num_particles(),
            animate: true,
            hangFromTop: false,
            handleCollisions: true,
            showEdges: false,
            substeps: 10,
            bendingCompliance: 1,
            stretchCompliance: 0,
            shearCompliance: 0.001,
        };
        folder.add(this.props, 'triangles').disable();
        folder.add(this.props, 'vertices').disable();
        folder.add(this.props, 'substeps').min(1).max(30).step(1).onChange((v: number) => this.sim.set_solver_substeps(v));
        folder.add(this.props, 'bendingCompliance').name('bend compliance').min(0).max(10).step(0.1).onChange((v: number) => this.sim.set_bending_compliance(v));
        folder.add(this.props, 'stretchCompliance').name('stretch compliance').min(0).max(1).step(0.01).onChange((v: number) => this.sim.set_stretch_compliance(v));
        folder.add(this.props, 'shearCompliance').name('shear compliance').min(0.001).max(1).step(0.01).onChange((v: number) => this.sim.set_shear_compliance(v));
        folder.add(this.props, 'hangFromTop').name('hang from top').onChange((v: boolean) => {
            this.sim.set_attach(v);
            this.reset();
        })
        folder.add(this.props, 'handleCollisions').name('handle collisions').onChange((v: boolean) => {
            this.sim.set_handle_collisions(v);
            this.reset();
        });
        folder.add(this.props, 'showEdges').name('show edges').onChange((s: boolean) => {
            this.edgeMesh.visible = s;
            this.frontMesh.visible = !s;
            this.backMesh.visible = !s;
        });
        const animateController = folder.add(this.props, 'animate');

        // grab handler
        this.grabber = new Grabber(this.sim, canvas, this.scene, this.props, animateController);
    }

    private initMesh() {
        const tri_ids = Array.from(this.sim.mesh_tri_ids());
        const edge_ids = Array.from(this.sim.mesh_edge_ids());

        // NOTE: ordering matters here. The sim.mesh_*() getter methods are lazily implemented and 
        // allocate into a new Vec to collect results into at runtime. This means a heap allocation
        // occurs and therefore the location in memory for particle positions changes. Here, we
        // store the pointer to the positions buffer location after these allocs. In the WASM
        // linear heap, it will be constant thereafter, so we don't need to touch the array moving 
        // forward.
        const positionsPtr = this.sim.particle_positions_ptr();
        this.positions = new Float32Array(memory.buffer, positionsPtr, this.sim.num_particles() * 3);

        // visual edge mesh
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setIndex(edge_ids);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        this.edgeMesh = new THREE.LineSegments(geometry, lineMaterial);
        this.edgeMesh.visible = false;
        this.scene.scene.add(this.edgeMesh);

        // visual tri mesh
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setIndex(tri_ids);
        const frontMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000, side: THREE.FrontSide });
        this.frontMesh = new THREE.Mesh(geometry, frontMaterial);
        this.frontMesh.castShadow = true;
        this.frontMesh.layers.enable(1);
        this.scene.scene.add(this.frontMesh);
        const backMaterial = new THREE.MeshPhongMaterial({ color: 0xff8000, side: THREE.BackSide });
        this.backMesh = new THREE.Mesh(geometry, backMaterial);
        this.backMesh.castShadow = true;
        this.backMesh.layers.enable(1);
        this.scene.scene.add(this.backMesh);
        geometry.computeVertexNormals();

        this.updateMesh();
    }

    private updateMesh() {
        this.frontMesh.geometry.computeVertexNormals();
        this.frontMesh.geometry.attributes.position.needsUpdate = true;
        this.frontMesh.geometry.computeBoundingSphere();
        this.edgeMesh.geometry.attributes.position.needsUpdate = true;
    }
}

export { SelfCollisionDemo, SelfCollisionDemoConfig };