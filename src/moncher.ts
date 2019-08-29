import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {Subject} from "tfw/core/react"
import {MapChange, MutableMap, RMap} from "tfw/core/rcollect"
import {log, Disposer} from "tfw/core/util"
import {Pointer} from "tfw/input/hand"
import {Texture, Tile} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App} from "./app"
import {GridTileSceneModel, GridTileSceneViewMode, PropTileInfo} from "./gridtiles"
import {MonsterMenu} from "./monstermenu"

/**
 * The kind of actor.
 */
export class ActorKind
{
  // Big fat TODO...
  static readonly EGG :ActorKind = new ActorKind(false, false, false, 0)
  static readonly FOOD :ActorKind = new ActorKind(false, false, false, 0)
  static readonly RUNNER :ActorKind = new ActorKind(true, false, false)
  static readonly HEALER :ActorKind = new ActorKind(false, true, true)
  static readonly LOBBER :ActorKind = new ActorKind(true, false, false)
  static readonly TESTER :ActorKind = new ActorKind(true, true, true)

  private constructor (
    readonly canRangeAttack :boolean,
    readonly canMeleeAttack :boolean,
    readonly canHeal :boolean,
    readonly maxSpeed :number = .025 // units per second
  ) {}
}

/**
 * Configuration for the 3D aspects of an actor. This will probably move.
 */
export interface ActorModel {
  model :string
  /** Idle animation. */
  idle? :string
  /** Eggs use the hatch animation at the end of their lives, other actors at the beginning. */
  hatch? :string
  walk? :string
  attack? :string
  hitReact? :string
  faint? :string
  sleep?: string
  wakeUp?: string
}

/**
 * Configuration of an actor.
 */
export class ActorConfig
{
  constructor (
    /** What the actor looks like in 2D. */
    readonly info? :PropTileInfo, // temp
    readonly model? :ActorModel,
    readonly kind :ActorKind = ActorKind.TESTER,
    readonly spawn? :ActorConfig,
    readonly startingHealth :number = 50,
    readonly maximumHealth :number = 50,
    readonly startingActionPts :number = 5,
    readonly maxActionPts :number = 10,
    readonly regenActionPts :number = .2,
  ) {}
}

export enum ActorAction {
  None,
  Hatching,
}

/**
 * Runtime information about an actor's state.
 */
export class ActorState
{
  constructor (
    /** Visual X coordinate (tile coordinates, floating point). */
    readonly x :number,
    /** Visual Y coordinate (tile coordinates, floating point). */
    readonly y :number,
    /** TODO */
    readonly action :ActorAction,
  ) {}

  // Legacy // TODO: Remove
  get actionPts () :number
  {
    return 20
  }
}

/**
 * An actor.
 */
class ActorNew
{
  /** All actors have health. */
  health :number

  constructor (
    readonly id :number,
    readonly config :ActorConfig,
    public x :number,
    public y :number,
    public action :ActorAction,
  ) {
    this.health = config.startingHealth
    this.postConstruct()
  }

  /**
   * Additional constructor logic for subclasses without having to reimpl the constructor. */
  protected postConstruct () :void
  {
  }

  isMobile () :boolean
  {
    switch (this.config.kind) {
      case ActorKind.EGG: return false
      case ActorKind.FOOD: return false
      default: return (this.action !== ActorAction.Hatching)
    }
  }

  tick (model :RanchModelNew) :void
  {
    // nothing by default
  }

  toState () :ActorState
  {
    return new ActorState(this.x, this.y, this.action)
  }

  setLocation (x :number, y :number) :void
  {
    this.x = x
    this.y = y
  }

  moveTowards (x :number, y :number) :void
  {
  }
}

class Egg extends ActorNew
{
  protected postConstruct () :void {
    // force health because we're going to do modify it in tick
    this.health = 50
  }

  tick (model :RanchModelNew) :void {
    this.health -= 1
    if (this.action === ActorAction.None && (this.health < 20)) {
      this.action = ActorAction.Hatching
      model.addActor(this.config.spawn!, this.x, this.y, ActorAction.Hatching)
    }
  }
}

class Monster extends ActorNew
{
  tick (model :RanchModelNew) :void {
    // TODO!
  }
}

class Food extends ActorNew
{
  tick (model :RanchModelNew) :void {
    this.health -= .01
  }
}

export class RanchModelNew
{
  /** The public view of monster state. */
  get actors () :RMap<number, ActorState> {
    return this._actors
  }

  /** The configuration data for an actor, guaranteed to be populated prior to
   *  'actors' being updated. */
  readonly actorConfig :Map<number, ActorConfig> = new Map<number, ActorConfig>()

  /**
   * Le constructor. */
  constructor (
  ) {
  }

  addActor (config :ActorConfig, x :number, y :number, action = ActorAction.None) :void
  {
    this.validateConfig(config)

    const id = this._nextActorId++
    const clazz :typeof ActorNew = this.pickActorClass(config)
    const data = new clazz(id, config, x, y, action)
    this.actorConfig.set(id, config)
    this._actorData.set(id, data)
    // finally, publish the state of the monster
    this._actors.set(data.id, data.toState())
  }

  protected validateConfig (config :ActorConfig)
  {
    switch (config.kind) {
      case ActorKind.EGG:
        if (!config.spawn) {
          throw new Error("Eggs must specify a spawn config.")
        }
        // validate the spawn too
        this.validateConfig(config.spawn)
        break
    }
  }

  protected pickActorClass (config :ActorConfig) :typeof ActorNew
  {
    switch (config.kind) {
      case ActorKind.EGG: return Egg
      case ActorKind.FOOD: return Food
      default: return Monster
    }
  }

  protected removeActor (data :ActorNew)
  {
    this._actorData.delete(data.id)
    this._actors.delete(data.id)
    // unmap the config last in the reverse of how we started
    this.actorConfig.delete(data.id)
  }

  getNearbyActors (x :number, y :number, maxDist :number = Math.sqrt(2)) :ActorNew[]
  {
    // TODO
    return []
  }

  /**
   * Advance the simulation.
   */
  tick () :void
  {
    for (const actor of this._actorData.values()) {
      actor.tick(this)
    }

    // publish all changes..
    for (const actor of this._actorData.values()) {
      if (actor.health <= 0) {
        this.removeActor(actor)
      } else {
        this._actors.set(actor.id, actor.toState())
      }
    }
  }

  protected _nextActorId :number = 0
  protected readonly _actorData :Map<number, ActorNew> = new Map()
  /** A mutable view of our public actors RMap. */
  protected readonly _actors :MutableMap<number, ActorState> = MutableMap.local()
}

/**
 * An actor.
 */
class Actor
{
  // Toy attributes while playing around. These will all go away.
  hunger :number = 0
  lonliness :number = 0
  boredom :number = 0
  crowding :number = 0

  health :number
  actionPts :number

  /** Recently visited locations, most recent at index 0. */
  locationMemory :vec2[] = []

  constructor (
    readonly id :number,
    readonly config :ActorConfig,
    public x :number,
    public y :number,
    public action :ActorAction,
  ) {
    this.health = config.startingHealth
    this.actionPts = config.startingActionPts
  }

  isMobile () :boolean
  {
    switch (this.config.kind) {
      case ActorKind.EGG: return false
      case ActorKind.FOOD: return false
      default: return (this.action !== ActorAction.Hatching)
    }
  }

//  isEggOrHatching () :boolean
//  {
//    return (this.config.kind === ActorKind.EGG) || (this.action === ActorAction.Hatching)
//  }

  maybeSetAction (cost :number, action :ActorAction) :boolean
  {
    if (this.actionPts < cost) return false

    this.actionPts -= cost
    this.action = action
    return true
  }

  toState () :ActorState
  {
    return new ActorState(this.x, this.y, this.action)
  }

  setLocation (x :number, y :number) :void
  {
    this.x = x
    this.y = y
    if (this.rememberLocation(x, y)) {
      this.boredom = Math.max(0, this.boredom - 20)
    }
  }

  rememberLocation (x :number, y :number) :boolean
  {
    const newLoc = vec2.fromValues(x, y)
    const index = this.getMemoryIndex(newLoc)
    if (index !== -1) {
      // splice it out of the old location
      this.locationMemory.splice(index, 1)

    } else if (this.locationMemory.length === Actor.MEMORY_SIZE) {
      // if we're already at the size, make room for the new location
      this.locationMemory.pop()
    }

    // always add the new location to the front
    this.locationMemory.unshift(newLoc)
    return (index === -1)
  }

  isInMemory (x :number, y :number) :boolean
  {
    return this.getMemoryIndex(vec2.fromValues(x, y)) > -1
  }

  protected getMemoryIndex (loc :vec2) :number
  {
    return this.locationMemory.findIndex(v => vec2.equals(loc, v))
  }

  /** How much memory to keep. */
  protected static readonly MEMORY_SIZE = 16
}

type ScoreFn = (x :number, y :number) => number

export class RanchModel
{
  /** The public view of monster state. */
  get actors () :RMap<number, ActorState> {
    return this._actors
  }

  /** The configuration data for an actor, guaranteed to be populated prior to
   *  'actors' being updated. */
  actorConfig :Map<number, ActorConfig> = new Map<number, ActorConfig>()

  constructor (
    /** The model we're on. */
    readonly model :GridTileSceneModel
  ) {
    this._actors = MutableMap.local()
  }

  /**
   * Add a new monster.
   */
  addMonster (config :ActorConfig, x :number, y :number, action = ActorAction.None) :void
  {
    this.validateConfig(config)

    const id = this._nextActorId++
    const data = new Actor(id, config, Math.trunc(x), Math.trunc(y), action)
    this.actorConfig.set(id, config)
    this._actorData.set(id, data)
    // move the monster to its current location to map it by location
    this.moveMonster(data, data.x, data.y)
    // finally, publish the state of the monster
    this._actors.set(data.id, data.toState())
  }

  protected validateConfig (config :ActorConfig)
  {
    switch (config.kind) {
      case ActorKind.EGG:
        if (!config.spawn) {
          throw new Error("Eggs must specify a spawn config.")
        }
        // validate the spawn too
        this.validateConfig(config.spawn)
        break
    }
  }

  protected removeMonster (data :Actor)
  {
    this.unmapLocation(data)
    this._actorData.delete(data.id)
    this._actors.delete(data.id)
    // unmap the config last in the reverse of how we started
    this.actorConfig.delete(data.id)
  }

  protected moveMonster (data :Actor, newX :number, newY :number)
  {
    this.unmapLocation(data)
    data.setLocation(newX, newY)
    this.mapLocation(data)
  }

  /**
   * Unmap the actor by location.
   */
  protected unmapLocation (data :Actor)
  {
    const oldKey = this.locToKey(data.x, data.y)
    const oldVals = this._actorsByLocation.get(oldKey)
    if (oldVals) {
      const dex = oldVals.indexOf(data.id)
      if (dex !== -1) {
        oldVals.splice(dex, 1)
      }
    }
  }

  protected mapLocation (data :Actor)
  {
    const newKey = this.locToKey(data.x, data.x)
    let newVals = this._actorsByLocation.get(newKey)
    if (!newVals) {
      newVals = []
      this._actorsByLocation.set(newKey, newVals)
    }
    newVals.push(data.id)
  }

  getMonsterCount (x :number, y :number) :number
  {
    return this.getMonsters(x, y).length
//    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
//      const array = this._actorsByLocation.get(this.locToKey(x, y))
//      if (array) return array.length
//    }
//    return 0
  }

  getMonsters (x :number, y :number) :number[]
  {
    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
      const array = this._actorsByLocation.get(this.locToKey(x, y))
      if (array) return array
    }
    return []
  }

  protected getFeature (x :number, y :number) :string
  {
    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
      return this.model.tiles[x][y]
    }
    return ""
  }

  protected locToKey (x :number, y :number) :number
  {
    // TODO: maybe we quantize to tile here?
    return (y * this.model.sceneWidth) + x
  }

  /**
   * Advance the simulation.
   */
  tick () :void
  {
    // first update the internal states of all monsters
    STATE_LOOP:
    for (const monst of this._actorData.values()) {
      // accumulate action points
      monst.actionPts += monst.config.regenActionPts

      switch (monst.config.kind) {
        case ActorKind.FOOD: continue STATE_LOOP

        case ActorKind.EGG:
          switch (monst.action) {
            default:
              if (monst.maybeSetAction(6, ActorAction.Hatching)) {
                // spawn the baby (spawn is asserted as present because we check when egg added)
                this.addMonster(monst.config.spawn!, monst.x, monst.y, ActorAction.Hatching)
              }
              break

            case ActorAction.Hatching:
              // once time has passed here, we delete the monster
              if (monst.actionPts >= 3) {
                this.removeMonster(monst)
              }
              break
          }
          continue STATE_LOOP

        default: // ActorKind
          switch (monst.action) {
            default: break

            case ActorAction.Hatching:
              if (!monst.maybeSetAction(7, ActorAction.None)) {
                continue STATE_LOOP
              }
              break
          }
          break
      }

      // see what kind of tile we're on and react to that
      switch (this.getFeature(monst.x, monst.y)) {
      case "dirt":
        monst.hunger++
        monst.boredom += 2
        break

      case "grass":
        monst.hunger = Math.max(0, monst.hunger - 20)
        monst.boredom++
        break

      case "cobble":
        monst.hunger++
        // no change to boredom
        break
      }

      // examine the nearby tiles for monsters
      let social = 0
      for (let xx = -1; xx < 2; xx++) {
        for (let yy = -1; yy < 2; yy++) {
          const neighbs = this.getMonsterCount(monst.x + xx, monst.y + yy)
          if (xx === 0 && yy === 0) {
            monst.crowding += neighbs - 1 // subtract one for ourselves
            social += neighbs - 1
          } else if (xx === 0 || yy === 0) {
            social += neighbs
          } else {
            social += neighbs / 2 // lesser influence at the corners
          }
        }
      }
      if (social === 0) {
        monst.lonliness++
        monst.crowding = Math.max(0, monst.crowding - 50)
      } else {
        monst.lonliness = Math.max(0, monst.lonliness - social)
      }
    }

    // then figure out if a monster wants to update state/loc
    for (const monst of this._actorData.values()) {
      if (!monst.isMobile()) {
        continue
      }

      const scoreFn :ScoreFn|undefined = this.getScoreFn(monst)
      if (scoreFn === undefined) continue
      let best :vec2[] = []
      let bestScore = Number.MIN_SAFE_INTEGER
      for (let xx = -1; xx < 2; xx++) {
        for (let yy = -1; yy < 2; yy++) {
          if (xx === 0 && yy === 0) continue
          const mx = xx + monst.x
          const my = yy + monst.y
          if (mx < 0 || my < 0 || mx >= this.model.sceneWidth || my >= this.model.sceneHeight) {
            continue
          }
          const score = scoreFn(mx, my)
          if (score > bestScore) {
            bestScore = score
            best = [ vec2.fromValues(mx, my) ]

          } else if (score === bestScore) {
            best.push(vec2.fromValues(mx, my))
          }
        }
      }
      if (bestScore !== Number.MIN_SAFE_INTEGER) {
        const bestLoc = best[Math.trunc(Math.random() * best.length)]
        this.moveMonster(monst, bestLoc[0], bestLoc[1])
      }
    }

    // publish all changes..
    for (const monst of this._actorData.values()) {
      this._actors.set(monst.id, monst.toState())
    }
  }

  protected getScoreFn (monst :Actor) :ScoreFn|undefined
  {
    let fns :ScoreFn[] = []
    if (monst.hunger > 50) {
      fns.push((x, y) => ("grass" === this.getFeature(x, y)) ? monst.hunger : 0)
    }
    if (monst.lonliness > 50) {
      // TODO: this is counting monsters during moves, so it will count wrong
      fns.push((x, y) => (this.getMonsterCount(x, y) > 0) ? monst.lonliness : 0)
    }
    if (monst.boredom > 50) {
      fns.push((x, y) => monst.isInMemory(x, y) ? 0 : monst.boredom)
    }
    if (monst.crowding > 50) {
      fns.push((x, y) => (this.getMonsterCount(x, y) > 0) ? 0 : monst.crowding)
    }
    switch (fns.length) {
      case 0: return undefined
      case 1: return fns[0]
      default: return (x, y) => {
          let weight = 0
          for (const fn of fns) {
            weight += fn(x, y)
          }
          return weight
        }
    }
  }

  protected _nextActorId :number = 0
  protected _actorData :Map<number, Actor> = new Map()
  /** A mutable view of our public actors RMap. */
  protected _actors :MutableMap<number, ActorState>
  /** Maps a location to actors ids. */
  protected _actorsByLocation :Map<number, number[]> = new Map()
}

class ActorSprite
{
  /** The tile for drawing the actor. */
  tile? :Tile
  /** Position. */
  pos :vec2 = vec2.create()
  /** A disposer just for this sprite. */
  disposer :Disposer = new Disposer()

  constructor (
    /** The most recent state. */
    public state :ActorState
  ) {}
}

export class MonsterRancherMode extends GridTileSceneViewMode {
  constructor (
    app :App,
    protected _ranch :RanchModel
  ) {
    super(app, _ranch.model)

    this.onDispose.add(_ranch.actors.onChange(this._monsterChange))
    _ranch.actors.forEach((monster, id) => { this.updateMonster(id, monster) })
  }

  /**
   * Update a monster sprite.
   */
  protected updateMonsterSprite (sprite :ActorSprite, state :ActorState)
  {
    sprite.state = state // just copy the latest state in
    let xx = state.x * this._model.config.tileWidth
    let yy = state.y * this._model.config.tileHeight
    if (sprite.tile) {
      xx -= sprite.tile.size[0] / 2
      yy -= sprite.tile.size[1] / 2
    }
    vec2.set(sprite.pos, xx, yy)
  }

  renderTo (clock :Clock, surf :Surface) :void
  {
    super.renderTo(clock, surf)

    if (this._menu) this._menu.render(clock, surf)
  }

  protected renderToOffset (clock :Clock, surf :Surface) :void
  {
    super.renderToOffset(clock, surf)

    // draw monsters
    for (const monst of this._actors.values()) {
      if (monst.tile) {
        surf.drawAt(monst.tile, monst.pos)
      }
    }
  }

  protected updateMonster (id :number, state :ActorState)
  {
    let sprite = this._actors.get(id)
    if (!sprite) {
      // async lookup tile
      const cfg = this._ranch.actorConfig.get(id)
      if (!cfg) {
        throw new Error("Monster doesn't have a config in the model")
      }
      if (!cfg.info) {
        if (this._doPropSpriteWarning) {
          log.warn("Not creating sprites for monsters with missing PropTileInfo")
          this._doPropSpriteWarning = false
        }
        return
      }

      sprite = new ActorSprite(state)
      this._actors.set(id, sprite)
      this.onDispose.add(sprite.disposer)
      // TODO: NOTE: we're not honoring the width/height in the PropTileInfo here
      const img :Subject<Texture> = this.getTexture(cfg.info.base, cfg.info.scale)
      const remover = img.onValue(tex => {
        sprite!.tile = tex
        // let's just call into updateActorSprite to rejiggle the location
        this.updateMonsterSprite(sprite!, sprite!.state)
      })
      sprite.disposer.add(remover)
    }
    this.updateMonsterSprite(sprite, state)
  }

  protected deleteMonster (id :number)
  {
    const sprite = this._actors.get(id)
    if (!sprite) return
    this._actors.delete(id)
    this.onDispose.remove(sprite.disposer)
    sprite.disposer.dispose()
  }

  protected pointerUpdated (p :Pointer) :void
  {
    if (this._menu) {
      if (p.pressed) {
        this.onDispose.remove(this._menu.disposer)
        this._menu.disposer.dispose()
        this._menu = undefined
      } else {
        return; // suppress any other mouse handling while menu is up
      }
    }

    super.pointerUpdated(p)

    if (p.pressed) {
      // see where that is in tile coordinates
      const x = Math.trunc((p.position[0] - this._offset[0]) / this._model.config.tileWidth)
      const y = Math.trunc((p.position[1] - this._offset[1]) / this._model.config.tileHeight)
      if (x >= 0 && y >= 0 && x < this._model.sceneWidth && y < this._model.sceneHeight) {
        this.tileClicked(x, y)
      }
    }
  }

  protected tileClicked (x :number, y :number) :void
  {
    const array :number[] = this._ranch.getMonsters(x, y)
    if (array.length === 0) return
    const id = array[array.length - 1]
    const config = this._ranch.actorConfig.get(id)! // must be present
    const state = this._ranch.actors.getValue(id)

    const screenX = Math.max(0, (x + .5) * this._model.config.tileWidth + this._offset[0])
    const screenY = Math.max(0, (y + .5) * this._model.config.tileHeight + this._offset[1])
    console.log(`Popping menu at ${screenX} ${screenY}`)

    this._menu = new MonsterMenu(this._app.renderer, config, state, screenX, screenY)
    this.onDispose.add(this._menu.disposer)
  }

  protected readonly _monsterChange = (change :MapChange<number, ActorState>) => {
    if (change.type === "set") {
      this.updateMonster(change.key, change.value)
    } else {
      this.deleteMonster(change.key)
    }
  }

  protected _menu? :MonsterMenu

  protected _doPropSpriteWarning :boolean = true

  protected readonly _actors :Map<number, ActorSprite> = new Map()
}
