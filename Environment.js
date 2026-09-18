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

        // ----------------------------------------
        // Presentation ground
        // ----------------------------------------

        this.groundMaterial = this.createGroundMaterial();

        // ----------------------------------------
        // Reservoir
        //
        // Keep these as regular MeshStandardMaterial.
        // They participate naturally in our existing
        // sun + hemisphere lighting and shadow pass.
        // ----------------------------------------

        this.reservoirFloorMaterial = new THREE.MeshStandardMaterial({
            color: 0x464c4e,
            roughness: 0.82,
            metalness: 0.02
        });

        this.reservoirWallMaterial = new THREE.MeshStandardMaterial({
            color: 0x596064,
            roughness: 0.72,
            metalness: 0.04
        });
    }

    createGroundMaterial() {

        const material = new THREE.MeshStandardMaterial({
            color: 0x4b514d,
            roughness: 0.92,
            metalness: 0.0
        });

        material.onBeforeCompile = (shader) => {

            // ----------------------------------------
            // Ground presentation controls
            // ----------------------------------------

            shader.uniforms.uMinorGridSize = { value: 0.50 };
            shader.uniforms.uMajorGridEvery = { value: 4.0 };
            shader.uniforms.uMinorGridColor = { value: new THREE.Color(0x424844) };
            shader.uniforms.uMajorGridColor = { value: new THREE.Color(0x353b38) };
            shader.uniforms.uGridStrength = { value: 0.70 };
            shader.uniforms.uLargeVariationStrength = { value: 0.035 };

            // ----------------------------------------
            // World-space position
            // ----------------------------------------

            shader.vertexShader = `
            varying vec3 vGroundWorldPosition;
        ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                "#include <worldpos_vertex>",
                `
            #include <worldpos_vertex>

            vGroundWorldPosition =
                (modelMatrix * vec4(transformed, 1.0)).xyz;
            `
            );

            // ----------------------------------------
            // Fragment uniforms
            // ----------------------------------------

            shader.fragmentShader = `
            varying vec3 vGroundWorldPosition;

            uniform float uMinorGridSize;
            uniform float uMajorGridEvery;

            uniform vec3 uMinorGridColor;
            uniform vec3 uMajorGridColor;

            uniform float uGridStrength;
            uniform float uLargeVariationStrength;
        ` + shader.fragmentShader;

            // ----------------------------------------
            // Inject procedural presentation pattern
            //
            // We do this AFTER Three.js applies the
            // regular material color, but BEFORE the
            // standard PBR lighting calculation.
            //
            // Therefore:
            //
            //     grid/color
            //          ↓
            // MeshStandardMaterial lighting
            //          ↓
            // shadows / sun / hemisphere light
            //
            // remain fully intact.
            // ----------------------------------------

            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <color_fragment>",
                `
            #include <color_fragment>

            // ----------------------------------------------------
            // Large-scale surface variation
            //
            // Extremely subtle. Its purpose is just to prevent
            // the ground from looking like a perfectly uniform
            // computer-generated plane.
            // ----------------------------------------------------

            float variationA = sin(vGroundWorldPosition.x * 0.63);
            float variationB = sin(vGroundWorldPosition.z * 0.47);

            float largeVariation =
                variationA *
                variationB *
                uLargeVariationStrength;

            diffuseColor.rgb *= 1.0 + largeVariation;

            // ----------------------------------------------------
            // Minor world-space grid
            // ----------------------------------------------------

            vec2 minorCoord =
                vGroundWorldPosition.xz /
                uMinorGridSize;

            vec2 minorDistance =
                abs(
                    fract(minorCoord - 0.5) -
                    0.5
                );

            // Pixel-space anti-aliasing.
            vec2 minorAA = fwidth(minorCoord);

            float minorLineX =
                1.0 -
                smoothstep(
                    minorAA.x * 0.55,
                    minorAA.x * 1.35,
                    minorDistance.x
                );

            float minorLineZ =
                1.0 -
                smoothstep(
                    minorAA.y * 0.55,
                    minorAA.y * 1.35,
                    minorDistance.y
                );

            float minorLine = max(minorLineX, minorLineZ);

            // ----------------------------------------------------
            // Major grid
            // ----------------------------------------------------

            float majorGridSize =
                uMinorGridSize *
                uMajorGridEvery;

            vec2 majorCoord =
                vGroundWorldPosition.xz /
                majorGridSize;

            vec2 majorDistance =
                abs(
                    fract(majorCoord - 0.5) -
                    0.5
                );

            vec2 majorAA = fwidth(majorCoord);

            float majorLineX =
                1.0 -
                smoothstep(
                    majorAA.x * 0.70,
                    majorAA.x * 1.65,
                    majorDistance.x
                );

            float majorLineZ =
                1.0 -
                smoothstep(
                    majorAA.y * 0.70,
                    majorAA.y * 1.65,
                    majorDistance.y
                );

            float majorLine = max(majorLineX, majorLineZ);

            // ----------------------------------------------------
            // Composite
            //
            // Minor grid stays restrained.
            // Major divisions are slightly stronger.
            // ----------------------------------------------------

            diffuseColor.rgb =
                mix(
                    diffuseColor.rgb,
                    uMinorGridColor,
                    minorLine *
                    0.34 *
                    uGridStrength
                );

            diffuseColor.rgb =
                mix(
                    diffuseColor.rgb,
                    uMajorGridColor,
                    majorLine *
                    0.72 *
                    uGridStrength
                );
            `
            );

            // Useful if we want GUI controls later without
            // rebuilding the material.
            material.userData.shader = shader;
        };

        material.customProgramCacheKey = () =>
            "presentation-ground-v1";

        return material;
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

        this.createBoxMesh("Reservoir_Floor",

            new THREE.Vector3(
                this.size.x + t * 2.0,
                this.floorThickness,
                this.size.z + t * 2.0
            ),

            new THREE.Vector3(
                this.center.x,
                this.boxMin.y - this.floorThickness * 0.5,
                this.center.z
            ),

            this.reservoirFloorMaterial
        );

        // ----------------------------------------
        // Left wall
        // ----------------------------------------

        this.createBoxMesh("Reservoir_LeftWall",

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

    createBoxMesh(name, dimensions, position, material = this.reservoirWallMaterial) {

        const geometry = new THREE.BoxGeometry(
            dimensions.x,
            dimensions.y,
            dimensions.z
        );

        const mesh = new THREE.Mesh(geometry, material);

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