import {
//  AnimationAction,
  AnimationMixer,
  Camera,
//  Color,
//  Math as ThreeMath,
  Object3D,
  Mesh,
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
import {NodeConfig, NodeContext, NodeInput, NodeTypeRegistry} from "tfw/graph/node"

import {App, Mode} from "./app"
import {
  ActorAction,
  ActorConfig,
  ActorKind,
  ActorModel,
  ActorState,
  RanchModel,
} from "./moncher"
import {MonsterDb} from "./monsterdb"
import {Hud} from "./hud"

class ActorInfo
{
  constructor (
    /** The id from the RanchModel. */
    readonly id :number,
    /** The id in the entity system. */
    readonly entityId :number,
    readonly config :ActorConfig,
  ) {}
}

class LerpRec
{
  constructor (
    /** The source location. */
    readonly src :Vector3,
    /** The destination location. */
    public dest :Vector3,
    /** How long shall we take? */
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
          this.trans.updateQuaternion(id, new Quaternion()) // face forward
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
  PlacingFood,
}

/**
 * Vector3.epsilonEquals ?  */
function vec3NearlyEqual (a :Vector3, b :Vector3) :boolean {
  const epsilon = .0001
  return (Math.abs(a.x - b.x) < epsilon) &&
    (Math.abs(a.y - b.y) < epsilon) &&
    (Math.abs(a.z - b.z) < epsilon)
}

/**
 * Look for a descendant with the specified name; remove and return it. */
function spliceNamedChild (obj :Object3D, name :string) :Object3D|undefined {
  let result :Object3D|undefined = undefined
  for (let ii = 0; ii < obj.children.length; ii++) {
    const child = obj.children[ii]
    if (child.name === name) {
      obj.children.splice(ii, 1)
      return child
    }
    result = spliceNamedChild(child, name)
    if (result !== undefined) {
      return result
    }
  }
  return undefined
}

export class RanchMode extends Mode
{
  constructor (
    app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    this.configureScene(app)

    // But, let's set things to be ready after a short delay even if there's *trouble at the mill*
    // Dispatches to setReady() unless we've been disposed already, but setReady is idempotent.
    let handle :any
    const cancelTimeout = () => { clearTimeout(handle) }
    handle = setTimeout(() => { this.onDispose.remove(cancelTimeout); this.setReady() }, 2000)
    this.onDispose.add(cancelTimeout)

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
    const state = this._state =
        new DenseValueComponent<ActorState>("state",
          new ActorState(0, 0, ActorAction.None))
    const hovers = new SparseValueComponent<HoverMap>("hovers", new Map())
    const lerp = this._lerp = new SparseValueComponent<LerpRec|undefined>("lerp", undefined)
    const graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))

    const domain = this._domain = new Domain({},
        {trans, obj, mixer, body, state, lerp, hovers, graph})
    /*const lerpsys =*/ this._lerpsys = new LerpSystem(domain, trans, lerp, this.getY.bind(this))
    const scenesys = this._scenesys = new SceneSystem(
        domain, trans, obj, hovers, hand.pointers)
    /*const graphsys =*/ this._graphsys = new GraphSystem(nodeCtx, domain, graph)
    scenesys.scene.add(host.group)

    /*const animsys =*/ this._animsys = new AnimationSystem(domain, obj, mixer)

    // add lights and camera
    const CAMERA_MOVEMENT_FACTOR = 20 // Hacky multiplication factor so we get noticeable movement
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
    trans.updateQuaternion(cameraId, new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0), -Math.PI/5))

    // TEMP: set up mouse wheel to do a little camera Y adjustment
    const MIN_CAMERA = RanchMode.CAMERA_HEIGHT / 5
    const MAX_CAMERA = RanchMode.CAMERA_HEIGHT * 5
    const WHEEL_FACTOR = .05
    const wheelHandler = (event :WheelEvent) => {
      cameraHeight.update(Math.max(MIN_CAMERA, Math.min(MAX_CAMERA,
            cameraHeight.current + (event.deltaY * WHEEL_FACTOR))))
      // Possibly TODO: keep same point centered!
    }
    root.addEventListener("wheel", wheelHandler)
    this.onDispose.add(() => root.removeEventListener("wheel", wheelHandler))

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
        // TODO: rotate light, for day-night cycle? Can do with graph?
      },
    })

    // add the ranch terrain
    /*const ranchTerrainId =*/ this._terrainId = domain.add({
      components: {
        trans: {},
        obj: {type: "gltf", url: "ranch/Ranch.glb", onLoad: this.ranchLoaded.bind(this)},
        // TODO: have a graph here with hover ability, and a callback?
        // (Remove manual Hand listening)
      },
    })
  }

  render (clock :Clock) :void {
    this._hand.update()
    this._host.update(clock)
    this._lerpsys.update(clock)
    this._animsys.update(clock)
    this._scenesys.update()
    this._scenesys.render(this._webGlRenderer)
  }

  protected ranchLoaded (scene :Object3D) :Object3D|undefined {
    const navMesh = spliceNamedChild(scene, "NavMesh")
    if (navMesh instanceof Mesh) {
      navMesh.geometry.computeBoundingBox()
      const box = navMesh.geometry.boundingBox
      log.info("Got the navmesh", "box", box)
      this._minX = box.min.x
      this._extentX = box.max.x - box.min.x
      this._minZ = box.min.z
      this._extentZ = box.max.z - box.min.z
      this.setReady()
    }
    return undefined
  }

  /**
   * Called once we know enough to start adding actors. */
  protected setReady () :void
  {
    if (this._ready) return
    this._ready = true

    this.onDispose.add(this._ranch.actors.onChange(this._actorChanged))
    this._ranch.actors.forEach((actor, id) => { this.updateActor(id, actor) })
  }

  /**
   * React to a actor being updated in the ranch model.
   */
  protected updateActor (id :number, state :ActorState) :void {
//    log.info("updateMonster",
//      "id", id, "action", state.action)
    // see if we've given this monster an entity ID yet
    let actorInfo = this._actors.get(id)
    if (!actorInfo) {
      actorInfo = this.addActor(id, state)
//      log.info("ADDING monster",
//        "id", id,
//        "entityId", actorInfo.entityId,
//        "egg?", (actorInfo.config.kind === ActorKind.EGG))
    }
    this.updateActorSprite(actorInfo, state)
  }

  /**
   * Effect updates received from the RanchModel.
   */
  protected updateActorSprite (actorInfo :ActorInfo, state :ActorState) :void {
    // store their state in the entity system...
    this._state.update(actorInfo.entityId, state)

    // then check their location against their LerpRec...
    const pos = this.location2to3(state.x, state.y)
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
    const duration = (oldPos.distanceTo(pos) * 1000) / RanchMode.ACTOR_MOVE_DISTANCE_PER_SECOND
    const rec = new LerpRec(oldPos, pos, duration)
    this._lerp.update(actorInfo.entityId, rec)
  }

  protected addActor (id :number, state :ActorState) :ActorInfo
  {
    const cfg = this._ranch.actorConfig.get(id)
    if (!cfg) {
      throw new Error("Actor doesn't have a config in the RanchModel")
    }
    if (!cfg.model) {
      throw new Error("Actor doesn't have 3d model configuration")
    }

    const graphCfg :GraphConfig = {}
    const animation = (url :string, play :NodeInput<boolean>, reps? :number, clamp? :boolean) => {
      const cfg :NodeConfig = {
        type: "animationAction",
        component: "mixer",
        url: url,
        play: play,
      }
      if (reps) cfg.repetitions = reps
      if (clamp !== undefined) cfg.clampWhenFinished = clamp
//      // experimental: vary the speed of the animation slightly
//      cfg.onLoad = (action :AnimationAction) => {
//        action.timeScale = 1 + ((Math.random() - .5) / 5)
//      }
      return cfg
    }

    // add animation logic for animations we support
    if (cfg.model.hatch) {
      graphCfg.state = <NodeConfig>{
        type: "readComponent",
        component: "state",
      }
      graphCfg.action = <NodeConfig>{
        type: "property",
        input: "state",
        name: "action",
      }
      graphCfg.isHatching = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.Hatching,
      }
      const isEgg :boolean = (cfg.kind === ActorKind.EGG)
      graphCfg.hatch = animation(cfg.model.hatch, "isHatching", 1, isEgg)
      graphCfg.notHatching = <NodeConfig>{type: "not", input: "isHatching"}

      if (isEgg) {
        if (cfg.model.idle) {
          graphCfg.idle = animation(cfg.model.idle, "notHatching")
        }

        graphCfg.notFinishedHatching = <NodeConfig>{
          type: "not",
          input: "hatch",
        }
        graphCfg.setInvisible = <NodeConfig>{
          type: "updateVisible",
          component: "obj",
          input: "notFinishedHatching",
        }
//        graphCfg.logVisible = <NodeConfig>{
//          type: "log",
//          message: "updateVisible",
//          input: "notFinishedHatching",
//        }
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
      graphCfg.walk = animation(cfg.model.walk, "yesLerp")

      if (cfg.model.idle && cfg.kind !== ActorKind.EGG) {
        let idleInput = "noLerp"
        if (cfg.model.hatch) {
          graphCfg.notHatchingOrFinishedHatching = <NodeConfig>{
            type: "or",
            inputs: ["notHatching", "hatch"]
          }
          graphCfg.isIdle = <NodeConfig>{
            type: "and",
            inputs: [ "noLerp", "notHatchingOrFinishedHatching" ],
          }
          idleInput = "isIdle"
        }
        graphCfg.idle = animation(cfg.model.idle, idleInput)

//        if (cfg.model.model.indexOf("LobberBlue") !== -1) {
//          log.info("Spawning lobber!")
//          graphCfg.monsterLog = <NodeConfig>{
//            type: "log",
//            message: "isIdle",
//            input: idleInput,
//          }
//          graphCfg.logNoLerp = <NodeConfig>{
//            type: "log",
//            message: "isNoLerp",
//            input: "noLerp",
//          }
//          graphCfg.logHatching = <NodeConfig>{
//            type: "log",
//            message: "isHatching",
//            input: "isHatching",
//          }
//        }
      }
    }

    const loc = this.location2to3(state.x, state.y)
    const entityId = this._domain.add({
      components: {
        trans: {initial: new Float32Array([loc.x, loc.y, loc.z, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "gltf", url: cfg.model.model},
        state: {initial: state},
        mixer: {},
        lerp: {},
        graph: graphCfg,
      },
    })
    const actorInfo = new ActorInfo(id, entityId, cfg)
    this._actors.set(id, actorInfo)
    return actorInfo
  }

  /**
   * React to an actor being removed from the ranch model.
   */
  protected deleteActor (id :number) :void {
    const actorInfo = this._actors.get(id)
    if (!actorInfo) return
    this._actors.delete(id)
    this._domain.delete(actorInfo.entityId)
  }

  protected setUiState (uiState :UiState) :void
  {
//    log.debug("Updating UI state: " + uiState)
    // probably some of this logic could move into the hud?
    this._uiState = uiState
    switch (uiState) {
    case UiState.Default:
      this._hud.button1.update({
        label: "🥚",
        action: () => this.setUiState(UiState.PlacingEgg),
      })
      this._hud.button2.update({
        label: "🍕",
        action: () => this.setUiState(UiState.PlacingFood),
      })
      this._hud.statusLabel.update("")
      break

    case UiState.PlacingEgg:
    case UiState.PlacingFood:
      this._hud.button1.update({
        label: "Cancel",
        action: () => this.setUiState(UiState.Default),
      })
      this._hud.button2.update(undefined)
      this._hud.statusLabel.update((uiState == UiState.PlacingEgg) ? "Place the egg" : "Drop Food")
      // TODO: stop normal scene panning? Or maybe you can pan and it always puts the egg
      // on your last touch and then there's a "hatch" button to confirm the placement.
      // For now, we unforgivingly hatch it on their first touch.
      break
    }
  }

  /**
   * Place an egg or food. */
  protected doPlacement (pos :vec2) :void
  {
    //log.debug("Got egg placing request", "pos", pos)
    const terrain = this._obj.read(this._terrainId)!
    const caster = new Raycaster()
    const ndc = new Vector2(
        (pos[0] / window.innerWidth) * 2 - 1,
        (pos[1] / window.innerHeight) * -2 + 1)
    caster.setFromCamera(ndc, this._obj.read(this._cameraId) as Camera)
    for (const result of caster.intersectObject(terrain, true)) {
      this.doPlacement2(result.point)
      return
    }
  }

  protected doPlacement2 (pos :Vector3) :void
  {
    // restrict placement to our navigation area
    pos.x = Math.max(this._minX, Math.min(this._extentX + this._minX, pos.x))
    pos.z = Math.max(this._minZ, Math.min(this._extentZ + this._minZ, pos.z))
    // we could also update y with getY but why? :)

    let actorConfig :ActorConfig
    if (this._uiState === UiState.PlacingEgg) {
      actorConfig = MonsterDb.getRandomEgg()

    } else {
      // Food DB?
      const foodModel :ActorModel = {
        model: "monsters/Acorn.glb",
      }
      actorConfig = new ActorConfig(undefined, foodModel, ActorKind.FOOD)
    }

    const loc :vec2 = this.location3to2(pos)
    this._ranch.addActor(actorConfig, loc[0], loc[1])
    this.setUiState(UiState.Default)
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

  protected location2to3 (x :number, y :number) :Vector3
  {
    // Currently x/y range from 0 to 1
    const x3 = (x * this._extentX) + this._minX
    const z3 = (y * this._extentZ) + this._minZ
    return new Vector3(x3, this.getY(x3, z3), z3)
  }

  protected location3to2 (pos :Vector3) :vec2
  {
    const x2 = (pos.x - this._minX) / this._extentX
    const y2 = (pos.z - this._minZ) / this._extentZ
    // bound it into the ranch model
    return vec2.fromValues(x2, y2)
  }

  /** Our heads-up-display: global UI. */
  protected _hud :Hud

  protected _uiState :UiState = UiState.Default

  protected _ready :boolean = false
  protected _minX = 0
  protected _extentX = 1
  protected _minZ = 0
  protected _extentZ = 1

  // The properties below are all definitely initialized via the constructor
  protected _host! :Host3
  protected _webGlRenderer! :WebGLRenderer
  protected _hand! :Hand
  protected _trans! :TransformComponent
  protected _obj! :Component<Object3D>
  protected _state! :Component<ActorState>
  protected _lerp! :Component<LerpRec|undefined>
  protected _graphsys! :GraphSystem
  protected _lerpsys! :LerpSystem
  protected _scenesys! :SceneSystem
  protected _animsys! :AnimationSystem
  protected _domain! :Domain

  protected _cameraId! :ID
  protected _terrainId! :ID

  protected readonly _actors :Map<number, ActorInfo> = new Map()

  protected readonly _actorChanged = (change :MapChange<number, ActorState>) => {
    if (change.type === "set") {
      this.updateActor(change.key, change.value)
    } else {
      this.deleteActor(change.key)
    }
  }

  protected readonly _handChanged = (change :MapChange<number, Pointer>) => {
    switch (this._uiState) {
      default: return

      case UiState.PlacingEgg:
      case UiState.PlacingFood:
        if (change.type === "set" && change.value.pressed) {
          this.doPlacement(change.value.position)
        }
        break
    }
  }

  private static ACTOR_MOVE_DISTANCE_PER_SECOND = 0.8
  private static CAMERA_HEIGHT = 7 // starting y coordinate of camera
  private static CAMERA_SETBACK = 14 // starting z coordinate of camera
}
