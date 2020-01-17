import * as firebase from "firebase/app"

import {Disposable, Disposer} from "tfw/core/util"
import {Scale, windowSize} from "tfw/core/ui"
import {dim2, rect, vec2zero} from "tfw/core/math"
import {uuidv1} from "tfw/core/uuid"
import {Clock, Loop} from "tfw/core/clock"
import {Value} from "tfw/core/react"
import {ResourceLoader} from "tfw/asset/loader"
import {Renderer} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {QuadBatch, UniformQuadBatch} from "tfw/scene2/batch"
import {ChannelClient} from "tfw/channel/client"
import {ClientStore, addrFromLocation} from "tfw/data/client"
import {InteractionManager} from "tfw/input/interact"
import {HTMLHost} from "tfw/ui/element"
import {UI} from "tfw/ui/ui"
import {currentUser} from "tfw/auth/firebase"

import {ChatDirector} from "./chatdirector"
import {ProfileStore, UserStore} from "./stores"
import {moncherStyles, moncherTheme} from "./uistyles"

firebase.initializeApp({
  apiKey: "AIzaSyBqGwobKx4ReOufFpoQcKD8qv_jY4lgRSk",
  authDomain: "tfwchat.firebaseapp.com",
  projectId: "tfwchat",
  appId: "1:733313051370:web:ef572661b45a730f8d8593"
})

const stripTrailSlash = (url :string) => url.endsWith("/") ? url.substring(0, url.length-1) : url
const ranchFocusR = /^([A-Za-z0-9]{20,22})(\+([A-Za-z0-9]{20,22}))?$/
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
} else if (window.location.hostname === "localhost") {
  // store this ranchId
  localStorage.setItem("ranchid", ranchId)
}

export class App implements Disposable {
  private mode :Mode

  readonly rootSize :Value<dim2>
  readonly rootBounds :Value<rect>
  readonly scale = new Scale(window.devicePixelRatio)
  readonly loop = new Loop()

  readonly interact = new InteractionManager()
  readonly loader :ResourceLoader
  readonly ui :UI
  readonly host :HTMLHost

  readonly client = new ChannelClient({serverUrl: addrFromLocation("data")})
  readonly store = new ClientStore(this.client)
  readonly profiles = new ProfileStore(this)
  readonly user = new UserStore(this)
  readonly chatdir = new ChatDirector(this)

  // global app "state"
  readonly state = {
    appPath: appPath.endsWith("/") ? appPath : `${appPath}/`,
    ranchId,
    focusId,
  }

  /** A value that is true when we're authed as a real user. */
  readonly notGuest = Value.join2(this.client.auth, this.client.manager.ackedId).map(
    ([sess, sid]) => sess.source !== "guest" && sess.id === sid)

  constructor (readonly root :HTMLElement) {
    // kind of a hack: when the window size changes, we emit an update with our div size
    // browsers don't emit resize events for arbitrary divs (there's apparently a proposal, yay)
    this.rootSize = windowSize(window).map(
      size => dim2.set(size, root.clientWidth, root.clientHeight))
    this.rootBounds = this.rootSize.map(size => rect.fromPosSize(vec2zero, size))

    this.loader = ResourceLoader.fetchLoader(appPath)
    this.ui = new UI(moncherTheme, moncherStyles, this.loader)
    this.host = new HTMLHost(root, this.interact)
    this.mode = new Mode(this)

    this.loop.clock.onEmit(clock => {
      this.host.update(clock)
      this.mode.render(clock)
    })

    // when we're authed as a Google user, slurp our profile info
    Value.join3(this.client.manager.ackedId, this.client.auth, currentUser).onValue(
      ([id, auth, user]) => {
        if (auth.source === "firebase" && auth.id === id && user) {
          const {displayName, photoURL} = user
          const profile = this.profiles.profile(id)
          if (displayName) profile.name.update(displayName)
          if (photoURL) profile.photo.update(photoURL)
          profile.type.update(1) // person
        }
      })
  }

  start () {
    this.loop.start()
  }

  setMode (mode :Mode) {
    this.mode.dispose()
    this.mode = mode
  }

  dispose () {
    this.store.dispose()
    this.client.dispose()
  }
}

export class Mode implements Disposable {
  protected onDispose = new Disposer()

  constructor (readonly app :App) {}

  render (clock :Clock) {}

  dispose () { this.onDispose.dispose() }
}

export abstract class Scene2Mode extends Mode {
  readonly renderer :Renderer

  constructor (app :App) {
    super(app)
    const root = app.root
    const renderer = this.renderer = new Renderer({
      size: app.rootSize,
      scaleFactor: app.scale.factor,
      gl: {alpha: false}
    })
    this.onDispose.add(renderer)
    root.appendChild(renderer.canvas)
    this.onDispose.add(app.rootBounds.onValue(bounds => {
      renderer.canvas.style.position = "absolute"
      renderer.canvas.style.left = `${bounds[0]}px`
      renderer.canvas.style.top = `${bounds[1]}px`
    }))
  }

  dispose () {
    super.dispose()
    this.app.root.removeChild(this.renderer.canvas)
  }
}

export abstract class BatchMode extends Scene2Mode {
  readonly batch :UniformQuadBatch

  constructor (app :App) {
    super(app)
    this.onDispose.add(this.batch = new UniformQuadBatch(this.renderer))
  }

  render (clock :Clock) {
    const batch = this.batch, target = this.renderer.target
    target.bind()
    batch.begin(target.size, target.flip)
    this.renderTo(clock, batch)
    batch.end()
  }

  abstract renderTo (clock :Clock, batch :QuadBatch) :void
}

export abstract class SurfaceMode extends Scene2Mode {
  readonly batch :UniformQuadBatch
  readonly surf :Surface

  constructor (app :App) {
    super(app)
    this.onDispose.add(this.batch = new UniformQuadBatch(this.renderer))
    this.surf = new Surface(this.renderer.target, this.batch)
  }

  render (clock :Clock) {
    const surf = this.surf
    surf.begin()
    this.renderTo(clock, surf)
    surf.end()
  }

  abstract renderTo (clock :Clock, surf :Surface) :void
}
