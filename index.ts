import GUI from 'lil-gui';
import * as Stats from 'stats.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { SelfCollisionDemo, SelfCollisionDemoConfig } from './src/self_collision_15';
import { ClothDemo, ClothDemoConfig } from './src/cloth_14';
import { HashDemo, HashDemoConfig } from './src/hashing_11';
import { Demo, Scene, Scene2DCanvas, Scene2DWebGL, Scene3D, SceneConfig, Scene2DConfig, Scene3DConfig } from './src/lib';
import { SoftBodiesDemo, SoftBodiesDemoConfig } from './src/softbodies_10';
import { SkinnedSoftbodyDemo, SkinnedSoftbodyDemoConfig } from './src/softbody_skinning_12';
import { FluidDemo, FluidDemoConfig } from './src/fluid_sim_17';
import { FlipDemo, FlipDemoConfig } from './src/flip_18';

import('./pkg').then(rust_wasm => {
    const $ = (id: string) => document.getElementById(id);

    const demos: Record<string, { title: string, config: SceneConfig, demo: any }> = {
        '10-SoftBodies': {
            title: 'Soft Body Simulation',
            config: SoftBodiesDemoConfig,
            demo: SoftBodiesDemo,
        },
        '11-Hashing': {
            title: 'Spatial Hashing',
            config: HashDemoConfig,
            demo: HashDemo,
        },
        '12-SoftbodySkinning': {
            title: 'Soft Body Skinning',
            config: SkinnedSoftbodyDemoConfig,
            demo: SkinnedSoftbodyDemo,
        },
        '14-Cloth': {
            title: 'Cloth Simulation',
            config: ClothDemoConfig,
            demo: ClothDemo,
        },
        '15-SelfCollision': {
            title: 'Cloth Self Collision Handling',
            config: SelfCollisionDemoConfig,
            demo: SelfCollisionDemo,
        },
        '17-FluidSimulation': {
            title: 'Euler Fluid',
            config: FluidDemoConfig,
            demo: FluidDemo,
        },
        '18-Flip': {
            title: 'Flip Fluid',
            config: FlipDemoConfig,
            demo: FlipDemo,
        }
    };
    const demoNames = Object.keys(demos);
    let canvas = $('canvas') as HTMLCanvasElement;
    let demo: Demo<any, any>;
    let scene: Scene;

    const replaceCanvas = () => {
        // some demos modify text color for contrast; reset
        document.getElementById('info').removeAttribute("style");
        // replace canvas element so we can get a new rendering context
        let newCanvas = document.createElement('canvas');
        canvas.parentNode.replaceChild(newCanvas, canvas);
        canvas = newCanvas;
    }

    const init2DScene = (config: Scene2DConfig): Scene2DCanvas | Scene2DWebGL => {
        replaceCanvas();

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        let context;
        let kind = config.kind;
        if (kind === "2DCanvas") {
            context = canvas.getContext('2d', { desynchronized: true });
            return { kind, width: canvas.width, height: canvas.height, context };
        } else if (kind === "2DWebGL") {
            context = canvas.getContext('webgl2', { antialias: true, desynchronized: true, powerPreference: "high-performance" });
            return { kind, width: canvas.width, height: canvas.height, context };
        } else {
            throw "unreachable";
        }
    }

    const initThreeScene = (config: Scene3DConfig): Scene3D => {
        replaceCanvas();

        const scene = new THREE.Scene();

        // lights
        scene.add(new THREE.AmbientLight(0x505050));
        scene.fog = new THREE.Fog(0x000000, 0, 15);

        const spotLight = new THREE.SpotLight(0xffffff);
        spotLight.angle = Math.PI / 5;
        spotLight.penumbra = 0.2;
        spotLight.position.set(2, 3, 3);
        spotLight.castShadow = true;
        spotLight.shadow.camera.near = 3;
        spotLight.shadow.camera.far = 10;
        spotLight.shadow.mapSize.width = 1024;
        spotLight.shadow.mapSize.height = 1024;
        scene.add(spotLight);

        const dirLight = new THREE.DirectionalLight(0x55505a, 1);
        dirLight.position.set(0, 3, 0);
        dirLight.castShadow = true;
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 10;
        dirLight.shadow.camera.right = 1;
        dirLight.shadow.camera.left = - 1;
        dirLight.shadow.camera.top = 1;
        dirLight.shadow.camera.bottom = - 1;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        scene.add(dirLight);

        // geometry
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20, 1, 1),
            new THREE.MeshPhongMaterial({ color: 0xa0adaf, shininess: 150 })
        );
        ground.rotation.x = - Math.PI / 2; // rotates X/Y to X/Z
        ground.receiveShadow = true;
        scene.add(ground);
        const helper = new THREE.GridHelper(20, 20);
        const material = helper.material as THREE.Material;
        material.opacity = 1.0;
        material.transparent = true;
        helper.position.set(0, 0.002, 0);
        scene.add(helper);

        // renderer
        const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
        renderer.shadowMap.enabled = true;
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        // camera
        const camera = new THREE.PerspectiveCamera(70, canvas.width / canvas.height, 0.01, 100);
        camera.position.set(0, config.cameraYZ[0], config.cameraYZ[1]);
        camera.updateMatrixWorld();
        scene.add(camera);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.zoomSpeed = 2.0;
        controls.panSpeed = 0.4;
        controls.target = config.cameraLookAt;
        controls.update();

        return { kind: '3D', scene, camera, renderer, controls };
    };

    let resizeTimer: NodeJS.Timeout; // limit 2d resize events to once per 250ms
    window.addEventListener('resize', () => {
        if (scene.kind === "3D") {
            // for 3d, THREE.js can non-destructively update the renderer
            const width = window.innerWidth;
            const height = window.innerHeight;
            scene.camera.aspect = width / height;
            scene.camera.updateProjectionMatrix();
            scene.renderer.setSize(width, height);
        } else {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                // for 2d, we generally need to reload the demo
                initDemo(props.demoSelection);
            }, 250);
        }
    });

    // attach perf stats window
    const stats = new Stats();
    stats.dom.style.position = 'absolute';
    const simPanel = stats.addPanel(new Stats.Panel('MS (Sim)', '#ff8', '#221'));
    let maxSimMs = 1;
    stats.showPanel(stats.dom.children.length - 1); // ms per sim step
    $('container').appendChild(stats.dom);

    // populate controls window
    const props = {
        demoSelection: demoNames.at(-1), // default to latest demo
        reset: () => demo.reset(),
    }
    const gui = new GUI({ autoPlace: false });
    gui.domElement.style.opacity = '0.9';
    $('gui').appendChild(gui.domElement);
    const generalFolder = gui.addFolder('General');
    let demoFolder: GUI;
    const initDemo = (sid: string) => {
        if (demoFolder) demoFolder.destroy();
        demoFolder = gui.addFolder('Demo Settings');
        const config = demos[sid].config;
        if (config.kind === "3D") {
            scene = initThreeScene(config);
        } else {
            scene = init2DScene(config);
        }
        $('title').innerText = demos[sid].title;
        demo = new demos[sid].demo(rust_wasm, canvas, scene, demoFolder);
        demo.init();
    }
    generalFolder.add(props, 'demoSelection', demoNames).name('select demo').onFinishChange(initDemo);
    generalFolder.add(props, 'reset').name('reset simulation');

    // default init
    initDemo(props.demoSelection);

    // main loop
    const animate = () => {
        stats.begin(); // collect perf data for stats.js
        let simTimeMs = performance.now();
        demo.update();
        simTimeMs = performance.now() - simTimeMs;
        if (scene.kind === "3D") {
            scene.renderer.render(scene.scene, scene.camera);
        } else {
            demo.draw();
        }
        simPanel.update(simTimeMs, (maxSimMs = Math.max(maxSimMs, simTimeMs)));
        stats.end();
        requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
}).catch(console.error);
