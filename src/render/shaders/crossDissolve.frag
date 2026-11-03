// Cross dissolve. intensity: brightness dip at the midpoint.
void main() {
  vec3 c = mix(getFrom(vUv), getTo(vUv), uProgress);
  float dip = uIntensity * sin(PI * uProgress);
  outColor = vec4(c * (1.0 - dip), 1.0);
}
