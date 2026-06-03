// ------------------------------------------------------------
// Particle rendering
// ------------------------------------------------------------

import * as THREE from "three";

export class ParticleRenderer {
    constructor(options) {
        this.scene = options.scene;
        this.positions = options.positions;
        this.particleCount = options.particleCount;
        this.particleRadius = options.particleRadius ?? 0.025;

        this.geometry = new THREE.BufferGeometry();

        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
        this.positionAttribute.setUsage(THREE.DynamicDrawUsage);

        this.geometry.setAttribute("position", this.positionAttribute);

        this.material = new THREE.PointsMaterial({
            color: 0x4db8ff,
            size: this.particleRadius * 2.5,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.scene.add(this.points);
    }

    update() {
        this.positionAttribute.needsUpdate = true;
    }

    dispose() {
        this.scene.remove(this.points);
        this.geometry.dispose();
        this.material.dispose();
    }
}