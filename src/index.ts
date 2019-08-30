import * as threejs from "three"
window["THREE"] = threejs

import {App} from "./app"
import {RanchModel} from "./moncher"
import {RanchMode} from "./moncher3d"
//import {MonsterDb} from "./monsterdb"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
app.start()

let ranch :RanchModel = new RanchModel()

// add sample monsters at the 4 corners
//ranch.addActor(MonsterDb.getRandomEgg(), 0, 0)
//ranch.addActor(MonsterDb.getRandomEgg(), 1, 0)
//ranch.addActor(MonsterDb.getRandomEgg(), 0, 1)
//ranch.addActor(MonsterDb.getRandomEgg(), 1, 1)

app.setMode(new RanchMode(app, ranch))

setInterval(() => { ranch.tick() }, 1000)
