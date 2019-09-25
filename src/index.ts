import {App} from "./app"
import {RanchMode} from "./ranchmode"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
window.onunload = () => app.dispose()
app.start()
app.setMode(new RanchMode(app))
