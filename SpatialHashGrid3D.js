// ------------------------------------------------------------
// Spatial hash grid
// ------------------------------------------------------------

export class SpatialHashGrid3D {

    constructor(cellSize, boxMin, boxMax) {

        this.cellSize = cellSize;
        this.invCellSize = 1.0 / cellSize;

        this.boxMin = boxMin;
        this.boxMax = boxMax;

        this.cellsX = 0;
        this.cellsY = 0;
        this.cellsZ = 0;

        this.cellHeads = null;
        this.particleNext = null;

        this.updateDimensions();
    }

    setCellSize(cellSize) {

        if (cellSize === this.cellSize) {
            return;
        }

        this.cellSize = cellSize;

        this.updateDimensions();
    }

    clear() {
        this.cells.clear();
    }

    cellCoord(value) {
        return Math.floor(value / this.cellSize);
    }

    // cellKey(ix, iy, iz) {
    //     return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
    // }

    clampX(x) {
        return Math.max(
            0,
            Math.min(this.cellsX - 1, x)
        );
    }

    clampY(y) {
        return Math.max(
            0,
            Math.min(this.cellsY - 1, y)
        );
    }

    clampZ(z) {
        return Math.max(
            0,
            Math.min(this.cellsZ - 1, z)
        );
    }

    cellX(value) {

        return this.clampX(
            Math.floor(
                (value - this.boxMin.x) *
                this.invCellSize
            )
        );
    }

    cellY(value) {

        return this.clampY(
            Math.floor(
                (value - this.boxMin.y) *
                this.invCellSize
            )
        );
    }

    cellZ(value) {

        return this.clampZ(
            Math.floor(
                (value - this.boxMin.z) *
                this.invCellSize
            )
        );
    }

    cellIndex(ix, iy, iz) {

        return (
            ix +
            iy * this.cellsX +
            iz * this.cellsX * this.cellsY
        );
    }

    // build(positions, particleCount) {
    //     this.clear();
    //
    //     for (let i = 0; i < particleCount; i++) {
    //         const base = i * 3;
    //
    //         const ix = this.cellCoord(positions[base]);
    //         const iy = this.cellCoord(positions[base + 1]);
    //         const iz = this.cellCoord(positions[base + 2]);
    //
    //         const key = this.cellKey(ix, iy, iz);
    //
    //         let bucket = this.cells.get(key);
    //
    //         if (bucket === undefined) {
    //             bucket = [];
    //             this.cells.set(key, bucket);
    //         }
    //
    //         bucket.push(i);
    //     }
    // }

    build(positions, particleCount) {

        this.cellHeads.fill(-1);

        if (this.particleNext === null || this.particleNext.length < particleCount) {
            this.particleNext = new Int32Array(particleCount);
        }

        for (let i = 0; i < particleCount; i++) {

            const base = i * 3;

            const ix = this.cellX(positions[base]);

            const iy = this.cellY(positions[base + 1]);

            const iz = this.cellZ(positions[base + 2]);

            const cell = this.cellIndex(ix, iy, iz);

            this.particleNext[i] = this.cellHeads[cell];

            this.cellHeads[cell] = i;
        }
    }

    // forEachNeighbor(positions, particleIndex, callback) {
    //     const base = particleIndex * 3;
    //
    //     const ix = this.cellCoord(positions[base]);
    //     const iy = this.cellCoord(positions[base + 1]);
    //     const iz = this.cellCoord(positions[base + 2]);
    //
    //     for (let dx = -1; dx <= 1; dx++) {
    //         for (let dy = -1; dy <= 1; dy++) {
    //             for (let dz = -1; dz <= 1; dz++) {
    //                 const key = this.cellKey(ix + dx, iy + dy, iz + dz);
    //                 const bucket = this.cells.get(key);
    //
    //                 if (bucket === undefined) {
    //                     continue;
    //                 }
    //
    //                 for (let k = 0; k < bucket.length; k++) {
    //                     callback(bucket[k]);
    //                 }
    //             }
    //         }
    //     }
    // }

    forEachNeighbor(positions, particleIndex, callback) {

        const base = particleIndex * 3;

        const ix = this.cellX(positions[base]);
        const iy = this.cellY(positions[base + 1]);
        const iz = this.cellZ(positions[base + 2]);

        const minX = Math.max(0, ix - 1);
        const maxX = Math.min(this.cellsX - 1, ix + 1);

        const minY = Math.max(0, iy - 1);
        const maxY = Math.min(this.cellsY - 1, iy + 1);

        const minZ = Math.max(0, iz - 1);
        const maxZ = Math.min(this.cellsZ - 1, iz + 1);

        for (let z = minZ; z <= maxZ; z++) {

            for (let y = minY; y <= maxY; y++) {

                for (let x = minX; x <= maxX; x++) {

                    const cell = this.cellIndex(x, y, z);

                    let j = this.cellHeads[cell];

                    while (j !== -1) {

                        callback(j);

                        j = this.particleNext[j];
                    }
                }
            }
        }
    }

    // Helpers

    updateDimensions() {

        this.invCellSize = 1.0 / this.cellSize;

        this.cellsX = Math.max(
            1,
            Math.ceil(
                (this.boxMax.x - this.boxMin.x) /
                this.cellSize
            )
        );

        this.cellsY = Math.max(
            1,
            Math.ceil(
                (this.boxMax.y - this.boxMin.y) /
                this.cellSize
            )
        );

        this.cellsZ = Math.max(
            1,
            Math.ceil(
                (this.boxMax.z - this.boxMin.z) /
                this.cellSize
            )
        );

        const cellCount =
            this.cellsX *
            this.cellsY *
            this.cellsZ;

        this.cellHeads =
            new Int32Array(cellCount);
    }

}