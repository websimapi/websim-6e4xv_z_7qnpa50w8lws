import { VoxelWorld } from './engine/VoxelWorld.js';
import { WebGPURenderer } from './engine/WebGPURenderer.js';
import { Camera } from './engine/Camera.js';
import { Input } from './engine/Input.js';

async function main() {
    const canvas = document.getElementById('gfx');
    
    // Initialize Systems
    const world = new VoxelWorld();
    const camera = new Camera(canvas, world);
    const input = new Input(canvas, camera);
    const renderer = new WebGPURenderer(canvas, world, camera);

    try {
        console.log("Main: Starting initialization...");
        if (!navigator.gpu) {
            throw new Error("WebGPU is not supported in this browser.");
        }
        await renderer.init();
        console.log("Main: Initialization successful. Starting loop.");
        
        const overlay = document.getElementById('init-overlay');
        if (overlay) overlay.classList.add('hidden');
    } catch (e) {
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = "Error: " + e.message;
        console.error("Main: Initialization failed", e);
        return;
    }
    
    // Initial GPU update
    renderer.updateVoxels();

    // Stats
    let lastTime = performance.now();
    const fpsElem = document.getElementById('fps');
    const voxelElem = document.getElementById('voxel-count');
    
    let frameCount = 0;
    let accumTime = 0;

    function loop(timestamp) {
        const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // Cap dt
        lastTime = timestamp;
        
        // Input Logic
        const actions = input.update(dt);
        
        // Interaction Logic
        if (actions.break || actions.place) {
            const fwd = camera.getForwardVector();
            const hit = world.raycast(camera.position, fwd, 8);
            
            if (hit) {
                let modified = false;
                if (actions.break) {
                    world.setVoxel(hit.position[0], hit.position[1], hit.position[2], 0);
                    modified = true;
                } else if (actions.place) {
                    const nx = hit.position[0] + hit.normal[0];
                    const ny = hit.position[1] + hit.normal[1];
                    const nz = hit.position[2] + hit.normal[2];
                    
                    // Don't suffocate self
                    const dist = Math.hypot(nx + 0.5 - camera.position[0], ny + 0.5 - camera.position[1], nz + 0.5 - camera.position[2]);
                    
                    if (dist > 1.0) {
                        world.setVoxel(nx, ny, nz, 2); // Place stone
                        modified = true;
                    }
                }
                
                if (modified) {
                    renderer.updateVoxels();
                }
            }
        }

        camera.update(dt);
        renderer.render(timestamp / 1000);
        
        // Stats
        frameCount++;
        accumTime += dt;
        if (accumTime > 0.5) {
            if (fpsElem) fpsElem.innerText = Math.round(frameCount / accumTime);
            if (voxelElem) voxelElem.innerText = world.totalVoxels.toLocaleString();
            frameCount = 0;
            accumTime = 0;
        }
        
        requestAnimationFrame(loop);
    }
    
    requestAnimationFrame(loop);
    
    // Handle resize
    const onResize = () => {
        const dpr = Math.min(window.devicePixelRatio, 2);
        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        camera.updateProjection();
        renderer.createDepthBuffer();
    };
    window.addEventListener('resize', onResize);
    onResize();
}

main();

