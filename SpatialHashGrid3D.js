// ------------------------------------------------------------
// Spatial hash grid
// ------------------------------------------------------------

export class SpatialHashGrid3D {

    constructor(cellSize) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    setCellSize(cellSize) {
        this.cellSize = cellSize;
    }

    clear() {
        this.cells.clear();
    }

    cellCoord(value) {
        return Math.floor(value / this.cellSize);
    }

    cellKey(ix, iy, iz) {
        return `${ix},${iy},${iz}`;
    }

    build(positions, particleCount) {
        this.clear();

        for (let i = 0; i < particleCount; i++) {
            const base = i * 3;

            const ix = this.cellCoord(positions[base]);
            const iy = this.cellCoord(positions[base + 1]);
            const iz = this.cellCoord(positions[base + 2]);

            const key = this.cellKey(ix, iy, iz);

            let bucket = this.cells.get(key);

            if (bucket === undefined) {
                bucket = [];
                this.cells.set(key, bucket);
            }

            bucket.push(i);
        }
    }

    forEachNeighbor(positions, particleIndex, callback) {
        const base = particleIndex * 3;

        const ix = this.cellCoord(positions[base]);
        const iy = this.cellCoord(positions[base + 1]);
        const iz = this.cellCoord(positions[base + 2]);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = this.cellKey(ix + dx, iy + dy, iz + dz);
                    const bucket = this.cells.get(key);

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

}