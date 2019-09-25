import {
  AnimationMixer,
  Camera,
  Color,
  DirectionalLight,
  Object3D,
  Light,
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
import {UUID, UUID0} from "tfw/core/uuid"
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
import {StateConfig, TransitionConfig} from "tfw/scene3/animation"
import {
  AnimationSystem,
  HoverMap,
  SceneSystem,
  loadGLTFAnimationClip,
} from "tfw/scene3/entity"
import {HTMLHost} from "tfw/ui/element"

import {registerLogicNodes} from "tfw/graph/logic"
import {registerMathNodes} from "tfw/graph/math"
import {SubgraphRegistry, registerUtilNodes} from "tfw/graph/util"
import {registerEntityNodes} from "tfw/entity/node"
import {registerSpaceNodes} from "tfw/space/node"
import {registerScene3Nodes, registerScene3Subgraphs} from "tfw/scene3/node"
import {registerPhysics3Nodes} from "tfw/physics3/node"
import {registerInputNodes} from "tfw/input/node"
import {registerUINodes} from "tfw/ui/node"
import {Graph, GraphConfig} from "tfw/graph/graph"
import {NodeContext, NodeTypeRegistry} from "tfw/graph/node"
import {DefaultStyles, DefaultTheme} from "tfw/ui/theme"

import {App, Mode} from "./app"
import {
  ActorConfig,
  ActorInstant,
  ActorKind,
  ActorKindAttributes,
  ActorState,
  ActorUpdate,
  PathInfo,
  blankActorUpdate,
} from "./ranchdata"
import {loc2vec} from "./ranchutil"
import {Hud, UiState} from "./hud"
import {ChatView} from "./chat"
import {Lakitu} from "./lakitu"
import {RanchObject, RanchReq} from "./data"
import {InstallAppView} from "./ui"
import {showEggInvite, showEggAuth} from "./egg"

class ActorInfo {

  constructor (
    /** The id from server. */
    readonly id :UUID,
    /** The id in the entity system. */
    readonly entityId :number,
    /** An easy reference to the config. */
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
    readonly paths :Component<PathInfo|undefined>,
    readonly updates :Component<ActorUpdate>,
    readonly setY :(into :Vector3) => void,
  ) {
    super(domain, Matcher.hasAllC(trans.id, paths.id))
  }

  update (clock :Clock) {
    const timestamp = clock.time / 1000
    this.onEntities(id => {
      let thePath = this.paths.read(id)
      let path = thePath
      // TODO: handle "facing" directions somewhere, either here or the model
      // maybe here since we handle advancing along segments that the model hasn't yet!
      let overtime = 0
      while (path) {
        if (!path.stamp) {
          path.stamp = timestamp + path.duration - overtime
          this.updateOrient(id, path.orient)
        }
        const timeLeft = path.stamp - timestamp
        if (timeLeft <= 0) {
          overtime = -timeLeft
          path.ended = true
          path = path.next
          if (!path) {
            // if at the end of the paths, update the orient to the state orient
            this.updateOrient(id, this.updates.read(id).orient)
            // update the component with the fact that the last segment is ended!
            this.paths.update(id, thePath)
          }
        } else {
          // otherwise, there's time left and we should update the position
          scratchV.lerpVectors(loc2vec(path.dest), loc2vec(path.src), timeLeft / path.duration)
          this.setY(scratchV)
          this.trans.updatePosition(id, scratchV)
          break
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

function makeLightCastShadows (obj :Object3D) :void {
  if (obj instanceof Light) obj.castShadow = true
}

/**
 * Helper for loading a SpriteMaterial for monster emojional state. */
function makeEmoji (tl :TextureLoader, url :string) :SpriteMaterial {
  return new SpriteMaterial({map: tl.load("monsters/emoji/" + url), color: 0xFFFFFF})
}

export class RanchMode extends Mode {

  constructor (
    protected _app :App,
  ) {
    super()
    this.subscribeToRanch()
    this.configureScene(_app)
    this.loadExtras()

    // But, let's set things to be ready after a short delay even if there's *trouble at the mill*
    // Dispatches to setReady() unless we've been disposed already, but setReady is idempotent.
//    let handle :any
//    const cancelTimeout = () => { clearTimeout(handle) }
//    handle = setTimeout(() => { this.onDispose.remove(cancelTimeout); this.setReady() }, 2000)
//    this.onDispose.add(cancelTimeout)

    this.onDispose.add(this._hud = new Hud(_app, this._host, _app.renderer, this))
    this.setUiState(UiState.Default)

    this.onDispose.add(new ChatView(_app, this._host))
    this.onDispose.add(new InstallAppView(_app, this._host))

    this.onDispose.add(Keyboard.instance.getKeyState(112 /* F1 */).onEmit(
        v => this.showNavMesh(v)))
    this.onDispose.add(Keyboard.instance.getKeyState(113 /* F2 */).onEmit(
        v => {if (v) this.targetNextActor(true)}))
    this.onDispose.add(Keyboard.instance.getKeyState(114 /* F3 */).onEmit(
        v => {if (v) this.targetNextActor(false)}))
    this.onDispose.add(Keyboard.instance.getKeyState(115 /* F4 */).onEmit(
        v => {if (v) this.setUiState(UiState.Debug)}))
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

  get debugMode () :Value<boolean> {
    return this._ranchObj.debug
  }

  setDebug (debug :boolean) :void {
    this._ranchObj.ranchq.post({type: "debug", value: debug})
  }

  /**
   * Send a request to the server to reset the entire ranch. */
  resetRanch () :void {
    this._ranchObj.ranchq.post({type: "reset"})
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
    const ranchId = this._app.state.ranchId
    const [ranch, unranch] = this._app.client.resolve(["ranches", ranchId], RanchObject)
    this._ranchObj = ranch
    this.onDispose.add(unranch)

    const DEBUG_DOBJ = false
    if (DEBUG_DOBJ) {
      //this.onDispose.add(ranch.state.onValue(s => {log.debug("Ranch state: " + s)}))

      // TEMP: log name
      this.onDispose.add(ranch.name.onValue(v => {log.debug("Ranch name : " + v)}))

      // TEMP: debugging for persistence: log everything
      log.debug("Existing actors: " + ranch.actorConfigs.size)
      ranch.actorConfigs.forEach((v, k) => {
        log.debug("Existing actorConfig",
          "key", k,
          "value", v)
      })
      ranch.actors.forEach((v, k) => {
        log.debug("Existing actor",
          "key", k,
          "value", v)
      })
      ranch.actorData.forEach((v, k) => {
        log.debug("Existing actorData",
          "key", k,
          "value", v)
      })
      this.onDispose.add(ranch.actorConfigs.onChange(ch => {
        if (ch.type === "set") {
          log.debug("actor config set",
            "key", ch.key,
            "value", ch.value)
        } else log.debug("actor config delete", "key", ch.key)
      }))
      this.onDispose.add(ranch.actors.onChange(ch => {
        if (ch.type === "set") {
          log.debug("actor set",
            "key", ch.key,
            "value", ch.value)
        } else log.debug("actor delete", "key", ch.key)
      }))
      this.onDispose.add(ranch.actorData.onChange(ch => {
        if (ch.type === "set") {
          log.debug("actor data set",
            "key", ch.key,
            "value", ch.value)
        } else log.debug("actor data delete", "key", ch.key)
      }))
    }
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
      subgraphs: new SubgraphRegistry(registerScene3Subgraphs),
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
    const updates = this._updates =
        new DenseValueComponent<ActorUpdate>("updates", blankActorUpdate())
    const hovers = new SparseValueComponent<HoverMap>("hovers", new Map())
    const paths = this._paths = new SparseValueComponent<PathInfo|undefined>("paths", undefined)
    const graph = this._graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))

    const domain = this._domain = new Domain({},
        {trans, obj, mixer, body, updates, paths, hovers, graph})
    this._pathsys = new PathSystem(domain, trans, paths, updates, this.setY.bind(this))
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

    // TODO: a lightlerper that slowly modifies the lighting between the 4 mood-modes
    const LIGHT_MOODS = ["Sunrise", "Day", "Sunset", "Night"]
    const mood = LIGHT_MOODS[Math.trunc(Math.random() * LIGHT_MOODS.length)]

    log.debug("Mood lighting: " + mood)
    this._mainLightId = domain.add({
      components: {
        trans: {},
        obj: {type: "json", url: "ranch/lights/Primary" + mood + ".json",
              onLoad: makeLightCastShadows},
      }
    })
    domain.add({
      components: {
        trans: {},
        obj: {type: "json", url: "ranch/lights/Rim" + mood + ".json"},
      },
    })
    domain.add({
      components: {
        trans: {},
        obj: {type: "json", url: "ranch/lights/Hemisphere" + mood + ".json"},
      },
    })
//    domain.add({
//      components: {
//        trans: {},
//        obj: {type: "json", url: "ranch/lights/Campfire.json"},
//      },
//    })

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
    //this._emojis.set(ActorState.Default, makeEmoji(tl, "EggIcon.png"))
    this._emojis.set(ActorState.Hungry, makeEmoji(tl, "AcornIcon.png"))
    this._emojis.set(ActorState.Sleepy, makeEmoji(tl, "SleepIcon.png"))
    this._emojis.set(ActorState.RandomMeet, makeEmoji(tl, "PalIcon.png"))
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

//      this.configurePathFinding(navMesh)

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
   * Called once we know enough to start adding actors. */
  protected setReady () :void {
    if (this._ready) return
    this._ready = true

    this.onDispose.add(this._ranchObj.actors.onChange(this._actorChanged))
    this._ranchObj.actors.forEach((actor, id) => { this.updateActor(id, actor) })
  }

  /**
   * React to a actor being updated in the ranch model. */
  protected updateActor (id :UUID, update :ActorUpdate) :void {
    // see if we've given this monster an entity ID yet
    let actorInfo = this._actors.get(id)
    if (!actorInfo) {
      actorInfo = this.addActor(id, update)
    }
    this.updateActorSprite(actorInfo, update)
  }

  /**
   * Effect updates received from the RanchModel. */
  protected updateActorSprite (actorInfo :ActorInfo, update :ActorUpdate) :void {
    // store their state in the entity system...
    this._updates.update(actorInfo.entityId, update)
    this.updatePath(actorInfo, update.path)
    if (!update.path) {
      this._trans.updatePosition(actorInfo.entityId, loc2vec(update, scratchV))
      this._trans.updateQuaternion(actorInfo.entityId,
          scratchQ.setFromAxisAngle(unitY, update.orient))
    }
    this._trans.updateScale(actorInfo.entityId,
        scratchV.set(update.scale, update.scale, update.scale))
    this.updateBubble(actorInfo, update)
  }

  protected updatePath (actorInfo :ActorInfo, path :PathInfo|undefined) :void {
    if (path) {
      // resolve objects against stored path to copy-over timestamps.
      // TODO: make this sane?
      let existingPath = this._paths.read(actorInfo.entityId)
      while (existingPath) {
        if (existingPath.src.x === path.src.x &&
            existingPath.src.y === path.src.y &&
            existingPath.src.z === path.src.z &&
            existingPath.dest.x === path.dest.x &&
            existingPath.dest.y === path.dest.y &&
            existingPath.dest.z === path.dest.z) {
          // let's say: this is the same!
          let pathPiece :PathInfo|undefined = path
          while (pathPiece && existingPath) {
            pathPiece.stamp = existingPath.stamp
            pathPiece.ended = existingPath.ended
            pathPiece = pathPiece.next
            existingPath = existingPath.next
          }
        } else {
          existingPath = existingPath.next
        }
      }
    }

    this._paths.update(actorInfo.entityId, path)
  }

  protected addBubble (monst :Object3D, update :ActorUpdate) :void {
    const bubble = new Sprite(this._bubbleMaterial)
    bubble.name = "bubble"
    const emoji = new Sprite()
    emoji.name = "emo"
    bubble.add(emoji)
    bubble.position.y = 1.0
    bubble.scale.set(.5, .5, .5)
    monst.add(bubble)
    this.updateBubble2(monst, update)
  }

  protected updateBubble (actorInfo :ActorInfo, update :ActorUpdate) :void {
    const obj = this._obj.read(actorInfo.entityId)
    this.updateBubble2(obj, update)
  }

  protected updateBubble2 (monst :Object3D, update :ActorUpdate) :void {
    const bub = monst.getObjectByName("bubble")
    if (!bub) return
    const material = this._emojis.get(update.state)
    bub.visible = material !== undefined
    if (material) {
      (bub.children[0] as Sprite).material = material
    }
  }

  protected addActor (id :UUID, update :ActorUpdate) :ActorInfo {
    const cfg = this._ranchObj.actorConfigs.get(id)
    if (!cfg) {
      // this isn't supposed to happen
      throw new Error("Actor doesn't have a config in the Ranch")
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
    graphCfg.inspectable = {
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
          const config = this._ranchObj.actorConfigs.get(id)
          const update = this._ranchObj.actors.get(id)
          if (config && update) {
            this.actorTouched(id, config, update)
            timeoutHandle = window.setTimeout(() => {
              this.trackActor(id)
              timeoutHandle = undefined
            }, 800)
          }
          else log.warn("Missing data for touched actor",
                        "id", id, "config", config, "update", update)
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

    // set up nodes to read the actor's ActorUpdate, and from that the state
    graphCfg.update = {
      type: "readComponent",
      component: "updates",
    }
    graphCfg.state = {
      type: "getProperty",
      input: "update",
      name: "state",
    }

    // set up animations
    const anyTransitions :PMap<TransitionConfig> = {}
    const defaultTransitions :PMap<TransitionConfig> = {}
    const animStates :PMap<StateConfig> = {
      default: {
        transitions: defaultTransitions,
      },
      any: {
        transitions: anyTransitions,
      },
    }
    graphCfg.controller = {
      type: "animationController",
      component: "mixer",
      config: {
        states: animStates,
      },
    }

    // set up our "Idle" animation as the default state
    if (cfg.model.idle) {
      animStates.default.url = cfg.model.idle
    }

    const isEgg = (cfg.kind === ActorKind.Egg)
    if (cfg.model.hatch) {
      // set up hatching (nearly the same between eggs and monsters)
      graphCfg.isHatching = {
        type: "equals",
        a: "state",
        b: ActorState.Hatching,
      }
      animStates.hatch = {
        url: cfg.model.hatch,
        repetitions: 1,
        finishBeforeTransition: true,
        clampWhenFinished: isEgg, // stop the egg hatch on the last frame
      }
      if (isEgg) {
        // create a blank animation state that is transitioned to when the egg is "Hatched"
        animStates.hatched = {url: ""} // TODO blank animation state?
        anyTransitions.hatched = {condition: "hatchedCond"}
        graphCfg.controller.hatchedCond = "isHatched"

        graphCfg.isHatched = {
          type: "equals",
          a: "state",
          b: ActorState.Hatched,
        }

        // TODO: if I can get a new "invisibilizing animation" from the artists, I can use that
        // for the 'hatched' animation and then the next 4 nodes can be removed:

        // we don't do anything in that animation state except use it to trigger a visibility change
        graphCfg.wasHatched = {
          type: "equals",
          a: "controller",
          b: {value: "hatched"},
        }
        graphCfg.wasEverHatched = {
          type: "or",
          inputs: ["wasHatched", "wasEverHatched"],
        }
        graphCfg.notWasEverHatched = {
          type: "not",
          input: "wasEverHatched",
        }
        graphCfg.setInvisibileOnHatched = {
          type: "updateVisible",
          component: "obj",
          input: "notWasEverHatched",
        }

      } else {
        animStates.hatch.transitions = { default: {} }
      }
      anyTransitions.hatch = {condition: "hatchCond"}
      graphCfg.controller.hatchCond = "isHatching"
    }

    if (isEgg) {
      graphCfg.isReadyToHatch = {
        type: "equals",
        a: "state",
        b: ActorState.ReadyToHatch,
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

//        graphCfg.readPath = {
//          type: "readComponent",
//          component: "paths",
//        }
//        graphCfg.noPath = {
//          type: "equals",
//          a: "readPath",
//          b: undefined,
//        }
//        graphCfg.yesPath = {
//          type: "not",
//          input: "noPath",
//        }
        graphCfg.hasValidPath = {
          type: "value",
          value: Value.constant(false), // placeholder value: will be replaced!
        }
        animStates.walk = {
          url: cfg.model.walk,
          transitions: {
            default: {condition: "!walkCond"},
          }
        }
        anyTransitions.walk = {condition: "walkCond"}
        graphCfg.controller.walkCond = "hasValidPath"
      } // end: walk

      if (cfg.model.eat) {
        graphCfg.isEating = {
          type: "equals",
          a: "state",
          b: ActorState.Eating,
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
        graphCfg.isSleeping = {
          type: "equals",
          a: "state",
          b: ActorState.Sleeping,
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
          transitions: {wake: {condition: "!sleepCond"}}
        }

        animStates.wake = {
          url: cfg.model.wakeUp,
          repetitions: 1,
          finishBeforeTransition: true,
          transitions: {default: {}},
        }
      } // end: faint / sleep / wakeUp

      // Happy-react happens whenever you touch a monster, even if in the other states.
      // So we need to set up a separate animation controller.
      if (cfg.model.happyReact || cfg.model.hitReact) {
        graphCfg.getInstant = {
          type: "getProperty",
          input: "update",
          name: "instant",
        }
        graphCfg.isInstantTouched = {
          type: "equals",
          a: "getInstant",
          b: ActorInstant.Touched,
        }
        graphCfg.isInstantHit = {
          type: "equals",
          a: "getInstant",
          b: ActorInstant.Hit,
        }
        graphCfg.auxController = {
          type: "animationController",
          component: "mixer",
          config: {
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

    const objDef = {
      type: "gltf",
      url: cfg.model.model,
      onLoad: (obj :Object3D) => {
        if (cfg.color !== undefined) this.colorize(obj, new Color(cfg.color))
        makeShadowy(obj)
        if (ActorKindAttributes.isMonster(cfg.kind)) this.addBubble(obj, update)
      },
    }
    const entityId = this._domain.add({
      components: {
        trans: {initial: new Float32Array(
            [update.x, update.y, update.z, 0, 0, 0, 1, 1, 1, 1])},
        obj: objDef,
        updates: {initial: update},
        paths: {},
        hovers: {},
        mixer: {},
        graph: graphCfg,
      },
    })

    if (!isEgg && cfg.model.walk) {
      const realIsWalking = this._paths.getValue(entityId).map(path => {
        if (!path) return false
        while (path.next) path = path.next
        return !path.ended
      })

//      realIsWalking.onEmit(b => {
//        log.debug("realIsWalking: " + b)
//      })

      // get the Graph and update the value
      const graph :Graph = this._graph.read(entityId)
      const node = graph.nodes.get("hasValidPath")
      if (node) {
        node.getProperty("value").update(realIsWalking)
        node.reconnect()
      } else {
        log.warn("hasValidPath node is missing! Did something change?")
      }
    }

    const actorInfo = new ActorInfo(id, entityId, cfg)
    this._actors.set(id, actorInfo)

    this.actorAdded(id)
    return actorInfo
  }

  /**
   * React to an actor being removed from the ranch model. */
  protected deleteActor (id :UUID) :void {
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

  protected actorAdded (id :UUID) {
    // if we arrived via an egg invite, "track" the egg so the camera focuses on it
    if (this._app.state.inviteId === id) this.trackActor(id)
  }

  protected actorTouched (id :UUID, config :ActorConfig, update :ActorUpdate) :void {
    // TEMP: hackery to require invite to touch/hatch egg
    if (!this._ranchObj.debug.current && config.kind === ActorKind.Egg) {
      if (this._app.user.user.key == update.owner) {
        showEggInvite(this._app, this._host, this._app.state.ranchId, id)
        return
      }
      else if (this._app.state.inviteId !== id) {
        log.info("No touchy eggy!", "id", id, "invite", this._app.state.inviteId)
        return
      } else if (!this._app.notGuest.current) {
        showEggAuth(this._app, this._host)
        return
      }
    }
    const req :RanchReq = {type: "touch", id: id}
    if (this._uiState === UiState.Debug) {
      req.arg = {debug: true}
    }
    this._ranchObj.ranchq.post(req)
  }

  /**
   * Have the camera follow the specified actor. */
  protected trackActor (id :UUID) :void {
    const actorInfo = this._actors.get(id)
    if (actorInfo) {
      this._camControl.setTrackedEntity(this._domain.ref(actorInfo.entityId))
      this._lastTrackedActor = id
    }
  }

  /**
   * Target the next actor, possibly constraining to owned ones. */
  targetNextActor (owned :boolean) :void {
    const myId = this._app.client.auth.current.id
    const ids :UUID[] = []
    this._ranchObj.actors.forEach((update, id) => {
      if (owned ? (update.owner === myId) : (update.owner !== UUID0)) {
        ids.push(id)
      }
    })
    if (ids.length === 0) return
    ids.sort()
    const needle = this._lastTrackedActor || UUID0
    this.trackActor(ids[(1 + ids.indexOf(needle)) % ids.length])
  }

  /**
   * Place an egg or food. */
  protected doPlacement (pos :Vector3) :void {
    const isEgg = (this._uiState === UiState.PlacingEgg)
    this._ranchObj.ranchq.post(
        {type: isEgg ? "dropEgg" : "dropFood", x: pos.x, y: pos.y, z: pos.z})
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

  protected _uiState :UiState = UiState.Default

  protected _ready :boolean = false

  /** The last actor we tracked. */
  protected _lastTrackedActor? :UUID

  // The properties below are all definitely initialized via the constructor
  protected _host! :HTMLHost
  protected _webGlRenderer! :WebGLRenderer
  protected _hand! :Hand
  protected _trans! :TransformComponent
  protected _obj! :Component<Object3D>
  protected _updates! :Component<ActorUpdate>
  protected _paths! :Component<PathInfo|undefined>
  protected _graph! :Component<Graph>
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
  protected readonly _emojis :Map<ActorState, SpriteMaterial> = new Map()

  protected readonly _inspectUiSize :dim2 = dim2.fromValues(1024, 768)

  protected readonly _actors :Map<UUID, ActorInfo> = new Map()

  protected readonly _actorChanged = (change :MapChange<UUID, ActorUpdate>) => {
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

      case 5: // five finger tap: let's debug!
        this.setUiState(UiState.Debug)
        break

      default: // do nothing
        break
      }
      break

    default: break
    }
  }
}
