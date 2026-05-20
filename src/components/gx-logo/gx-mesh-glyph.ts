import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

/** World-space X split between g and x in gx-icon.glb (after Blender rotation). */
const GLYPH_X_SPLIT_RATIO = 0.52;

/**
 * Keeps only triangles whose centroid is on the x side of the gx mark.
 * gx-icon.glb is one mesh; this avoids a mismatched Text3D favicon.
 */
export function clipGeometryToGlyphX(
  geometry: BufferGeometry,
  splitRatio = GLYPH_X_SPLIT_RATIO,
): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;

  const splitX = box.min.x + (box.max.x - box.min.x) * splitRatio;
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const v = new Vector3();
  const centroid = new Vector3();
  const verts: number[] = [];

  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    centroid.set(0, 0, 0);
    const indices: number[] = [];
    for (let j = 0; j < 3; j++) {
      const vi = index ? index.getX(i * 3 + j) : i * 3 + j;
      indices.push(vi);
      v.fromBufferAttribute(pos, vi);
      centroid.add(v);
    }
    centroid.divideScalar(3);
    if (centroid.x < splitX) continue;

    for (const vi of indices) {
      v.fromBufferAttribute(pos, vi);
      verts.push(v.x, v.y, v.z);
    }
  }

  const clipped = new BufferGeometry();
  clipped.setAttribute("position", new Float32BufferAttribute(verts, 3));
  clipped.computeVertexNormals();
  return clipped;
}
