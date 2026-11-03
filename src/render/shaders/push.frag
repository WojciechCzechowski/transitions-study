// Push: B pushes A off screen. params.xy: direction the picture moves.
// intensity: motion blur along the push, peaking mid-move. params.z: blur length at intensity 1.
vec3 scene(vec2 uv, vec2 dir, float p) {
  vec2 a = uv - dir * p;          // A has moved by dir * p
  vec2 b = uv - dir * (p - 1.0);  // B starts one frame-width behind
  if (inside(a)) return getFrom(a);
  return getTo(clamp(b, 0.0, 1.0));
}
void main() {
  vec2 dir = normalize(uParams.xy + vec2(1e-6, 0.0));
  float blur = uIntensity * uParams.z * sin(PI * clamp(uProgress, 0.0, 1.0));
  const int TAPS = 12;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < TAPS; i++) {
    float o = (float(i) / float(TAPS - 1) - 0.5) * blur;
    acc += scene(vUv + dir * o, dir, uProgress);
  }
  outColor = vec4(acc / float(TAPS), 1.0);
}
