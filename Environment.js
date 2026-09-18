import * as THREE from "three";

// ------------------------------------------------------------
// Environment
// ------------------------------------------------------------

export class Environment {

    constructor({
        scene,
        renderer,
        boxMin,
        boxMax,
        showSimulationBounds = false
    })
    {
        this.scene = scene;
        this.renderer = renderer;

        this.boxMin = boxMin.clone();
        this.boxMax = boxMax.clone();

        this.size = new THREE.Vector3().subVectors(this.boxMax, this.boxMin);

        this.center = new THREE.Vector3().addVectors(this.boxMin, this.boxMax).multiplyScalar(0.5);

        this.root = new THREE.Group();
        this.root.name = "Environment";

        this.scene.add(this.root);

        // ----------------------------------------
        // Reservoir dimensions
        // ----------------------------------------

        this.floorThickness = 0.12;
        this.wallThickness = 0.10;

        this.wallHeight = Math.min(Math.max(this.size.y * 0.42, 0.45), 0.70);

        this.frontLipHeight = Math.min(this.wallHeight, 0.65);

        // ----------------------------------------
        // Setup
        // ----------------------------------------

        this.setupRenderer();
        this.createSky();
        this.setupOutdoorLighting();

        this.createMaterials();

        this.createGround();
        this.createReservoir();

        this.createSimulationBounds(showSimulationBounds);
    }

// ------------------------------------------------------------
// Renderer
// ------------------------------------------------------------

    setupRenderer() {

        this.renderer.shadowMap.enabled = true;

        // Three.js r182:
        // PCFShadowMap is now the soft PCF implementation.
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        // Everything casting shadows in this environment
        // is currently static.
        //
        // Build the shadow map once instead of every frame.
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.needsUpdate = true;
    }

    // ------------------------------------------------------------
    // Sky
    // ------------------------------------------------------------

    createSky() {

        this.skyHorizonColor = new THREE.Color(0xc9ddea);
        this.skyZenithColor = new THREE.Color(0x4d83bb);

        const largestDimension = Math.max(this.size.x, this.size.z);

        const skyRadius = largestDimension * 12.0;

        const geometry = new THREE.SphereGeometry(skyRadius, 48, 24);

        const positions = geometry.attributes.position;

        const colors = new Float32Array(positions.count * 3);

        const color = new THREE.Color();

        for (let i = 0; i < positions.count; i++) {

            const normalizedY = positions.getY(i) / skyRadius;

            let t = THREE.MathUtils.clamp((normalizedY + 0.05) / 0.95, 0.0, 1.0);

            // Smoothstep-like interpolation.
            t = t * t * (3.0 - 2.0 * t);

            color
                .copy(this.skyHorizonColor)
                .lerp(this.skyZenithColor, t);

            colors[i * 3 + 0] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(colors, 3)
        );

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.BackSide,

            depthWrite: false,

            // Sky is self-lit.
            toneMapped: true
        });

        this.sky = new THREE.Mesh(geometry, material);

        this.sky.name = "Environment_Sky";

        this.sky.position.set(
            this.center.x,
            this.boxMin.y,
            this.center.z
        );

        this.root.add(this.sky);

        // Fallback clear/background color.
        this.scene.background = this.skyHorizonColor;
    }

    // ------------------------------------------------------------
    // Outdoor lighting
    // ------------------------------------------------------------

    setupOutdoorLighting() {

        // Direction from the scene toward the sun.
        //
        // This convention is useful because the fluid shader
        // also expects a surface-to-light direction.
        this.sunDirection = new THREE.Vector3(-0.55, 1.0, 0.35).normalize();

        // ----------------------------------------
        // Ambient sky / ground contribution
        // ----------------------------------------

        this.hemiLight = new THREE.HemisphereLight(
            0xc9e4ff,
            0x465044,
            0.9
        );

        this.hemiLight.name = "Environment_HemisphereLight";

        this.root.add(this.hemiLight);

        // ----------------------------------------
        // Sun
        // ----------------------------------------

        this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.0);

        this.sunLight.name = "Environment_Sun";

        this.sunLight.castShadow = true;

        // DirectionalLight points FROM its position
        // TOWARD its target.
        this.sunTarget = new THREE.Object3D();

        this.sunTarget.name = "Environment_SunTarget";

        this.sunTarget.position.copy(this.center);

        this.root.add(this.sunTarget);

        this.sunLight.target = this.sunTarget;

        const largestDimension = Math.max(this.size.x, this.size.z);

        const sunDistance = largestDimension * 3.0;

        this.sunLight.position
            .copy(this.center)
            .addScaledVector(this.sunDirection, sunDistance);

        this.configureSunShadow(largestDimension, sunDistance);

        this.root.add(this.sunLight);
    }

    configureSunShadow(largestDimension, sunDistance) {

        const shadow = this.sunLight.shadow;

        shadow.mapSize.set(2048, 2048);

        const shadowExtent = largestDimension * 1.8;

        shadow.camera.left = -shadowExtent;
        shadow.camera.right = shadowExtent;
        shadow.camera.top = shadowExtent;
        shadow.camera.bottom = -shadowExtent;

        shadow.camera.near = 0.1;
        shadow.camera.far = sunDistance * 2.0;

        // Small bias values because the scene itself
        // is only a few world units across.
        shadow.bias = -0.0002;
        shadow.normalBias = 0.01;

        shadow.radius = 2.0;
        shadow.intensity = 0.8;

        shadow.camera.updateProjectionMatrix();
    }

    getSunDirection(target = new THREE.Vector3()) {
        return target.copy(this.sunDirection);
    }

    // ------------------------------------------------------------
    // Materials
    // ------------------------------------------------------------

    createMaterials() {

        this.groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x303630,
            roughness: 0.95,
            metalness: 0.0
        });

        this.reservoirMaterial = new THREE.MeshStandardMaterial({
            color: 0x3d4346,
            roughness: 0.88,
            metalness: 0.03
        });
    }

    // ------------------------------------------------------------
    // Ground
    // ------------------------------------------------------------

    createGround() {

        const largestDimension = Math.max(this.size.x, this.size.z);

        const groundSize = largestDimension * 4.5;

        const geometry = new THREE.PlaneGeometry(groundSize, groundSize);

        this.ground = new THREE.Mesh(geometry, this.groundMaterial);

        this.ground.name = "Environment_Ground";

        this.ground.rotation.x = -Math.PI * 0.5;

        this.ground.position.set(
            this.center.x,
            this.boxMin.y - this.floorThickness - 0.025,
            this.center.z
        );

        // prepare for the shadow pass.
        this.ground.receiveShadow = true;

        this.root.add(this.ground);
    }

    // ------------------------------------------------------------
    // Reservoir
    // ------------------------------------------------------------

    createReservoir() {

        this.reservoir = new THREE.Group();

        this.reservoir.name = "Environment_Reservoir";

        this.root.add(this.reservoir);

        const t = this.wallThickness;

        // ----------------------------------------
        // Floor
        // ----------------------------------------

        this.createBoxMesh(
            "Reservoir_Floor",

            new THREE.Vector3(
                this.size.x + t * 2.0,
                this.floorThickness,
                this.size.z + t * 2.0
            ),

            new THREE.Vector3(
                this.center.x,
                this.boxMin.y - this.floorThickness * 0.5,
                this.center.z
            )
        );

        // ----------------------------------------
        // Left wall
        // ----------------------------------------

        this.createBoxMesh(
            "Reservoir_LeftWall",

            new THREE.Vector3(
                t,
                this.wallHeight,
                this.size.z + t * 2.0
            ),

            new THREE.Vector3(
                this.boxMin.x - t * 0.5,
                this.boxMin.y + this.wallHeight * 0.5,
                this.center.z
            )
        );

        // ----------------------------------------
        // Right wall
        // ----------------------------------------

        this.createBoxMesh(
            "Reservoir_RightWall",

            new THREE.Vector3(
                t,
                this.wallHeight,
                this.size.z + t * 2.0
            ),

            new THREE.Vector3(
                this.boxMax.x + t * 0.5,
                this.boxMin.y + this.wallHeight * 0.5,
                this.center.z
            )
        );

        // ----------------------------------------
        // Rear wall
        // ----------------------------------------

        this.createBoxMesh(
            "Reservoir_BackWall",

            new THREE.Vector3(
                this.size.x,
                this.wallHeight,
                t
            ),

            new THREE.Vector3(
                this.center.x,
                this.boxMin.y + this.wallHeight * 0.5,
                this.boxMin.z - t * 0.5
            )
        );

        // ----------------------------------------
        // Front lip
        //
        // Intentionally lower than the other walls
        // so the existing camera still has a clear
        // view into the simulation.
        // ----------------------------------------

        this.createBoxMesh(
            "Reservoir_FrontLip",

            new THREE.Vector3(
                this.size.x + t * 2.0,
                this.frontLipHeight,
                t
            ),

            new THREE.Vector3(
                this.center.x,
                this.boxMin.y + this.frontLipHeight * 0.5,
                this.boxMax.z + t * 0.5
            )
        );
    }

    createBoxMesh(name, dimensions, position) {
        const geometry = new THREE.BoxGeometry(
            dimensions.x,
            dimensions.y,
            dimensions.z
        );

        const mesh = new THREE.Mesh(geometry, this.reservoirMaterial);

        mesh.name = name;

        mesh.position.copy(position);

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        this.reservoir.add(mesh);

        return mesh;
    }

    // ------------------------------------------------------------
    // Solver bounds
    // ------------------------------------------------------------

    createSimulationBounds(visible) {
        const boxGeometry = new THREE.BoxGeometry(
            this.size.x,
            this.size.y,
            this.size.z
        );

        const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);

        boxGeometry.dispose();

        const material = new THREE.LineBasicMaterial({
            color: 0x4f7894,
            transparent: true,
            opacity: 0.65
        });

        this.simulationBounds = new THREE.LineSegments(edgeGeometry, material);

        this.simulationBounds.name = "Environment_SimulationBounds";

        this.simulationBounds.position.copy(this.center);

        this.simulationBounds.visible = visible;

        this.root.add(this.simulationBounds);
    }

    setSimulationBoundsVisible(visible) {
        if (!this.simulationBounds) {
            return;
        }

        this.simulationBounds.visible = visible;
    }

    // ------------------------------------------------------------
    // Lifetime
    // ------------------------------------------------------------

    dispose() {

        const geometries = new Set();
        const materials = new Set();

        this.root.traverse((object) => {

            if (object.geometry) {
                geometries.add(object.geometry);
            }

            if (object.material) {

                if (Array.isArray(object.material)) {
                    for (const material of object.material) {
                        materials.add(material);
                    }
                } else {
                    materials.add(object.material);
                }
            }
        });

        for (const geometry of geometries) {
            geometry.dispose();
        }

        for (const material of materials) {
            material.dispose();
        }

        this.scene.remove(this.root);
    }
}