import {Geometry, LineBasicMaterial, LineLoop, Object3D, Vector3} from "three"
import {ChatCircle} from "./ranchdata"
import {loc2vec} from "./ranchutil"

export function createChatCircle (circle :ChatCircle, setY :(into :Vector3) => void) :Object3D {
  const POINTS_PER_RADIUS = 16 // how many points to use for a radius 1 circle
  const points = POINTS_PER_RADIUS * circle.radius
  const center = loc2vec(circle)
  const geom = new Geometry()
  let maxY = center.y
  for (let pp = 0, rads = 0, incr = (Math.PI * 2) / points; pp < points; pp++, rads += incr) {
    const point = center.clone()
    point.x += Math.sin(rads) * circle.radius
    point.z += Math.cos(rads) * circle.radius
    setY(point) // best effort to find the Y of the point, otherwise keep center Y
    maxY = Math.max(maxY, point.y)
    geom.vertices.push(point)
  }
  // go back through and force them all to the highest Y
  geom.vertices.forEach(v => { v.y = maxY })

  const mat = new LineBasicMaterial({color: 0xEEEE22, linewidth: 10})
  return new LineLoop(geom, mat)
}
