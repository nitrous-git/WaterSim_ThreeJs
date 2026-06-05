import * as THREE from "three";

export class ScreenSpaceFluidRenderer {
    constructor(options = {}) {
        this.positions = options.positions;
        this.particleCount = options.particleCount;

        // This is the visual sphere radius used by the screen-space renderer.
        // It should generally be larger than the physics collision radius.
        this.particleRadius = options.particleRadius ?? 0.08;

        this.width = options.width ?? window.innerWidth;
        this.height = options.height ?? window.innerHeight;
        this.pixelRatio = options.pixelRatio ?? 1.0;

        this.blurIterations = options.blurIterations ?? 10;

        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
        this.positionAttribute.setUsage(THREE.DynamicDrawUsage);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", this.positionAttribute);

        this.depthMaterial = this.createDepthMaterial();
        this.thicknessMaterial = this.createThicknessMaterial();

        this.fluidPoints = new THREE.Points(
            this.geometry,
            this.depthMaterial
        );
        this.fluidPoints.frustumCulled = false;

        this.thicknessPoints = new THREE.Points(
            this.geometry,
            this.thicknessMaterial
        );
        this.thicknessPoints.frustumCulled = false;

        this.fluidScene = new THREE.Scene();
        this.fluidScene.add(this.fluidPoints);

        this.thicknessScene = new THREE.Scene();
        this.thicknessScene.add(this.thicknessPoints);

        this.fullscreenScene = new THREE.Scene();

        this.fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.fullscreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);

        this.fullscreenQuad.frustumCulled = false;
        this.fullscreenScene.add(this.fullscreenQuad);

        this.blurMaterial = this.createBlurMaterial();
        this.thicknessBlurMaterial = this.createThicknessBlurMaterial();
        this.compositeMaterial = this.createCompositeMaterial();

        this.lightDirectionWorld = new THREE.Vector3(0.5, 1.0, 0.35).normalize();
        this.lightDirectionView = new THREE.Vector3();

        this.allocateRenderTargets();
    }

    // ------------------------------------------------------------
    // Materials
    // ------------------------------------------------------------

    createDepthMaterial() {
        return new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,

            uniforms: {
                uPointRadius: {
                    value: this.particleRadius
                },

                uPointScale: {
                    value: 1.0
                },

                uProjectionMatrix: {
                    value: new THREE.Matrix4()
                }
            },

            depthTest: true,
            depthWrite: true,
            transparent: false,
            blending: THREE.NoBlending,

            vertexShader: /* glsl */`
                uniform float uPointRadius;
                uniform float uPointScale;

                out vec3 vViewCenter;

                void main() {
                    vec4 viewPosition =
                        modelViewMatrix * vec4(position, 1.0);

                    vViewCenter = viewPosition.xyz;

                    float viewDepth = max(0.0001, -viewPosition.z);

                    gl_PointSize =
                        uPointRadius *
                        uPointScale /
                        viewDepth;

                    gl_Position =
                        projectionMatrix *
                        viewPosition;
                }
            `,

            fragmentShader: /* glsl */`
                precision highp float;

                uniform float uPointRadius;
                uniform mat4 uProjectionMatrix;

                in vec3 vViewCenter;

                out vec4 outColor;

                void main() {
                    vec2 pointPosition =
                        gl_PointCoord * 2.0 - 1.0;

                    float radiusSquared =
                        dot(pointPosition, pointPosition);

                    if (radiusSquared > 1.0) {
                        discard;
                    }

                    float sphereZ =
                        sqrt(max(0.0, 1.0 - radiusSquared));

                    vec3 viewPosition =
                        vViewCenter +
                        vec3(
                            pointPosition.x,
                            pointPosition.y,
                            sphereZ
                        ) * uPointRadius;

                    vec4 clipPosition =
                        uProjectionMatrix *
                        vec4(viewPosition, 1.0);

                    float normalizedDepth =
                        clipPosition.z /
                        clipPosition.w;

                    gl_FragDepth =
                        normalizedDepth * 0.5 + 0.5;

                    float linearDepth =
                        -viewPosition.z;

                    outColor = vec4(
                        linearDepth,
                        0.0,
                        0.0,
                        1.0
                    );
                }
            `
        });
    }

    createThicknessMaterial() {
        return new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uPointRadius: { value: this.particleRadius },
                uPointScale: { value: 1.0 },
                uThicknessStrength: { value: 0.08 }
            },
            depthTest: false,
            depthWrite: false,
            transparent: true,
            blending: THREE.AdditiveBlending,
            vertexShader: /* glsl */`
            uniform float uPointRadius;
            uniform float uPointScale;

            void main() {
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);

                float viewDepth = max(0.0001, -viewPosition.z);
                gl_PointSize = uPointRadius * uPointScale / viewDepth;

                gl_Position = projectionMatrix * viewPosition;
            }
        `,
            fragmentShader: /* glsl */`
            precision highp float;

            uniform float uThicknessStrength;

            out vec4 outColor;

            void main() {
                vec2 pointPosition = gl_PointCoord * 2.0 - 1.0;
                float r2 = dot(pointPosition, pointPosition);

                if (r2 > 1.0) {
                    discard;
                }

                // Screen-space sphere thickness.
                // Center of the particle contributes more than the edge.
                float sphereThickness = sqrt(max(0.0, 1.0 - r2));

                outColor = vec4(sphereThickness * uThicknessStrength, 0.0, 0.0, 1.0);
            }
        `
        });
    }

    createBlurMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uDepthTexture: {
                    value: null
                },

                uTexelSize: {
                    value: new THREE.Vector2(1.0, 1.0)
                },

                uDirection: {
                    value: new THREE.Vector2(1.0, 0.0)
                },

                uDepthThreshold: {
                    value: 0.28
                }
            },

            depthTest: false,
            depthWrite: false,

            vertexShader: /* glsl */`
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,

            fragmentShader: /* glsl */`
                precision highp float;

                uniform sampler2D uDepthTexture;
                uniform vec2 uTexelSize;
                uniform vec2 uDirection;
                uniform float uDepthThreshold;

                varying vec2 vUv;

                float gaussianWeight(float distanceValue) {
                    return exp(
                        -0.5 *
                        distanceValue *
                        distanceValue /
                        4.0
                    );
                }

                void addDepthSample(
                    float sampleDepth,
                    float centerDepth,
                    float weight,
                    inout float depthSum,
                    inout float weightSum
                ) {
                    if (sampleDepth <= 0.0) {
                        return;
                    }

                    float depthDifference =
                        abs(sampleDepth - centerDepth);

                    if (depthDifference > uDepthThreshold) {
                        return;
                    }

                    depthSum += sampleDepth * weight;
                    weightSum += weight;
                }

                void main() {
                    float centerDepth =
                        texture2D(
                            uDepthTexture,
                            vUv
                        ).r;

                    if (centerDepth <= 0.0) {
                        gl_FragColor = vec4(0.0);
                        return;
                    }

                    float depthSum = centerDepth;
                    float weightSum = 1.0;

                    for (int i = 1; i <= 4; i++) {
                        float offsetIndex = float(i);

                        vec2 offset =
                            uDirection *
                            uTexelSize *
                            offsetIndex;

                        float positiveDepth =
                            texture2D(
                                uDepthTexture,
                                clamp(
                                    vUv + offset,
                                    vec2(0.0),
                                    vec2(1.0)
                                )
                            ).r;

                        float negativeDepth =
                            texture2D(
                                uDepthTexture,
                                clamp(
                                    vUv - offset,
                                    vec2(0.0),
                                    vec2(1.0)
                                )
                            ).r;

                        float weight =
                            gaussianWeight(offsetIndex);

                        addDepthSample(
                            positiveDepth,
                            centerDepth,
                            weight,
                            depthSum,
                            weightSum
                        );

                        addDepthSample(
                            negativeDepth,
                            centerDepth,
                            weight,
                            depthSum,
                            weightSum
                        );
                    }

                    float blurredDepth =
                        depthSum /
                        max(weightSum, 0.0001);

                    gl_FragColor = vec4(
                        blurredDepth,
                        0.0,
                        0.0,
                        1.0
                    );
                }
            `
        });
    }

    createThicknessBlurMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uThicknessTexture: { value: null },
                uTexelSize: { value: new THREE.Vector2(1.0, 1.0) },
                uDirection: { value: new THREE.Vector2(1.0, 0.0) }
            },
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */`
            varying vec2 vUv;

            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
            fragmentShader: /* glsl */`
            precision highp float;

            uniform sampler2D uThicknessTexture;
            uniform vec2 uTexelSize;
            uniform vec2 uDirection;

            varying vec2 vUv;

            float weight(float x) {
                return exp(-0.5 * x * x / 4.0);
            }

            void main() {
                float sum = texture2D(uThicknessTexture, vUv).r;
                float weightSum = 1.0;

                for (int i = 1; i <= 4; i++) {
                    float fi = float(i);
                    vec2 offset = uDirection * uTexelSize * fi;

                    float w = weight(fi);

                    sum += texture2D(uThicknessTexture, clamp(vUv + offset, vec2(0.0), vec2(1.0))).r * w;
                    sum += texture2D(uThicknessTexture, clamp(vUv - offset, vec2(0.0), vec2(1.0))).r * w;

                    weightSum += 2.0 * w;
                }

                float blurredThickness = sum / max(weightSum, 0.0001);

                gl_FragColor = vec4(blurredThickness, 0.0, 0.0, 1.0);
            }
        `
        });
    }

    createCompositeMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: {
                uSceneColor: { value: null },
                uSceneDepth: { value: null },
                uFluidDepth: { value: null },
                uFluidThickness: { value: null },

                uTexelSize: { value: new THREE.Vector2(1.0, 1.0) },
                uProjectionMatrixInverse: { value: new THREE.Matrix4() },

                uCameraNear: { value: 0.01 },
                uCameraFar: { value: 100.0 },

                uShallowColor: { value: new THREE.Color(0x55ccff) },
                uDeepColor: { value: new THREE.Color(0x06395f) },

                uLightDirection: { value: new THREE.Vector3(0.5, 1.0, 0.35).normalize() },

                uOpacity: { value: 0.08 },
                uRefractionStrength: { value: 0.017 },
                uFresnelStrength: { value: 1.5 },
                uSpecularStrength: { value: 0.8 },

                uAbsorptionStrength: { value: 5.8 },
                uThicknessOpacity: { value: 2.1 },
                uReflectionStrength: { value: 0.95 }
            },
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */`
            varying vec2 vUv;

            void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
            }
        `,
            fragmentShader: /* glsl */`
            precision highp float;

            uniform sampler2D uSceneColor;
            uniform sampler2D uSceneDepth;
            uniform sampler2D uFluidDepth;
            uniform sampler2D uFluidThickness;

            uniform vec2 uTexelSize;
            uniform mat4 uProjectionMatrixInverse;

            uniform float uCameraNear;
            uniform float uCameraFar;

            uniform vec3 uShallowColor;
            uniform vec3 uDeepColor;
            uniform vec3 uLightDirection;

            uniform float uOpacity;
            uniform float uRefractionStrength;
            uniform float uFresnelStrength;
            uniform float uSpecularStrength;

            uniform float uAbsorptionStrength;
            uniform float uThicknessOpacity;
            uniform float uReflectionStrength;

            varying vec2 vUv;

            float perspectiveDepthToViewZ(float depth, float nearPlane, float farPlane) {
                return nearPlane * farPlane / ((farPlane - nearPlane) * depth - farPlane);
            }

            float getSceneLinearDepth(vec2 uv) {
                float sceneDepth = texture2D(uSceneDepth, uv).r;

                if (sceneDepth >= 1.0) {
                    return 1.0e20;
                }

                return -perspectiveDepthToViewZ(sceneDepth, uCameraNear, uCameraFar);
            }

            float getFluidDepth(vec2 uv) {
                return texture2D(uFluidDepth, clamp(uv, vec2(0.0), vec2(1.0))).r;
            }

            vec3 reconstructViewPosition(vec2 uv, float linearDepth) {
                vec2 normalizedPosition = uv * 2.0 - 1.0;

                vec4 viewRay = uProjectionMatrixInverse * vec4(normalizedPosition, 1.0, 1.0);
                viewRay /= viewRay.w;

                return viewRay.xyz * (linearDepth / -viewRay.z);
            }

            float validNeighborDepth(vec2 uv, float fallbackDepth) {
                float sampleDepth = getFluidDepth(uv);

                if (sampleDepth <= 0.0) {
                    return fallbackDepth;
                }

                return sampleDepth;
            }

            vec3 reconstructNormal(vec2 uv, float centerDepth) {
                vec3 centerPosition = reconstructViewPosition(uv, centerDepth);

                vec2 offsetX = vec2(uTexelSize.x, 0.0);
                vec2 offsetY = vec2(0.0, uTexelSize.y);

                float rightDepth = validNeighborDepth(uv + offsetX, centerDepth);
                float leftDepth  = validNeighborDepth(uv - offsetX, centerDepth);
                float upDepth    = validNeighborDepth(uv + offsetY, centerDepth);
                float downDepth  = validNeighborDepth(uv - offsetY, centerDepth);

                vec3 rightPosition = reconstructViewPosition(uv + offsetX, rightDepth);
                vec3 leftPosition  = reconstructViewPosition(uv - offsetX, leftDepth);
                vec3 upPosition    = reconstructViewPosition(uv + offsetY, upDepth);
                vec3 downPosition  = reconstructViewPosition(uv - offsetY, downDepth);

                vec3 dxForward = rightPosition - centerPosition;
                vec3 dxBackward = centerPosition - leftPosition;

                vec3 dyForward = upPosition - centerPosition;
                vec3 dyBackward = centerPosition - downPosition;

                // Edge-aware derivative selection.
                // This avoids using a neighbor across a large depth discontinuity.
                vec3 dx = abs(dxForward.z) < abs(dxBackward.z) ? dxForward : dxBackward;
                vec3 dy = abs(dyForward.z) < abs(dyBackward.z) ? dyForward : dyBackward;

                vec3 normal = normalize(cross(dx, dy));

                if (normal.z < 0.0) {
                    normal = -normal;
                }

                return normal;
            }

            vec3 getSkyReflectionColor(vec3 reflectedDirection) {
                float t = clamp(reflectedDirection.y * 0.5 + 0.5, 0.0, 1.0);

                vec3 horizonColor = vec3(0.78, 0.92, 1.0);
                vec3 skyColor = vec3(0.08, 0.26, 0.62);

                return mix(horizonColor, skyColor, t);
            }

            void main() {
                vec3 sceneColor = texture2D(uSceneColor, vUv).rgb;

                float fluidDepth = getFluidDepth(vUv);

                if (fluidDepth <= 0.0) {
                    gl_FragColor = vec4(sceneColor, 1.0);
                    return;
                }

                float sceneDepth = getSceneLinearDepth(vUv);

                if (fluidDepth >= sceneDepth - 0.001) {
                    gl_FragColor = vec4(sceneColor, 1.0);
                    return;
                }

                float thickness = texture2D(uFluidThickness, vUv).r;

                vec3 viewPosition = reconstructViewPosition(vUv, fluidDepth);
                vec3 normal = reconstructNormal(vUv, fluidDepth);
                vec3 viewDirection = normalize(-viewPosition);

                float normalView = max(dot(normal, viewDirection), 0.0);
                float fresnel = pow(1.0 - normalView, 5.0) * uFresnelStrength;

                vec3 lightDirection = normalize(uLightDirection);

                float diffuse = max(dot(normal, lightDirection), 0.0);

                vec3 reflectedLight = reflect(-lightDirection, normal);
                float specular = pow(max(dot(reflectedLight, viewDirection), 0.0), 96.0) * uSpecularStrength;

                vec2 refractedUv = clamp(
                    vUv + normal.xy * uRefractionStrength,
                    vec2(0.0),
                    vec2(1.0)
                );

                vec3 refractedScene = texture2D(uSceneColor, refractedUv).rgb;

                // Beer-Lambert-ish absorption.
                // Absorb red/green more than blue to create water depth tinting.
                vec3 absorptionCoefficient = vec3(1.0, 0.45, 0.12);
                vec3 transmittance = exp(-uAbsorptionStrength * thickness * absorptionCoefficient);

                refractedScene *= transmittance;

                float thicknessAlpha = 1.0 - exp(-uThicknessOpacity * thickness);

                vec3 waterColor = mix(
                    uDeepColor,
                    uShallowColor,
                    clamp(0.25 + diffuse * 0.75 - thickness * 0.35, 0.0, 1.0)
                );

                vec3 reflectedDirection = reflect(-viewDirection, normal);
                vec3 reflectionColor = getSkyReflectionColor(reflectedDirection);

                vec3 refractedWater = mix(
                    refractedScene,
                    waterColor,
                    clamp(0.18 + thicknessAlpha * 0.45, 0.0, 1.0)
                );

                vec3 waterSurface = mix(
                    refractedWater,
                    reflectionColor,
                    clamp(fresnel * uReflectionStrength, 0.0, 1.0)
                );

                waterSurface += vec3(specular);

                float finalAlpha = clamp(
                    uOpacity + thicknessAlpha * (1.0 - uOpacity),
                    0.0,
                    1.0
                );

                vec3 finalColor = mix(sceneColor, waterSurface, finalAlpha);

                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
        });
    }

    // ------------------------------------------------------------
    // Render targets
    // ------------------------------------------------------------

    allocateRenderTargets() {
        const targetWidth = Math.max(
            1,
            Math.floor(this.width * this.pixelRatio)
        );

        const targetHeight = Math.max(
            1,
            Math.floor(this.height * this.pixelRatio)
        );

        this.disposeRenderTargets();

        this.sceneTarget = new THREE.WebGLRenderTarget(
            targetWidth,
            targetHeight,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                depthBuffer: true,
                stencilBuffer: false
            }
        );

        this.sceneTarget.texture.generateMipmaps = false;

        this.sceneTarget.depthTexture = new THREE.DepthTexture(
            targetWidth,
            targetHeight,
            THREE.UnsignedIntType
        );

        this.sceneTarget.depthTexture.format = THREE.DepthFormat;
        this.sceneTarget.depthTexture.type = THREE.UnsignedIntType;

        this.depthTarget = this.createFluidDepthTarget(targetWidth, targetHeight, true);
        this.blurTargetA = this.createFluidDepthTarget(targetWidth, targetHeight, false);
        this.blurTargetB = this.createFluidDepthTarget(targetWidth, targetHeight, false);

        this.thicknessTarget = this.createFluidValueTarget(targetWidth, targetHeight);
        this.thicknessBlurTargetA = this.createFluidValueTarget(targetWidth, targetHeight);
        this.thicknessBlurTargetB = this.createFluidValueTarget(targetWidth, targetHeight);

        const texelSizeX = 1.0 / targetWidth;
        const texelSizeY = 1.0 / targetHeight;

        this.blurMaterial.uniforms.uTexelSize.value.set(
            texelSizeX,
            texelSizeY
        );

        this.compositeMaterial.uniforms.uTexelSize.value.set(
            texelSizeX,
            texelSizeY
        );

        this.thicknessBlurMaterial.uniforms.uTexelSize.value.set(
            texelSizeX,
            texelSizeY
        );

        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
    }

    createFluidDepthTarget(width, height, depthBuffer) {
        const target = new THREE.WebGLRenderTarget(
            width,
            height,
            {
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat,
                type: THREE.HalfFloatType,
                depthBuffer,
                stencilBuffer: false
            }
        );

        target.texture.generateMipmaps = false;

        return target;
    }

    createFluidValueTarget(width, height) {
        const target = new THREE.WebGLRenderTarget(
            width,
            height,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
                type: THREE.HalfFloatType,
                depthBuffer: false,
                stencilBuffer: false
            }
        );

        target.texture.generateMipmaps = false;

        return target;
    }

    disposeRenderTargets() {
        this.sceneTarget?.dispose();

        this.depthTarget?.dispose();
        this.blurTargetA?.dispose();
        this.blurTargetB?.dispose();

        this.thicknessTarget?.dispose();
        this.thicknessBlurTargetA?.dispose();
        this.thicknessBlurTargetB?.dispose();
    }
    // ------------------------------------------------------------
    // Update / render
    // ------------------------------------------------------------

    update() {
        this.positionAttribute.needsUpdate = true;
    }

    setResolution(width, height, pixelRatio = 1.0) {
        this.width = width;
        this.height = height;
        this.pixelRatio = pixelRatio;

        this.allocateRenderTargets();
    }

    render(renderer, scene, camera) {
        camera.updateMatrixWorld();

        this.depthMaterial.uniforms.uPointRadius.value = this.particleRadius;
        this.depthMaterial.uniforms.uPointScale.value = this.targetHeight * camera.projectionMatrix.elements[5];
        this.depthMaterial.uniforms.uProjectionMatrix.value.copy(camera.projectionMatrix);

        this.thicknessMaterial.uniforms.uPointRadius.value = this.particleRadius;
        this.thicknessMaterial.uniforms.uPointScale.value = this.targetHeight * camera.projectionMatrix.elements[5];

        this.compositeMaterial.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
        this.compositeMaterial.uniforms.uCameraNear.value = camera.near;
        this.compositeMaterial.uniforms.uCameraFar.value = camera.far;

        this.lightDirectionView
            .copy(this.lightDirectionWorld)
            .transformDirection(camera.matrixWorldInverse);

        this.compositeMaterial.uniforms.uLightDirection.value.copy(this.lightDirectionView);

        const previousRenderTarget = renderer.getRenderTarget();
        const previousClearColor = renderer.getClearColor(new THREE.Color());
        const previousClearAlpha = renderer.getClearAlpha();

        // --------------------------------------------------------
        // Pass 1: normal scene color and scene depth
        // --------------------------------------------------------
        renderer.setRenderTarget(this.sceneTarget);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);

        // --------------------------------------------------------
        // Pass 2: particle sphere front depth
        // --------------------------------------------------------
        renderer.setRenderTarget(this.depthTarget);
        renderer.setClearColor(0x000000, 0.0);
        renderer.clear(true, true, true);
        renderer.render(this.fluidScene, camera);

        // --------------------------------------------------------
        // Pass 3: bilateral depth blur
        // --------------------------------------------------------
        let depthTexture = this.depthTarget.texture;

        for (let i = 0; i < this.blurIterations; i++) {
            this.blurMaterial.uniforms.uDepthTexture.value = depthTexture;
            this.blurMaterial.uniforms.uDirection.value.set(1.0, 0.0);

            this.renderFullscreen(renderer, this.blurMaterial, this.blurTargetA);

            this.blurMaterial.uniforms.uDepthTexture.value = this.blurTargetA.texture;
            this.blurMaterial.uniforms.uDirection.value.set(0.0, 1.0);

            this.renderFullscreen(renderer, this.blurMaterial, this.blurTargetB);

            depthTexture = this.blurTargetB.texture;
        }

        // --------------------------------------------------------
        // Pass 4: additive particle thickness
        // --------------------------------------------------------
        renderer.setRenderTarget(this.thicknessTarget);
        renderer.setClearColor(0x000000, 0.0);
        renderer.clear(true, false, false);
        renderer.render(this.thicknessScene, camera);

        // --------------------------------------------------------
        // Pass 5: blur thickness
        // --------------------------------------------------------
        let thicknessTexture = this.thicknessTarget.texture;

        this.thicknessBlurMaterial.uniforms.uThicknessTexture.value = thicknessTexture;
        this.thicknessBlurMaterial.uniforms.uDirection.value.set(1.0, 0.0);
        this.renderFullscreen(renderer, this.thicknessBlurMaterial, this.thicknessBlurTargetA);

        this.thicknessBlurMaterial.uniforms.uThicknessTexture.value = this.thicknessBlurTargetA.texture;
        this.thicknessBlurMaterial.uniforms.uDirection.value.set(0.0, 1.0);
        this.renderFullscreen(renderer, this.thicknessBlurMaterial, this.thicknessBlurTargetB);

        thicknessTexture = this.thicknessBlurTargetB.texture;

        // --------------------------------------------------------
        // Pass 6: composite water surface over the scene
        // --------------------------------------------------------
        this.compositeMaterial.uniforms.uSceneColor.value = this.sceneTarget.texture;
        this.compositeMaterial.uniforms.uSceneDepth.value = this.sceneTarget.depthTexture;
        this.compositeMaterial.uniforms.uFluidDepth.value = depthTexture;
        this.compositeMaterial.uniforms.uFluidThickness.value = thicknessTexture;

        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 1.0);
        renderer.clear(true, true, true);

        this.fullscreenQuad.material = this.compositeMaterial;

        renderer.render(this.fullscreenScene, this.fullscreenCamera);

        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.setRenderTarget(previousRenderTarget);
    }

    renderFullscreen(renderer, material, renderTarget) {
        this.fullscreenQuad.material = material;

        renderer.setRenderTarget(renderTarget);
        renderer.setClearColor(0x000000, 0.0);
        renderer.clear(true, false, false);

        renderer.render(
            this.fullscreenScene,
            this.fullscreenCamera
        );
    }

    dispose() {
        this.disposeRenderTargets();

        this.geometry.dispose();

        this.depthMaterial.dispose();
        this.thicknessMaterial.dispose();
        this.blurMaterial.dispose();
        this.thicknessBlurMaterial.dispose();
        this.compositeMaterial.dispose();

        this.fullscreenQuad.geometry.dispose();
    }

}