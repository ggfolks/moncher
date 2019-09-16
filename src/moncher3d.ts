import {
  AnimationMixer,
  Camera,
  Color,
  DirectionalLight,
  Object3D,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"

import {Pathfinding} from "./pathfinding"

import {Body} from "cannon"

//import {loadImage} from "tfw/core/assets"
import {Clock} from "tfw/core/clock"
import {dim2, vec2} from "tfw/core/math"
import {MapChange} from "tfw/core/rcollect"
import {Value} from "tfw/core/react"
import {
  Noop,
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
import {HTMLHost} from "tfw/ui/element"

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
import {DefaultStyles, DefaultTheme} from "tfw/ui/theme"

import {App, Mode} from "./app"
import {
  ActorAction,
  ActorConfig,
  ActorInstant,
  ActorKind,
  ActorModel,
  ActorState,
  PathRec,
  RanchModel,
} from "./moncher"
import {MonsterDb} from "./monsterdb"
import {Hud, UiState} from "./hud"
import {ChatView} from "./chat"
import {Lakitu} from "./lakitu"
import {RanchObject} from "./data"

class ActorInfo {

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

class PathSystem extends System {

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

/**
 * Make a loaded actor object cast (and receive?) shadows. */
function makeShadowy (obj :Object3D) :void {
  if (obj instanceof Mesh) {
    obj.castShadow = true
    obj.receiveShadow = true
  }
  obj.children.forEach(makeShadowy)
}

/**
 * Make the loaded scene receive shadows. */
function makeSceneShadowy (obj :Object3D) :void {
  if (obj.name.startsWith("Terrain")) {
    obj.receiveShadow = true
  }
  obj.children.forEach(makeSceneShadowy)
}

/**
 * Helper for loading a SpriteMaterial for monster emojional state. */
function makeEmoji (tl :TextureLoader, url :string) :SpriteMaterial {
  return new SpriteMaterial({map: tl.load("monsters/emoji/" + url), color: 0xFFFFFF})
}

export class RanchMode extends Mode {

  constructor (
    protected _app :App,
    protected _ranch :RanchModel,
  ) {
    super()
    this.subscribeToRanch()
    this.configureScene(_app)
    this.loadExtras()

    // But, let's set things to be ready after a short delay even if there's *trouble at the mill*
    // Dispatches to setReady() unless we've been disposed already, but setReady is idempotent.
    let handle :any
    const cancelTimeout = () => { clearTimeout(handle) }
    handle = setTimeout(() => { this.onDispose.remove(cancelTimeout); this.setReady() }, 2000)
    this.onDispose.add(cancelTimeout)

    this.onDispose.add(this._hud = new Hud(_app, this._host, _app.renderer, this))
    this.setUiState(UiState.Default)

    this.onDispose.add(this._chat = new ChatView(_app))
    this._chat.root.bindOrigin(_app.renderer.size, "left", "bottom", "left", "bottom")
    this._host.addRoot(this._chat.root)

    this.onDispose.add(Keyboard.instance.getKeyState(112 /* F1 */).onEmit(
        v => this.showNavMesh(v)))
    this.onDispose.add(Keyboard.instance.getKeyState(83 /* S key */).onEmit(v => {
        if (v) {
          const enabled = !this._webGlRenderer.shadowMap.enabled

          // this doesn't seem to do anything
          this._webGlRenderer.shadowMap.enabled = enabled
          this._webGlRenderer.shadowMap.needsUpdate = true

          // this does something
          const dl = this._obj.read(this._mainLightId) as DirectionalLight
          dl.castShadow = enabled
        }
      }))
  }

  dispose () :void {
    super.dispose()
    for (const remover of this._preloads.values()) {
      remover()
    }
    this._preloads.clear()
  }

  protected preloadObj (url :string) :void {
    this.preloadAnim(url + "#") // pretend it has an animation named ""
  }

  protected preloadAnim (url :string) :void {
    if (this._preloads.has(url)) return // we already got one!
    let handle :any
    const cancelLater :Remover = () => { clearImmediate(handle) }
    const runLater = () => {
        // replace 'cancelLater' with the Subject's remover
        this._preloads.set(url, loadGLTFAnimationClip(url).onEmit(Noop))
      }
    handle = setImmediate(runLater)
    this._preloads.set(url, cancelLater)
  }

  protected subscribeToRanch () :void {
    const ranchId = this._app.state.ranchId.current // TODO
    const [ranch, unranch] = this._app.client.resolve(["ranches", ranchId], RanchObject)
    this._ranchObj = ranch
    this.onDispose.add(unranch)

    this.onDispose.add(ranch.state.onValue(s => {log.debug("Ranch state: " + s)}))

    // TEMP: log name
    this.onDispose.add(ranch.name.onValue(v => {log.debug("Ranch name : " + v)}))
  }

  protected configureScene (app :App) :void {
    const webGlRenderer = this._webGlRenderer = new WebGLRenderer()
    webGlRenderer.gammaOutput = true
    webGlRenderer.gammaFactor = 2.2
    webGlRenderer.shadowMap.enabled = navigator.userAgent.toLowerCase().indexOf('android') === -1

    this.onDispose.add(webGlRenderer)

    // replace the 2d canvas
    const root = app.renderer.canvas.parentElement as HTMLElement
    root.removeChild(app.renderer.canvas)
    root.appendChild(webGlRenderer.domElement)
    this.onDispose.add(app.renderer.size.onValue(size => {
      webGlRenderer.setPixelRatio(window.devicePixelRatio)
      webGlRenderer.setSize(size[0], size[1])
      dim2.set(this._inspectUiSize, size[0], size[1])
    }))
    // set up a dispose to restore the 2d canvas
    this.onDispose.add(() => {
      root.removeChild(webGlRenderer.domElement)
      root.appendChild(app.renderer.canvas)
    })

    const host = this._host = new HTMLHost(root)
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
      theme: DefaultTheme,
      styles: DefaultStyles,
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

    /*const animsys =*/ this._animsys = new AnimationSystem(domain, obj, mixer)

    // add lights and camera
    const cameraId = this._cameraId = domain.add({
      components: {
        trans: {},
        obj: {type: "perspectiveCamera"},
      },
    })
    this._camControl = new Lakitu(cameraId, trans, this.setY.bind(this))

    // mouse wheel adjusts camera distance
    const WHEEL_FACTOR = .05
    const wheelHandler = (event :WheelEvent) => {
      this._camControl.adjustDistance(event.deltaY * WHEEL_FACTOR)
    }
    root.addEventListener("wheel", wheelHandler)
    this.onDispose.add(() => root.removeEventListener("wheel", wheelHandler))

    // set up arrow keys to change focus
    const kb = Keyboard.instance
    const enum ArrowKey { Left = 37, Up, Right, Down }
    const ARROW_KEY_FACTOR = .5
    this.onDispose.add(kb.getKeyState(ArrowKey.Left).onEmit(
        p => { if (p) this.adjustCameraTarget(-ARROW_KEY_FACTOR, 0) } ))
    this.onDispose.add(kb.getKeyState(ArrowKey.Right).onEmit(
        p => { if (p) this.adjustCameraTarget(ARROW_KEY_FACTOR, 0) } ))
    this.onDispose.add(kb.getKeyState(ArrowKey.Up).onEmit(
        p => { if (p) this.adjustCameraTarget(0, -ARROW_KEY_FACTOR) } ))
    this.onDispose.add(kb.getKeyState(ArrowKey.Down).onEmit(
        p => { if (p) this.adjustCameraTarget(0, ARROW_KEY_FACTOR) } ))

    domain.add({
      components: {
        trans: {},
        obj: {type: "hemisphereLight", color: 0x00aaff, groundColor: 0xffaa00},
      },
    })
    this._mainLightId = domain.add({
      components: {
        trans: {},
        obj: {type: "json", url: "ranch/MainLight.json"},
      }
    })
    domain.add({
      components: {
        trans: {},
        obj: {type: "json", url: "ranch/RimLight.json"},
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

  protected loadExtras () :void {
    const tl = new TextureLoader()
    this._bubbleMaterial = makeEmoji(tl, "ThoughtBubble.png")
    //this._emojis.set(ActorAction.VisitingEgg, this.makeEmoji(tl, "EggIcon.png"))
    this._emojis.set(ActorAction.SeekingFood, makeEmoji(tl, "AcornIcon.png"))
    this._emojis.set(ActorAction.Sleepy, makeEmoji(tl, "SleepIcon.png"))
  }

  render (clock :Clock) :void {
    this._hand.update()
    this._scenesys.updateHovers(this._webGlRenderer)
    this._graphsys.update(clock)
    this._host.update(clock)
    this._pathsys.update(clock)
    this._animsys.update(clock)
    this._camControl.update(clock)
    this._scenesys.update()
    this._scenesys.render(this._webGlRenderer)
  }

  setUiState (uiState :UiState) :void {
    this._uiState = uiState
    this._hud.updateUiState(uiState)
  }

  protected ranchLoaded (scene :Object3D) :void {
    this._terrain = scene
    const navMesh = scene.getObjectByName("NavMesh")
    if (navMesh instanceof Mesh) {
      navMesh.parent!.remove(navMesh)
      this._navMesh = navMesh

      // update the ranch model TODO: this will be a serverside thing, can't update it from here!
      this._ranch.setNavMesh(navMesh)

      this.configurePathFinding(navMesh)

      // use the bounding box of the navmesh geometry as the bounds of our camera focus
      navMesh.geometry.computeBoundingBox()
      this._camControl.updateTargetBounds(navMesh.geometry.boundingBox)
    }
    makeSceneShadowy(scene)
    this.setReady()
  }

  /**
   * Attempt to colorize the object and all its children.  */
  protected colorize (obj :Object3D, color :Color) :void {
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
  protected configurePathFinding (navMesh :Mesh) :void {
    this._pathFinder = new Pathfinding()
    this._pathFinder.setZoneData(
      RanchMode.RANCH_ZONE, Pathfinding.createZone(navMesh.geometry as THREE.BufferGeometry))
  }

  /**
   * Called once we know enough to start adding actors. */
  protected setReady () :void {
    if (this._ready) return
    this._ready = true

    this.onDispose.add(this._ranch.actors.onChange(this._actorChanged))
    this._ranch.actors.forEach((actor, id) => { this.updateActor(id, actor) })
  }

  /**
   * React to a actor being updated in the ranch model. */
  protected updateActor (id :number, state :ActorState) :void {
    // see if we've given this monster an entity ID yet
    let actorInfo = this._actors.get(id)
    if (!actorInfo) {
      actorInfo = this.addActor(id, state)
    }
    this.updateActorSprite(actorInfo, state)
  }

  /**
   * Effect updates received from the RanchModel. */
  protected updateActorSprite (actorInfo :ActorInfo, state :ActorState) :void {
    // store their state in the entity system...
    this._state.update(actorInfo.entityId, state)
    this._paths.update(actorInfo.entityId, state.path)
    if (!state.path) {
      this._trans.updatePosition(actorInfo.entityId, state.pos)
      this._trans.updateQuaternion(actorInfo.entityId,
          scratchQ.setFromAxisAngle(unitY, state.orient))
    }
    this._trans.updateScale(actorInfo.entityId,
        scratchV.set(state.scale, state.scale, state.scale))
    this.updateBubble(actorInfo, state)
  }

  protected addBubble (monst :Object3D, state :ActorState) :void {
    const bubble = new Sprite(this._bubbleMaterial)
    bubble.name = "bubble"
    const emoji = new Sprite()
    emoji.name = "emo"
    bubble.add(emoji)
    bubble.position.y =  1.2
    bubble.scale.set(.8, .8, .8)
    monst.add(bubble)
    this.updateBubble2(monst, state)
  }

  protected updateBubble (actorInfo :ActorInfo, state :ActorState) :void {
    const obj = this._obj.read(actorInfo.entityId)
    this.updateBubble2(obj, state)
  }

  protected updateBubble2 (monst :Object3D, state :ActorState) :void {
    const bub = monst.getObjectByName("bubble")
    if (!bub) return
    const material = this._emojis.get(state.action)
    bub.visible = material !== undefined
    if (material) {
      (bub.children[0] as Sprite).material = material
    }
  }

  protected addActor (id :number, state :ActorState) :ActorInfo {
    const cfg = this._ranch.actorConfig.get(id)
    if (!cfg) {
      // this isn't supposed to happen
      throw new Error("Actor doesn't have a config in the RanchModel")
    }

    // Preloading!
    const toSpawn = cfg.spawn
    if (toSpawn) {
      // let's go ahead and pre-load the model of what we're going to spawn.
      // Loading the animations is the only way
      this.preloadObj(toSpawn.model.model)
      // everything else is an animation, let's make no assumptions and f'n preload them all!
      for (const key in toSpawn.model) {
        if (key === "model") continue
        const anim = toSpawn.model[key]
        if (anim) this.preloadAnim(anim)
      }
    }

    const graphCfg :GraphConfig = {}

    // make the graph inspectable
//0    const triggerInspect = Mutable.local(false)
//0    let touchTime :number = 0
    graphCfg.inspectable = <NodeConfig>{
      type: "subgraph",
      graph: {
        doubleClick: {type: "doubleClick"},
        hover: {type: "hover", component: "hovers"},
        inspect: {type: "and", inputs: ["doubleClick", "hover"]},
//0        // Hack-in a way that I can bring up the graph even on touch inputs
//0        triggerInspect: {type: "or", inputs: ["inspect", triggerInspect ]},
        ui: {
          type: "ui",
//0          input: "triggerInspect",
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
          size: this._inspectUiSize,
        },
      },
    }

    // set up nodes to capture touches on the actor and call our callback
    graphCfg.hover = {type: "hover", component: "hovers"}

    let timeoutHandle :number|undefined
    graphCfg.detectTouch = {
      type: "onChange",
      input: ["hover", "pressed"],
      callback: (nv :boolean, ov :boolean) => {
        if (timeoutHandle !== undefined) {
          window.clearTimeout(timeoutHandle)
          timeoutHandle = undefined
        }
        if (nv) {
          this.actorTouched(id)
          timeoutHandle = window.setTimeout(() => {
              this.trackActor(id)
              timeoutHandle = undefined
            }, 800)
//0          const time = Date.now()
//0          if (time - touchTime <= 1000) {
//0            triggerInspect.update(true)
//0          }
//0          touchTime = time
//0
//0        } else {
//0          triggerInspect.update(false)
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
    const anyTransitions :PMap<TransitionConfig> = {}
    const defaultTransitions :PMap<TransitionConfig> = {}
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
        url: cfg.model.readyToHatch
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

      if (cfg.model.sleep && cfg.model.faint && cfg.model.wakeUp) {
        graphCfg.isSleeping = <NodeConfig>{
          type: "equals",
          x: "action",
          y: ActorAction.Sleeping,
        }
        animStates.faint = {
          url: cfg.model.faint,
          repetitions: 1,
          clampWhenFinished: true,
          finishBeforeTransition: true,
          transitions: {sleep: {}},
        }
        // only transition to faint from default
        defaultTransitions.faint = {condition: "sleepCond"}
        graphCfg.controller.sleepCond = "isSleeping"
        animStates.sleep = {
          url: cfg.model.sleep,
          transitions: {wake: {condition: "wakeCond"}}
        }

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
        graphCfg.controller.wakeCond = "isWaking"
      } // end: faint / sleep / wakeUp

      // Happy-react happens whenever you touch a monster, even if in the other states.
      // So we need to set up a separate animation controller.
      if (cfg.model.happyReact || cfg.model.hitReact) {
        graphCfg.getInstant = <NodeConfig>{
          type: "property",
          input: "state",
          name: "instant",
        }
        graphCfg.isInstantTouched = <NodeConfig>{
          type: "equals",
          x: "getInstant",
          y: ActorInstant.Touched,
        }
        graphCfg.isInstantHit = <NodeConfig>{
          type: "equals",
          x: "getInstant",
          y: ActorInstant.Hit,
        }
        graphCfg.auxController = <NodeConfig>{
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
              hit: {
                url: cfg.model.hitReact,
                repetitions: 1,
                finishBeforeTransition: true,
              },
              any: {
                transitions: {
                  touched: {condition: "touchCond"},
                  hit: {condition: "hitCond"},
                  default: {}
                },
              },
            },
          },
          touchCond: "isInstantTouched",
          hitCond: "isInstantHit",
        }
      }
    }

    const objDef = <GLTFConfig>{
      type: "gltf",
      url: cfg.model.model,
      onLoad: obj => {
        if (cfg.color !== undefined) this.colorize(obj, new Color(cfg.color))
        makeShadowy(obj)
        if (cfg.kind.isMonster()) this.addBubble(obj, state)
      },
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
   * React to an actor being removed from the ranch model. */
  protected deleteActor (id :number) :void {
    const actorInfo = this._actors.get(id)
    if (!actorInfo) return
    this._actors.delete(id)
    this._domain.delete(actorInfo.entityId)
  }

  protected mouseToLocation (pos :vec2) :Vector3|undefined {
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

  protected actorTouched (id :number) :void {
    this._ranch.actorTouched(id)

    this._ranchObj.ranchq.post({type: "touch", id: id})
  }

  /**
   * Have the camera follow the specified actor. */
  protected trackActor (id :number) :void {
    const actorInfo = this._actors.get(id)
    if (actorInfo) this._camControl.setTrackedEntity(this._domain.ref(actorInfo.entityId))
  }

  /**
   * Place an egg or food. */
  protected doPlacement (pos :Vector3) :void {
    const actorConfig :ActorConfig = (this._uiState === UiState.PlacingEgg)
        ? MonsterDb.getRandomEgg()
        : new ActorConfig(ActorKind.FOOD, <ActorModel>{ model: "monsters/Acorn.glb" })
    this._ranch.addActor(actorConfig, pos)
    this.setUiState(UiState.Default)
  }

  /**
   * Override the Y coordinate with a sample from the navmesh, if possible. */
  protected setY (into :Vector3, terrainFallback? :boolean) :void {
    let obj = this._navMesh || this._terrain // Use the navmesh if we have it
    if (obj) {
      const oldY = into.y
      const CAST_HEIGHT = 10
      into.y = CAST_HEIGHT
      const caster = new Raycaster(into, downY)
      while (obj) {
        for (const result of caster.intersectObject(obj, true)) {
          into.y = result.point.y
          return
        }
        if (terrainFallback && (obj === this._navMesh)) {
          obj = this._terrain
        }
        else break
      }
      into.y = oldY
    }
  }

  /**
   * Make a relative adjustment to the camera and stop tracking any tracked entity. */
  protected adjustCameraTarget (deltaX :number, deltaZ :number) :void {
    this._camControl.clearTrackedEntity()
    this._camControl.adjustTarget(deltaX, deltaZ)
  }

  protected showNavMesh (show :boolean) :void {
    if (!this._terrain || !this._navMesh) return
    const navMeshShowing = (this._navMesh === this._obj.read(this._terrainId))
    if (show !== navMeshShowing) {
      if (show) {
        this._obj.update(this._terrainId, this._navMesh)
        this._scenesys.scene.add(this._navMesh)
        this._scenesys.scene.remove(this._terrain)
      } else {
        this._obj.update(this._terrainId, this._terrain)
        this._scenesys.scene.add(this._terrain)
        this._scenesys.scene.remove(this._navMesh)
      }
    }

    // Log camera details
    log.debug("Camera",
        "dist", this._camControl.distance,
        "target", this._camControl.getTarget(),
        "angle", this._camControl.angle)
  }

  /** Tracks all the urls we've preloaded. */
  // TODO: call some removers when we might think we don't need something anymore
  protected _preloads :Map<string, Remover> = new Map()

  /** Our heads-up-display: global UI. */
  protected _hud :Hud

  /** Handles our camera positioning. */
  protected _camControl! :Lakitu

  /** Displays the chat UI. */
  protected _chat :ChatView

  protected _uiState :UiState = UiState.Default

  protected _pathFinder? :Pathfinding

  protected _ready :boolean = false

  // The properties below are all definitely initialized via the constructor
  protected _host! :HTMLHost
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
  protected _mainLightId! :ID

  /** Our navigation mesh, if loaded. */
  protected _navMesh? :Mesh
  protected _terrain? :Object3D

  protected _ranchObj! :RanchObject

  protected _bubbleMaterial! :SpriteMaterial
  protected readonly _emojis :Map<ActorAction, SpriteMaterial> = new Map()

  protected readonly _inspectUiSize :dim2 = dim2.fromValues(1024, 768)

  protected readonly _actors :Map<number, ActorInfo> = new Map()

  protected readonly _actorChanged = (change :MapChange<number, ActorState>) => {
    if (change.type === "set") {
      this.updateActor(change.key, change.value)
    } else {
      this.deleteActor(change.key)
    }
  }

  // TODO: move into new gesture handler class
  protected readonly _handChanged = (change :MapChange<number, Pointer>) => {

    if (change.type === "deleted") return
    if (!change.value.pressed) return
    switch (this._uiState) {
      case UiState.PlacingEgg:
      case UiState.PlacingFood:
        const loc = this.mouseToLocation(change.value.position)
        if (loc) this.doPlacement(loc)
        break

      case UiState.Default:
        // do panning an zooming
        switch (this._hand.pointers.size) {
          case 1: // mouse panning
            if (change.value.movement[0] || change.value.movement[1]) {
              const MOUSE_FACTOR = -.025
              this.adjustCameraTarget(
                  change.value.movement[0] * MOUSE_FACTOR,
                  change.value.movement[1] * MOUSE_FACTOR)
            }
            break

          case 2: // pinchy zoomy
            const pp = change.value
            if (pp.movement[0] || pp.movement[1]) {
              for (const op of this._hand.pointers.values()) {
                if (op !== pp) {
                  const newDist = vec2.distance(op.position, pp.position)
                  const oldDist = vec2.distance(op.position,
                      [ pp.position[0] - pp.movement[0], pp.position[1] - pp.movement[1] ])
                  const PINCH_FACTOR = .05
                  this._camControl.adjustDistance((oldDist - newDist) * PINCH_FACTOR)
                  break
                }
              }
            }
            break

          case 3: // three finger zoom: Y movement zooms; all 3 for fast; hold 2 and fine tune index
            if (change.value.movement[1]) {
              const THREE_FINGER_FACTOR = -.02
              this._camControl.adjustDistance(change.value.movement[1] * THREE_FINGER_FACTOR)
            }
            break

          default: // do nothing
            break
        }
        break

      default: break
    }
  }

  private static readonly RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
