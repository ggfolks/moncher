import {initFirebaseAuth} from "tfw/auth/firebase"
import {App} from "./app"
import {RanchMode} from "./ranchmode"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

// init firebase auth before creating our app; this loads cached credentials and enables us to
// reauth directly as our cached firebase user while asynchronously double checking that those
// credentials are still valid (if they're not valid, the server will also reject our cached creds,
// but if they are valid then this gets us into the server faster and without being a guest first)
initFirebaseAuth()

const app = new App(root)
window.onunload = () => app.dispose()
app.start()
app.setMode(new RanchMode(app))
