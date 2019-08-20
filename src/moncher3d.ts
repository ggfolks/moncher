import {
  AnimationMixer,
  Color,
  Math as ThreeMath,
  Object3D,
  Quaternion,
  Vector3,
  WebGLRenderer,
} from "three"

import {Body} from "cannon"

import {Clock} from "tfw/core/clock"
import {MapChange} from "tfw/core/rcollect"
import {Hand} from "tfw/input/hand"
import {DenseValueComponent, Domain} from "tfw/entity/entity"
import {TransformComponent} from "tfw/space/entity"
import {AnimationSystem, SceneSystem} from "tfw/scene3/entity"
import {Host3} from "tfw/ui/host3"

import {App, Mode} from "./app"
import {MonsterConfig, MonsterState, RanchModel} from "./moncher"

class ActorInfo
{
  constructor (
    /** The id from the RanchModel. */
    readonly id :number,
    /** The id in the entity system. */
    readonly entityId :number,
    readonly config :MonsterConfig,
  ) {}
}

export class RanchMode extends Mode
{
  constructor (
    app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    this.configureScene(app)

    this.onDispose.add(_ranch.monsters.onChange(this._monsterChange))
    _ranch.monsters.forEach((monster, id) => { this.updateMonster(id, monster) })
  }

  protected configureScene (app :App) :void {
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

    const trans = this._trans = new TransformComponent("trans")
    const obj = new DenseValueComponent<Object3D>("obj", new Object3D())
    const mixer = new DenseValueComponent<AnimationMixer>("mixer",
        new AnimationMixer(new Object3D()))
    const body = new DenseValueComponent<Body>("body", new Body())

    const domain = this._domain = new Domain({}, {trans, obj, mixer, body})
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
          material: {type: "toon", color: 0x60c060},
        },
        body: {shapes: [{type: "plane"}]},
      },
    })
    trans.updateQuaternion(terrainId, new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0), -Math.PI/2))
    trans.updateScale(terrainId, new Vector3(100, 100, 100))

    // temp: add a sphere
    const origin = new Vector3(0, 3, -10)
    const position = new Vector3()
    const boxId = domain.add({
      components: {
        trans: {},
        obj: {
          type: "mesh",
          geometry: {type: "sphereBuffer"},
          material: {type: "toon", color: new Color().setHSL(Math.random(), 1.0, 0.6)},
        },
        body: {shapes: [{type: "sphere"}], mass: 1},
      },
    })
    position.set(
      origin.x + ThreeMath.randFloat(-2, 2),
      origin.y + ThreeMath.randFloat(-2, 2),
      origin.z + ThreeMath.randFloat(-2, 2),
    )
    trans.updatePosition(boxId, position)

  }

  render (clock :Clock) :void {
    this._hand.update()
    this._host.update(clock)
    this._animsys.update(clock)
    this._scenesys.render(this._webGlRenderer)
  }

  /**
   * React to a monster being added to the ranch model.
   */
  protected updateMonster (id :number, state :MonsterState) :void {
    // see if we've given this monster an entity ID yet
    let actorInfo = this._monsters.get(id)
    if (!actorInfo) {
      const cfg = this._ranch.monsterConfig.get(id)
      if (!cfg) {
        throw new Error("Monster doesn't have a config in the RanchModel")
      }
      if (!cfg.model) {
        throw new Error("Monster doesn't have 3d model configuration")
      }
      const entityId = this._domain.add({
        components: {
          trans: {initial: new Float32Array([state.x, 0, -state.y, 0, 0, 0, 1, 1, 1, 1])},
          obj: {type: "gltf", url: cfg.model.model},
          mixer: {},
        },
      })
      actorInfo = new ActorInfo(id, entityId, cfg)
      this._monsters.set(id, actorInfo)
    }

    this.updateMonsterActor(actorInfo, state)
  }

  /**
   * Effect updates received from the RanchModel.
   */
  protected updateMonsterActor (actorInfo :ActorInfo, state :MonsterState) :void {
    let pos = new Vector3(state.x, 0, -state.y)
    this._trans.updatePosition(actorInfo.entityId, pos)
    // TODO more here brah
  }

  /**
   * React to a monster being removed from the ranch model.
   */
  protected deleteMonster (id :number) :void {
    const actorInfo = this._monsters.get(id)
    if (!actorInfo) return
    this._monsters.delete(id)
    this._domain.delete(actorInfo.entityId)
  }

  // The properties below are all definitely initialized via the constructor
  protected _host! :Host3
  protected _webGlRenderer! :WebGLRenderer
  protected _hand! :Hand
  protected _trans! :TransformComponent
  protected _scenesys! :SceneSystem
  protected _animsys! :AnimationSystem
  protected _domain! :Domain

  protected readonly _monsters :Map<number, ActorInfo> = new Map()

  protected readonly _monsterChange = (change :MapChange<number, MonsterState>) => {
    if (change.type === "set") {
      this.updateMonster(change.key, change.value)
    } else {
      this.deleteMonster(change.key)
    }
  }
}
