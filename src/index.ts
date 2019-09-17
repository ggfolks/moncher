import {App} from "./app"
import {RanchModel} from "./moncher"
import {RanchMode} from "./moncher3d"
//import {Vector3} from "three"
//import {MonsterDb} from "./monsterdb"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
window.onunload = () => app.dispose()
app.start()

const ranch :RanchModel = new RanchModel()
const mode :RanchMode = new RanchMode(app, ranch)
app.setMode(mode)

// add a sample monster
//ranch.addActor(MonsterDb.getRandomEgg(), new Vector3(2, -.25, 0)) // y is approximate

// Tick the ranch model. Using the app clock will "Freeze" the sim when we're offscreen
let nextTime = 0
app.loop.clock.onEmit(clock => {
  while (clock.elapsed > nextTime) {
    ranch.tick(1000)
    nextTime += 1 // elapsed is in seconds
  }
})
