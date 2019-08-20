import {
  AnimationMixer,
  Object3D,
  Quaternion,
  Vector3,
  WebGLRenderer,
} from "three"

import {Body} from "cannon"

import {Clock} from "tfw/core/clock"
import {Hand} from "tfw/input/hand"
import {DenseValueComponent, Domain} from "tfw/entity/entity"
import {TransformComponent} from "tfw/space/entity"
import {AnimationSystem, SceneSystem} from "tfw/scene3/entity"
import {Host3} from "tfw/ui/host3"

import {App, Mode} from "./app"
import {RanchModel} from "./moncher"


export class RanchMode extends Mode
{
  constructor (
    app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    const webGlRenderer = this._webGlRenderer = new WebGLRenderer()
    webGlRenderer.gammaOutput = true
    webGlRenderer.gammaFactor = 2.2
    this.onDispose.add(webGlRenderer)

    // replace the 2d canvas
    const root = app.renderer.canvas.parentElement as HTMLElement
    root.removeChild(app.renderer.canvas)
    root.appendChild(webGlRenderer.domElement)
    this.onDispose.add(app.renderer.size.onValue(size => {
      webGlRenderer.setPixelRatio(window.devicePixelRatio)
      webGlRenderer.setSize(size[0], size[1])
    }))
    // set up a dispose to restore the 2d canvas
    this.onDispose.add(() => {
      root.removeChild(webGlRenderer.domElement)
      root.appendChild(app.renderer.canvas)
    })

    const host = this._host = new Host3()
    this.onDispose.add(host.bind(webGlRenderer.domElement))
    this.onDispose.add(host)

    const hand = this._hand = new Hand(webGlRenderer.domElement)
    this.onDispose.add(hand)

    const trans = new TransformComponent("trans")
    const obj = new DenseValueComponent<Object3D>("obj", new Object3D())
    const mixer = new DenseValueComponent<AnimationMixer>("mixer",
        new AnimationMixer(new Object3D()))
    const body = new DenseValueComponent<Body>("body", new Body())

    const domain = new Domain({}, {trans, obj, mixer, body})
    const scenesys = this._scenesys = new SceneSystem(
        domain, trans, obj, undefined, hand.pointers)
    scenesys.scene.add(host.group)

    /*const animsys =*/ this._animsys = new AnimationSystem(domain, obj, mixer)

    // add lights and camera
    domain.add({
      components: {
        trans: {initial: new Float32Array([0, 3, 0, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "perspectiveCamera"},
      },
    })
    domain.add({
      components: {
        trans: {},
        obj: {type: "ambientLight", color: 0x202020},
      },
    })
    domain.add({
      components: {
        trans: {initial: new Float32Array([1, 1, 1, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "directionalLight"},
      },
    })

    // add plane terrain (from spain; rainy)
    const terrainId = domain.add({
      components: {
        trans: {},
        obj: {
          type: "mesh",
          geometry: {type: "planeBuffer"},
          material: {type: "toon", color: "#60c060"},
        },
        body: {shapes: [{type: "plane"}]},
      },
    })
    trans.updateQuaternion(terrainId, new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      -Math.PI/2.
    ))
  }

  render (clock :Clock) :void {
    this._hand.update()
    this._host.update(clock)
    this._animsys.update(clock)
    this._scenesys.render(this._webGlRenderer)
  }

  protected _host :Host3
  protected _webGlRenderer :WebGLRenderer
  protected _hand :Hand
  protected _scenesys :SceneSystem
  protected _animsys :AnimationSystem
}
