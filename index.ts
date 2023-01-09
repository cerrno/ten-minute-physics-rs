import GUI from 'lil-gui';
import * as Stats from 'stats.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { SelfCollisionDemo, SelfCollisionDemoConfig } from './src/self_collision_15';
import { ClothDemo, ClothDemoConfig } from './src/cloth_14';
import { HashDemo, HashDemoConfig } from './src/hashing_11';
import { Demo, Scene, Scene2D, Scene3D, SceneConfig, Scene2DConfig, Scene3DConfig } from './src/lib';
import { SoftBodiesDemo, SoftBodiesDemoConfig } from './src/softbodies_10';
import { SkinnedSoftbodyDemo, SkinnedSoftbodyDemoConfig } from './src/softbody_skinning_12';
import { FluidDemo, FluidDemoConfig } from './src/fluid_sim_17';

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
        }
    };
    const demoNames = Object.keys(demos);
    let canvas = $('canvas') as HTMLCanvasElement;
    let demo: Demo<any, any>;
    let scene: Scene;

    const replaceCanvas = () => {
        // replace canvas element so we can get a new rendering context
        let newCanvas = document.createElement('canvas');
        canvas.parentNode.replaceChild(newCanvas, canvas);
        canvas = newCanvas;
    }

    const initCanvasScene = (_: Scene2DConfig): Scene2D => {
        replaceCanvas();

        let context = canvas.getContext('2d', { desynchronized: true });
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.focus();
        return { kind: '2D', width: canvas.width, height: canvas.height, context };
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
    stats.showPanel(1); // ms per frame
    $('container').appendChild(stats.dom);

    // populate controls window
    const props = {
        demoSelection: demoNames[0],
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
            scene = initCanvasScene(config);
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
    const step = () => {
        stats.begin(); // collect perf data for stats.js
        demo.update(); // 2D scenes draw as part of `update()`
        if (scene.kind === "3D") {
            scene.renderer.render(scene.scene, scene.camera);
        }
        stats.end();
        requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}).catch(console.error);
