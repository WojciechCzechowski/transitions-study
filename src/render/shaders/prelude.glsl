#version 300 es
precision highp float;
// Shared by every fragment shader. Screen space: x right, y down, (0,0) top-left.
uniform sampler2D uFrom;   // outgoing frame (clip A)
uniform sampler2D uTo;     // incoming frame (clip B)
uniform float uProgress;   // eased progress 0..1
uniform float uLinear;     // linear progress 0..1
uniform float uIntensity;  // preset-specific strength from Feel
uniform vec4 uParams;      // preset-specific constants from the config
uniform vec2 uResolution;  // drawing buffer size in pixels
in vec2 vUv;
out vec4 outColor;
const float PI = 3.14159265359;
vec3 getFrom(vec2 uv) { return texture(uFrom, uv).rgb; }
vec3 getTo(vec2 uv) { return texture(uTo, uv).rgb; }
bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
