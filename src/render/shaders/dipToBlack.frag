// Dip to black. intensity: share of the duration held at black. params.x: depth.
void main() {
  float hold = clamp(uIntensity, 0.0, 0.9) * 0.5;
  float depth = clamp(uParams.x, 0.0, 1.0);
  float p = uProgress;
  vec3 c;
  if (p < 0.5) {
    float k = clamp(p / max(0.5 - hold, 1e-4), 0.0, 1.0);
    c = getFrom(vUv) * (1.0 - depth * k);
  } else {
    float k = clamp((1.0 - p) / max(0.5 - hold, 1e-4), 0.0, 1.0);
    c = getTo(vUv) * (1.0 - depth * k);
  }
  outColor = vec4(c, 1.0);
}
