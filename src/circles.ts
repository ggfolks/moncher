import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingBufferGeometry,
  Vector3,
} from "three"
import {ChatCircle} from "./ranchdata"
import {loc2vec} from "./ranchutil"

export function createChatCircle (circle :ChatCircle) :Object3D {
  const RING_THICKNESS = .1
  const POINTS_PER_RADIUS = 16 // how many points to use for a radius 1 circle
  const points = POINTS_PER_RADIUS * circle.radius

  const mat = new MeshBasicMaterial({color: 0xEEEE22})
  const geom = new RingBufferGeometry(circle.radius - RING_THICKNESS, circle.radius, points)
  const ring = new Mesh(geom, mat)
  loc2vec(circle, ring.position)
  ring.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / -2)
  return ring
}
