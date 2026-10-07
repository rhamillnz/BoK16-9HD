import { Fn, abs, cross, dFdx, dFdy, dot, normalView, normalize, positionView, sign } from 'three/tsl';

/**
 * Normal bent by the screen-space slope of a height node (Mikkelsen's surface-gradient bump
 * mapping, view space): procedural relief without a texture or extra geometry. Assign the result
 * to a node material's `normalNode`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bumpedNormal = Fn(([height]: [any]) => {
  const dpdx = dFdx(positionView),
    dpdy = dFdy(positionView);
  const dhdx = dFdx(height),
    dhdy = dFdy(height);
  const n = normalView;
  const r1 = cross(dpdy, n),
    r2 = cross(n, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(r1.mul(dhdx).add(r2.mul(dhdy)));
  return normalize(abs(det).mul(n).sub(grad));
});
