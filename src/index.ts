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

setInterval(() => { ranch.tick(1000) }, 1000)
