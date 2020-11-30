if (!navigator.gpu || GPUBufferUsage.COPY_SRC === undefined)
    document.body.className = 'error';

const positionAttributeNum = 0;
const texCoordsAttributeNum = 1;

const transformBindingNum = 0;
const textureBindingNum = 1;
const textureBindingNum2 = 2;
const samplerBindingNum = 3;

const bindGroupIndex = 0;

const shader = `
struct FragmentData {
    float4 position : SV_Position;
    float2 texCoords : attribute(${texCoordsAttributeNum});
}

vertex FragmentData vertex_main(
    float4 position : attribute(${positionAttributeNum}),
    float2 texCoords : attribute(${texCoordsAttributeNum}),
    constant float4x4[] modelViewProjectionMatrix : register(b${transformBindingNum}))
{
    FragmentData out;
    out.position = mul(modelViewProjectionMatrix[0], position);
    out.texCoords = texCoords;
    return out;
}

fragment float4 fragment_main(
    float2 texCoords : attribute(${texCoordsAttributeNum}),
    Texture2D<float4> faceTexture : register(t${textureBindingNum}),
    Texture2D<float4> faceTexture2 : register(t${textureBindingNum2}),
    sampler faceSampler : register(s${samplerBindingNum})) : SV_Target 0
{
    float2 scaledTc = float2(6.0 * texCoords.x - 3.0, 12.0 * texCoords.y - 6.0);
    float PI = 3.14159265359;
    float fadeOut = (sin(texCoords.y * PI));
    scaledTc.y /= ((1.0 + fadeOut) / 2.0);
    fadeOut *= 1.5;
    float r = fadeOut * Sample(faceTexture, faceSampler, scaledTc).x;
    r = min(r, 1.0);
    return float4(r,r,r,r) + (1.0 - r) * Sample(faceTexture2, faceSampler, texCoords);
}
`;

let device, swapChain, verticesBuffer, bindGroupLayout, pipeline, renderPassDescriptor, queue, textureViewBinding, samplerBinding;
let projectionMatrix = mat4.create();

const texCoordsOffset = 4 * 4;
const vertexSize = 4 * 6;
const cubeVertexArray3 = new Float32Array(xCnt * yCnt * (6));

var phi = 0, theta = 0;
var dTheta = Math.PI / (yCnt - 1);
var dPhi = Math.PI * 2 / (xCnt - 1);
var dT = 1.0 / (yCnt - 1);
var dS = 1.0 / (xCnt - 1);
var cnt = 0;
for (var y = 0; y < yCnt; y++) {
    theta = y * dTheta;
    for (var x = 0; x < xCnt; x++) {
        phi = x * dPhi;
        cubeVertexArray3[cnt++] = Math.cos(phi) * Math.sin(theta);
        cubeVertexArray3[cnt++] = -Math.cos(theta);
        cubeVertexArray3[cnt++] = Math.sin(phi) * Math.sin(theta);
        cubeVertexArray3[cnt++] = 1.0;

        cubeVertexArray3[cnt++] = 1.0 - (x * dS);
        cubeVertexArray3[cnt++] = 1.0 - (y * dT);
    }
}

var indexCnt2 = (xCnt * 2) * (yCnt - 1) - 1;
const cubeVertexArrayIndex = new Uint32Array(indexCnt2);
var rowOffset = 0;
cnt = 0;

for (var row = 0; row < yCnt - 1; row++) {
    rowOffset = row * xCnt;

    for (var col = 0; col < xCnt; col++) {
        cubeVertexArrayIndex[cnt++] = rowOffset + col;
        cubeVertexArrayIndex[cnt++] = rowOffset + col + xCnt;
    }

    if (row != yCnt - 2) {
        //cubeVertexArrayIndex[cnt++] = 0xFFFFFFFF;
    }
}

if (cnt == indexCnt2) {
    console.log("wrong index cnt");
}

verticesArray = new Float32Array(indexCnt * (6));

var pushIndex = 0;
for (var i = 0; i < indexCnt2 - 2; ++i) {
    for (var l = 0; l < 3; ++l) {
        var ll = i % 2 != 0 ? 2 - l : l;
        var i0 = cubeVertexArrayIndex[i + ll];
        for (var k = 0; k < 6; ++k) {
            verticesArray[pushIndex] = cubeVertexArray3[i0 * 6 + k];
            pushIndex++;
        }
    }
}

async function init() {
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice();

    device.onuncapturederror = function (e) {
        console.log(`ERROR:`, e);
    };

    const canvas = document.getElementById('webgpu-canvas');

    const aspect = Math.abs(canvas.width / canvas.height);
    mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 100.0);

    const context = canvas.getContext('gpu');

    const swapChainDescriptor = {
        device: device,
        format: "bgra8unorm"
    };
    swapChain = context.configureSwapChain(swapChainDescriptor);

    const shaderModuleDescriptor = { code: shader, isWHLSL: true };
    const shaderModule = device.createShaderModule(shaderModuleDescriptor);

    const verticesBufferDescriptor = {
        size: verticesArray.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    };
    let verticesArrayBuffer;
    [verticesBuffer, verticesArrayBuffer] = device.createBufferMapped(verticesBufferDescriptor);

    const verticesWriteArray = new Float32Array(verticesArrayBuffer);
    verticesWriteArray.set(verticesArray);
    verticesBuffer.unmap();

    const positionAttributeDescriptor = {
        shaderLocation: positionAttributeNum,
        offset: 0,
        format: "float4"
    };
    const texCoordsAttributeDescriptor = {
        shaderLocation: texCoordsAttributeNum,
        offset: texCoordsOffset,
        format: "float2"
    }
    const vertexBufferDescriptor = {
        attributeSet: [positionAttributeDescriptor, texCoordsAttributeDescriptor],
        stride: vertexSize,
        stepMode: "vertex"
    };
    const vertexInputDescriptor = { vertexBuffers: [vertexBufferDescriptor] };

    const image = new Image();
    const imageLoadPromise = new Promise(resolve => {
        image.onload = () => resolve();
        image.src = "./img/av.png"
    });
    await Promise.resolve(imageLoadPromise);

    const textureSize = {
        width: image.width,
        height: image.height,
        depth: 1
    };

    const textureDescriptor = {
        size: textureSize,
        arrayLayerCount: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: "2d",
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED
    };
    const texture = device.createTexture(textureDescriptor);

    // Texture data
    const canvas2d = document.createElement('canvas');
    canvas2d.width = image.width;
    canvas2d.height = image.height;
    const context2d = canvas2d.getContext('2d');
    context2d.drawImage(image, 0, 0);

    const imageData = context2d.getImageData(0, 0, image.width, image.height);

    const textureDataBufferDescriptor = {
        size: imageData.data.length,
        usage: GPUBufferUsage.COPY_SRC
    };
    const [textureDataBuffer, textureArrayBuffer] = device.createBufferMapped(textureDataBufferDescriptor);

    const textureWriteArray = new Uint8Array(textureArrayBuffer);
    textureWriteArray.set(imageData.data);
    textureDataBuffer.unmap();

    const dataCopyView = {
        buffer: textureDataBuffer,
        offset: 0,
        rowPitch: image.width * 4,
        imageHeight: 0
    };
    const textureCopyView = {
        texture: texture,
        mipLevel: 0,
        arrayLayer: 0,
        origin: { x: 0, y: 0, z: 0 }
    };

    const blitCommandEncoder = device.createCommandEncoder();
    blitCommandEncoder.copyBufferToTexture(dataCopyView, textureCopyView, textureSize);

    queue = device.getQueue();

    queue.submit([blitCommandEncoder.finish()]);

    let texture2;
    {
        // Load texture image
        const image = new Image();
        const imageLoadPromise = new Promise(resolve => {
            image.onload = () => resolve();
            image.src = "./img/8081_earthmap2k.jpg"
        });
        await Promise.resolve(imageLoadPromise);

        const textureSize = {
            width: image.width,
            height: image.height,
            depth: 1
        };

        const textureDescriptor = {
            size: textureSize,
            arrayLayerCount: 1,
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: "2d",
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED
        };
        texture2 = device.createTexture(textureDescriptor);

        // Texture data
        const canvas2d = document.createElement('canvas');
        canvas2d.width = image.width;
        canvas2d.height = image.height;
        const context2d = canvas2d.getContext('2d');
        context2d.drawImage(image, 0, 0);

        const imageData = context2d.getImageData(0, 0, image.width, image.height);

        const textureDataBufferDescriptor = {
            size: imageData.data.length,
            usage: GPUBufferUsage.COPY_SRC
        };
        const [textureDataBuffer, textureArrayBuffer] = device.createBufferMapped(textureDataBufferDescriptor);

        const textureWriteArray = new Uint8Array(textureArrayBuffer);
        textureWriteArray.set(imageData.data);
        textureDataBuffer.unmap();

        const dataCopyView = {
            buffer: textureDataBuffer,
            offset: 0,
            rowPitch: image.width * 4,
            imageHeight: 0
        };
        const textureCopyView = {
            texture: texture2,
            mipLevel: 0,
            arrayLayer: 0,
            origin: { x: 0, y: 0, z: 0 }
        };

        const blitCommandEncoder = device.createCommandEncoder();
        blitCommandEncoder.copyBufferToTexture(dataCopyView, textureCopyView, textureSize);

        queue = device.getQueue();

        queue.submit([blitCommandEncoder.finish()]);
    }

    // Bind group binding layout
    const transformBufferBindGroupLayoutBinding = {
        binding: transformBindingNum, // id[[(0)]]
        visibility: GPUShaderStage.VERTEX,
        type: "uniform-buffer"
    };

    const textureBindGroupLayoutBinding = {
        binding: textureBindingNum,
        visibility: GPUShaderStage.FRAGMENT,
        type: "sampled-texture"
    };
    textureViewBinding = {
        binding: textureBindingNum,
        resource: texture.createDefaultView()
    };

    const textureBindGroupLayoutBinding2 = {
        binding: textureBindingNum2,
        visibility: GPUShaderStage.FRAGMENT,
        type: "sampled-texture"
    };
    textureViewBinding2 = {
        binding: textureBindingNum2,
        resource: texture2.createDefaultView()
    };

    const samplerBindGroupLayoutBinding = {
        binding: samplerBindingNum,
        visibility: GPUShaderStage.FRAGMENT,
        type: "sampler"
    };
    samplerBinding = {
        binding: samplerBindingNum,
        resource: device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            magFilter: "linear",
            minFilter: "linear",
        })
    };

    const bindGroupLayoutDescriptor = {
        bindings: [transformBufferBindGroupLayoutBinding, textureBindGroupLayoutBinding, textureBindGroupLayoutBinding2, samplerBindGroupLayoutBinding]
    };
    bindGroupLayout = device.createBindGroupLayout(bindGroupLayoutDescriptor);

    // Pipeline
    const depthStateDescriptor = {
        depthWriteEnabled: true,
        depthCompare: "less"
    };

    const pipelineLayoutDescriptor = { bindGroupLayouts: [bindGroupLayout] };
    const pipelineLayout = device.createPipelineLayout(pipelineLayoutDescriptor);
    const vertexStageDescriptor = {
        module: shaderModule,
        entryPoint: "vertex_main"
    };
    const fragmentStageDescriptor = {
        module: shaderModule,
        entryPoint: "fragment_main"
    };
    const colorState = {
        format: "bgra8unorm",
        alphaBlend: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add"
        },
        colorBlend: {
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
            operation: "add"
        },
        writeMask: GPUColorWrite.ALL
    };
    const pipelineDescriptor = {
        layout: pipelineLayout,

        vertexStage: vertexStageDescriptor,
        fragmentStage: fragmentStageDescriptor,

        primitiveTopology: "triangle-list",
        colorStates: [colorState],
        depthStencilState: depthStateDescriptor,
        vertexInput: vertexInputDescriptor
    };
    pipeline = device.createRenderPipeline(pipelineDescriptor);

    let colorAttachment = {
        loadOp: "clear",
        storeOp: "store",
        clearColor: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
    };

    const depthSize = {
        width: canvas.width,
        height: canvas.height,
        depth: 1
    };

    const depthTextureDescriptor = {
        size: depthSize,
        arrayLayerCount: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: "2d",
        format: "depth32float-stencil8",
        usage: GPUTextureUsage.OUTPUT_ATTACHMENT
    };

    const depthTexture = device.createTexture(depthTextureDescriptor);

    const depthAttachment = {
        attachment: depthTexture.createDefaultView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        clearDepth: 1.0
    };

    renderPassDescriptor = {
        colorAttachments: [colorAttachment],
        depthStencilAttachment: depthAttachment
    };

    render();
}

const transformSize = 4 * 16;

const transformBufferDescriptor = {
    size: transformSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.MAP_WRITE
};

let mappedGroups = [];

function render() {
    if (mappedGroups.length === 0) {
        const [buffer, arrayBuffer] = device.createBufferMapped(transformBufferDescriptor);
        const group = device.createBindGroup(createBindGroupDescriptor(buffer, textureViewBinding, textureViewBinding2, samplerBinding));
        let mappedGroup = { buffer: buffer, arrayBuffer: arrayBuffer, bindGroup: group };
        drawCommands(mappedGroup);
    } else
        drawCommands(mappedGroups.shift());
}

function createBindGroupDescriptor(transformBuffer, textureViewBinding, textureViewBinding2, samplerBinding) {
    const transformBufferBinding = {
        buffer: transformBuffer,
        offset: 0,
        size: transformSize
    };
    const transformBufferBindGroupBinding = {
        binding: transformBindingNum,
        resource: transformBufferBinding
    };
    return {
        layout: bindGroupLayout,
        bindings: [transformBufferBindGroupBinding, textureViewBinding, textureViewBinding2, samplerBinding]
    };
}

function drawCommands(mappedGroup) {
    updateTransformArray(new Float32Array(mappedGroup.arrayBuffer));
    mappedGroup.buffer.unmap();

    const commandEncoder = device.createCommandEncoder();
    renderPassDescriptor.colorAttachments[0].attachment = swapChain.getCurrentTexture().createDefaultView();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffers(0, [verticesBuffer], [0]);
    passEncoder.setBindGroup(bindGroupIndex, mappedGroup.bindGroup);
    passEncoder.draw(indexCnt, 1, 0, 0);
    passEncoder.endPass();

    queue.submit([commandEncoder.finish()]);

    mappedGroup.buffer.mapWriteAsync().then((arrayBuffer) => {
        mappedGroup.arrayBuffer = arrayBuffer;
        mappedGroups.push(mappedGroup);
    });

    requestAnimationFrame(render);
}

var camphi = 0.5;
var camtheta = 0.0;
var camphiDelta = 0;
var camthetaDelta = 0;
function updateTransformArray(array) {

    let viewMatrix = mat4.create();
    let now = Date.now() / 3000;

    const canvas = document.getElementById("webgpu-canvas");
    var scale = mat4.create();
    if (canvas.width > canvas.height) {
        const aspect = Math.abs(canvas.width / canvas.height);
        mat4.fromScaling(scale, vec3.fromValues(1.0 / aspect * 0.95, 0.95, 1));
    }
    else {
        const aspect = Math.abs(canvas.height / canvas.width);
        mat4.fromScaling(scale, vec3.fromValues(0.95, 1.0 / aspect * 0.95, 1));
    }

    camphi += camphiDelta;
    camtheta += camthetaDelta;

    if (camphi < -Math.PI * 0.5) {
        camphi = -Math.PI * 0.5;
    }

    if (camphi > Math.PI * 0.5) {
        camphi = Math.PI * 0.5;
    }

    camphiDelta *= 0.9;
    camthetaDelta *= 0.9;

    mat4.rotateX(viewMatrix, viewMatrix, camphi);
    mat4.rotateY(viewMatrix, viewMatrix, camtheta);

    mat4.rotate(viewMatrix, viewMatrix, now, vec3.fromValues(0, 1, 0));

    let modelViewProjectionMatrix = mat4.create();
    mat4.multiply(modelViewProjectionMatrix, scale, viewMatrix);
    mat4.copy(array, modelViewProjectionMatrix)
}

window.addEventListener("load", init);