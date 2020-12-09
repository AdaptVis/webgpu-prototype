(async () => {
  canvas = document.getElementById("webgpu-canvas");
  DPR = window.devicePixelRatio || 1;

  var cubePositionOffset = 0;
  var cubeUVOffset = 4 * 4;

  const adapter = await navigator.gpu.requestAdapter();

  const glslangModule = await import(/* webpackIgnore: true */ 'https://unpkg.com/@webgpu/glslang@0.0.15/dist/web-devel/glslang.js');
  const glslang = await glslangModule.default();
  const device = await adapter.requestDevice();

  const aspect = Math.abs(canvas.width / canvas.height);
  let projectionMatrix = mat4.create();
  mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 100.0);

  const context = canvas.getContext('gpupresent');

  const swapChain = context.configureSwapChain({
    device,
    format: "bgra8unorm",
  });

  const cubeVertexSize2 = 4 * 8;

  const cubeVertexArray3 = new Float32Array(xCnt * yCnt * (8));

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

      cubeVertexArray3[cnt++] = 1.0;
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

  cubeVertexArray2 = new Float32Array(indexCnt * (8));

  var pushIndex = 0;
  for (var i = 0; i < indexCnt2 - 2; ++i) {
    for (var l = 0; l < 3; ++l) {
      var ll = i % 2 != 0 ? 2 - l : l;
      var i0 = cubeVertexArrayIndex[i + ll];
      for (var k = 0; k < 8; ++k) {
        cubeVertexArray2[pushIndex] = cubeVertexArray3[i0 * 8 + k];
        pushIndex++;
      }
    }
  }

  const verticesBuffer = device.createBuffer({
    size: cubeVertexArray2.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(verticesBuffer.getMappedRange()).set(cubeVertexArray2);
  verticesBuffer.unmap();

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      // Transform
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      type: "uniform-buffer"
    }, {
      // Sampler
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      type: "sampler"
    }, {
      // Texture view
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      type: "sampled-texture"
    }
      , {
      // Texture view
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      type: "sampled-texture"
    }
    ]
  });

  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

  const glslShaders = {
    vertex: `#version 450
layout(set = 0, binding = 0) uniform Uniforms {
mat4 modelViewProjectionMatrix;
} uniforms;

layout(location = 0) in vec4 position;
layout(location = 1) in vec4 uv;

layout(location = 0) out vec2 fragUV;
layout(location = 1) out vec4 fragPosition;

void main() {
fragPosition = position;
gl_Position = uniforms.modelViewProjectionMatrix * position;
fragPosition = gl_Position;
fragUV = uv.zw;
}
`,

    fragment: `#version 450
layout(set = 0, binding = 1) uniform sampler mySampler;
layout(set = 0, binding = 2) uniform texture2D myTexture;
layout(set = 0, binding = 3) uniform texture2D myTexture2;

layout(location = 0) in vec2 fragUV;
layout(location = 1) in vec4 fragPosition;
layout(location = 0) out vec4 outColor;

void main() {
vec2 fragUV2;
fragUV2.x = 7.0 * fragUV.x - 3.5;
fragUV2.y = 12.0 * fragUV.y - 6.0;

#define PI 3.14159265359

//fragUV2.y += 1.0 - (sin(fragUV.y * PI));

//outColor = vec4(fragUV2.y, 0.0, 0.0, 1.0);

float fadeOut = (sin(fragUV.y * PI));
fragUV2.y /= ((1.0 + fadeOut) / 2.0);
fadeOut *= 1.5;
float r = fadeOut * texture(sampler2D(myTexture, mySampler), fragUV2).r;
r = min(r, 1.0);
outColor = (1.0 - r) * texture(sampler2D(myTexture2, mySampler), fragUV) + vec4(r);
//outColor *= max(1.0, dot(normalize(vec3(-1.0)), normalize(fragPosition.xyz)));
}
`,
  };

  var vs = glslang.compileGLSL(glslShaders.vertex, "vertex");
  var fs = glslang.compileGLSL(glslShaders.fragment, "fragment");

  const pipeline = device.createRenderPipeline({
    vertexStage: {
      module: device.createShaderModule({ code: vs }),
      entryPoint: "main",
    },
    fragmentStage: {
      module: device.createShaderModule({ code: fs }),
      entryPoint: "main",
    },

    primitiveTopology: 'triangle-list',
    depthStencilState: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus-stencil8",
    },
    vertexState: {
      vertexBuffers: [
        {
          arrayStride: cubeVertexSize2,
          attributes: [
            {
              shaderLocation: 0,
              offset: cubePositionOffset,
              format: "float4",
            },
            {
              shaderLocation: 1,
              offset: cubeUVOffset,
              format: "float4",
            },
          ],
        },
      ],
    },

    rasterizationState: {
      cullMode: "back",
    },

    colorStates: [
      {
        format: "bgra8unorm",
      },
    ],
  });

  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height, depth: 1 },
    format: "depth24plus-stencil8",
    usage: GPUTextureUsage.OUTPUT_ATTACHMENT
  });

  const renderPassDescriptor = {
    colorAttachments: [{
      attachment: undefined,

      loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    }],
    depthStencilAttachment: {
      attachment: depthTexture.createView(),

      depthLoadValue: 1.0,
      depthStoreOp: "store",
      stencilLoadValue: 0,
      stencilStoreOp: "store",
    }
  };

  const uniformBufferSize = 4 * 16;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  let cubeTexture;
  {
    const img = document.createElement('img');
    img.src = './img/av.png';
    await img.decode();

    console.log(img);
    let textureDataCanvas = document.createElement("canvas");
    let textureDataCtx = textureDataCanvas.getContext("2d");

    textureDataCanvas.width = img.width;
    textureDataCanvas.height = img.height;
    textureDataCtx.drawImage(img, 0, 0);
    var imageData = textureDataCtx.getImageData(0, 0, img.width, img.height).data;

    var w = img.width;
    var h = img.height;

    var buffer = new ArrayBuffer(w * h * 4);
    var imgBytes = new Uint8ClampedArray(buffer, 0);
    for (var a = 0; a < w * h * 4; ++a) {
      imgBytes[a] = imageData[a];
    }

    cubeTexture = device.createTexture({
      size: [w, h, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.SAMPLED | GPUTextureUsage.COPY_DST,
    });

    device.defaultQueue.writeTexture(
      { texture: cubeTexture },
      buffer,
      { offset: 0, bytesPerRow: w * 4, rowsPerImage: h },
      [w, h, 1])
  }

  let cubeTexture2;
  {
    const img = document.createElement('img');
    img.src = './img/8081_earthmap2k.jpg';
    await img.decode();

    console.log(img);
    let textureDataCanvas = document.createElement("canvas");
    let textureDataCtx = textureDataCanvas.getContext("2d");

    textureDataCanvas.width = img.width;
    textureDataCanvas.height = img.height;
    textureDataCtx.drawImage(img, 0, 0);
    var imageData = textureDataCtx.getImageData(0, 0, img.width, img.height).data;

    var w = img.width;
    var h = img.height;

    var buffer = new ArrayBuffer(w * h * 4);
    var imgBytes = new Uint8ClampedArray(buffer, 0);
    for (var a = 0; a < w * h * 4; ++a) {
      imgBytes[a] = imageData[a];
    }

    cubeTexture2 = device.createTexture({
      size: [w, h, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.SAMPLED | GPUTextureUsage.COPY_DST,
    });

    device.defaultQueue.writeTexture(
      { texture: cubeTexture2 },
      buffer,
      { offset: 0, bytesPerRow: w * 4, rowsPerImage: h },
      [w, h, 1])
  }

  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    addressModeW: "repeat",
    magFilter: "linear",
    minFilter: "linear",
  });

  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
      },
    }, {
      binding: 1,
      resource: sampler,
    },
    {
      binding: 2,
      resource: cubeTexture.createView(),
    },
    {
      binding: 3,
      resource: cubeTexture2.createView(),
    }
    ],
  });

  function getTransformationMatrix() {
    let viewMatrix = mat4.create();
    let now = Date.now() / 3000;

    const canvas = document.getElementById("webgpu-canvas");
    /*
    let scale = mat4.create();
    if (canvas.width > canvas.height) {
      const aspect = Math.abs(canvas.width / canvas.height);
      mat4.fromScaling(scale, vec3.fromValues(1.0 / aspect * 0.95, 0.95, 1));
    }
    else {
      const aspect = Math.abs(canvas.height / canvas.width);
      mat4.fromScaling(scale, vec3.fromValues(0.95, 1.0 / aspect * 0.95, 1));
    } */

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

    mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -3));

    mat4.rotateX(viewMatrix, viewMatrix, camphi);
    mat4.rotateY(viewMatrix, viewMatrix, camtheta);

    mat4.rotate(viewMatrix, viewMatrix, now, vec3.fromValues(0, 1, 0));

    let projectionMatrix = mat4.create();

    const aspect = Math.abs(canvas.width / canvas.height);
    mat4.perspective(projectionMatrix, Math.PI / 4.5, aspect, 1, 100);

    let modelViewProjectionMatrix = mat4.create();
    mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

    return modelViewProjectionMatrix;
  }

  document.body.removeChild(document.getElementById("loading"));

  requestAnimationFrame(function draw() {
    const transformationMatrix = getTransformationMatrix();
    device.defaultQueue.writeBuffer(
      uniformBuffer,
      0,
      transformationMatrix.buffer,
      transformationMatrix.byteOffset,
      transformationMatrix.byteLength
    );
    renderPassDescriptor.colorAttachments[0].attachment = swapChain.getCurrentTexture().createView();

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, uniformBindGroup);
    passEncoder.setVertexBuffer(0, verticesBuffer);
    passEncoder.draw(indexCnt, 1, 0, 0);

    passEncoder.endPass();
    device.defaultQueue.submit([commandEncoder.finish()]);

    requestAnimationFrame(draw);
  });
})();