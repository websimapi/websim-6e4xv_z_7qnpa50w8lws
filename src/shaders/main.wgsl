struct CameraUniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    position: vec3<f32>,
    pad1: f32,
    world_size: vec3<f32>,
    pad2: f32,
    sun_dir: vec3<f32>,
    pad3: f32,
    time: f32,
    pad_a: f32,
    pad_b: f32,
    pad_c: f32,
    inv_view_proj: mat4x4<f32>,
};

struct InstanceData {
    x: f32, y: f32, z: f32, face: u32,
    type_id: u32, p1: u32, p2: u32, p3: u32,
};

struct Instances {
    data: array<InstanceData>,
};

struct IndirectArgs {
    vertex_count: u32,
    instance_count: atomic<u32>,
    first_vertex: u32,
    first_instance: u32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> voxels: array<u32>;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(3) var myTexture: texture_2d<f32>;

@group(1) @binding(0) var<storage, read_write> instances_write: Instances;
@group(1) @binding(1) var<storage, read_write> indirect: IndirectArgs;

@group(2) @binding(0) var<storage, read> instances_read: Instances;

// --- Noise & Clouds ---

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2<f32>(0.0,0.0)), hash(i + vec2<f32>(1.0,0.0)), u.x),
               mix(hash(i + vec2<f32>(0.0,1.0)), hash(i + vec2<f32>(1.0,1.0)), u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var pos = p;
    let rot = mat2x2<f32>(0.8, 0.6, -0.6, 0.8);
    for (var i = 0; i < 4; i++) {
        v += a * noise(pos);
        pos = rot * pos * 2.1 + vec2<f32>(1.3, 2.8);
        a *= 0.5;
    }
    return v;
}

fn cloud_density(pos: vec3<f32>) -> f32 {
    let time = camera.time * 2.0;
    // Animate cloud texture
    let uv = pos.xz * 0.003 + vec2<f32>(time * 0.01, time * 0.005);
    var den = fbm(uv);
    
    // Height shaping
    let h_mid = 180.0;
    let h_width = 40.0;
    let h = pos.y;
    let h_factor = smoothstep(0.0, 1.0, 1.0 - abs(h - h_mid) / h_width);
    
    den *= h_factor;
    return smoothstep(0.4, 0.8, den); // threshold
}

fn get_idx(x: u32, y: u32, z: u32) -> u32 {
    let s = vec3<u32>(camera.world_size.xyz);
    return x + y * s.x + z * s.x * s.y;
}

fn is_solid(x: u32, y: u32, z: u32) -> bool {
    let s = vec3<u32>(camera.world_size.xyz);
    if (x >= s.x || y >= s.y || z >= s.z) { return false; }
    return voxels[get_idx(x, y, z)] != 0u;
}

fn append_face(x: u32, y: u32, z: u32, face: u32, type_id: u32) {
    let idx = atomicAdd(&indirect.instance_count, 1u);
    instances_write.data[idx] = InstanceData(f32(x), f32(y), f32(z), face, type_id, 0u, 0u, 0u);
}

@compute @workgroup_size(8, 8, 4)
fn computeMain(@builtin(global_invocation_id) id: vec3<u32>) {
    let s = vec3<u32>(camera.world_size.xyz);
    if (id.x >= s.x || id.y >= s.y || id.z >= s.z) { return; }

    let voxel = voxels[get_idx(id.x, id.y, id.z)];
    if (voxel == 0u) { return; }

    // X+
    if (!is_solid(id.x + 1u, id.y, id.z)) { append_face(id.x, id.y, id.z, 0u, voxel); }
    // X-
    if (id.x == 0u || !is_solid(id.x - 1u, id.y, id.z)) { append_face(id.x, id.y, id.z, 1u, voxel); }
    // Y+
    if (!is_solid(id.x, id.y + 1u, id.z)) { append_face(id.x, id.y, id.z, 2u, voxel); }
    // Y-
    if (id.y == 0u || !is_solid(id.x, id.y - 1u, id.z)) { append_face(id.x, id.y, id.z, 3u, voxel); }
    // Z+
    if (!is_solid(id.x, id.y, id.z + 1u)) { append_face(id.x, id.y, id.z, 4u, voxel); }
    // Z-
    if (id.z == 0u || !is_solid(id.x, id.y, id.z - 1u)) { append_face(id.x, id.y, id.z, 5u, voxel); }
}

struct VertexOutput {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) world_pos: vec3<f32>,
    @location(2) normal: vec3<f32>,
    @location(3) @interpolate(flat) voxel_id: u32,
    @location(4) shadow_bias_pos: vec3<f32>,
};

@vertex
fn skyVertex(@builtin(vertex_index) v_idx: u32) -> VertexOutput {
    var pos = vec2<f32>(-1.0, -1.0);
    if (v_idx == 1u) { pos = vec2<f32>(3.0, -1.0); }
    if (v_idx == 2u) { pos = vec2<f32>(-1.0, 3.0); }
    
    var out: VertexOutput;
    out.clip_pos = vec4<f32>(pos, 1.0, 1.0); // Z=1.0
    out.uv = pos * 0.5 + 0.5;
    return out;
}

@vertex
fn vertexMain(@builtin(vertex_index) v_idx: u32, @builtin(instance_index) i_idx: u32) -> VertexOutput {
    let inst = instances_read.data[i_idx];
    let base_pos = vec3<f32>(inst.x, inst.y, inst.z);
    
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
    );
    let c = corners[v_idx];
    
    var local_p = vec3<f32>(0.0);
    var norm = vec3<f32>(0.0);
    
    switch inst.face {
        case 0u: { local_p = vec3<f32>(1.0, c.y, 1.0 - c.x); norm = vec3<f32>(1.0, 0.0, 0.0); }
        case 1u: { local_p = vec3<f32>(0.0, c.y, c.x); norm = vec3<f32>(-1.0, 0.0, 0.0); }
        case 2u: { local_p = vec3<f32>(c.x, 1.0, 1.0 - c.y); norm = vec3<f32>(0.0, 1.0, 0.0); }
        case 3u: { local_p = vec3<f32>(c.x, 0.0, c.y); norm = vec3<f32>(0.0, -1.0, 0.0); }
        case 4u: { local_p = vec3<f32>(c.x, c.y, 1.0); norm = vec3<f32>(0.0, 0.0, 1.0); }
        case 5u: { local_p = vec3<f32>(1.0 - c.x, c.y, 0.0); norm = vec3<f32>(0.0, 0.0, -1.0); }
        default: {}
    }
    
    let w_pos = base_pos + local_p;
    
    var out: VertexOutput;
    out.clip_pos = camera.proj * camera.view * vec4<f32>(w_pos, 1.0);
    out.uv = c;
    out.world_pos = w_pos;
    out.normal = norm;
    out.voxel_id = inst.type_id;
    out.shadow_bias_pos = w_pos + norm * 0.05;
    return out;
}

fn voxel_trace(start: vec3<f32>, dir: vec3<f32>) -> f32 {
    let s = vec3<f32>(camera.world_size.xyz);
    var p = start;
    let step = dir * 0.8; 
    
    for (var i = 0; i < 150; i++) {
        p += step;
        if (p.y >= s.y) { return 1.0; }
        if (p.x < 0.0 || p.x >= s.x || p.y < 0.0 || p.z < 0.0 || p.z >= s.z) { continue; }
        if (is_solid(u32(p.x), u32(p.y), u32(p.z))) { return 0.1; }
    }
    return 1.0;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4<f32> {
    var uv_off = vec2<f32>(0.0, 0.0);
    if (in.voxel_id == 1u) { if (in.normal.y > 0.5) { uv_off = vec2<f32>(0.0, 0.0); } else { uv_off = vec2<f32>(0.0, 0.5); } }
    else if (in.voxel_id == 2u) { uv_off = vec2<f32>(0.5, 0.0); }
    else if (in.voxel_id == 3u) { uv_off = vec2<f32>(0.0, 0.5); }
    else if (in.voxel_id == 4u) { uv_off = vec2<f32>(0.5, 0.5); }
    else if (in.voxel_id == 5u) { uv_off = vec2<f32>(0.0, 0.0); }
    
    let texColor = textureSample(myTexture, mySampler, in.uv * 0.5 + uv_off);
    if (texColor.a < 0.5) { discard; }

    let sun = normalize(camera.sun_dir);
    let diff = max(dot(in.normal, sun), 0.0);
    let ambient = 0.4;
    
    var shadow = 1.0;
    if (diff > 0.0) {
        shadow = voxel_trace(in.shadow_bias_pos, sun);
        
        // Cloud shadows
        if (shadow > 0.5) {
            let cloud_h = 180.0;
            if (in.world_pos.y < cloud_h) {
                let dist_to_cloud = (cloud_h - in.world_pos.y) / sun.y;
                if (dist_to_cloud > 0.0) {
                    let cloud_pos = in.world_pos + sun * dist_to_cloud;
                    let den = cloud_density(cloud_pos);
                    shadow *= mix(1.0, 0.4, den);
                }
            }
        }
    }
    
    let brightness = ambient + diff * shadow * 0.8;
    
    // Fog blending
    let dist = distance(in.world_pos, camera.position);
    let fog = clamp((dist - 300.0) / 900.0, 0.0, 1.0);
    let sky = vec3<f32>(0.5, 0.7, 0.95);
    
    return vec4<f32>(mix(texColor.rgb * brightness, sky, fog), 1.0);
}

@fragment
fn skyFragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // Reconstruct world ray
    let ndc = vec4<f32>(in.uv * 2.0 - 1.0, 1.0, 1.0); 
    let h_world = camera.inv_view_proj * ndc;
    let world_pos = h_world.xyz / h_world.w;
    
    let ro = camera.position;
    let rd = normalize(world_pos - ro);
    
    var col = vec3<f32>(0.5, 0.7, 0.95); 
    let sun = normalize(camera.sun_dir);
    let sun_dot = max(dot(rd, sun), 0.0);
    col += vec3<f32>(0.8, 0.6, 0.4) * pow(sun_dot, 16.0);
    
    let y_min = 150.0;
    let y_max = 210.0;
    
    let t1 = (y_min - ro.y) / rd.y;
    let t2 = (y_max - ro.y) / rd.y;
    
    let t_near = min(t1, t2);
    let t_far = max(t1, t2);
    
    if (t_far > 0.0 && t_near < t_far && rd.y > 0.0) {
        var t = max(t_near, 0.0);
        let t_end = t_far;
        let step_size = 3.0;
        
        for (var i = 0; i < 40; i++) {
            if (t >= t_end) { break; }
            let p = ro + rd * t;
            let den = cloud_density(p);
            
            if (den > 0.01) {
                let light = 1.0; 
                let cloud_col = vec3<f32>(0.95) * (0.6 + 0.4*light);
                let alpha = den * 0.2; 
                col = mix(col, cloud_col, alpha);
                if (alpha > 0.9) { break; }
            }
            t += step_size;
        }
    }
    
    return vec4<f32>(col, 1.0);
}

