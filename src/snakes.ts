//import {log} from "tfw/core/util"
import {Geometry, LineBasicMaterial, Line, Object3D} from "three"
import {ChatSnake} from "./ranchdata"
import {loc2vec} from "./ranchutil"

const Y_PAD = .2

export function createChatSnake (snake :ChatSnake) :Object3D {
  const geom = new Geometry()
  for (const loc of snake.points) {
    const node = loc2vec(loc)
    node.y += Y_PAD
    geom.vertices.push(node)
  }
  //console.log("Created snoot booper with " + geom.vertices.length + " vertices.")
  const mat = new LineBasicMaterial({color: 0xEEEE22})
  return new Line(geom, mat)
}
