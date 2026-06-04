// ------------------------------------------------------------
// Particle rendering
// ------------------------------------------------------------

import * as THREE from "three";
import {WaterParticleMaterial} from "./WaterParticleMaterial.js";

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

        this.material = new WaterParticleMaterial({
            width: window.innerWidth,
            height: window.innerHeight,

            // Render radius, not physics radius.
            // Bigger than particleRadius to make particles overlap visually.
            pointRadius: this.particleRadius * 3.2,

            baseColor: 0x55ccff,
            deepColor: 0x06395f,
            highlightColor: 0xffffff,

            opacity: 0.62,
            softness: 0.32,
            rimPower: 2.2,
            highlightStrength: 0.35,
            fresnelStrength: 0.75
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;

        this.scene.add(this.points);
    }

    update(timeSeconds = 0.0) {
        this.positionAttribute.needsUpdate = true;
        this.material.updateTime(timeSeconds);
    }

    setResolution(width, height) {
        this.material.setResolution(width, height);
    }

    dispose() {
        this.scene.remove(this.points);
        this.geometry.dispose();
        this.material.dispose();
    }
}