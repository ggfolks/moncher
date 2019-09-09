// Pathfinding needs THREE to be a global
import * as threejs from "three"
window["THREE"] = threejs

import {App} from "./app"
import {RanchModel} from "./moncher"
import {RanchMode} from "./moncher3d"
//import {Vector3} from "three"
//import {MonsterDb} from "./monsterdb"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
app.start()

const ranch :RanchModel = new RanchModel()
const mode :RanchMode = new RanchMode(app, ranch)
app.setMode(mode)

// add a sample monster
//ranch.addActor(MonsterDb.getRandomEgg(), new Vector3(2, -.25, 0)) // y is approximate


// Tick the ranch model. We could just use an interval but this will "Freeze" us when
// we're offscreen
let lastTime = 0
const updateFrame = (time :number) => {
  const delta = time - lastTime
  if (delta > 1000) {
    lastTime = time
    ranch.tick(1000)
  }
  requestAnimationFrame(updateFrame)
}
requestAnimationFrame(updateFrame)
