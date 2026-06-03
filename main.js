import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

const BOX_MIN = new THREE.Vector3(-0.2, 0.0, -0.6);
const BOX_MAX = new THREE.Vector3(1.0, 1.6, 1.0);

const boxSize = new THREE.Vector3().subVectors(BOX_MAX, BOX_MIN);
const boxCenter = new THREE.Vector3().addVectors(BOX_MIN, BOX_MAX).multiplyScalar(0.5);

const boxGeometry = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
const boxEdges = new THREE.EdgesGeometry(boxGeometry);
const boxLines = new THREE.LineSegments(
    boxEdges,
    new THREE.LineBasicMaterial({ color: 0x335577 })
);

boxLines.position.copy(boxCenter);
scene.add(boxLines);

// ------------------------------------------------------------
// SPH parameters
// ------------------------------------------------------------

const COUNT_X = 11;
const COUNT_Y = 14;
const COUNT_Z = 11;

const NUM_PARTICLES = COUNT_X * COUNT_Y * COUNT_Z;

const H = 0.13;                    // smoothing radius
const H2 = H * H;
const CELL_SIZE = H;

const MASS = 0.02;
const REST_DENSITY = 25.0;
const STIFFNESS = 8.0;
const GAMMA = 7.0;

const VISCOSITY = 0.02;
const GRAVITY = -9.81;

const PARTICLE_RADIUS = 0.025;
const BOUNCE = 0.85;
const WALL_DAMPING = 0.85;

const FIXED_DT = 1.0 / 120.0;
const SUBSTEPS = 2;

// Standard SPH kernels
const POLY6 = 315.0 / (64.0 * Math.PI * Math.pow(H, 9));
const SPIKY_GRAD = -45.0 / (Math.PI * Math.pow(H, 6));
const VISC_LAP = 45.0 / (Math.PI * Math.pow(H, 6));

// ------------------------------------------------------------
// Particle data
// ------------------------------------------------------------

const positions = new Float32Array(NUM_PARTICLES * 3);
const velocities = new Float32Array(NUM_PARTICLES * 3);
const accelerations = new Float32Array(NUM_PARTICLES * 3);

const densities = new Float32Array(NUM_PARTICLES);
const pressures = new Float32Array(NUM_PARTICLES);

// ------------------------------------------------------------
// Particle rendering
// ------------------------------------------------------------

const particleGeometry = new THREE.BufferGeometry();
const positionAttribute = new THREE.BufferAttribute(positions, 3);
particleGeometry.setAttribute("position", positionAttribute);

const particleMaterial = new THREE.PointsMaterial({
    color: 0x4db8ff,
    size: PARTICLE_RADIUS * 2.5,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
});

const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particlePoints);

// ------------------------------------------------------------
// Spatial hash grid
// ------------------------------------------------------------

const spatialHash = new Map();

function cellCoord(value) {
    return Math.floor(value / CELL_SIZE);
}

function cellKey(ix, iy, iz) {
    return `${ix},${iy},${iz}`;
}

function buildSpatialHash() {
    spatialHash.clear();

    for (let i = 0; i < NUM_PARTICLES; i++) {
        const base = i * 3;

        const ix = cellCoord(positions[base]);
        const iy = cellCoord(positions[base + 1]);
        const iz = cellCoord(positions[base + 2]);

        const key = cellKey(ix, iy, iz);

        let bucket = spatialHash.get(key);
        if (bucket === undefined) {
            bucket = [];
            spatialHash.set(key, bucket);
        }

        bucket.push(i);
    }
}

function forEachNeighbor(i, callback) {
    const base = i * 3;

    const ix = cellCoord(positions[base]);
    const iy = cellCoord(positions[base + 1]);
    const iz = cellCoord(positions[base + 2]);

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = cellKey(ix + dx, iy + dy, iz + dz);
                const bucket = spatialHash.get(key);

                if (bucket === undefined) {
                    continue;
                }

                for (let k = 0; k < bucket.length; k++) {
                    callback(bucket[k]);
                }
            }
        }
    }
}

// ------------------------------------------------------------
// Initial particle block
// ------------------------------------------------------------

function resetParticles() {
    let index = 0;

    const startX = 0.00;
    const startY = 0.25;
    const startZ = -0.15;
    const spacing = 0.08;

    for (let y = 0; y < COUNT_Y; y++) {
        for (let x = 0; x < COUNT_X; x++) {
            for (let z = 0; z < COUNT_Z; z++) {
                const base = index * 3;

                const jitterX = (Math.random() - 0.5) * 0.01;
                const jitterY = (Math.random() - 0.5) * 0.01;
                const jitterZ = (Math.random() - 0.5) * 0.01;

                positions[base] = startX + x * spacing + jitterX;
                positions[base + 1] = startY + y * spacing + jitterY;
                positions[base + 2] = startZ + z * spacing + jitterZ;

                velocities[base] = 0.0;
                velocities[base + 1] = 0.0;
                velocities[base + 2] = 0.0;

                index++;
            }
        }
    }

    positionAttribute.needsUpdate = true;
}

// ------------------------------------------------------------
// SPH density + pressure
// ------------------------------------------------------------

function computeDensityAndPressure() {
    for (let i = 0; i < NUM_PARTICLES; i++) {
        const ib = i * 3;

        let rho = 0.0;

        const xi = positions[ib];
        const yi = positions[ib + 1];
        const zi = positions[ib + 2];

        forEachNeighbor(i, (j) => {
            const jb = j * 3;

            const rx = xi - positions[jb];
            const ry = yi - positions[jb + 1];
            const rz = zi - positions[jb + 2];

            const r2 = rx * rx + ry * ry + rz * rz;

            if (r2 < H2) {
                const diff = H2 - r2;
                rho += MASS * POLY6 * diff * diff * diff;
            }
        });

        densities[i] = Math.max(rho, 0.0001);

        const ratio = densities[i] / REST_DENSITY;
        const pressure = STIFFNESS * (Math.pow(ratio, GAMMA) - 1.0);

        pressures[i] = Math.max(pressure, 0.0);
    }
}

// ------------------------------------------------------------
// SPH forces
// ------------------------------------------------------------

function computeForces() {
    for (let i = 0; i < NUM_PARTICLES; i++) {
        const ib = i * 3;

        let ax = 0.0;
        let ay = GRAVITY;
        let az = 0.0;

        const xi = positions[ib];
        const yi = positions[ib + 1];
        const zi = positions[ib + 2];

        const vxi = velocities[ib];
        const vyi = velocities[ib + 1];
        const vzi = velocities[ib + 2];

        const rhoi = densities[i];
        const Pi = pressures[i];

        forEachNeighbor(i, (j) => {
            if (i === j) {
                return;
            }

            const jb = j * 3;

            const rx = xi - positions[jb];
            const ry = yi - positions[jb + 1];
            const rz = zi - positions[jb + 2];

            const r2 = rx * rx + ry * ry + rz * rz;

            if (r2 <= 0.000001 || r2 >= H2) {
                return;
            }

            const r = Math.sqrt(r2);
            const rhoj = densities[j];
            const Pj = pressures[j];

            // Pressure force
            const pressureTerm = (Pi / (rhoi * rhoi)) + (Pj / (rhoj * rhoj));
            const gradScale = SPIKY_GRAD * (H - r) * (H - r) / r;

            const gradX = gradScale * rx;
            const gradY = gradScale * ry;
            const gradZ = gradScale * rz;

            ax += -MASS * pressureTerm * gradX;
            ay += -MASS * pressureTerm * gradY;
            az += -MASS * pressureTerm * gradZ;

            // Viscosity force
            const lap = VISC_LAP * (H - r);

            ax += VISCOSITY * MASS * (velocities[jb] - vxi) / rhoj * lap;
            ay += VISCOSITY * MASS * (velocities[jb + 1] - vyi) / rhoj * lap;
            az += VISCOSITY * MASS * (velocities[jb + 2] - vzi) / rhoj * lap;
        });

        accelerations[ib] = ax;
        accelerations[ib + 1] = ay;
        accelerations[ib + 2] = az;
    }
}

// ------------------------------------------------------------
// Container collision
// ------------------------------------------------------------

function collideWithContainer(i) {
    const base = i * 3;

    let x = positions[base];
    let y = positions[base + 1];
    let z = positions[base + 2];

    let vx = velocities[base];
    let vy = velocities[base + 1];
    let vz = velocities[base + 2];

    const minX = BOX_MIN.x + PARTICLE_RADIUS;
    const minY = BOX_MIN.y + PARTICLE_RADIUS;
    const minZ = BOX_MIN.z + PARTICLE_RADIUS;

    const maxX = BOX_MAX.x - PARTICLE_RADIUS;
    const maxY = BOX_MAX.y - PARTICLE_RADIUS;
    const maxZ = BOX_MAX.z - PARTICLE_RADIUS;

    if (x < minX) {
        x = minX;
        vx = Math.abs(vx) * BOUNCE;
        vy *= WALL_DAMPING;
        vz *= WALL_DAMPING;
    } else if (x > maxX) {
        x = maxX;
        vx = -Math.abs(vx) * BOUNCE;
        vy *= WALL_DAMPING;
        vz *= WALL_DAMPING;
    }

    if (y < minY) {
        y = minY;
        vy = Math.abs(vy) * BOUNCE;
        vx *= WALL_DAMPING;
        vz *= WALL_DAMPING;
    } else if (y > maxY) {
        y = maxY;
        vy = -Math.abs(vy) * BOUNCE;
        vx *= WALL_DAMPING;
        vz *= WALL_DAMPING;
    }

    if (z < minZ) {
        z = minZ;
        vz = Math.abs(vz) * BOUNCE;
        vx *= WALL_DAMPING;
        vy *= WALL_DAMPING;
    } else if (z > maxZ) {
        z = maxZ;
        vz = -Math.abs(vz) * BOUNCE;
        vx *= WALL_DAMPING;
        vy *= WALL_DAMPING;
    }

    positions[base] = x;
    positions[base + 1] = y;
    positions[base + 2] = z;

    velocities[base] = vx;
    velocities[base + 1] = vy;
    velocities[base + 2] = vz;
}

// ------------------------------------------------------------
// Simulation step
// ------------------------------------------------------------

function stepSPH(dt) {
    buildSpatialHash();

    computeDensityAndPressure();
    computeForces();

    for (let i = 0; i < NUM_PARTICLES; i++) {
        const base = i * 3;

        velocities[base] += accelerations[base] * dt;
        velocities[base + 1] += accelerations[base + 1] * dt;
        velocities[base + 2] += accelerations[base + 2] * dt;

        // Small global damping for stability
        velocities[base] *= 0.998;
        velocities[base + 1] *= 0.998;
        velocities[base + 2] *= 0.998;

        positions[base] += velocities[base] * dt;
        positions[base + 1] += velocities[base + 1] * dt;
        positions[base + 2] += velocities[base + 2] * dt;

        collideWithContainer(i);
    }

    positionAttribute.needsUpdate = true;
}

// ------------------------------------------------------------
// Controls
// ------------------------------------------------------------

window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r") {
        resetParticles();
    }
});

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

resetParticles();

function animate() {
    requestAnimationFrame(animate);

    for (let i = 0; i < SUBSTEPS; i++) {
        stepSPH(FIXED_DT / SUBSTEPS);
    }

    controls.update();
    renderer.render(scene, camera);
}

animate();