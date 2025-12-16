import { vec3, mat4, quat } from 'gl-matrix';

export class Camera {
    constructor(canvas, world) {
        // Center of the world
        this.position = vec3.fromValues(world.sizeX / 2, 110, world.sizeZ / 2);
        this.quaternion = quat.create();
        this.canvas = canvas;
        
        this.fov = 70 * Math.PI / 180;
        this.near = 0.1;
        this.far = 1200.0; // Increased render distance

        this.pitch = 0;
        this.yaw = 0;
        
        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();
        this.updateProjection();
        
        // Sun direction
        this.sunDir = vec3.fromValues(0.4, 0.7, 0.3);
        vec3.normalize(this.sunDir, this.sunDir);
    }

    updateProjection() {
        this.aspect = this.canvas.width / this.canvas.height;
        mat4.perspective(this.projectionMatrix, this.fov, this.aspect, this.near, this.far);
    }

    update(dt) {
        const qYaw = quat.create();
        quat.setAxisAngle(qYaw, [0, 1, 0], this.yaw);
        
        const qPitch = quat.create();
        quat.setAxisAngle(qPitch, [1, 0, 0], this.pitch);
        
        quat.multiply(this.quaternion, qYaw, qPitch);
        
        const target = vec3.create();
        vec3.transformQuat(target, [0, 0, -1], this.quaternion);
        vec3.add(target, this.position, target);
        
        mat4.lookAt(this.viewMatrix, this.position, target, [0, 1, 0]);
    }

    rotate(dx, dy) {
        const sensitivity = 0.002;
        this.yaw -= dx * sensitivity;
        this.pitch -= dy * sensitivity;
        
        this.pitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, this.pitch));
    }

    move(x, z, dt) {
        const speed = 25.0; // Faster movement for large world
        const forward = vec3.create();
        vec3.transformQuat(forward, [0, 0, -1], this.quaternion);
        forward[1] = 0;
        vec3.normalize(forward, forward);
        
        const right = vec3.create();
        vec3.transformQuat(right, [1, 0, 0], this.quaternion);
        right[1] = 0;
        vec3.normalize(right, right);
        
        const move = vec3.create();
        vec3.scaleAndAdd(move, move, forward, z * speed * dt);
        vec3.scaleAndAdd(move, move, right, x * speed * dt);
        
        vec3.add(this.position, this.position, move);
    }
    
    moveVertical(dir, dt) {
        const speed = 20.0;
        this.position[1] += dir * speed * dt;
    }
    
    getForwardVector() {
        const fwd = vec3.create();
        vec3.transformQuat(fwd, [0, 0, -1], this.quaternion);
        return fwd;
    }
}

