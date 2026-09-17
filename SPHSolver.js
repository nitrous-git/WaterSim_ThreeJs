// ------------------------------------------------------------
// SPH Simulation
// ------------------------------------------------------------

import { SpatialHashGrid3D } from "./SpatialHashGrid3D.js";

export class SPHSolver {
    constructor(options = {}) {
        this.countX = options.countX ?? 10;
        this.countY = options.countY ?? 14;
        this.countZ = options.countZ ?? 10;

        this.numParticles = this.countX * this.countY * this.countZ;

        this.boxMin = options.boxMin ?? { x: -0.2, y: 0.0, z: -0.8 };
        this.boxMax = options.boxMax ?? { x: 1.0, y: 1.6, z: 1.0 };

        // SPH parameters
        this.h = options.h ?? 0.12;
        this.mass = options.mass ?? 0.039;
        this.restDensity = options.restDensity ?? 92.0;
        this.stiffness = options.stiffness ?? 8.0;
        this.gamma = options.gamma ?? 7.0;
        this.viscosity = options.viscosity ?? 0.02;
        this.gravity = options.gravity ?? -9.81;

        // Integration / collision parameters
        this.fixedDt = options.fixedDt ?? 1.0 / 120.0;
        this.substeps = options.substeps ?? 1;

        this.particleRadius = options.particleRadius ?? 0.025;
        this.bounce = options.bounce ?? 0.85;
        this.wallDamping = options.wallDamping ?? 0.85;
        this.globalDamping = options.globalDamping ?? 0.998;

        this.initialSpacing = options.initialSpacing ?? 0.07;
        this.initialHeight = options.initialHeight ?? 0.65;

        this.initialPosition = options.initialPosition ?? {x: -0.20, y: 0.0, z: -0.5};

        // Surface tension

        // This is a tunable simulation coefficient,
        // not a real SI water surface-tension value.
        this.surfaceTension = options.surfaceTension ?? 1779.0;

        // Density deficit required to classify a particle
        // as strongly exposed to the free surface.
        this.surfaceDensityRange = options.surfaceDensityRange ?? 0.2;

        // Avoid attraction at very small particle separations.
        this.cohesionMinQ = options.cohesionMinQ ?? 0.28;

        // Mouse / pointer interaction
        this.mouseForceActive = false;
        this.mouseForceRadius = options.mouseForceRadius ?? 0.40;
        this.mouseForceStrength = options.mouseForceStrength ?? 50.0;

        this.mouseRayOrigin = { x: 0.0, y: 0.0, z: 0.0 };
        this.mouseRayDirection = { x: 0.0, y: 0.0, z: -1.0 };

        // Particle arrays
        this.positions = new Float32Array(this.numParticles * 3);
        this.velocities = new Float32Array(this.numParticles * 3);
        this.accelerations = new Float32Array(this.numParticles * 3);

        this.densities = new Float32Array(this.numParticles);
        this.pressures = new Float32Array(this.numParticles);

        this.densityScratch = new Float64Array(this.numParticles);

        this.surfaceFactors = new Float32Array(this.numParticles);

        // Unique SPH neighbor pairs
        this.pairCount = 0;
        this.pairCapacity =  Math.max(1024, this.numParticles * 32);
        this.pairA = new Int32Array(this.pairCapacity);
        this.pairB = new Int32Array(this.pairCapacity);


        this.grid = new SpatialHashGrid3D(this.h, this.boxMin, this.boxMax);

        // debug forces
        this.enablePressureForce = true;
        this.enableViscosityForce = true;
        this.enableCohesionForce = true;

        this.updateKernelConstants();

        this.profile = {
            gridMs: 0.0,
            pairBuildMs: 0.0,
            densityMs: 0.0,
            forcesMs: 0.0,
            integrationMs: 0.0,
            totalMs: 0.0
        };
    }

    updateKernelConstants() {
        this.h2 = this.h * this.h;

        this.poly6 = 315.0 / (64.0 * Math.PI * Math.pow(this.h, 9));
        this.spikyGrad = -45.0 / (Math.PI * Math.pow(this.h, 6));
        this.viscLap = 45.0 / (Math.PI * Math.pow(this.h, 6));

        this.grid.setCellSize(this.h);
    }

    setSmoothingLength(value) {
        this.h = value;
        this.updateKernelConstants();
    }

    reset() {
        let index = 0;

        const startX = this.initialPosition.x;
        const startY = this.initialPosition.y;
        const startZ = this.initialPosition.z;

        for (let y = 0; y < this.countY; y++) {
            for (let x = 0; x < this.countX; x++) {
                for (let z = 0; z < this.countZ; z++) {
                    const base = index * 3;

                    const jitterX = (Math.random() - 0.5) * 0.01;
                    const jitterY = (Math.random() - 0.5) * 0.01;
                    const jitterZ = (Math.random() - 0.5) * 0.01;

                    this.positions[base] = startX + x * this.initialSpacing + jitterX;

                    this.positions[base + 1] = startY + y * this.initialSpacing + jitterY;

                    this.positions[base + 2] = startZ + z * this.initialSpacing + jitterZ;

                    this.velocities[base] = 0.0;
                    this.velocities[base + 1] = 0.0;
                    this.velocities[base + 2] = 0.0;

                    this.accelerations[base] = 0.0;
                    this.accelerations[base + 1] = 0.0;
                    this.accelerations[base + 2] = 0.0;

                    index++;
                }
            }
        }

        this.densities.fill(0.0);
        this.pressures.fill(0.0);
        this.pairCount = 0;
    }

    step(dt) {
        const totalStart = performance.now();

        // --------------------------------------------------------
        // Spatial grid
        // --------------------------------------------------------

        let phaseStart = performance.now();

        this.grid.build(this.positions, this.numParticles);

        this.profile.gridMs = performance.now() - phaseStart;

        // --------------------------------------------------------
        // Unique interacting pairs
        // --------------------------------------------------------

        phaseStart = performance.now();

        this.buildUniqueNeighborPairs();

        this.profile.pairBuildMs = performance.now() - phaseStart;

        // --------------------------------------------------------
        // Density / pressure
        // --------------------------------------------------------

        phaseStart = performance.now();

        this.computeDensityAndPressure();

        this.profile.densityMs = performance.now() - phaseStart;

        // --------------------------------------------------------
        // Forces
        // --------------------------------------------------------

        phaseStart = performance.now();

        this.computeForces();

        this.profile.forcesMs = performance.now() - phaseStart;

        // --------------------------------------------------------
        // External forces + integration
        // --------------------------------------------------------

        phaseStart = performance.now();

        this.applyMouseForce();

        this.integrateEuler(dt);

        this.applyGlobalDamping();

        this.profile.integrationMs = performance.now() - phaseStart;

        // --------------------------------------------------------
        // Total solver step
        // --------------------------------------------------------

        this.profile.totalMs = performance.now() - totalStart;
    }

    computeDensityAndPressure() {
        const positions = this.positions;
        const densities = this.densities;
        const pressures = this.pressures;
        const surfaceFactors = this.surfaceFactors;
        const densityScratch = this.densityScratch;

        const pairA = this.pairA;
        const pairB = this.pairB;
        const pairCount = this.pairCount;

        const h2 = this.h2;
        const kernelScale = this.mass * this.poly6;

        // --------------------------------------------------------
        // Self density
        // --------------------------------------------------------
        //
        // The old particle-centric density loop included i == j.
        //
        // Since the pair list contains only distinct pairs,
        // explicitly seed every particle with W(0).

        const selfDensity = kernelScale * h2 * h2 * h2;

        densityScratch.fill(selfDensity);

        // --------------------------------------------------------
        // Pair density
        // --------------------------------------------------------
        //
        // Every stored pair contributes the same Poly6 value
        // to both particles.

        for (let k = 0; k < pairCount; k++) {
            const i = pairA[k];
            const j = pairB[k];

            const ib = i * 3;
            const jb = j * 3;

            const dx = positions[ib] - positions[jb];
            const dy = positions[ib + 1] - positions[jb + 1];
            const dz = positions[ib + 2] - positions[jb + 2];

            const r2 = dx * dx + dy * dy + dz * dz;

            // No support-radius test is required here.
            //
            // buildUniqueNeighborPairs() already guarantees:
            //
            //     r2 < h2
            //
            // and positions have not changed since the pair list
            // was generated.

            const diff = h2 - r2;
            const contribution = kernelScale * diff * diff * diff;

            densityScratch[i] += contribution;
            densityScratch[j] += contribution;
        }

        // --------------------------------------------------------
        // Pressure + surface classification
        // --------------------------------------------------------

        const restDensity = this.restDensity;
        const stiffness = this.stiffness;
        const gamma = this.gamma;
        const surfaceDensityRange = this.surfaceDensityRange;

        for (let i = 0; i < this.numParticles; i++) {
            const density = densityScratch[i];

            densities[i] = density;

            const ratio = density / restDensity;

            const pressure = stiffness * (Math.pow(ratio, gamma) - 1.0);

            pressures[i] = Math.max(pressure, 0.0);

            const densityDeficit =
                (restDensity - density) / (restDensity * surfaceDensityRange);

            surfaceFactors[i] = Math.min(1.0, Math.max(0.0, densityDeficit));
        }
    }

    computeForces() {
        const positions = this.positions;
        const velocities = this.velocities;
        const accelerations = this.accelerations;

        const densities = this.densities;
        const pressures = this.pressures;
        const surfaceFactors = this.surfaceFactors;

        const grid = this.grid;

        const cellHeads = grid.cellHeads;
        const particleNext = grid.particleNext;

        const cellsX = grid.cellsX;
        const cellsY = grid.cellsY;
        const cellsZ = grid.cellsZ;

        const strideY = cellsX;
        const strideZ = cellsX * cellsY;

        const invCellSize = grid.invCellSize;

        const gridMinX = grid.boxMin.x;
        const gridMinY = grid.boxMin.y;
        const gridMinZ = grid.boxMin.z;

        const h = this.h;
        const h2 = this.h2;

        const mass = this.mass;

        const gravity = this.gravity;

        const spikyGrad = this.spikyGrad;
        const viscLap = this.viscLap;

        const viscosity = this.viscosity;

        const surfaceTension = this.surfaceTension;

        const enablePressure = this.enablePressureForce;
        const enableViscosity = this.enableViscosityForce;
        const enableCohesion = this.enableCohesionForce;

        for (let i = 0; i < this.numParticles; i++) {
            const ib = i * 3;

            const xi = positions[ib];
            const yi = positions[ib + 1];
            const zi = positions[ib + 2];

            const vxi = velocities[ib];
            const vyi = velocities[ib + 1];
            const vzi = velocities[ib + 2];

            const rhoi = densities[i];
            const Pi = pressures[i];

            let ax = 0.0;
            let ay = gravity;
            let az = 0.0;

            // ----------------------------------------------------
            // Particle grid cell
            // ----------------------------------------------------

            let ix = Math.floor((xi - gridMinX) * invCellSize);
            let iy = Math.floor((yi - gridMinY) * invCellSize);
            let iz = Math.floor((zi - gridMinZ) * invCellSize);

            ix = Math.max(0, Math.min(cellsX - 1, ix));
            iy = Math.max(0, Math.min(cellsY - 1, iy));
            iz = Math.max(0, Math.min(cellsZ - 1, iz));

            // ----------------------------------------------------
            // Neighbor cell range
            // ----------------------------------------------------

            const minX = Math.max(0, ix - 1);
            const maxX = Math.min(cellsX - 1, ix + 1);

            const minY = Math.max(0, iy - 1);
            const maxY = Math.min(cellsY - 1, iy + 1);

            const minZ = Math.max(0, iz - 1);
            const maxZ = Math.min(cellsZ - 1, iz + 1);

            // ----------------------------------------------------
            // Neighbor traversal
            // ----------------------------------------------------

            for (let z = minZ; z <= maxZ; z++) {
                const zOffset = z * strideZ;

                for (let y = minY; y <= maxY; y++) {
                    const yzOffset = zOffset + y * strideY;

                    for (let x = minX; x <= maxX; x++) {
                        let j = cellHeads[yzOffset + x];

                        while (j !== -1) {
                            if (j !== i) {
                                const jb = j * 3;

                                const rx = xi - positions[jb];
                                const ry = yi - positions[jb + 1];
                                const rz = zi - positions[jb + 2];

                                const r2 = rx * rx + ry * ry + rz * rz;

                                if (r2 > 0.000001 && r2 < h2) {
                                    const r = Math.sqrt(r2);

                                    const rhoj = densities[j];
                                    const Pj = pressures[j];

                                    // ----------------------------
                                    // Pressure
                                    // ----------------------------

                                    if (enablePressure) {
                                        const pressureTerm =
                                            Pi / (rhoi * rhoi) + Pj / (rhoj * rhoj);

                                        const hMinusR = h - r;

                                        const gradScale = spikyGrad * hMinusR * hMinusR / r;

                                        const gradX = gradScale * rx;
                                        const gradY = gradScale * ry;
                                        const gradZ = gradScale * rz;

                                        ax += -mass * pressureTerm * gradX;
                                        ay += -mass * pressureTerm * gradY;
                                        az += -mass * pressureTerm * gradZ;
                                    }

                                    // ----------------------------
                                    // Viscosity
                                    // ----------------------------

                                    if (enableViscosity) {
                                        const lap = viscLap * (h - r);

                                        const factor = viscosity * mass * lap / rhoj;

                                        ax += factor * (velocities[jb] - vxi);
                                        ay += factor * (velocities[jb + 1] - vyi);
                                        az += factor * (velocities[jb + 2] - vzi);
                                    }

                                    // ----------------------------
                                    // Cohesion
                                    // ----------------------------

                                    if (enableCohesion) {
                                        const surfaceFactor = Math.max(surfaceFactors[i],  surfaceFactors[j]);

                                        if (surfaceFactor > 0.0) {
                                            const q = r / h;

                                            const cohesionWeight = this.computeCohesionWeight(q);

                                            if (cohesionWeight > 0.0) {
                                                const invR = 1.0 / r;

                                                const cohesionAcceleration =
                                                    surfaceTension *
                                                    mass *
                                                    surfaceFactor *
                                                    cohesionWeight /
                                                    Math.max(rhoj, 0.0001);

                                                ax += cohesionAcceleration * (-rx * invR);
                                                ay += cohesionAcceleration * (-ry * invR);
                                                az += cohesionAcceleration * (-rz * invR);
                                            }
                                        }
                                    }
                                }
                            }

                            // Always advance exactly once.
                            j = particleNext[j];
                        }
                    }
                }
            }

            accelerations[ib] = ax;
            accelerations[ib + 1] = ay;
            accelerations[ib + 2] = az;
        }
    }

    integrateEuler(dt) {
        for (let i = 0; i < this.numParticles; i++) {
            const base = i * 3;

            // Update velocity first
            this.velocities[base] += this.accelerations[base] * dt;
            this.velocities[base + 1] += this.accelerations[base + 1] * dt;
            this.velocities[base + 2] += this.accelerations[base + 2] * dt;

            // Then update position
            this.positions[base] += this.velocities[base] * dt;
            this.positions[base + 1] += this.velocities[base + 1] * dt;
            this.positions[base + 2] += this.velocities[base + 2] * dt;

            // Container collision
            this.collideWithContainer(i);
        }
    }

    applyGlobalDamping() {
        for (let i = 0; i < this.numParticles; i++) {
            const base = i * 3;

            this.velocities[base] *= this.globalDamping;
            this.velocities[base + 1] *= this.globalDamping;
            this.velocities[base + 2] *= this.globalDamping;
        }
    }

    collideWithContainer(i) {
        const base = i * 3;

        let x = this.positions[base];
        let y = this.positions[base + 1];
        let z = this.positions[base + 2];

        let vx = this.velocities[base];
        let vy = this.velocities[base + 1];
        let vz = this.velocities[base + 2];

        const minX = this.boxMin.x + this.particleRadius;
        const minY = this.boxMin.y + this.particleRadius;
        const minZ = this.boxMin.z + this.particleRadius;

        const maxX = this.boxMax.x - this.particleRadius;
        const maxY = this.boxMax.y - this.particleRadius;
        const maxZ = this.boxMax.z - this.particleRadius;

        if (x < minX) {
            x = minX;
            vx = Math.abs(vx) * this.bounce;
            vy *= this.wallDamping;
            vz *= this.wallDamping;
        } else if (x > maxX) {
            x = maxX;
            vx = -Math.abs(vx) * this.bounce;
            vy *= this.wallDamping;
            vz *= this.wallDamping;
        }

        if (y < minY) {
            y = minY;
            vy = Math.abs(vy) * this.bounce;
            vx *= this.wallDamping;
            vz *= this.wallDamping;
        } else if (y > maxY) {
            y = maxY;
            vy = -Math.abs(vy) * this.bounce;
            vx *= this.wallDamping;
            vz *= this.wallDamping;
        }

        if (z < minZ) {
            z = minZ;
            vz = Math.abs(vz) * this.bounce;
            vx *= this.wallDamping;
            vy *= this.wallDamping;
        } else if (z > maxZ) {
            z = maxZ;
            vz = -Math.abs(vz) * this.bounce;
            vx *= this.wallDamping;
            vy *= this.wallDamping;
        }

        this.positions[base] = x;
        this.positions[base + 1] = y;
        this.positions[base + 2] = z;

        this.velocities[base] = vx;
        this.velocities[base + 1] = vy;
        this.velocities[base + 2] = vz;
    }

    // Mouse Interaction
    // ------------------------------------------------------------

    setMouseForceRay(active, origin, direction) {
        this.mouseForceActive = active;

        this.mouseRayOrigin.x = origin.x;
        this.mouseRayOrigin.y = origin.y;
        this.mouseRayOrigin.z = origin.z;

        const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);

        if (len > 0.000001) {
            this.mouseRayDirection.x = direction.x / len;
            this.mouseRayDirection.y = direction.y / len;
            this.mouseRayDirection.z = direction.z / len;
        }
    }

    applyMouseForce() {
        if (!this.mouseForceActive) {
            return;
        }

        const ox = this.mouseRayOrigin.x;
        const oy = this.mouseRayOrigin.y;
        const oz = this.mouseRayOrigin.z;

        const dx = this.mouseRayDirection.x;
        const dy = this.mouseRayDirection.y;
        const dz = this.mouseRayDirection.z;

        const radius = this.mouseForceRadius;
        const radius2 = radius * radius;

        for (let i = 0; i < this.numParticles; i++) {
            const base = i * 3;

            const px = this.positions[base];
            const py = this.positions[base + 1];
            const pz = this.positions[base + 2];

            // Vector from ray origin to particle
            const vx = px - ox;
            const vy = py - oy;
            const vz = pz - oz;

            // Projection distance along ray
            const t = vx * dx + vy * dy + vz * dz;

            // Ignore particles behind the camera ray
            if (t < 0.0) {
                continue;
            }

            // Closest point on ray to particle
            const cx = ox + dx * t;
            const cy = oy + dy * t;
            const cz = oz + dz * t;

            // Vector from ray to particle
            const rx = px - cx;
            const ry = py - cy;
            const rz = pz - cz;

            const dist2 = rx * rx + ry * ry + rz * rz;

            if (dist2 > radius2 || dist2 < 0.000001) {
                continue;
            }

            const dist = Math.sqrt(dist2);

            const nx = rx / dist;
            const ny = ry / dist;
            const nz = rz / dist;

            const q = 1.0 - dist / radius;
            const falloff = q * q;

            const force = this.mouseForceStrength * falloff;

            this.accelerations[base] += nx * force;
            this.accelerations[base + 1] += ny * force;
            this.accelerations[base + 2] += nz * force;
        }
    }

    // Surface Tension helper methods
    // ------------------------------------------------------------

    computeCohesionWeight(q) {
        if (q <= this.cohesionMinQ || q >= 1.0) {
            return 0.0;
        }

        const t = (q - this.cohesionMinQ) / (1.0 - this.cohesionMinQ);

        // 0 near very small separation
        // maximum attraction at medium separation
        // 0 at the edge of the SPH support radius
        return 4.0 * t * (1.0 - t);
    }

    // ----------------------------------------------------
    // Neighbor helper
    // ----------------------------------------------------
    ensurePairCapacity(requiredCapacity) {
        if (requiredCapacity <= this.pairCapacity) {
            return;
        }

        let newCapacity = Math.max(1024, this.pairCapacity);

        while (newCapacity < requiredCapacity) {
            newCapacity *= 2;
        }

        const newPairA = new Int32Array(newCapacity);
        const newPairB = new Int32Array(newCapacity);

        newPairA.set(this.pairA.subarray(0, this.pairCount));
        newPairB.set(this.pairB.subarray(0, this.pairCount));

        this.pairA = newPairA;
        this.pairB = newPairB;
        this.pairCapacity = newCapacity;
    }

    buildUniqueNeighborPairs() {
        const positions = this.positions;
        const grid = this.grid;

        const cellHeads = grid.cellHeads;
        const particleNext = grid.particleNext;

        const cellsX = grid.cellsX;
        const cellsY = grid.cellsY;
        const cellsZ = grid.cellsZ;

        const strideY = cellsX;
        const strideZ = cellsX * cellsY;

        const h2 = this.h2;

        let pairCount = 0;
        let pairA = this.pairA;
        let pairB = this.pairB;
        let pairCapacity = this.pairCapacity;

        // --------------------------------------------------------
        // Traverse each grid cell once
        // --------------------------------------------------------

        for (let z = 0; z < cellsZ; z++) {
            const zOffset = z * strideZ;

            for (let y = 0; y < cellsY; y++) {
                const yzOffset = zOffset + y * strideY;

                for (let x = 0; x < cellsX; x++) {
                    const cell = yzOffset + x;
                    const head = cellHeads[cell];

                    if (head === -1) {
                        continue;
                    }

                    // ------------------------------------------------
                    // 1. Pairs inside the same cell
                    // ------------------------------------------------
                    //
                    // Start j at particleNext[i], so:
                    //
                    // (i, j) is visited once
                    // (j, i) is never visited
                    // (i, i) is never visited

                    let i = head;

                    while (i !== -1) {
                        const ib = i * 3;

                        const xi = positions[ib];
                        const yi = positions[ib + 1];
                        const zi = positions[ib + 2];

                        let j = particleNext[i];

                        while (j !== -1) {
                            const jb = j * 3;

                            const dx = xi - positions[jb];
                            const dy = yi - positions[jb + 1];
                            const dz = zi - positions[jb + 2];

                            const r2 = dx * dx + dy * dy + dz * dz;

                            if (r2 < h2) {
                                if (pairCount >= pairCapacity) {
                                    this.pairCount = pairCount;
                                    this.ensurePairCapacity(pairCount + 1);

                                    pairA = this.pairA;
                                    pairB = this.pairB;
                                    pairCapacity = this.pairCapacity;
                                }

                                pairA[pairCount] = i;
                                pairB[pairCount] = j;
                                pairCount++;
                            }

                            j = particleNext[j];
                        }

                        i = particleNext[i];
                    }

                    // ------------------------------------------------
                    // 2. Forward neighbor cells only
                    // ------------------------------------------------
                    //
                    // Half of the 26-cell neighborhood:
                    //
                    // dz = 0
                    //   dy = 0 : dx = +1
                    //   dy = +1: dx = -1, 0, +1
                    //
                    // dz = +1
                    //   dy = -1, 0, +1
                    //   dx = -1, 0, +1
                    //
                    // 1 + 3 + 9 = 13 neighbor cells.
                    //
                    // Therefore A -> B is processed,
                    // but B -> A never is.

                    for (let cellDz = 0; cellDz <= 1; cellDz++) {
                        const neighborZ = z + cellDz;

                        if (neighborZ >= cellsZ) {
                            continue;
                        }

                        const minDy = cellDz === 0 ? 0 : -1;

                        for (let cellDy = minDy; cellDy <= 1; cellDy++) {
                            const neighborY = y + cellDy;

                            if (neighborY < 0 || neighborY >= cellsY) {
                                continue;
                            }

                            const minDx = (cellDz === 0 && cellDy === 0) ? 1 : -1;

                            for (let cellDx = minDx; cellDx <= 1; cellDx++) {
                                const neighborX = x + cellDx;

                                if (neighborX < 0 || neighborX >= cellsX) {
                                    continue;
                                }

                                const neighborCell =
                                    neighborX +
                                    neighborY * strideY +
                                    neighborZ * strideZ;

                                const neighborHead = cellHeads[neighborCell];

                                if (neighborHead === -1) {
                                    continue;
                                }

                                // ------------------------------------
                                // Cross-cell particle pairs
                                // ------------------------------------

                                let i = head;

                                while (i !== -1) {
                                    const ib = i * 3;

                                    const xi = positions[ib];
                                    const yi = positions[ib + 1];
                                    const zi = positions[ib + 2];

                                    let j = neighborHead;

                                    while (j !== -1) {
                                        const jb = j * 3;

                                        const dx = xi - positions[jb];
                                        const dy = yi - positions[jb + 1];
                                        const dz = zi - positions[jb + 2];

                                        const r2 = dx * dx + dy * dy + dz * dz;

                                        if (r2 < h2) {
                                            if (pairCount >= pairCapacity) {
                                                this.pairCount = pairCount;
                                                this.ensurePairCapacity(pairCount + 1);

                                                pairA = this.pairA;
                                                pairB = this.pairB;
                                                pairCapacity = this.pairCapacity;
                                            }

                                            pairA[pairCount] = i;
                                            pairB[pairCount] = j;
                                            pairCount++;
                                        }

                                        j = particleNext[j];
                                    }

                                    i = particleNext[i];
                                }
                            }
                        }
                    }
                }
            }
        }

        this.pairCount = pairCount;

        return pairCount;
    }


    // ----------------------------------------------------
    // debug helper
    // ----------------------------------------------------

    setForceBenchmarkOptions(pressure, viscosity, cohesion)
    {
        this.enablePressureForce = pressure;
        this.enableViscosityForce = viscosity;
        this.enableCohesionForce = cohesion;
    }

    benchmarkForcePass(iterations = 50) {

        // Ensure the spatial structure and density values
        // correspond to the current frozen particle state.

        this.grid.build(
            this.positions,
            this.numParticles
        );

        this.buildUniqueNeighborPairs();
        this.computeDensityAndPressure();

        // Warm-up.
        // Gives the JS engine a chance to optimize the hot path.

        for (let i = 0; i < 5; ++i) {
            this.computeForces();
        }

        const start = performance.now();

        for (let i = 0; i < iterations; ++i) {
            this.computeForces();
        }

        const elapsed = performance.now() - start;
        return elapsed / iterations;
    }

    benchmarkDensityPass(iterations = 100) {
        this.grid.build(this.positions, this.numParticles);
        this.buildUniqueNeighborPairs();

        // Warm-up
        for (let i = 0; i < 5; i++) {
            this.computeDensityAndPressure();
        }

        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            this.computeDensityAndPressure();
        }

        return (performance.now() - start) / iterations;
    }

    benchmarkPairBuild(iterations = 100) {
        // Frozen-state benchmark:
        // build the grid once and repeatedly benchmark only
        // pair generation.

        this.grid.build(this.positions, this.numParticles);

        // Warm-up
        for (let i = 0; i < 5; i++) {
            this.buildUniqueNeighborPairs();
        }

        const start = performance.now();

        for (let i = 0; i < iterations; i++) {
            this.buildUniqueNeighborPairs();
        }

        const elapsed = performance.now() - start;
        const averageMs = elapsed / iterations;

        const averageNeighbors =
            this.numParticles > 0
                ? (this.pairCount * 2) / this.numParticles
                : 0.0;

        return {
            averageMs,
            pairCount: this.pairCount,
            averageNeighbors,
            capacity: this.pairCapacity
        };
    }

}
