import {
  AnimationMixer,
  Camera,
  Color,
  Object3D,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"

import {Pathfinding} from "three-pathfinding"

import {Body} from "cannon"

//import {loadImage} from "tfw/core/assets"
import {Clock} from "tfw/core/clock"
import {dim2, vec2} from "tfw/core/math"
import {MapChange} from "tfw/core/rcollect"
import {Mutable, Value} from "tfw/core/react"
import {
  PMap,
  Remover,
  log,
} from "tfw/core/util"
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
import {AnimationControllerConfig, StateConfig, TransitionConfig} from "tfw/scene3/animation"
import {
  AnimationSystem,
  GLTFConfig,
  HoverMap,
  SceneSystem,
  loadGLTFAnimationClip,
} from "tfw/scene3/entity"
//import {HTMLHost} from "tfw/ui/element"
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
  ActorAction,
  ActorConfig,
  ActorKind,
  ActorModel,
  ActorState,
  PathRec,
  RanchModel,
} from "./moncher"
import {MonsterDb} from "./monsterdb"
import {Hud, UiState} from "./hud"
import {graphStyles, graphTheme} from "./graphstyles"

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

const unitY = new Vector3(0, 1, 0)
const downY = new Vector3(0, -1, 0)
const scratchQ = new Quaternion()
const scratchV :Vector3 = new Vector3()

class PathSystem extends System
{
  constructor (
    domain :Domain,
    readonly trans :TransformComponent,
    readonly paths :Component<PathRec|undefined>,
    readonly state :Component<ActorState>,
		readonly setY :(into :Vector3) => void,
  ) {
    super(domain, Matcher.hasAllC(trans.id, paths.id))
  }

  update (clock :Clock) {
    this.onEntities(id => {
      let path = this.paths.read(id)
      // TODO: handle "facing" directions somewhere, either here or the model
      // maybe here since we handle advancing along segments that the model hasn't yet!
      let overtime = 0
      while (path) {
        if (!path.stamp) {
          path.stamp = clock.time + path.duration - overtime
          this.updateOrient(id, path.orient)
        }
        const timeLeft = path.stamp - clock.time
        if (timeLeft <= 0) {
          overtime = -timeLeft
          path = path.next
          // update our component
          this.paths.update(id, path)
          if (!path) {
            // if at the end of the paths, update the orient to the state orient
            this.updateOrient(id, this.state.read(id).orient)
          }
        } else {
          // otherwise, there's time left and we should update the position
          scratchV.lerpVectors(path.dest, path.src, timeLeft / path.duration)
          this.setY(scratchV)
          this.trans.updatePosition(id, scratchV)
          path = undefined
        }
      }
    })
  }

  updateOrient (id :ID, orient :number) {
    this.trans.updateQuaternion(id, scratchQ.setFromAxisAngle(unitY, orient))
  }
}

export class RanchMode extends Mode
{
  constructor (
    protected _app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    this.configureScene(_app)

    // But, let's set things to be ready after a short delay even if there's *trouble at the mill*
    // Dispatches to setReady() unless we've been disposed already, but setReady is idempotent.
    let handle :any
    const cancelTimeout = () => { clearTimeout(handle) }
    handle = setTimeout(() => { this.onDispose.remove(cancelTimeout); this.setReady() }, 2000)
    this.onDispose.add(cancelTimeout)

    this.onDispose.add(this._hud = new Hud(this._host, _app.renderer, this))
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

//    const host = this._host = new HTMLHost(root)
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
      theme: graphTheme,
      styles: graphStyles,
//      image: {resolve: loadImage},
      screen: app.renderer.size,
    }

    const trans = this._trans = new TransformComponent("trans")
    const obj = this._obj = new DenseValueComponent<Object3D>("obj", new Object3D())
    const mixer = new DenseValueComponent<AnimationMixer>("mixer",
        new AnimationMixer(new Object3D()))
    const body = new DenseValueComponent<Body>("body", new Body())
    const state = this._state =
        new DenseValueComponent<ActorState>("state", ActorState.createDummy())
    const hovers = new SparseValueComponent<HoverMap>("hovers", new Map())
    const paths = this._paths = new SparseValueComponent<PathRec|undefined>("paths", undefined)
    const graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))

    const domain = this._domain = new Domain({},
        {trans, obj, mixer, body, state, paths, hovers, graph})
    this._pathsys = new PathSystem(domain, trans, paths, state, this.setY.bind(this))
    this._scenesys = new SceneSystem(
        domain, trans, obj, hovers, hand.pointers)
    this._graphsys = new GraphSystem(nodeCtx, domain, graph)
    this._scenesys.scene.add(host.group)

    /*const animsys =*/ this._animsys = new AnimationSystem(domain, obj, mixer)

    // add lights and camera
    const CAMERA_MOVEMENT_FACTOR = 20 // Hacky multiplication factor so we get noticeable movement
    const cameraHeight = Mutable.local(RanchMode.CAMERA_HEIGHT)
    this._cameraId = domain.add({
      components: {
        trans: {initial: new Float32Array(
            [-.825, 1.2, 6.882, -.05, 0, 0, 1, 1, 1, 1]
            )},
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
        obj: {type: "hemisphereLight", color: 0x00aaff, groundColor: 0xffaa00},
      },
    })
    domain.add({
      components: {
        trans: {initial: new Float32Array([1, 1, 1, 0, 0, 0, 1, 1, 1, 1])},
        obj: {type: "directionalLight"},
//        graph: {
//          clock: {type: "clock"},
//          spin: {type: "multiply", inputs: [.1, "clock"]},
//          accumSpin: {type: "accumulate", input: "spin"},
//          rotation: {type: "Euler", z: "accumSpin"},
//          setVec: {type: "Vector3.applyEuler", vector: new Vector3(0, 1, 0), euler: "rotation"},
//          update: {type: "updatePosition", component: "trans", input: "setVec"},
//          //logRotation: {type: "log", message: "Accumulation rotation", input: "setVec"},
//        },
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
    this._graphsys.update(clock)
    this._host.update(clock)
    this._pathsys.update(clock)
    this._animsys.update(clock)
    this._scenesys.update()
    this._scenesys.render(this._webGlRenderer)
  }

  setUiState (uiState :UiState) :void {
    this._uiState = uiState
    this._hud.updateUiState(uiState)
  }

  protected ranchLoaded (scene :Object3D) :Object3D|undefined {
    this._terrain = scene
    const navMesh = scene.getObjectByName("NavMesh")
    if (navMesh instanceof Mesh) {
      navMesh.parent!.remove(navMesh)
      this._navMesh = navMesh

//      // compute the boundaries of the ranch (TEMP?)
//      navMesh.geometry.computeBoundingBox()
//      const box = navMesh.geometry.boundingBox
//      log.info("Got the navmesh", "box", box)
      // TODO: constrain scrolling based on the extents of the navmesh

      // update the ranch model TODO: this will be a serverside thing, can't update it from here!
      this._ranch.setNavMesh(navMesh)

      this.configurePathFinding(navMesh)
    }
    this.setReady()

    return undefined // don't replace the ranch
  }

  /**
   * Attempt to colorize the object and all its children.  */
  protected colorize (obj :Object3D, color :Color) :void
  {
    if ((obj instanceof Mesh) && (obj.material instanceof MeshStandardMaterial)) {
      // clone the material so that we don't change all instances of this object
      const newMat = new MeshStandardMaterial(obj.material as object)
      newMat.color = color
      obj.material = newMat
    }
    for (const child of obj.children) {
      this.colorize(child, color)
    }
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
    // see if we've given this monster an entity ID yet
    let actorInfo = this._actors.get(id)
    if (!actorInfo) {
      actorInfo = this.addActor(id, state)
    }
    this.updateActorSprite(actorInfo, state)
  }

  /**
   * Effect updates received from the RanchModel.
   */
  protected updateActorSprite (actorInfo :ActorInfo, state :ActorState) :void {
    // store their state in the entity system...
    this._state.update(actorInfo.entityId, state)
    this._paths.update(actorInfo.entityId, state.path)
    if (!state.path) {
      this._trans.updateQuaternion(actorInfo.entityId,
          scratchQ.setFromAxisAngle(unitY, state.orient))
    }
    this._trans.updateScale(actorInfo.entityId,
        scratchV.set(state.scale, state.scale, state.scale))
  }

  protected addActor (id :number, state :ActorState) :ActorInfo
  {
    const cfg = this._ranch.actorConfig.get(id)
    if (!cfg) {
      // this isn't supposed to happen
      throw new Error("Actor doesn't have a config in the RanchModel")
    }

    // Preloading!
    if (cfg.spawn) {
      // let's go ahead and pre-load the model of what we're going to spawn.
      // Loading the animations is the only way
      const runLater = () => {
        // TODO: is there a more straightforward way to do this?
        let remover :Remover
        remover = loadGLTFAnimationClip(cfg.spawn!.model.model + "#").once(v => {
            this.onDispose.remove(remover)
          })
        this.onDispose.add(remover)
      }
      setTimeout(runLater, 0) // but, what if we're already disposed when this runs?
    }

    const graphCfg :GraphConfig = {}

    // make the graph inspectable
    graphCfg.inspectable = <NodeConfig>{
      type: "subgraph",
      graph: {
        doubleClick: {type: "doubleClick"},
        hover: {type: "hover", component: "hovers"},
        inspect: {type: "and", inputs: ["doubleClick", "hover"]},
        ui: {
          type: "ui",
          input: "inspect",
          model: {
            editable: Value.constant(true),
            backButton: {text: Value.constant("←")},
            closeButton: {text: Value.constant("x")},
          },
          root: {
            type: "root",
            scale: this._app.renderer.scale,
            contents: {
              type: "box",
              contents: {type: "graphviewer", editable: "editable"},
              style: {halign: "stretch", valign: "stretch", background: "$root"},
            },
          },
          size: dim2.fromValues(1024, 768),
        },
      },
    }

    // set up nodes to capture touches on the actor and call our callback
    graphCfg.hover = {type: "hover", component: "hovers"}
    graphCfg.detectTouch = {
      type: "onChange",
      input: ["hover", "pressed"],
      callback: (nv :boolean, ov :boolean) => {
        if (nv) {
          this.actorTouched(id)
        }
      },
    }

    // set up nodes to read the actor's state / action
    graphCfg.state = <NodeConfig>{
      type: "readComponent",
      component: "state",
    }
    graphCfg.action = <NodeConfig>{
      type: "property",
      input: "state",
      name: "action",
    }

    // set up animations
    const anyTransitions :PMap<TransitionConfig> = {
    }
    const defaultTransitions :PMap<TransitionConfig> = {
    }
    const animStates :PMap<StateConfig> = {
      default: <StateConfig>{
        transitions: defaultTransitions,
      },
      any: <StateConfig>{
        transitions: anyTransitions,
      },
    }
    graphCfg.controller = <NodeConfig>{
      type: "animationController",
      component: "mixer",
      config: <AnimationControllerConfig>{
        states: animStates,
      },
    }

    // set up our "Idle" animation as the default state
    if (cfg.model.idle) {
      animStates.default.url = cfg.model.idle
    }

    const isEgg = (cfg.kind === ActorKind.EGG)
    if (cfg.model.hatch) {
      // set up hatching (nearly the same between eggs and monsters)
      graphCfg.isHatching = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.Hatching,
      }
      animStates.hatch = {
        url: cfg.model.hatch,
        repetitions: 1,
        finishBeforeTransition: true,
        clampWhenFinished: isEgg, // stop the egg hatch on the last frame
      }
      if (!isEgg) {
        animStates.hatch.transitions = { default: {} }
      }
      anyTransitions.hatch = {condition: "hatchCond"}
      graphCfg.controller.hatchCond = "isHatching"
    }

    if (isEgg) {
      graphCfg.isReadyToHatch = <NodeConfig>{
        type: "equals",
        x: "action",
        y: ActorAction.ReadyToHatch,
      }
      // set up the ready-to-hatch state
      animStates.readyToHatch = {
        // TODO: a url!
      }
      anyTransitions.readyToHatch = {condition: "readyHatchCond"}
      graphCfg.controller.readyHatchCond = "isReadyToHatch"

    } else {
      // regular monster
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
        animStates.walk = {
          url: cfg.model.walk,
          transitions: {
            default: {condition: "!walkCond"},
          }
        }
        anyTransitions.walk = {condition: "walkCond"}
        graphCfg.controller.walkCond = "yesPath"
      } // end: walk

      if (cfg.model.eat) {
        graphCfg.isEating = <NodeConfig>{
          type: "equals",
          x: "action",
          y: ActorAction.Eating,
        }
        animStates.eat = {
          url: cfg.model.eat,
          transitions: {
            default: {condition: "!eatCond"},
          }
        }
        anyTransitions.eat = {condition: "eatCond"}
        graphCfg.controller.eatCond = "isEating"
      } // end: eat

      if (cfg.model.sleep && cfg.model.faint) {
        graphCfg.isSleeping = <NodeConfig>{
          type: "equals",
          x: "action",
          y: ActorAction.Sleeping,
        }
        animStates.faint = {
          url: cfg.model.faint,
          repetitions: 1,
          finishBeforeTransition: true,
          transitions: {sleep: {}},
        }
        // only transition to faint from default
        defaultTransitions.faint = {condition: "sleepCond"}
        graphCfg.controller.sleepCond = "isSleeping"
        animStates.sleep = {
          url: cfg.model.sleep,
          transitions: {default: {condition: "!sleepCond"}}
        }
      } // end: sleep

      if (cfg.model.wakeUp) {
        graphCfg.isWaking = <NodeConfig>{
          type: "equals",
          x: "action",
          y: ActorAction.Waking,
        }
        animStates.wake = {
          url: cfg.model.wakeUp,
          repetitions: 1,
          finishBeforeTransition: true,
          transitions: {default: {}},
        }
        anyTransitions.wake = {condition: "wakeCond"}
        graphCfg.controller.wakeCond = "isWaking"
      } // end: wakeup

      // Happy-react happens whenever you touch a monster, even if in the other states.
      // So we need to set up a separate animation controller.
      if (cfg.model.happyReact) {
        graphCfg.touched = <NodeConfig>{
          type: "property",
          input: "state",
          name: "touched",
        }
        graphCfg.happyReactAuxController = <NodeConfig>{
          type: "animationController",
          component: "mixer",
          config: <AnimationControllerConfig>{
            states: {
              default: {},
              touched: {
                url: cfg.model.happyReact,
                repetitions: 1,
                finishBeforeTransition: true,
              },
              any: {
                transitions: {
                  touched: {condition: "touchCond"},
                  default: {}
                },
              },
            },
          },
          touchCond: "touched",
        }
      }
    }

    const objDef = <GLTFConfig>{type: "gltf", url: cfg.model.model}
    if (cfg.color !== undefined) {
      objDef.onLoad = obj => { this.colorize(obj, new Color(cfg.color)); return undefined }
    }
    const entityId = this._domain.add({
      components: {
        trans: {initial: new Float32Array(
            [state.pos.x, state.pos.y, state.pos.z, 0, 0, 0, 1, 1, 1, 1])},
        obj: objDef,
        state: {initial: state},
        paths: {},
        hovers: {},
        mixer: {},
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

  protected mouseToLocation (pos :vec2) :Vector3|undefined
  {
    const obj = this._navMesh || this._terrain
    if (obj) {
      const caster = new Raycaster()
      const ndc = new Vector2(
          (pos[0] / window.innerWidth) * 2 - 1,
          (pos[1] / window.innerHeight) * -2 + 1)
      caster.setFromCamera(ndc, this._obj.read(this._cameraId) as Camera)
      for (const result of caster.intersectObject(obj, true)) {
        return result.point
      }
    }
    return undefined
  }

  protected actorTouched (id :number) :void
  {
    this._ranch.actorTouched(id)
  }

  /**
   * Place an egg or food. */
  protected doPlacement (pos :Vector3) :void
  {
    const actorConfig :ActorConfig = (this._uiState === UiState.PlacingEgg)
        ? MonsterDb.getRandomEgg()
        : new ActorConfig(ActorKind.FOOD, <ActorModel>{ model: "monsters/Acorn.glb" })
    this._ranch.addActor(actorConfig, pos)
    this.setUiState(UiState.Default)
  }

  /**
   * Override the Y coordinate with a sample from the navmesh, if possible. */
  protected setY (into :Vector3) :void {
    const obj = this._navMesh || this._terrain // Use the navmesh if we have it
    if (obj) {
      const oldY = into.y
      into.y = RanchMode.MAX_CAMERA_DISTANCE + 1
      const caster = new Raycaster(into, downY)
      for (const result of caster.intersectObject(obj, true)) {
        into.y = result.point.y
        return
      }
      into.y = oldY
    }
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

    log.debug("Camera", "arr", this._trans.read(this._cameraId))
  }

  /** Our heads-up-display: global UI. */
  protected _hud :Hud

  protected _uiState :UiState = UiState.Default

  protected _pathFinder? :Pathfinding

  protected _ready :boolean = false

  // The properties below are all definitely initialized via the constructor
  protected _host! :Host3
  //protected _host! :HTMLHost
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
      case UiState.PlacingEgg:
      case UiState.PlacingFood:
        if (change.type === "set" && change.value.pressed) {
          const loc = this.mouseToLocation(change.value.position)
          if (loc) this.doPlacement(loc)
        }
        break

      default: break
    }
  }

  // New constants for camera control
  private static MAX_CAMERA_DISTANCE = 10

  private static CAMERA_HEIGHT = 2 // starting y coordinate of camera
  private static CAMERA_SETBACK = 5 // starting z coordinate of camera

  private static RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
