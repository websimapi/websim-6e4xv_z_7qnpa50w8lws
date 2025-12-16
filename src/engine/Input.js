import nipplejs from 'nipplejs';

export class Input {
    constructor(canvas, camera) {
        this.keys = {};
        this.camera = camera;
        this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.moveInput = { x: 0, z: 0 };
        this.isPointerLocked = false;
        this.events = { jump: false, place: false, break: false };

        // Desktop
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
        window.addEventListener('blur', () => { this.keys = {}; });
        
        canvas.addEventListener('mousedown', (e) => {
            if (!this.isPointerLocked && !this.isMobile) {
                canvas.requestPointerLock().catch(e => console.warn("Pointer lock failed", e));
            }
            if (this.isPointerLocked) {
                if(e.button === 0) this.events.break = true;
                if(e.button === 2) this.events.place = true;
            }
        });
        
        document.addEventListener('mouseup', () => {
            this.events.break = false;
            this.events.place = false;
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === canvas;
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isPointerLocked) {
                camera.rotate(e.movementX, e.movementY);
            }
        });

        // Mobile / Touch
        if (this.isMobile) {
            this.setupTouch(canvas);
        }

        this.setupUI();
    }
    
    setupTouch(canvas) {
        const zone = document.getElementById('controls-zone');
        if (zone) {
            const manager = nipplejs.create({
                zone: zone,
                mode: 'static',
                position: { left: '50%', top: '50%' },
                color: 'white'
            });

            manager.on('move', (evt, data) => {
                if (data.angle) {
                    const angle = data.angle.radian;
                    const force = Math.min(data.force, 1.0);
                    this.moveInput.x = Math.cos(angle) * force;
                    this.moveInput.z = -Math.sin(angle) * force;
                }
            });

            manager.on('end', () => {
                this.moveInput.x = 0;
                this.moveInput.z = 0;
            });
        }

        let lastTouchX = 0;
        let lastTouchY = 0;
        
        canvas.addEventListener('touchstart', (e) => {
            const t = e.touches[e.touches.length-1];
            if (t.clientX < 150 && t.clientY > window.innerHeight - 150) return;
            lastTouchX = t.clientX;
            lastTouchY = t.clientY;
        }, {passive: false});

        canvas.addEventListener('touchmove', (e) => {
            const t = e.touches[e.touches.length-1];
            if (t.clientX < 150 && t.clientY > window.innerHeight - 150) return;
            
            e.preventDefault();
            
            const dx = t.clientX - lastTouchX;
            const dy = t.clientY - lastTouchY;
            
            this.camera.rotate(-dx * 2.5, -dy * 2.5);
            
            lastTouchX = t.clientX;
            lastTouchY = t.clientY;
        }, {passive: false});
    }
    
    setupUI() {
        const bindBtn = (id, eventKey) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.events[eventKey] = true; });
                btn.addEventListener('touchend', (e) => { e.preventDefault(); this.events[eventKey] = false; });
                btn.addEventListener('mousedown', (e) => { e.preventDefault(); this.events[eventKey] = true; });
                btn.addEventListener('mouseup', (e) => { e.preventDefault(); this.events[eventKey] = false; });
            }
        };

        bindBtn('btn-jump', 'jump');
        bindBtn('btn-place', 'place');
        bindBtn('btn-break', 'break');
    }

    update(dt) {
        let x = 0;
        let z = 0;

        // Desktop
        if (this.keys['KeyW']) z += 1;
        if (this.keys['KeyS']) z -= 1;
        if (this.keys['KeyA']) x -= 1;
        if (this.keys['KeyD']) x += 1;

        // Normalize
        if (x !== 0 || z !== 0) {
            const len = Math.sqrt(x*x + z*z);
            x /= len;
            z /= len;
        }
        
        if (this.keys['Space']) this.camera.moveVertical(1, dt);
        if (this.keys['ShiftLeft']) this.camera.moveVertical(-1, dt);
        
        // Mobile Override
        if (this.moveInput.x !== 0 || this.moveInput.z !== 0) {
            x = this.moveInput.x;
            z = this.moveInput.z;
        }
        
        if (this.events.jump) this.camera.moveVertical(1, dt);

        this.camera.move(x, z, dt);
        
        const result = { ...this.events };
        // Reset single-frame triggers
        // Maintain hold events if needed, but for place/break we usually want repeat or single
        // For now, let's allow hold to spam
        return result;
    }
}

