// Wipe: an edge travels across the frame revealing B. params.xy: travel direction.
// intensity: edge feather (0 = hard line, 1 = half the frame).
void main() {
  vec2 dir = normalize(uParams.xy + vec2(1e-6, 0.0));
  // Position along the travel direction, 0 where the edge starts, 1 where it ends.
  float s = dot(vUv - 0.5, dir) / (abs(dir.x) * 0.5 + abs(dir.y) * 0.5) * 0.5 + 0.5;
  float f = max(uIntensity * 0.5, 0.001);
  float edge = mix(-f, 1.0 + f, uProgress);
  float showB = 1.0 - smoothstep(edge - f, edge + f, s);
  outColor = vec4(mix(getFrom(vUv), getTo(vUv), showB), 1.0);
}
