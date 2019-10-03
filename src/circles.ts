import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingBufferGeometry,
  Vector3,
} from "three"
import {ChatCircle} from "./ranchdata"

export function createChatCircle (circle :ChatCircle, setY :(into :Vector3) => void) :Object3D {
  const POINTS_PER_RADIUS = 16 // how many points to use for a radius 1 circle
  const points = POINTS_PER_RADIUS * circle.radius
  const point = new Vector3()
  let maxY = circle.y
  // take some samples
  for (let pp = 0, rads = 0, incr = (Math.PI * 2) / points; pp < points; pp++, rads += incr) {
    point.x = circle.x + Math.sin(rads) * circle.radius
    point.y = circle.y
    point.z = circle.z + Math.cos(rads) * circle.radius
    setY(point) // best effort to find the Y of the point, otherwise keep center Y
    maxY = Math.max(maxY, point.y)
  }

  const mat = new MeshBasicMaterial({color: 0xEEEE22})
  const geom = new RingBufferGeometry(circle.radius - .1, circle.radius, points)
  const ring = new Mesh(geom, mat)
  ring.position.set(circle.x, maxY, circle.z)
  ring.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / -2)
  return ring
}
