// Blur: A defocuses, swaps to B at the peak, B refocuses.
// intensity: peak radius (1 = params.x of the frame height).
const int SAMPLES = 32;
const float GOLDEN = 2.39996323;
vec3 diskBlur(sampler2D tex, vec2 uv, float radius) {
  if (radius < 1e-4) return texture(tex, uv).rgb;
  vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float r = sqrt((float(i) + 0.5) / float(SAMPLES)) * radius;
    float a = float(i) * GOLDEN;
    acc += texture(tex, clamp(uv + vec2(cos(a), sin(a)) * r * aspect, 0.0, 1.0)).rgb;
  }
  return acc / float(SAMPLES);
}
void main() {
  float p = uProgress;
  float radius = uIntensity * uParams.x * sin(PI * p);
  vec3 a = diskBlur(uFrom, vUv, radius);
  vec3 b = diskBlur(uTo, vUv, radius);
  outColor = vec4(mix(a, b, smoothstep(0.3, 0.7, p)), 1.0);
}
