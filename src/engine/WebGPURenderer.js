import { mat4, vec3 } from 'gl-matrix';

export class WebGPURenderer {
    constructor(canvas, world, camera) {
        this.canvas = canvas;
        this.world = world;
        this.camera = camera;
        this.adapter = null;
        this.device = null;
        this.context = null;
        
        // Resources
        this.pipeline = null;
        this.computePipeline = null;
        
        // Bind Groups
        this.commonBindGroup = null;
        this.computeBindGroup = null;
        this.renderBindGroup = null;
        this.emptyBindGroup = null;
        
        this.voxelBuffer = null;
        this.instanceBuffer = null;
        this.indirectBuffer = null;
        this.uniformBuffer = null;
        this.texture = null;
        this.sampler = null;
        this.depthTexture = null;

        this.frameCount = 0;
        this.dirty = true;
    }

    async init() {
        if (!navigator.gpu) throw new Error("No WebGPU support");
        
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: "high-performance"
        });
        
        if (!this.adapter) throw new Error("No GPU adapter found");
        
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu');
        
        const format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: format,
            alphaMode: 'premultiplied'
        });

        await this.loadResources();
        this.createBuffers();
        await this.createPipelines(format);
        this.createDepthBuffer();
    }

    async loadResources() {
        const img = new Image();
        img.src = '/atlas.png';
        await new Promise(r => img.onload = r);
        
        this.texture = this.device.createTexture({
            size: [img.width, img.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        
        const imageBitmap = await createImageBitmap(img);
        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: this.texture },
            [img.width, img.height]
        );

        this.sampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            addressModeU: 'repeat',
            addressModeV: 'repeat'
        });
    }

    createBuffers() {
        // Uniforms: View(16), Proj(16), Pos(4), WorldSize(4), SunDir(4), Time(4) -> 48 floats -> 192 bytes
        // Added InvViewProj(16) -> 64 bytes. Total 256 bytes.
        this.uniformBuffer = this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Voxels (Read Only in Shader)
        this.voxelBuffer = this.device.createBuffer({
            size: this.world.totalVoxels * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        // Instances (3M max to be safe for large world)
        // Each instance is 32 bytes (8 floats/u32s)
        const maxInstances = 3000000;
        this.instanceBuffer = this.device.createBuffer({
            size: maxInstances * 32,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
        });

        // Indirect Draw Args
        this.indirectBuffer = this.device.createBuffer({
            size: 16, // 4 u32s
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST
        });
    }

    async createPipelines(format) {
        const shaderCode = await (await fetch('./src/shaders/main.wgsl')).text();
        const shaderModule = this.device.createShaderModule({
            label: "Main Shader",
            code: shaderCode
        });

        // --- Layouts ---
        
        // Group 0: Common (Uniforms, Voxels, Textures)
        this.commonLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }
            ]
        });

        // Group 1: Compute Writes (Instances, Indirect)
        this.computeLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // Instances Write
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }  // Indirect Write
            ]
        });

        // Group 2: Render Reads (Instances)
        this.renderLayout = this.device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } } // Instances Read
            ]
        });
        
        // Empty Layout (For slot 1 in Render Pipeline)
        this.emptyLayout = this.device.createBindGroupLayout({ entries: [] });

        // --- Pipelines ---

        const computePipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.commonLayout, this.computeLayout]
        });

        this.computePipeline = this.device.createComputePipeline({
            layout: computePipelineLayout,
            compute: { module: shaderModule, entryPoint: 'computeMain' }
        });

        const renderPipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.commonLayout, this.emptyLayout, this.renderLayout]
        });

        this.pipeline = this.device.createRenderPipeline({
            layout: renderPipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{ format: format }]
            },
            primitive: { topology: 'triangle-list', cullMode: 'back' },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus'
            }
        });

        // Sky Pipeline
        const skyPipelineLayout = this.device.createPipelineLayout({
            bindGroupLayouts: [this.commonLayout]
        });

        this.skyPipeline = this.device.createRenderPipeline({
            layout: skyPipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'skyVertex'
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'skyFragment',
                targets: [{ format: format }]
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: {
                depthWriteEnabled: false,
                depthCompare: 'less-equal',
                format: 'depth24plus'
            }
        });

        // --- Bind Groups ---

        this.commonBindGroup = this.device.createBindGroup({
            layout: this.commonLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.voxelBuffer } },
                { binding: 2, resource: this.sampler },
                { binding: 3, resource: this.texture.createView() }
            ]
        });

        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computeLayout,
            entries: [
                { binding: 0, resource: { buffer: this.instanceBuffer } },
                { binding: 1, resource: { buffer: this.indirectBuffer } }
            ]
        });

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.renderLayout,
            entries: [
                { binding: 0, resource: { buffer: this.instanceBuffer } }
            ]
        });

        this.emptyBindGroup = this.device.createBindGroup({
            layout: this.emptyLayout,
            entries: []
        });
    }

    createDepthBuffer() {
        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
    }

    updateVoxels() {
        this.device.queue.writeBuffer(this.voxelBuffer, 0, this.world.data);
        this.dirty = true;
    }

    render(time) {
        if (!this.device || !this.pipeline) return;

        // Calc InvViewProj
        const viewProj = mat4.create();
        mat4.multiply(viewProj, this.camera.projectionMatrix, this.camera.viewMatrix);
        const invViewProj = mat4.create();
        mat4.invert(invViewProj, viewProj);

        // Update Uniforms (Size 64 floats = 256 bytes)
        const uniforms = new Float32Array(64);
        uniforms.set(this.camera.viewMatrix, 0);
        uniforms.set(this.camera.projectionMatrix, 16);
        uniforms.set(this.camera.position, 32);
        
        uniforms.set([this.world.sizeX, this.world.sizeY, this.world.sizeZ, 0], 36);
        uniforms.set([this.camera.sunDir[0], this.camera.sunDir[1], this.camera.sunDir[2], 0], 40);
        uniforms.set([time, 0, 0, 0], 44); // 44..47
        uniforms.set(invViewProj, 48); 

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

        const commandEncoder = this.device.createCommandEncoder();

        if (this.dirty) {
            this.dirty = false;
            // Reset indirect args: vertex_count=6, instance_count=0, first_vertex=0, first_instance=0
            this.device.queue.writeBuffer(this.indirectBuffer, 0, new Uint32Array([6, 0, 0, 0]));

            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.computePipeline);
            pass.setBindGroup(0, this.commonBindGroup);
            pass.setBindGroup(1, this.computeBindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(this.world.sizeX / 8),
                Math.ceil(this.world.sizeY / 8),
                Math.ceil(this.world.sizeZ / 4)
            );
            pass.end();
        }

        const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.5, g: 0.7, b: 0.95, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.commonBindGroup);
        pass.setBindGroup(1, this.emptyBindGroup); // Placeholder for Group 1
        pass.setBindGroup(2, this.renderBindGroup); // Actual Render Group
        pass.drawIndirect(this.indirectBuffer, 0);

        // Sky Pass
        pass.setPipeline(this.skyPipeline);
        pass.setBindGroup(0, this.commonBindGroup);
        pass.draw(3);

        pass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }
}

