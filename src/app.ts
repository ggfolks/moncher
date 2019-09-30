import * as firebase from "firebase/app"

import {Disposable, Disposer} from "tfw/core/util"
import {dim2} from "tfw/core/math"
import {uuidv1} from "tfw/core/uuid"
import {Clock, Loop} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {Subject, Value} from "tfw/core/react"
import {Renderer, windowSize} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {UniformQuadBatch} from "tfw/scene2/batch"
import {Client, addrFromLocation} from "tfw/data/client"
import {UI} from "tfw/ui/ui"
import {initFirebaseAuth, currentUser} from "tfw/auth/firebase"

import {ProfileStore, UserStore} from "./stores"
import {moncherStyles, moncherTheme} from "./uistyles"

firebase.initializeApp({
  apiKey: "AIzaSyBqGwobKx4ReOufFpoQcKD8qv_jY4lgRSk",
  authDomain: "tfwchat.firebaseapp.com",
  projectId: "tfwchat",
  appId: "1:733313051370:web:ef572661b45a730f8d8593"
})

const stripTrailSlash = (url :string) => url.endsWith("/") ? url.substring(0, url.length-1) : url
const ranchFocusR = /^([A-Za-z0-9]{22})(\+([A-Za-z0-9]{22}))?$/
function parseLocation () :[string, string, string|undefined] {
  const path = window.location.pathname
  if (path) {
    const lastSlash = path.lastIndexOf("/")
    if (lastSlash >= 0) {
      const match = path.substring(lastSlash+1).match(ranchFocusR)
      if (match) return [path.substring(0, lastSlash), match[1], match[3]]
    }
  }
  const query = window.location.search
  if (query) {
    const match = query.substring(1).match(ranchFocusR)
    if (match) return [stripTrailSlash(path), match[1], match[3]]
  }
  return [stripTrailSlash(path), "", undefined]
}
const [appPath, ranchId, focusId] = parseLocation()

// if we have no ranch id, redirect to one
if (ranchId === "") {
  if (window.location.hostname === "localhost") {
    // on localhost, make up a unique ranchid for this developer/browser
    let ranchId = localStorage.getItem("ranchid")
    if (!ranchId) localStorage.setItem("ranchid", ranchId = uuidv1())
    window.location.search = ranchId
  } else {
    window.location.pathname = `${appPath}/5cXg8Tp5WwsuVeO7JflubY`
  }
}

export class App implements Disposable {
  private mode :Mode

  readonly renderer :Renderer
  readonly loop  = new Loop()
  readonly ui = new UI(moncherTheme, moncherStyles, {resolve: loadImage})
  readonly client = new Client(p => Subject.constant(addrFromLocation("data")))
  readonly profiles = new ProfileStore(this)
  readonly user = new UserStore(this)

  // global app "state"
  readonly state = {
    appPath: appPath.endsWith("/") ? appPath : `${appPath}/`,
    ranchId,
    focusId,
  }

  /** A value that is true when we're authed as a real user. */
  readonly notGuest = Value.join2(this.client.auth, this.client.serverAuth).map(
    ([sess, sid]) => sess.source !== "guest" && sess.id === sid)

  constructor (readonly root :HTMLElement) {
    this.renderer = new Renderer({
      // kind of a hack: when the window size changes, we emit an update with our div size
      // browsers don't emit resize events for arbitrary divs (there's apparently a proposal, yay)
      size: windowSize(window).map(size => dim2.set(size, root.clientWidth, root.clientHeight)),
      scaleFactor: window.devicePixelRatio,
      gl: {alpha: false}
    })
    root.appendChild(this.renderer.canvas)

    this.mode = new BlankMode(this)
    this.loop = new Loop()
    this.loop.clock.onEmit(clock => this.mode.render(clock))

    // when we're authed as a Google user, slurp our profile info
    this.client.serverAuth.onValue(id => {
      if (this.client.auth.current.source === "firebase") {
        const user = currentUser.current
        if (user) {
          const {displayName, photoURL} = user
          const profile = this.profiles.profile(id)
          if (displayName) profile.name.update(displayName)
          if (photoURL) profile.photo.update(photoURL)
          profile.type.update(1) // person
        }
      }
    })

    initFirebaseAuth()
  }

  start () {
    this.loop.start()
  }

  setMode (mode :Mode) {
    this.mode.dispose()
    this.mode = mode
  }

  dispose () {
    this.client.dispose()
  }
}

export abstract class Mode implements Disposable {
  protected onDispose = new Disposer()

  abstract render (clock :Clock) :void

  dispose () {
    this.onDispose.dispose()
  }
}

export abstract class SurfaceMode extends Mode {
  readonly batch :UniformQuadBatch
  readonly surf :Surface

  constructor (app :App) {
    super()
    this.onDispose.add(this.batch = new UniformQuadBatch(app.renderer.glc))
    this.surf = new Surface(app.renderer.target, this.batch)
  }

  render (clock :Clock) {
    const surf = this.surf
    surf.begin()
    this.renderTo(clock, surf)
    surf.end()
  }

  abstract renderTo (clock :Clock, surf :Surface) :void
}

class BlankMode extends SurfaceMode {
  renderTo (clock :Clock, surf :Surface) {
    surf.clearTo(0.25, 0.5, 1, 1)
  }
}
