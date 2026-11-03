// Zoom: A scales up as it leaves, B settles from the same scale.
// intensity: zoom amount. params.x: radial blur strength at the midpoint.
vec3 sampleZoom(sampler2D tex, vec2 uv, float scale, float blur) {
  vec2 c = vec2(0.5);
  vec2 base = (uv - c) / scale + c;
  vec2 toCentre = c - base;
  const int TAPS = 10;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1);
    acc += texture(tex, clamp(base + toCentre * blur * t, 0.0, 1.0)).rgb;
  }
  return acc / float(TAPS);
}
void main() {
  float p = uProgress;
  float z = max(uIntensity, 0.0);
  float blur = uParams.x * z * sin(PI * p) * 0.25;
  vec3 a = sampleZoom(uFrom, vUv, 1.0 + z * p, blur);
  vec3 b = sampleZoom(uTo, vUv, 1.0 + z * (1.0 - p), blur);
  outColor = vec4(mix(a, b, smoothstep(0.35, 0.65, p)), 1.0);
}
