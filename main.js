import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

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
// GUI
// ------------------------------------------------------------

const guiSettings = {
    h: solver.h,
    mass: solver.mass,
    restDensity: solver.restDensity,
    stiffness: solver.stiffness,
    gamma: solver.gamma,
    viscosity: solver.viscosity,
    gravity: solver.gravity,

    fixedDt: solver.fixedDt,
    substeps: solver.substeps,

    bounce: solver.bounce,
    wallDamping: solver.wallDamping,
    globalDamping: solver.globalDamping,

    reset: () => {
        solver.reset();
        particleRenderer.update();
    }
};

const gui = new GUI();

const sphFolder = gui.addFolder("SPH");
sphFolder
    .add(guiSettings, "h", 0.06, 0.25, 0.005)
    .name("Smoothing h")
    .onChange((value) => {
        solver.setSmoothingLength(value);
    });

sphFolder
    .add(guiSettings, "mass", 0.001, 0.1, 0.001)
    .name("Mass")
    .onChange((value) => {
        solver.mass = value;
    });

sphFolder
    .add(guiSettings, "restDensity", 1.0, 200.0, 1.0)
    .name("Rest Density")
    .onChange((value) => {
        solver.restDensity = value;
    });

sphFolder
    .add(guiSettings, "stiffness", 0.1, 100.0, 0.1)
    .name("Stiffness")
    .onChange((value) => {
        solver.stiffness = value;
    });

sphFolder
    .add(guiSettings, "gamma", 1.0, 10.0, 0.1)
    .name("Gamma")
    .onChange((value) => {
        solver.gamma = value;
    });

sphFolder
    .add(guiSettings, "viscosity", 0.0, 2.0, 0.01)
    .name("Viscosity")
    .onChange((value) => {
        solver.viscosity = value;
    });

sphFolder
    .add(guiSettings, "gravity", -30.0, 10.0, 0.1)
    .name("Gravity")
    .onChange((value) => {
        solver.gravity = value;
    });

sphFolder.open();

const integrationFolder = gui.addFolder("Integration");

integrationFolder
    .add(guiSettings, "fixedDt", 1.0 / 240.0, 1.0 / 30.0, 0.0005)
    .name("Fixed dt")
    .onChange((value) => {
        solver.fixedDt = value;
    });

integrationFolder
    .add(guiSettings, "substeps", 1, 8, 1)
    .name("Substeps")
    .onChange((value) => {
        solver.substeps = value;
    });

const collisionFolder = gui.addFolder("Collision");

collisionFolder
    .add(guiSettings, "bounce", 0.0, 1.0, 0.01)
    .name("Bounce")
    .onChange((value) => {
        solver.bounce = value;
    });

collisionFolder
    .add(guiSettings, "wallDamping", 0.0, 1.0, 0.01)
    .name("Wall Damping")
    .onChange((value) => {
        solver.wallDamping = value;
    });

collisionFolder
    .add(guiSettings, "globalDamping", 0.9, 1.0, 0.001)
    .name("Global Damping")
    .onChange((value) => {
        solver.globalDamping = value;
    });

gui.add(guiSettings, "reset").name("Reset Simulation");

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