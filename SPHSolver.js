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

        this.surfaceFactors = new Float32Array(this.numParticles);

        this.grid = new SpatialHashGrid3D(this.h);

        this.updateKernelConstants();
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

        const startX = -0.20;
        const startY = 0.0;
        const startZ = -0.5;

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
    }

    step(dt) {
        // Build neighbor structure
        this.grid.build(this.positions, this.numParticles);

        // Compute SPH state
        this.computeDensityAndPressure();
        this.computeForces();

        // Add external mouse force
        // We call applyMouseForce() after computeForces() and before integrateEuler(dt)
        // That way the mouse simply adds extra acceleration into the current frame
        this.applyMouseForce();

        // Simple semi-implicit Euler
        this.integrateEuler(dt);

        // Small damping, similar in spirit to the damping term in the Python version
        this.applyGlobalDamping();
    }

    computeDensityAndPressure() {
        for (let i = 0; i < this.numParticles; i++) {
            const ib = i * 3;

            const xi = this.positions[ib];
            const yi = this.positions[ib + 1];
            const zi = this.positions[ib + 2];

            let rho = 0.0;

            this.grid.forEachNeighbor(this.positions, i, (j) => {
                const jb = j * 3;

                const rx = xi - this.positions[jb];
                const ry = yi - this.positions[jb + 1];
                const rz = zi - this.positions[jb + 2];

                const r2 = rx * rx + ry * ry + rz * rz;

                if (r2 < this.h2) {
                    const diff = this.h2 - r2;
                    rho += this.mass * this.poly6 * diff * diff * diff;
                }
            });

            rho = Math.max(rho, 0.0001);
            this.densities[i] = rho;

            const ratio = rho / this.restDensity;
            const pressure = this.stiffness * (Math.pow(ratio, this.gamma) - 1.0);

            this.pressures[i] = Math.max(pressure, 0.0);

            // Surface Factor
            const densityDeficit = (this.restDensity - rho) / (this.restDensity * this.surfaceDensityRange);
            this.surfaceFactors[i] = Math.min(1.0, Math.max(0.0, densityDeficit));
        }
    }

    computeForces() {
        for (let i = 0; i < this.numParticles; i++) {
            const ib = i * 3;

            const xi = this.positions[ib];
            const yi = this.positions[ib + 1];
            const zi = this.positions[ib + 2];

            const vxi = this.velocities[ib];
            const vyi = this.velocities[ib + 1];
            const vzi = this.velocities[ib + 2];

            const rhoi = this.densities[i];
            const Pi = this.pressures[i];

            let ax = 0.0;
            let ay = this.gravity;
            let az = 0.0;

            this.grid.forEachNeighbor(this.positions, i, (j) => {
                if (i === j) {
                    return;
                }

                const jb = j * 3;

                const rx = xi - this.positions[jb];
                const ry = yi - this.positions[jb + 1];
                const rz = zi - this.positions[jb + 2];

                const r2 = rx * rx + ry * ry + rz * rz;

                if (r2 <= 0.000001 || r2 >= this.h2) {
                    return;
                }

                const r = Math.sqrt(r2);

                const rhoj = this.densities[j];
                const Pj = this.pressures[j];

                // Pressure force
                const pressureTerm = Pi / (rhoi * rhoi) + Pj / (rhoj * rhoj);

                const gradScale = this.spikyGrad * (this.h - r) * (this.h - r) / r;

                const gradX = gradScale * rx;
                const gradY = gradScale * ry;
                const gradZ = gradScale * rz;

                ax += -this.mass * pressureTerm * gradX;
                ay += -this.mass * pressureTerm * gradY;
                az += -this.mass * pressureTerm * gradZ;

                // Viscosity force
                const lap = this.viscLap * (this.h - r);

                ax += this.viscosity * this.mass * (this.velocities[jb] - vxi) / rhoj * lap;

                ay += this.viscosity * this.mass * (this.velocities[jb + 1] - vyi) / rhoj * lap;

                az += this.viscosity * this.mass * (this.velocities[jb + 2] - vzi) / rhoj * lap;

                // Weak surface cohesion
                const surfaceFactor = Math.max(this.surfaceFactors[i], this.surfaceFactors[j]);

                if (surfaceFactor > 0.0) {
                    const q = r / this.h;

                    const cohesionWeight = this.computeCohesionWeight(q);

                    if (cohesionWeight > 0.0) {
                        const invR = 1.0 / r;

                        const cohesionAcceleration = this.surfaceTension * this.mass * surfaceFactor * cohesionWeight / Math.max(rhoj, 0.0001);

                        ax += cohesionAcceleration * (-rx * invR);

                        ay += cohesionAcceleration * (-ry * invR);

                        az += cohesionAcceleration * (-rz * invR);
                    }
                }

            });

            this.accelerations[ib] = ax;
            this.accelerations[ib + 1] = ay;
            this.accelerations[ib + 2] = az;
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


}
