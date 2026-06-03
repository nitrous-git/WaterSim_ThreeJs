import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SPHSolver } from "./SPHSolver.js";
import { ParticleRenderer } from "./ParticleRenderer.js";

// ------------------------------------------------------------
// Scene setup
// ------------------------------------------------------------

const canvas = document.getElementById("webgl-canvas");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    100
);

camera.position.set(2.5, 2.0, 3.0);
camera.lookAt(0, 0.9, 0);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// ------------------------------------------------------------
// Controls
// ------------------------------------------------------------

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

// ------------------------------------------------------------
// Lighting
// ------------------------------------------------------------

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x223344, 1.4);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

// ------------------------------------------------------------
// Container
// ------------------------------------------------------------

const boxMin = new THREE.Vector3(-0.2, 0.0, -0.6);
const boxMax = new THREE.Vector3(1.0, 1.6, 1.0);

createContainerBox(scene, boxMin, boxMax);

function createContainerBox(scene, min, max) {
    const size = new THREE.Vector3().subVectors(max, min);
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

    const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const boxEdges = new THREE.EdgesGeometry(boxGeometry);

    const boxLines = new THREE.LineSegments(
        boxEdges,
        new THREE.LineBasicMaterial({ color: 0x335577 })
    );

    boxLines.position.copy(center);
    scene.add(boxLines);
}

// ------------------------------------------------------------
// SPH simulation
// ------------------------------------------------------------

const solver = new SPHSolver({
    countX: 11,
    countY: 14,
    countZ: 11,

    boxMin,
    boxMax,

    h: 0.13,
    mass: 0.02,
    restDensity: 25.0,
    stiffness: 8.0,
    gamma: 7.0,
    viscosity: 0.02,
    gravity: -9.81,

    fixedDt: 1.0 / 120.0,
    substeps: 2,

    particleRadius: 0.025,
    bounce: 0.85,
    wallDamping: 0.85,
    globalDamping: 0.998
});

solver.reset();

const particleRenderer = new ParticleRenderer({
    scene,
    positions: solver.positions,
    particleCount: solver.numParticles,
    particleRadius: solver.particleRadius
});

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------

window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r") {
        solver.reset();
        particleRenderer.update();
    }
});

// ------------------------------------------------------------
// Resize
// ------------------------------------------------------------

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

function animate() {
    requestAnimationFrame(animate);

    for (let i = 0; i < solver.substeps; i++) {
        solver.step(solver.fixedDt / solver.substeps);
    }

    particleRenderer.update();

    controls.update();
    renderer.render(scene, camera);
}

animate();