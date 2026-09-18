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

        this.setupBaselineLighting();
        this.createMaterials();

        this.createGround();
        this.createReservoir();

        this.createSimulationBounds(showSimulationBounds);
    }

    // ------------------------------------------------------------
    // Baseline presentation
    // ------------------------------------------------------------

    setupBaselineLighting() {

        // Keep the current look for now.
        // Commit 3 will replace this with the real outdoor sky.
        this.scene.background = new THREE.Color(0x05070a);

        this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x223344, 1.4);

        this.hemiLight.name = "Environment_HemisphereLight";

        this.root.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);

        this.sunLight.name = "Environment_Sun";

        this.sunLight.position.set(3, 5, 2);

        this.root.add(this.sunLight);
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

        // Already prepared for the shadow pass.
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

        // These do nothing until we enable
        // shadow maps in the lighting pass,
        // but the meshes are ready for it.
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