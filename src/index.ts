import {App} from "./app"
import {RanchMode} from "./moncher"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
window.onunload = () => app.dispose()
app.start()

const mode :RanchMode = new RanchMode(app)
app.setMode(mode)
