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

import {Pathfinding} from "three-pathfinding"

import {Body} from "cannon"

import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {MapChange} from "tfw/core/rcollect"
import {Mutable} from "tfw/core/react"
import {log} from "tfw/core/util"
import {Hand, Pointer} from "tfw/input/hand"
import {Keyboard} from "tfw/input/keyboard"
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

class PathRec
{
  constructor (
    /** The source location. */
    readonly src :Vector3,
    /** The destination location. */
    public dest :Vector3,
    /** How long shall we take? */
    readonly duration :number,
    /** The next section of the path. */
    public next? :PathRec
  ) {}

  /** Ending timestamp (start time + duration) (filled-in by PathSystem) */
  stamp? :number
}

class PathSystem extends System
{
  constructor (
    domain :Domain,
    readonly trans :TransformComponent,
    readonly paths :Component<PathRec|undefined>,
    readonly getY :(x :number, z :number) => number,
  ) {
    super(domain, Matcher.hasAllC(trans.id, paths.id))
  }

  update (clock :Clock) {
    const pos :Vector3 = new Vector3()
    this.onEntities(id => {
      const pathRec = this.paths.read(id)
      if (pathRec) {
        if (!pathRec.stamp) {
//          log.debug("Starting",
//            "dest", pathRec.dest,
//            "src", pathRec.src)
          // calculate the end time for the walk
          pathRec.stamp = clock.time + pathRec.duration
          // calculate the direction
          const subbed = new Vector3().subVectors(pathRec.dest, pathRec.src)
          subbed.y = 0
          this.trans.updateQuaternion(id,
              new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), subbed.normalize()))
        }
        const timeLeft = pathRec.stamp - clock.time
        if (timeLeft <= 0) {
          this.trans.updatePosition(id, pathRec.dest)
          this.paths.update(id, pathRec.next)
          if (!pathRec.next) {
            this.trans.updateQuaternion(id, new Quaternion()) // face forward
          }
//          log.debug("Reached destination",
//            "dest", pathRec.dest)
          // TODO: carry over remainder time to next segment?

        } else {
          pos.lerpVectors(pathRec.dest, pathRec.src, timeLeft / pathRec.duration)
//          log.debug("Lerping...",
//            "dest", pathRec.dest,
//            "src", pathRec.src,
//            "%", timeLeft / pathRec.duration,
//            "pos", pos)
          // but override the Y value according to terrain?
          pos.y = this.getY(pos.x, pos.z)
          this.trans.updatePosition(id, pos)
        }
      }
    })
  }
}

const enum UiState
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

    this.onDispose.add(Keyboard.instance.getKeyState(32).onChange((ov, nv) => this.swapTerrain()))
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
          new ActorState(0, 0, 1, ActorAction.Idle))
    const hovers = new SparseValueComponent<HoverMap>("hovers", new Map())
    const paths = this._paths = new SparseValueComponent<PathRec|undefined>("paths", undefined)
    const graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))

    const domain = this._domain = new Domain({},
        {trans, obj, mixer, body, state, paths, hovers, graph})
    this._pathsys = new PathSystem(domain, trans, paths, this.getY.bind(this))
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
    this._pathsys.update(clock)
    this._animsys.update(clock)
    this._scenesys.update()
    this._scenesys.render(this._webGlRenderer)
  }

  protected ranchLoaded (scene :Object3D) :Object3D|undefined {
    this._terrain = scene
    const navMesh = spliceNamedChild(scene, "NavMesh")
    if (navMesh instanceof Mesh) {
      this._navMesh = navMesh

      // compute the boundaries of the ranch (TEMP?)
      navMesh.geometry.computeBoundingBox()
      const box = navMesh.geometry.boundingBox
      log.info("Got the navmesh", "box", box)
      this._minX = box.min.x
      this._extentX = box.max.x - box.min.x
      this._minZ = box.min.z
      this._extentZ = box.max.z - box.min.z

      this.configurePathFinding(navMesh)
      this.setReady()
    }
    return undefined
  }

  /**
   * Configure pathfinding once we have the navmesh. */
  protected configurePathFinding (navMesh :Mesh) :void
  {
    this._pathFinder = new Pathfinding()
    this._pathFinder.setZoneData(RanchMode.RANCH_ZONE, Pathfinding.createZone(navMesh.geometry))
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
    this._trans.updateScale(actorInfo.entityId, new Vector3(state.scale, state.scale, state.scale))

    // then check their location against their PathRec...
    const pos = this.location2to3(state.x, state.y)
    let oldRec = this._paths.read(actorInfo.entityId)
    if (oldRec) {
      while (oldRec.next) {
        oldRec = oldRec.next
      }
      if (vec3NearlyEqual(oldRec.dest, pos)) {
        // just update the position in the old record
        oldRec.dest = pos
        return
      }
    }

    const oldPos = this._trans.readPosition(actorInfo.entityId, new Vector3())
    if (!oldRec && vec3NearlyEqual(pos, oldPos)) {
      // just update the translation and return
      this._trans.updatePosition(actorInfo.entityId, pos)
      return
    }
//    log.debug("Want new path", "oldPos", oldPos)

    let path :Vector3[]
    if (this._pathFinder) {
      const groupId = this._pathFinder.getGroup(RanchMode.RANCH_ZONE, oldPos)
      const foundPath = this._pathFinder.findPath(oldPos, pos, RanchMode.RANCH_ZONE, groupId)
      if (foundPath) {
        path = foundPath
        path.unshift(oldPos) // we need to manually put the first point at the beginning
      } else {
        log.debug("Rejecting bogus path")
        return
      }

    } else {
      path = [oldPos, pos]
    }
//    log.debug("Found path!", "path", path)

    let rec :PathRec|undefined = undefined
    while (path.length > 1) {
      const dest = path.pop()!
      const src = path[path.length - 1]
      const duration = (src.distanceTo(dest) * 1000) /
          (RanchMode.ACTOR_MOVE_DISTANCE_PER_SECOND * state.scale)
      rec = new PathRec(src, dest, duration, rec)
//      log.info("Added to end...", "src", src, "dest", dest)
    }
    this._paths.update(actorInfo.entityId, rec)
  }

  protected addActor (id :number, state :ActorState) :ActorInfo
  {
    const cfg = this._ranch.actorConfig.get(id)
    if (!cfg) {
      // this isn't supposed to happen
      throw new Error("Actor doesn't have a config in the RanchModel")
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

    // Always add graph nodes to read the state
    graphCfg.state = <NodeConfig>{
      type: "readComponent",
      component: "state",
    }
    graphCfg.action = <NodeConfig>{
      type: "property",
      input: "state",
      name: "action",
    }

    // add animation logic for animations we support
    const isIdle :string[] = []
    if (cfg.model.hatch) {
      graphCfg.isHatching = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.Hatching,
      }
      const isEgg :boolean = (cfg.kind === ActorKind.EGG)
      graphCfg.hatch = animation(cfg.model.hatch, "isHatching", 1, isEgg)
      graphCfg.notHatching = <NodeConfig>{type: "not", input: "isHatching"}

      if (isEgg) {
        isIdle.push("notHatching")
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

    // TODO A real Walking activity would simplify this, TODO when we walk on the navmesh
    if (cfg.model.walk) {
      graphCfg.readPath = <NodeConfig>{
        type: "readComponent",
        component: "paths",
      }
      graphCfg.noPath = <NodeConfig>{
        type: "equals",
        x: "readPath",
        y: undefined,
      }
      graphCfg.yesPath = <NodeConfig>{
        type: "not",
        input: "noPath",
      }
      graphCfg.walk = animation(cfg.model.walk, "yesPath")
      isIdle.push("noPath")

      if (cfg.model.hatch && cfg.kind !== ActorKind.EGG) {
        // make us go idle right away when hatching has finished
        graphCfg.notHatchingOrFinishedHatching = <NodeConfig>{
          type: "or",
          inputs: ["notHatching", "hatch"]
        }
        isIdle.push("notHatchingOrFinishedHatching")
      }
    }

    if (cfg.model.sleep && cfg.model.faint) {
      graphCfg.isSleeping = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.Sleeping,
      }
      graphCfg.triggerSleep = <NodeConfig>{
        type: "and",
        inputs: ["isSleeping", "noPath"],
      }
      graphCfg.faintFirst = animation(cfg.model.faint, "triggerSleep", 1)
      graphCfg.reallySleeping = <NodeConfig>{
        type: "and",
        inputs: ["isSleeping", "faintFirst"],
      }
      graphCfg.sleep = animation(cfg.model.sleep, "reallySleeping")
      graphCfg.notSleeping = <NodeConfig>{
        type: "not",
        input: "isSleeping",
      }
      isIdle.push("notSleeping")
    }

    if (cfg.model.wakeUp) {
      graphCfg.isWaking = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.Waking,
      }
      graphCfg.triggerWake = <NodeConfig>{
        type: "and",
        inputs: ["isWaking", "noPath"],
      }
      graphCfg.wake = animation(cfg.model.wakeUp, "triggerWake", 1)
      graphCfg.notWaking = <NodeConfig>{type: "not", input: "isWaking"}
      graphCfg.notWakingOrFinishedWaking = <NodeConfig>{
        type: "or",
        inputs: ["notWaking", "wake"],
      }
      isIdle.push("notWakingOrFinishedWaking")
    }

    // trigger idle when all the idle conditions are true
    if (cfg.model.idle) {
      if (isIdle.length === 1) {
        graphCfg.idle = animation(cfg.model.idle, isIdle[0])
      } else {
        graphCfg.isIdle = <NodeConfig>{
          type: "and",
          inputs: isIdle,
        }
        graphCfg.idle = animation(cfg.model.idle, "isIdle")
      }
    }

    const loc = this.location2to3(state.x, state.y)
    const entityId = this._domain.add({
      components: {
        trans: {initial: new Float32Array([loc.x, loc.y, loc.z, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "gltf", url: cfg.model.model},
        state: {initial: state},
        mixer: {},
        paths: {},
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
        label: "🌰",
        action: () => this.setUiState(UiState.PlacingFood),
      })
      this._hud.statusLabel.update("Hold SPACE to see the navmesh")
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
    // use the navmesh for validating placement, if available
    const obj = this._navMesh || this._terrain
    if (!obj) return
    //log.debug("Got egg placing request", "pos", pos)
    const caster = new Raycaster()
    const ndc = new Vector2(
        (pos[0] / window.innerWidth) * 2 - 1,
        (pos[1] / window.innerHeight) * -2 + 1)
    caster.setFromCamera(ndc, this._obj.read(this._cameraId) as Camera)
    for (const result of caster.intersectObject(obj, true)) {
      this.doPlacement2(result.point)
      return
    }
  }

  protected doPlacement2 (pos :Vector3) :void
  {
    // restrict placement to our navigation area
    pos.x = Math.max(this._minX, Math.min(this._extentX + this._minX, pos.x))
    pos.z = Math.max(this._minZ, Math.min(this._extentZ + this._minZ, pos.z))
    // we could also update y with getY but why? :)   (Because we'll throw it away)

    const actorConfig :ActorConfig = (this._uiState === UiState.PlacingEgg)
        ? MonsterDb.getRandomEgg()
        : new ActorConfig(ActorKind.FOOD, <ActorModel>{ model: "monsters/Acorn.glb" })
    const loc :vec2 = this.location3to2(pos)
    this._ranch.addActor(actorConfig, loc[0], loc[1])
    this.setUiState(UiState.Default)
  }

  protected getY (x :number, z :number) :number
  {
    // Try to use the navmesh first, but if we get no hits we'll circle back to the terrain anyway
    let terrain = this._navMesh || this._terrain
    if (terrain) {
      const HAWK_HEIGHT = 10
      const caster = new Raycaster(new Vector3(x, HAWK_HEIGHT, z), new Vector3(0, -1, 0))

      while (true) {
        const results = caster.intersectObject(terrain, true)
        for (const result of results) {
          return HAWK_HEIGHT - result.distance
        }
        if (terrain === this._navMesh) {
          terrain = this._terrain!
        } else {
          break
        }
      }
    }
    log.debug("Didn't find decent height")
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

  protected swapTerrain () :void
  {
    if (!this._terrain || !this._navMesh) return
    const obj = this._obj.read(this._terrainId)
    if (obj === this._terrain) {
      this._obj.update(this._terrainId, this._navMesh)
      this._scenesys.scene.add(this._navMesh)
      this._scenesys.scene.remove(this._terrain)
    } else {
      this._obj.update(this._terrainId, this._terrain)
      this._scenesys.scene.add(this._terrain)
      this._scenesys.scene.remove(this._navMesh)
    }
  }

  /** Our heads-up-display: global UI. */
  protected _hud :Hud

  protected _uiState :UiState = UiState.Default

  protected _pathFinder? :Pathfinding

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
  protected _paths! :Component<PathRec|undefined>
  protected _graphsys! :GraphSystem
  protected _pathsys! :PathSystem
  protected _scenesys! :SceneSystem
  protected _animsys! :AnimationSystem
  protected _domain! :Domain

  protected _cameraId! :ID
  protected _terrainId! :ID

  /** Our navigation mesh, if loaded. */
  protected _navMesh? :Mesh
  protected _terrain? :Object3D

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
      default:
        break

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

  private static RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
