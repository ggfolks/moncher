import {
  AnimationMixer,
  Camera,
//  Color,
//  Math as ThreeMath,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"

import {Body} from "cannon"

import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {MapChange} from "tfw/core/rcollect"
import {Mutable} from "tfw/core/react"
import {log} from "tfw/core/util"
import {Hand, Pointer} from "tfw/input/hand"
import {
  Component,
  DenseValueComponent,
  Domain,
  GraphSystem,
  ID,
  Matcher,
  SparseValueComponent,
  System,
} from "tfw/entity/entity"
import {TransformComponent} from "tfw/space/entity"
import {AnimationSystem, HoverMap, SceneSystem} from "tfw/scene3/entity"
import {Host3} from "tfw/ui/host3"

import {registerLogicNodes} from "tfw/graph/logic"
import {registerMathNodes} from "tfw/graph/math"
import {registerUtilNodes} from "tfw/graph/util"
import {registerEntityNodes} from "tfw/entity/node"
import {registerSpaceNodes} from "tfw/space/node"
import {registerScene3Nodes} from "tfw/scene3/node"
import {registerPhysics3Nodes} from "tfw/physics3/node"
import {registerInputNodes} from "tfw/input/node"
import {registerUINodes} from "tfw/ui/node"
import {Graph, GraphConfig} from "tfw/graph/graph"
import {NodeConfig, NodeContext, NodeTypeRegistry} from "tfw/graph/node"

import {App, Mode} from "./app"
import {
  MonsterAction,
  MonsterConfig,
  MonsterKind,
  MonsterModel,
  MonsterState,
  RanchModel,
} from "./moncher"
import {Hud} from "./hud"

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

class LerpRec
{
  constructor (
    /** The source location. */
    readonly src :Vector3,
    /** The destination location. */
    public dest :Vector3,
    /** How long shall we take? (TODO: compute based on speed / distance?) */
    readonly duration :number,
    /** Ending timestamp (start time + duration) (filled-in by LerpSystem) */
    public stamp? :number
  ) {}
}

class LerpSystem extends System
{
  constructor (
    domain :Domain,
    readonly trans :TransformComponent,
    readonly lerp :Component<LerpRec|undefined>,
    readonly getY :(x :number, z :number) => number,
  ) {
    super(domain, Matcher.hasAllC(trans.id, lerp.id))
  }

  update (clock :Clock) {
    const pos :Vector3 = new Vector3()
    this.onEntities(id => {
      const lerpRec = this.lerp.read(id)
      if (lerpRec) {
        if (!lerpRec.stamp) {
          // calculate the end time for the walk
          lerpRec.stamp = clock.time + lerpRec.duration
          // calculate the direction
          const subbed = new Vector3().subVectors(lerpRec.dest, lerpRec.src)
          subbed.y = 0
          this.trans.updateQuaternion(id,
              new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), subbed.normalize()))
        }
        const timeLeft = lerpRec.stamp - clock.time
        if (timeLeft <= 0) {
          this.trans.updatePosition(id, lerpRec.dest)
          this.lerp.update(id, undefined)
          this.trans.updateQuaternion(id, new Quaternion())
        } else {
          pos.lerpVectors(lerpRec.dest, lerpRec.src, timeLeft / lerpRec.duration)
          // but override the Y value according to terrain?
          pos.y = this.getY(pos.x, pos.z)
          this.trans.updatePosition(id, pos)
        }
      }
    })
  }
}

enum UiState
{
  Default,
  PlacingEgg,
}

const vec3NearlyEqual = (a :Vector3, b :Vector3) => {
  const epsilon = .0001
  return (Math.abs(a.x - b.x) < epsilon) &&
    (Math.abs(a.y - b.y) < epsilon) &&
    (Math.abs(a.z - b.z) < epsilon)
}

export class RanchMode extends Mode
{
  constructor (
    app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    this.configureScene(app)

    this.onDispose.add(_ranch.monsters.onChange(this._monsterChanged))
    _ranch.monsters.forEach((monster, id) => { this.updateMonster(id, monster) })

    this.onDispose.add(this._hud = new Hud(this._host, app.renderer))
    this.setUiState(UiState.Default)
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
    this.onDispose.add(hand.pointers.onChange(this._handChanged))

    // TODO: what is the minimum we need?
    const nodeCtx :NodeContext = {
      types: new NodeTypeRegistry(
        registerLogicNodes,
        registerMathNodes,
        registerUtilNodes,
        registerEntityNodes,
        registerSpaceNodes,
        registerScene3Nodes,
        registerPhysics3Nodes,
        registerInputNodes,
        registerUINodes,
      ),
      hand,
      host,
    }

    const trans = this._trans = new TransformComponent("trans")
    const obj = this._obj = new DenseValueComponent<Object3D>("obj", new Object3D())
    const mixer = new DenseValueComponent<AnimationMixer>("mixer",
        new AnimationMixer(new Object3D()))
    const body = new DenseValueComponent<Body>("body", new Body())
    // TODO: action could potentially be replaced by the whole MonsterState, but perhaps
    // we even have a bigger record and subsume the lerp record.
    const action = this._action =
        new DenseValueComponent<MonsterAction>("action", MonsterAction.None)
    const hovers = new SparseValueComponent<HoverMap>("hovers", new Map())
    const lerp = this._lerp = new SparseValueComponent<LerpRec|undefined>("lerp", undefined)
    const graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))

    const domain = this._domain = new Domain({},
        {trans, obj, mixer, body, action, lerp, hovers, graph})
    /*const lerpsys =*/ this._lerpsys = new LerpSystem(domain, trans, lerp, this.getY.bind(this))
    const scenesys = this._scenesys = new SceneSystem(
        domain, trans, obj, hovers, hand.pointers)
    /*const graphsys =*/ this._graphsys = new GraphSystem(nodeCtx, domain, graph)
    scenesys.scene.add(host.group)

    /*const animsys =*/ this._animsys = new AnimationSystem(domain, obj, mixer)

    // add lights and camera
    const CAMERA_MOVEMENT_FACTOR = 80 // Hacky multiplication factor so we get noticeable movement
    const cameraHeight = Mutable.local(RanchMode.CAMERA_HEIGHT)
    const cameraId = this._cameraId = domain.add({
      components: {
        trans: {initial: new Float32Array(
            [0, RanchMode.CAMERA_HEIGHT, RanchMode.CAMERA_SETBACK, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "perspectiveCamera"},
        hovers: {},
        graph: {
          hover: {type: "hover", component: "hovers"},
          viewMovement: {type: "Vector3.split", input: ["hover", "viewMovement"]},
          xDelta: {type: "multiply",
              inputs: [["hover", "pressed"], ["viewMovement", "x"], -CAMERA_MOVEMENT_FACTOR]},
          yDelta: {type: "multiply",
              inputs: [["hover", "pressed"], ["viewMovement", "y"], CAMERA_MOVEMENT_FACTOR]},
          leftRight: {type: "accumulate", input: "xDelta"},
          upDown: {type: "accumulate", input: "yDelta"},
          upDownSetback: {type: "add", inputs: ["upDown", RanchMode.CAMERA_SETBACK]},
          panning: {type: "Vector3",
              x: "leftRight", y: cameraHeight, z: "upDownSetback"},
          updatePosition: {type: "updatePosition", component: "trans", input: "panning"}
        },
      },
    })
//    // HERE
//
//    const wheelHandler = (event :PointerEvent) => {
//
//    }
//    root.addEventListener("wheel", wheelHandler)
//    this.onDispose.add(() => root.removeEventListener("wheel", wheelHandler))

//    setInterval(() => {
//      log.debug("Camera position", "pos", trans.readPosition(cameraId, new Vector3()))
//    }, 1200)
    //console.log("GRuntle: " + cameraId + "/" + Quaternion)
    trans.updateQuaternion(cameraId, new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0), -Math.PI/5))
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

    // add the ranch terrain
    const ranchTerrainId = this._terrainId = domain.add({
      components: {
        trans: {},
        obj: {type: "gltf", url: "ranch/Ranch.glb"}, // Contains a "NavMesh" object. TODO
      },
    })
    trans.updateScale(ranchTerrainId, new Vector3(.5, .5, .5))
  }

  render (clock :Clock) :void {
    this._hand.update()
    this._host.update(clock)
    this._lerpsys.update(clock)
    this._animsys.update(clock)
    this._scenesys.update()
    this._scenesys.render(this._webGlRenderer)
  }

  /**
   * React to a monster being added to the ranch model.
   */
  protected updateMonster (id :number, state :MonsterState) :void {
    // see if we've given this monster an entity ID yet
    let actorInfo = this._monsters.get(id)
    if (!actorInfo) {
      actorInfo = this.addMonster(id, state)
    }
    this.updateMonsterActor(actorInfo, state)
  }

  /**
   * Effect updates received from the RanchModel.
   */
  protected updateMonsterActor (actorInfo :ActorInfo, state :MonsterState) :void {
    // store their action in the entity system...
    this._action.update(actorInfo.entityId, state.action)

    // then check their location against their LerpRec...
    const pos = new Vector3(state.x, this.getY(state.x, -state.y), -state.y)
    const oldRec = this._lerp.read(actorInfo.entityId)
    if (oldRec && vec3NearlyEqual(oldRec.dest, pos)) {
      // just update the position in the old record
      oldRec.dest = pos
      return
    }

    const oldPos = this._trans.readPosition(actorInfo.entityId, new Vector3())
    if (!oldRec && vec3NearlyEqual(pos, oldPos)) {
      // just update the translation and return
      this._trans.updatePosition(actorInfo.entityId, pos)
      return
    }
    const duration = (oldPos.distanceTo(pos) * 1000) / RanchMode.MONSTER_MOVE_DISTANCE_PER_SECOND
    const rec = new LerpRec(oldPos, pos, duration)
    this._lerp.update(actorInfo.entityId, rec)
  }

  protected addMonster (id :number, state :MonsterState) :ActorInfo
  {
    const cfg = this._ranch.monsterConfig.get(id)
    if (!cfg) {
      throw new Error("Monster doesn't have a config in the RanchModel")
    }
    if (!cfg.model) {
      throw new Error("Monster doesn't have 3d model configuration")
    }

    const graphCfg :GraphConfig = {}

    // add animation logic for animations we support
    if (cfg.model.hatch) {
      graphCfg.action = <NodeConfig>{
        type: "readComponent",
        component: "action",
      }
      graphCfg.isHatching = <NodeConfig>{
        type: "equals",
        x: "action",
        y: MonsterAction.Hatching,
      }
      graphCfg.hatch = <NodeConfig>{
        type: "AnimationAction",
        component: "mixer",
        url: cfg.model.hatch,
        play: "isHatching",
      }
    }

    if (cfg.model.walk) {
      graphCfg.readLerp = <NodeConfig>{
        type: "readComponent",
        component: "lerp",
      }
      graphCfg.noLerp = <NodeConfig>{
        type: "equals",
        x: "readLerp",
        y: undefined,
      }
      graphCfg.yesLerp = <NodeConfig>{
        type: "not",
        input: "noLerp",
      }
      graphCfg.walk = <NodeConfig>{
        type: "AnimationAction",
        component: "mixer",
        url: cfg.model.walk,
        play: "yesLerp",
      }
    }

    const entityId = this._domain.add({
      components: {
        trans: {initial: new Float32Array([state.x, this.getY(state.x, -state.y), -state.y,
            0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "gltf", url: cfg.model.model},
        action: {initial: state.action},
        mixer: {},
        lerp: {},
        graph: graphCfg,
      },
    })
    const actorInfo = new ActorInfo(id, entityId, cfg)
    this._monsters.set(id, actorInfo)
    return actorInfo
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

  protected getY (x :number, z :number) :number
  {
    const terrain = this._obj.read(this._terrainId)
    if (terrain) {
      const HAWK_HEIGHT = 10
      const caster = new Raycaster(new Vector3(x, HAWK_HEIGHT, z), new Vector3(0, -1, 0))
      const results = caster.intersectObject(terrain, true)
      for (const result of results) {
        return HAWK_HEIGHT - result.distance
      }
    }
    return 2.5 // bogus fallback height
  }

  protected setUiState (uiState :UiState) :void
  {
//    log.debug("Updating UI state: " + uiState)
    // probably some of this logic could move into the hud?
    this._uiState = uiState
    switch (uiState) {
    case UiState.Default:
      this._hud.actionButton.update("🥚") // egg
      this._hud.action.update(() => this.setUiState(UiState.PlacingEgg))
      this._hud.statusLabel.update("")
      break

    case UiState.PlacingEgg:
      this._hud.actionButton.update("Cancel")
      this._hud.action.update(() => this.setUiState(UiState.Default))
      this._hud.statusLabel.update("Place the egg")
      // TODO: stop normal scene panning? Or maybe you can pan and it always puts the egg
      // on your last touch and then there's a "hatch" button to confirm the placement.
      // For now, we unforgivingly hatch it on their first touch.
      break
    }
  }

  /**
   * Place an egg. */
  protected placeEgg (pos :vec2) :void
  {
    log.debug("Got egg placing request", "pos", pos)
    const terrain = this._obj.read(this._terrainId)!
    const caster = new Raycaster()
    const ndc = new Vector2(
        (pos[0] / window.innerWidth) * 2 - 1,
        (pos[1] / window.innerHeight) * -2 + 1)
    caster.setFromCamera(ndc, this._obj.read(this._cameraId) as Camera)
    for (const result of caster.intersectObject(terrain, true)) {
      // Freeze these?
      const monsterModel :MonsterModel = {
        model: "monsters/LobberBlue.glb",
        hatch: "monsters/LobberBlue.glb#Hatch",
        walk: "monsters/LobberBlue.glb#Walk",
        attack: "monsters/LobberBlue.glb#Attack",
      }
      const eggModel :MonsterModel = {
        model: "monsters/Egg.glb",
        hatch: "monsters/Egg.glb#Hatch",
      }

      const config :MonsterConfig = new MonsterConfig(undefined, monsterModel)
      const eggConfig :MonsterConfig = new MonsterConfig(undefined,
        eggModel, MonsterKind.EGG, config)

      this._ranch.addMonster(eggConfig, Math.round(result.point.x), Math.round(-result.point.z))
      this.setUiState(UiState.Default)
      return // stop after first result
    }
  }

  /** Our heads-up-display: global UI. */
  protected _hud :Hud

  protected _uiState :UiState = UiState.Default

  // The properties below are all definitely initialized via the constructor
  protected _host! :Host3
  protected _webGlRenderer! :WebGLRenderer
  protected _hand! :Hand
  protected _trans! :TransformComponent
  protected _obj! :Component<Object3D>
  protected _action! :Component<MonsterAction>
  protected _lerp! :Component<LerpRec|undefined>
  protected _graphsys! :GraphSystem
  protected _lerpsys! :LerpSystem
  protected _scenesys! :SceneSystem
  protected _animsys! :AnimationSystem
  protected _domain! :Domain

  protected _cameraId! :ID
  protected _terrainId! :ID

  protected readonly _monsters :Map<number, ActorInfo> = new Map()

  protected readonly _monsterChanged = (change :MapChange<number, MonsterState>) => {
    if (change.type === "set") {
      this.updateMonster(change.key, change.value)
    } else {
      this.deleteMonster(change.key)
    }
  }

  protected readonly _handChanged = (change :MapChange<number, Pointer>) => {
    if (this._uiState === UiState.PlacingEgg && change.type === "set" && change.value.pressed) {
      this.placeEgg(change.value.position)
    }
  }

  private static MONSTER_MOVE_DISTANCE_PER_SECOND = 0.8
  private static CAMERA_HEIGHT = 7 // starting y coordinate of camera
  private static CAMERA_SETBACK = 14 // starting z coordinate of camera
}
