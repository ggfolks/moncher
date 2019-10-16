import {Geometry, LineBasicMaterial, Line, Object3D, Vector3} from "three"
import {ChatSnake} from "./ranchdata"
import {loc2vec} from "./ranchutil"

export function createChatSnake (snake :ChatSnake) :Object3D {
  const geom = new Geometry()
  geom.vertices.push(loc2vec(snake)) // head
  for (let ii = 0; ii < snake.points.length; ii += 3) {
    geom.vertices.push(new Vector3(snake.points[ii], snake.points[ii + 1], snake.points[ii + 2]))
  }
  //console.log("Created snoot booper with " + geom.vertices.length + " vertices.")
  const mat = new LineBasicMaterial({color: 0xEEEE22})
  return new Line(geom, mat)
}
