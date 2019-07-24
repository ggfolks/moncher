import {Disposable, Disposer} from "tfw/core/util"
import {Clock, Loop} from "tfw/core/clock"
import {Renderer, windowSize} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {UniformQuadBatch} from "tfw/scene2/batch"
import {dim2} from "tfw/core/math"

export class App {
  readonly renderer :Renderer
  readonly loop  = new Loop()
  private mode! :Mode

  constructor (readonly root :HTMLElement) {
    this.renderer = new Renderer({
      // kind of a hack: when the window size changes, we emit an update with our div size;
      // browsers don't emit resize events for arbitrary divs (there's apparently a proposal, yay)
      size: windowSize(window).map(size => dim2.set(size, root.clientWidth, root.clientHeight)),
      scaleFactor: window.devicePixelRatio,
      gl: {alpha: false}
    })
    root.appendChild(this.renderer.canvas)

    this.mode = new BlankMode(this)
    this.loop = new Loop()
    this.loop.clock.onEmit(clock => this.mode.render(clock))
  }

  start () {
    this.loop.start()
  }

  setMode (mode :Mode) {
    this.mode.dispose()
    this.mode = mode
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
