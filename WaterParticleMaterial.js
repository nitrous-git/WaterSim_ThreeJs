import * as THREE from "three";

export class WaterParticleMaterial extends THREE.ShaderMaterial {
    constructor(options = {}) {
        const uniforms = {
            uResolution: {
                value: new THREE.Vector2(
                    options.width ?? window.innerWidth,
                    options.height ?? window.innerHeight
                )
            },

            uTime: {
                value: 0.0
            },

            // Approximate world-space visual radius.
            // This is not the collision radius; it is the rendered sprite radius.
            uPointRadius: {
                value: options.pointRadius ?? 0.075
            },

            uBaseColor: {
                value: new THREE.Color(options.baseColor ?? 0x55ccff)
            },

            uDeepColor: {
                value: new THREE.Color(options.deepColor ?? 0x0a3d66)
            },

            uHighlightColor: {
                value: new THREE.Color(options.highlightColor ?? 0xffffff)
            },

            uOpacity: {
                value: options.opacity ?? 0.62
            },

            uSoftness: {
                value: options.softness ?? 0.32
            },

            uRimPower: {
                value: options.rimPower ?? 2.2
            },

            uHighlightStrength: {
                value: options.highlightStrength ?? 0.35
            },

            uFresnelStrength: {
                value: options.fresnelStrength ?? 0.75
            }
        };

        super({
            uniforms,

            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,

            vertexShader: /* glsl */`
                uniform vec2 uResolution;
                uniform float uPointRadius;

                varying float vViewDepth;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    vViewDepth = -mvPosition.z;

                    // Perspective-scaled point size.
                    // uPointRadius behaves like an approximate world-space sprite radius.
                    gl_PointSize = uPointRadius * uResolution.y / max(0.01, vViewDepth);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,

            fragmentShader: /* glsl */`
                precision highp float;

                uniform float uTime;
                uniform vec3 uBaseColor;
                uniform vec3 uDeepColor;
                uniform vec3 uHighlightColor;
                uniform float uOpacity;
                uniform float uSoftness;
                uniform float uRimPower;
                uniform float uHighlightStrength;
                uniform float uFresnelStrength;

                varying float vViewDepth;

                void main() {
                    // Convert point UV from [0, 1] to [-1, 1]
                    vec2 p = gl_PointCoord * 2.0 - 1.0;

                    float r2 = dot(p, p);

                    // Discard outside circular sprite
                    if (r2 > 1.0) {
                        discard;
                    }

                    float r = sqrt(r2);

                    // Soft circular alpha mask
                    float circleMask = 1.0 - smoothstep(1.0 - uSoftness, 1.0, r);

                    // Fake sphere normal from point coordinate
                    float z = sqrt(max(0.0, 1.0 - r2));
                    vec3 normal = normalize(vec3(p.x, p.y, z));

                    // View direction in impostor space
                    vec3 viewDir = vec3(0.0, 0.0, 1.0);

                    // Fake Fresnel edge
                    float ndotv = max(dot(normal, viewDir), 0.0);
                    float fresnel = pow(1.0 - ndotv, uRimPower);

                    // Fake center lighting
                    float centerLight = pow(ndotv, 3.0);

                    // Tiny animated shimmer
                    float shimmer =
                        0.5 + 0.5 * sin(
                            18.0 * p.x +
                            13.0 * p.y +
                            uTime * 2.0
                        );

                    shimmer *= 0.04;

                    // Color gradient: deeper at edges, brighter near center
                    vec3 color = mix(uDeepColor, uBaseColor, centerLight);

                    // Fresnel rim highlight
                    color = mix(
                        color,
                        uHighlightColor,
                        fresnel * uFresnelStrength
                    );

                    // Specular-ish center glint
                    float highlight = pow(max(normal.x * 0.35 + normal.y * 0.25 + normal.z, 0.0), 24.0);
                    color += uHighlightColor * highlight * uHighlightStrength;

                    color += shimmer;

                    // More transparent center, stronger rim
                    float alpha = uOpacity * circleMask;
                    alpha *= mix(0.65, 1.15, fresnel);

                    gl_FragColor = vec4(color, alpha);
                }
            `
        });
    }

    setResolution(width, height) {
        this.uniforms.uResolution.value.set(width, height);
    }

    updateTime(timeSeconds) {
        this.uniforms.uTime.value = timeSeconds;
    }
}