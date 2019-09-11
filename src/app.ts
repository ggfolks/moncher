import {Disposable, Disposer} from "tfw/core/util"
import {dim2} from "tfw/core/math"
import {UUID, uuidv1} from "tfw/core/uuid"
import {Clock, Loop} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {Mutable, Subject} from "tfw/core/react"
import {Renderer, windowSize} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {UniformQuadBatch} from "tfw/scene2/batch"
import {Client} from "tfw/data/client"
import {UI} from "tfw/ui/ui"

import {ProfileStore} from "./stores"
import {moncherStyles, moncherTheme} from "./uistyles"

// TODO: firebase auth stuff
const auth = {id: uuidv1(), token: "guest"}
const host = window.location.hostname
const port = host === "localhost" ? 8080 : parseInt(window.location.port || "443")
const addr = {host, port, path: "data"}

export class App implements Disposable {
  private mode :Mode

  readonly renderer :Renderer
  readonly loop  = new Loop()
  readonly ui = new UI(moncherTheme, moncherStyles, {resolve: loadImage})
  readonly client = new Client(p => Subject.constant(addr), auth)
  readonly profiles :ProfileStore

  // global app "state"
  readonly state = {
    // TODO: eventually we'll get the ranch id from the URL, but for now we just hardcode one
    ranchId: Mutable.local<UUID>("5cXg8Tp5WwsuVeO7JflubY"),
  }

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
    this.profiles = new ProfileStore(this)
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
