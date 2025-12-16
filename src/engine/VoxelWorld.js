export class VoxelWorld {
    constructor() {
        // Increased world size
        this.sizeX = 512;
        this.sizeY = 128;
        this.sizeZ = 512;
        this.totalVoxels = this.sizeX * this.sizeY * this.sizeZ;
        
        console.log(`VoxelWorld: Generating world (${this.sizeX}x${this.sizeY}x${this.sizeZ})...`);
        this.data = new Uint32Array(this.totalVoxels);
        this.generateTerrain();
    }

    generateTerrain() {
        console.time("TerrainGen");
        // Simple heightmap gen
        const heightMap = new Uint8Array(this.sizeX * this.sizeZ);
        
        // Pseudo-random function
        const noise = (x, z) => {
            const s = Math.sin;
            const c = Math.cos;
            const sx = x * 0.015;
            const sz = z * 0.015;
            
            let val = s(sx) * 25 + c(sz) * 25;
            val += s(sx * 3 + sz * 2) * 10;
            val += s(sx * 6 + sz * 4) * 4;
            return val;
        };
        
        for (let x = 0; x < this.sizeX; x++) {
            for (let z = 0; z < this.sizeZ; z++) {
                const hBase = 40;
                const h = hBase + noise(x, z);
                heightMap[x + z * this.sizeX] = Math.floor(Math.max(1, Math.min(this.sizeY - 1, h)));
            }
        }

        const strideY = this.sizeX;
        const strideZ = this.sizeX * this.sizeY;
        
        for (let z = 0; z < this.sizeZ; z++) {
            for (let x = 0; x < this.sizeX; x++) {
                const height = heightMap[x + z * this.sizeX];
                let currentIdx = x + z * strideZ;
                
                // Fill column
                for (let y = 0; y < this.sizeY; y++) {
                    let type = 0;
                    if (y === height) type = 1; // Grass
                    else if (y > height - 4 && y < height) type = 3; // Dirt
                    else if (y <= height - 4) type = 2; // Stone
                    
                    if (type !== 0) this.data[currentIdx] = type;
                    
                    currentIdx += strideY;
                }

                // Trees (scattered)
                if (x > 5 && x < this.sizeX - 5 && z > 5 && z < this.sizeZ - 5) {
                     if (height > 20 && ((x * 47 + z * 19) % 200) === 0) {
                         this.addTree(x, height + 1, z);
                     }
                }
            }
        }
        console.timeEnd("TerrainGen");
    }

    addTree(x, y, z) {
        const h = 5;
        // Trunk
        for (let i = 0; i < h; i++) {
            this.setVoxel(x, y + i, z, 4);
        }
        // Leaves
        for (let ly = h - 2; ly <= h + 1; ly++) {
            for (let lx = -2; lx <= 2; lx++) {
                for (let lz = -2; lz <= 2; lz++) {
                    if (Math.abs(lx) + Math.abs(lz) + Math.abs(ly - h) < 4) {
                        if (this.getVoxel(x + lx, y + ly, z + lz) === 0) {
                            this.setVoxel(x + lx, y + ly, z + lz, 5);
                        }
                    }
                }
            }
        }
    }

    getVoxel(x, y, z) {
        if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return 0;
        return this.data[x + y * this.sizeX + z * this.sizeX * this.sizeY];
    }

    setVoxel(x, y, z, val) {
        if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return;
        this.data[x + y * this.sizeX + z * this.sizeX * this.sizeY] = val;
    }

    raycast(origin, direction, maxDist) {
        let t = 0.0;
        let x = Math.floor(origin[0]);
        let y = Math.floor(origin[1]);
        let z = Math.floor(origin[2]);
        
        const stepX = Math.sign(direction[0]);
        const stepY = Math.sign(direction[1]);
        const stepZ = Math.sign(direction[2]);
        
        const tDeltaX = direction[0] !== 0 ? Math.abs(1 / direction[0]) : 1e30;
        const tDeltaY = direction[1] !== 0 ? Math.abs(1 / direction[1]) : 1e30;
        const tDeltaZ = direction[2] !== 0 ? Math.abs(1 / direction[2]) : 1e30;
        
        let tMaxX = (stepX > 0 ? x + 1 - origin[0] : origin[0] - x) * tDeltaX;
        let tMaxY = (stepY > 0 ? y + 1 - origin[1] : origin[1] - y) * tDeltaY;
        let tMaxZ = (stepZ > 0 ? z + 1 - origin[2] : origin[2] - z) * tDeltaZ;

        let lastAxis = -1; 

        while (t < maxDist) {
            const v = this.getVoxel(x, y, z);
            if (v !== 0) {
                let normal = [0, 0, 0];
                if (lastAxis === 0) normal[0] = -stepX;
                else if (lastAxis === 1) normal[1] = -stepY;
                else if (lastAxis === 2) normal[2] = -stepZ;
                return { position: [x, y, z], normal, voxel: v };
            }

            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    x += stepX;
                    t = tMaxX;
                    tMaxX += tDeltaX;
                    lastAxis = 0;
                } else {
                    z += stepZ;
                    t = tMaxZ;
                    tMaxZ += tDeltaZ;
                    lastAxis = 2;
                }
            } else {
                if (tMaxY < tMaxZ) {
                    y += stepY;
                    t = tMaxY;
                    tMaxY += tDeltaY;
                    lastAxis = 1;
                } else {
                    z += stepZ;
                    t = tMaxZ;
                    tMaxZ += tDeltaZ;
                    lastAxis = 2;
                }
            }
        }
        return null;
    }
}

