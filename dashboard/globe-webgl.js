import { PhotorealisticEarthRenderer } from "./photorealistic-earth.js";

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;

uniform float uRotation;
uniform vec2 uScale;
uniform vec2 uOffset;

varying vec3 vNormal;
varying vec2 vUv;
varying float vDepth;

vec3 rotateY(vec3 value, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(
    value.x * c + value.z * s,
    value.y,
    -value.x * s + value.z * c
  );
}

void main() {
  vec3 position =
    rotateY(aPosition, uRotation);
  vec3 normal =
    normalize(
      rotateY(aNormal, uRotation)
    );

  vNormal = normal;
  vUv = aUv;
  vDepth = position.z;

  gl_Position = vec4(
    position.x * uScale.x +
      uOffset.x,
    position.y * uScale.y +
      uOffset.y,
    -position.z * 0.55,
    1.0
  );
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D uEarth;
uniform float uTextureReady;

varying vec3 vNormal;
varying vec2 vUv;
varying float vDepth;

void main() {
  if (vDepth < 0.0) {
    discard;
  }

  vec3 normal = normalize(vNormal);
  vec3 lightDirection =
    normalize(vec3(-0.42, 0.48, 0.76));

  float diffuse =
    max(
      dot(normal, lightDirection),
      0.0
    );
  float edge =
    pow(
      1.0 -
        clamp(
          normal.z,
          0.0,
          1.0
        ),
      3.2
    );

  vec3 fallback =
    mix(
      vec3(0.018, 0.075, 0.115),
      vec3(0.07, 0.20, 0.25),
      diffuse
    );

  vec3 textureColor =
    texture2D(
      uEarth,
      vec2(vUv.x, vUv.y)
    ).rgb;

  vec3 base =
    mix(
      fallback,
      textureColor,
      uTextureReady
    );

  float illumination =
    0.58 +
    diffuse * 0.62;
  vec3 color =
    base * illumination;

  color +=
    vec3(0.035, 0.36, 0.72) *
    edge *
    0.72;

  float limb =
    smoothstep(
      0.0,
      0.11,
      normal.z
    );

  gl_FragColor =
    vec4(
      color,
      limb
    );
}
`;

function compile(
  gl,
  type,
  source
) {
  const shader =
    gl.createShader(type);
  gl.shaderSource(
    shader,
    source
  );
  gl.compileShader(shader);

  if (
    !gl.getShaderParameter(
      shader,
      gl.COMPILE_STATUS
    )
  ) {
    const info =
      gl.getShaderInfoLog(
        shader
      );
    gl.deleteShader(shader);
    throw new Error(
      `globe_shader_compile_failed: ${info || "unknown"}`
    );
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compile(
    gl,
    gl.VERTEX_SHADER,
    VERTEX_SHADER
  );
  const fragment = compile(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER
  );
  const program =
    gl.createProgram();
  gl.attachShader(
    program,
    vertex
  );
  gl.attachShader(
    program,
    fragment
  );
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (
    !gl.getProgramParameter(
      program,
      gl.LINK_STATUS
    )
  ) {
    const info =
      gl.getProgramInfoLog(
        program
      );
    gl.deleteProgram(program);
    throw new Error(
      `globe_program_link_failed: ${info || "unknown"}`
    );
  }
  return program;
}

function sphereGeometry(
  latitudeBands = 64,
  longitudeBands = 96
) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (
    let latIndex = 0;
    latIndex <= latitudeBands;
    latIndex += 1
  ) {
    const latitude =
      -Math.PI / 2 +
      (
        latIndex /
        latitudeBands
      ) * Math.PI;
    const cosLatitude =
      Math.cos(latitude);
    const sinLatitude =
      Math.sin(latitude);

    for (
      let lonIndex = 0;
      lonIndex <= longitudeBands;
      lonIndex += 1
    ) {
      const longitude =
        -Math.PI +
        (
          lonIndex /
          longitudeBands
        ) *
          Math.PI *
          2;

      const x =
        cosLatitude *
        Math.sin(longitude);
      const y =
        sinLatitude;
      const z =
        cosLatitude *
        Math.cos(longitude);

      positions.push(
        x,
        y,
        z
      );
      normals.push(
        x,
        y,
        z
      );
      uvs.push(
        lonIndex /
          longitudeBands,
        latIndex /
          latitudeBands
      );
    }
  }

  const stride =
    longitudeBands + 1;
  for (
    let latIndex = 0;
    latIndex < latitudeBands;
    latIndex += 1
  ) {
    for (
      let lonIndex = 0;
      lonIndex < longitudeBands;
      lonIndex += 1
    ) {
      const first =
        latIndex * stride +
        lonIndex;
      const second =
        first + stride;

      indices.push(
        first,
        second,
        first + 1,
        second,
        second + 1,
        first + 1
      );
    }
  }

  return {
    positions:
      new Float32Array(
        positions
      ),
    normals:
      new Float32Array(
        normals
      ),
    uvs:
      new Float32Array(
        uvs
      ),
    indices:
      new Uint16Array(
        indices
      )
  };
}

function bufferAttribute(
  gl,
  program,
  name,
  values,
  size
) {
  const location =
    gl.getAttribLocation(
      program,
      name
    );
  const buffer =
    gl.createBuffer();
  gl.bindBuffer(
    gl.ARRAY_BUFFER,
    buffer
  );
  gl.bufferData(
    gl.ARRAY_BUFFER,
    values,
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(
    location
  );
  gl.vertexAttribPointer(
    location,
    size,
    gl.FLOAT,
    false,
    0,
    0
  );
  return buffer;
}

function fallbackPixel(gl) {
  const texture =
    gl.createTexture();
  gl.bindTexture(
    gl.TEXTURE_2D,
    texture
  );
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([
      5,
      24,
      36,
      255
    ])
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    gl.LINEAR
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    gl.CLAMP_TO_EDGE
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    gl.CLAMP_TO_EDGE
  );
  return texture;
}

export class GeoGlobeRenderer {
  constructor(
    canvas,
    {
      textureUrl =
        new URL(
          "./earth-dark.svg",
          import.meta.url
        ).href,
      realContainer = null,
      googleMapsApiKey = "",
      googleTilesRootUrl = "",
      creditContainer = null
    } = {}
  ) {
    this.canvas = canvas;
    this.available = false;
    this.textureReady = false;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.photorealistic =
      new PhotorealisticEarthRenderer(
        realContainer,
        {
          apiKey:
            googleMapsApiKey,
          tilesRootUrl:
            googleTilesRootUrl,
          creditContainer
        }
      );

    const gl =
      canvas?.getContext(
        "webgl",
        {
          alpha: true,
          antialias: true,
          depth: true,
          premultipliedAlpha:
            true,
          powerPreference:
            "high-performance"
        }
      );

    if (!gl) return;

    try {
      const program =
        createProgram(gl);
      const geometry =
        sphereGeometry();

      this.gl = gl;
      this.program = program;
      this.indexCount =
        geometry.indices.length;

      this.buffers = [
        bufferAttribute(
          gl,
          program,
          "aPosition",
          geometry.positions,
          3
        ),
        bufferAttribute(
          gl,
          program,
          "aNormal",
          geometry.normals,
          3
        ),
        bufferAttribute(
          gl,
          program,
          "aUv",
          geometry.uvs,
          2
        )
      ];

      this.indexBuffer =
        gl.createBuffer();
      gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        this.indexBuffer
      );
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        geometry.indices,
        gl.STATIC_DRAW
      );

      this.uniforms = {
        rotation:
          gl.getUniformLocation(
            program,
            "uRotation"
          ),
        scale:
          gl.getUniformLocation(
            program,
            "uScale"
          ),
        offset:
          gl.getUniformLocation(
            program,
            "uOffset"
          ),
        earth:
          gl.getUniformLocation(
            program,
            "uEarth"
          ),
        textureReady:
          gl.getUniformLocation(
            program,
            "uTextureReady"
          )
      };

      this.texture =
        fallbackPixel(gl);

      gl.useProgram(program);
      gl.uniform1i(
        this.uniforms.earth,
        0
      );
      gl.enable(
        gl.DEPTH_TEST
      );
      gl.depthFunc(gl.LEQUAL);
      gl.disable(
        gl.CULL_FACE
      );
      gl.enable(gl.BLEND);
      gl.blendFunc(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA
      );

      const image =
        new Image();
      image.decoding = "async";
      image.onload = () => {
        if (!this.gl) return;
        gl.activeTexture(
          gl.TEXTURE0
        );
        gl.bindTexture(
          gl.TEXTURE_2D,
          this.texture
        );
        gl.pixelStorei(
          gl.UNPACK_FLIP_Y_WEBGL,
          true
        );
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          image
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MAG_FILTER,
          gl.LINEAR
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_S,
          gl.CLAMP_TO_EDGE
        );
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_T,
          gl.CLAMP_TO_EDGE
        );
        this.textureReady = true;
      };
      image.onerror = () => {
        this.textureReady =
          false;
      };
      image.src = textureUrl;

      canvas.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          this.available =
            false;
        }
      );

      this.available = true;
    } catch (error) {
      console.warn(
        "GeoLive WebGL globe unavailable",
        error
      );
      this.available = false;
    }
  }

  get photorealisticActive() {
    return Boolean(
      this.photorealistic
        ?.active
    );
  }

  ensurePhotorealistic() {
    return this.photorealistic
      ?.initialize?.() ||
      Promise.resolve(false);
  }

  suspendPhotorealistic() {
    this.photorealistic
      ?.destroy?.();
  }

  get label() {
    if (
      this.photorealistic
        ?.label
    ) {
      return this.photorealistic
        .label;
    }
    return this.available
      ? "3D WebGL"
      : "2D fallback";
  }

  maxZoom() {
    return this.photorealistic
      ?.maxZoom?.() || 1.5;
  }

  zoomStep(zoom) {
    return this.photorealistic
      ?.zoomStep?.(zoom) || 0.1;
  }

  project(
    latitude,
    longitude
  ) {
    return this.photorealistic
      ?.project?.(
        latitude,
        longitude
      ) || null;
  }

  resize() {
    if (
      !this.available ||
      !this.gl
    ) {
      return;
    }

    const rect =
      this.canvas
        .getBoundingClientRect();
    const dpr =
      Math.min(
        window.devicePixelRatio ||
          1,
        2
      );
    const width =
      Math.max(
        1,
        Math.round(
          rect.width * dpr
        )
      );
    const height =
      Math.max(
        1,
        Math.round(
          rect.height * dpr
        )
      );

    if (
      width === this.lastWidth &&
      height === this.lastHeight
    ) {
      return;
    }

    this.lastWidth = width;
    this.lastHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(
      0,
      0,
      width,
      height
    );
  }

  render({
    rotationDegrees = -20,
    latitudeDegrees = 12,
    zoom = 1
  } = {}) {
    if (
      this.photorealistic
        ?.render({
          rotationDegrees,
          latitudeDegrees,
          zoom
        })
    ) {
      return true;
    }

    if (
      !this.available ||
      !this.gl
    ) {
      return false;
    }

    this.resize();

    const gl = this.gl;
    const cssWidth =
      Math.max(
        1,
        this.canvas.clientWidth
      );
    const cssHeight =
      Math.max(
        1,
        this.canvas.clientHeight
      );
    const radius =
      Math.min(
        cssWidth * 0.37,
        cssHeight * 0.43
      ) *
      Math.min(
        Math.max(
          Number(zoom) || 1,
          0.7
        ),
        1.5
      );

    const scaleX =
      2 * radius /
      cssWidth;
    const scaleY =
      2 * radius /
      cssHeight;

    gl.clearColor(
      0,
      0,
      0,
      0
    );
    gl.clear(
      gl.COLOR_BUFFER_BIT |
      gl.DEPTH_BUFFER_BIT
    );
    gl.useProgram(
      this.program
    );
    gl.activeTexture(
      gl.TEXTURE0
    );
    gl.bindTexture(
      gl.TEXTURE_2D,
      this.texture
    );
    gl.uniform1f(
      this.uniforms.rotation,
      -Number(
        rotationDegrees || 0
      ) *
        Math.PI /
        180
    );
    gl.uniform2f(
      this.uniforms.scale,
      scaleX,
      scaleY
    );
    gl.uniform2f(
      this.uniforms.offset,
      0,
      0.04
    );
    gl.uniform1f(
      this.uniforms.textureReady,
      this.textureReady
        ? 1
        : 0
    );

    gl.bindBuffer(
      gl.ELEMENT_ARRAY_BUFFER,
      this.indexBuffer
    );
    gl.drawElements(
      gl.TRIANGLES,
      this.indexCount,
      gl.UNSIGNED_SHORT,
      0
    );
    return true;
  }
}
