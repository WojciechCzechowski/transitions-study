#version 300 es
// One oversized triangle covering the viewport. vUv is (0,0) at the top-left,
// matching ImageBitmap row order, so no texture flip is needed.
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
