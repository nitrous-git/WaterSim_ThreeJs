import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";

import { SPHSolver } from "./SPHSolver.js";
import { ParticleRenderer } from "./ParticleRenderer.js";
import { ScreenSpaceFluidRenderer  } from "./ScreenSpaceFluidRenderer.js";

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

// Mouse Raycaster
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

const pointerState = {
    isDown: false,
    hasMoved: false
};

const interactionState = {
    waterInteraction: false
};

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
    countX: 12,
    countY: 16,
    countZ: 12,

    boxMin,
    boxMax,

    h: 0.13,
    mass: 0.039,
    restDensity: 92.0,
    stiffness: 8.0,
    gamma: 7.0,
    viscosity: 0.02,
    gravity: -9.81,

    fixedDt: 1.0 / 120.0,
    substeps: 1,

    particleRadius: 0.025,  // 0.09 could also work
    bounce: 0.25,
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

const screenSpaceFluidRenderer = new ScreenSpaceFluidRenderer({
    positions: solver.positions,
    particleCount: solver.numParticles,

    // Use a visual radius larger than the physics radius
    // so the projected particles overlap into a surface.
    particleRadius: solver.h * 0.45,

    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: renderer.getPixelRatio(),

    blurIterations: 10
});

// ------------------------------------------------------------
// Debug panel
// ------------------------------------------------------------

const debugPanel = document.getElementById("debug-panel");

let frameCounter = 0;
let fpsTimer = 0;
let displayedFps = 0;

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

/*
const presets = {
    stable: () => {
        solver.h = 0.12;
        solver.mass = 0.02;
        solver.restDensity = 35.0;
        solver.stiffness = 5.0;
        solver.gamma = 7.0;
        solver.viscosity = 0.08;
        solver.gravity = -9.81;
        solver.fixedDt = 1.0 / 120.0;
        solver.substeps = 2;
        solver.globalDamping = 0.998;
        solver.bounce = 0.35;
        solver.wallDamping = 0.85;

        solver.updateKernelConstants();
        solver.reset();
        particleRenderer.update();
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    },

    energetic: () => {
        solver.h = 0.13;
        solver.mass = 0.02;
        solver.restDensity = 25.0;
        solver.stiffness = 8.0;
        solver.gamma = 7.0;
        solver.viscosity = 0.02;
        solver.gravity = -9.81;
        solver.fixedDt = 1.0 / 120.0;
        solver.substeps = 2;
        solver.globalDamping = 0.997;
        solver.bounce = 0.85;
        solver.wallDamping = 0.85;

        solver.updateKernelConstants();
        solver.reset();
        particleRenderer.update();
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    },

    viscous: () => {
        solver.h = 0.14;
        solver.mass = 0.025;
        solver.restDensity = 35.0;
        solver.stiffness = 4.0;
        solver.gamma = 6.0;
        solver.viscosity = 0.25;
        solver.gravity = -9.81;
        solver.fixedDt = 1.0 / 120.0;
        solver.substeps = 2;
        solver.globalDamping = 0.995;
        solver.bounce = 0.2;
        solver.wallDamping = 0.7;

        solver.updateKernelConstants();
        solver.reset();
        particleRenderer.update();
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    }
};

const presetFolder = gui.addFolder("Presets");
presetFolder.add(presets, "stable").name("Stable Water");
presetFolder.add(presets, "energetic").name("Energetic");
presetFolder.add(presets, "viscous").name("Viscous");
presetFolder.open();
*/

const renderSettings = {
    mode: "Screen-Space Fluid"
};

const renderModes = [
    "Water Particles",
    "Screen-Space Fluid"
];

gui
    .add(renderSettings, "mode", renderModes)
    .name("Render Mode")
    .onChange(updateRenderMode);

function updateRenderMode() {
    const useParticleRenderer =
        renderSettings.mode === "Water Particles";

    particleRenderer.setEnabled(useParticleRenderer);
}

updateRenderMode();

gui.add(guiSettings, "reset").name("Reset Simulation");

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

sphFolder
    .add(
        solver,
        "surfaceTension",
        0.0,
        2000.0,
        1.0
    )
    .name("Cohesion Strength");

sphFolder
    .add(
        solver,
        "surfaceDensityRange",
        0.05,
        0.8,
        0.01
    )
    .name("Surface Density Range");

sphFolder
    .add(
        solver,
        "cohesionMinQ",
        0.0,
        0.8,
        0.01
    )
    .name("Minimum Distance Ratio");

sphFolder.close();

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

integrationFolder.close();

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

collisionFolder.close();


// screen-space fluid GUI controls
// --------------------------------------
const screenSpaceFolder =
    gui.addFolder("Screen-Space Fluid");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer,
        "blurIterations",
        1,
        20,
        1
    )
    .name("Blur Iterations");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer.blurMaterial.uniforms.uDepthThreshold,
        "value",
        0.01,
        0.5,
        0.01
    )
    .name("Depth Threshold");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer.compositeMaterial.uniforms.uOpacity,
        "value",
        0.0,
        1.0,
        0.01
    )
    .name("Water Opacity");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer.compositeMaterial.uniforms.uRefractionStrength,
        "value",
        0.0,
        0.05,
        0.001
    )
    .name("Refraction");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer.compositeMaterial.uniforms.uFresnelStrength,
        "value",
        0.0,
        2.0,
        0.05
    )
    .name("Fresnel");

screenSpaceFolder
    .add(
        screenSpaceFluidRenderer.compositeMaterial.uniforms.uSpecularStrength,
        "value",
        0.0,
        2.0,
        0.05
    )
    .name("Specular");

screenSpaceFolder.close();

// fluid mouse interaction GUI controls
// --------------------------------------
const interactionFolder = gui.addFolder("Mouse Interaction");

interactionFolder
    .add(interactionState, "waterInteraction")
    .name("Enable Interaction")
    .onChange((enabled) => {
        controls.enabled = !enabled;

        pointerState.isDown = false;
        pointerState.hasMoved = false;

        solver.setMouseForceRay(
            false,
            raycaster.ray.origin,
            raycaster.ray.direction
        );

        renderer.domElement.style.cursor = enabled ? "crosshair" : "grab";
    });

interactionFolder
    .add(solver, "mouseForceRadius", 0.10, 0.45, 0.01)
    .name("Radius");

interactionFolder
    .add(solver, "mouseForceStrength", -50.0, 50.0, 1.0)
    .name("Strength");

interactionFolder.open();


// ------------------------------------------------------------
// Input
// ------------------------------------------------------------

window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r") {
        solver.reset();
        particleRenderer.update();
    }
});

function updateMouseNDC(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2.0 - 1.0;
    mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2.0 + 1.0;

    pointerState.hasMoved = true;
}

function updateMouseForceRay() {
    if (!interactionState.waterInteraction || !pointerState.hasMoved) {
        solver.setMouseForceRay(false, raycaster.ray.origin, raycaster.ray.direction);
        return;
    }

    raycaster.setFromCamera(mouseNDC, camera);

    solver.setMouseForceRay(
        pointerState.isDown,
        raycaster.ray.origin,
        raycaster.ray.direction
    );
}

window.addEventListener("pointermove", (event) => {
    if (!interactionState.waterInteraction) {
        return;
    }

    updateMouseNDC(event);
});

window.addEventListener("pointerdown", (event) => {
    if (!interactionState.waterInteraction || event.button !== 0) {
        return;
    }

    pointerState.isDown = true;
    updateMouseNDC(event);
    updateMouseForceRay();
});

window.addEventListener("pointerup", () => {
    pointerState.isDown = false;
    updateMouseForceRay();
});

window.addEventListener("pointerleave", () => {
    pointerState.isDown = false;
    updateMouseForceRay();
});

// ------------------------------------------------------------
// Resize
// ------------------------------------------------------------

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

    particleRenderer.setResolution(window.innerWidth, window.innerHeight);

    screenSpaceFluidRenderer.setResolution(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
});

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

let previousTime = performance.now();
let accumulator = 0;
const maxFrameDt = 0.05;

function animate(currentTime) {
    requestAnimationFrame(animate);


    const rawDeltaSeconds = (currentTime - previousTime) * 0.001;
    const physicsDeltaSeconds = Math.min(rawDeltaSeconds, maxFrameDt);

    previousTime = currentTime;

    //accumulator += physicsDeltaSeconds;

    // This counts rendered frames, not physics steps
    frameCounter++;
    fpsTimer += rawDeltaSeconds;

    if (fpsTimer >= 0.25) {
        displayedFps = Math.round(frameCounter / fpsTimer);
        frameCounter = 0;
        fpsTimer = 0;
    }

    updateMouseForceRay();

    // Solver Update
    for (let i = 0; i < solver.substeps; i++) {
        solver.step(solver.fixedDt / solver.substeps);
    }

    const useParticles = renderSettings.mode === "Water Particles";

    if (useParticles) {
        particleRenderer.update(currentTime * 0.001);
    } else {
        screenSpaceFluidRenderer.update();
    }

    debugPanel.innerHTML = `
        Particles: ${solver.numParticles}<br>
        FPS: ${displayedFps}<br>
        fixedDt: ${solver.fixedDt.toFixed(4)}<br>
        h: ${solver.h.toFixed(3)}<br>
        stiffness: ${solver.stiffness.toFixed(2)}<br>
        viscosity: ${solver.viscosity.toFixed(3)}
    `;

    controls.update();

    if (useParticles) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
    } else {
        screenSpaceFluidRenderer.render(renderer, scene, camera);
    }
}

requestAnimationFrame(animate);