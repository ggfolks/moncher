import {MutableMap, RMap} from "tfw/core/rcollect"
import {log} from "tfw/core/util"

import {Mesh, Vector3} from "three"
import {Pathfinding} from "./pathfinding"
import {MONSTER_ACCELERANT} from "./debug"

/** Actor kinds. */
export const enum ActorKind {
  /** These will be persisted. Do not reuse ids. */
  Egg = 1,
  Food = 2,
  Lobber = 3,
  Runner = 4,
}

/**
 * Static methods to go with ActorKind. */
export class ActorKindAttributes {
  /**
   * Is the specified kind a monster? */
  static isMonster (kind :ActorKind) :boolean {
    switch (kind) {
      case ActorKind.Egg: case ActorKind.Food: return false
      default: return true
    }
  }

  static initialHealth (kind :ActorKind) :number {
    switch (kind) {
      default: return 50
    }
  }

  static baseMovementSpeed (kind :ActorKind) :number {
    switch (kind) {
      default: return .7
    }
  }
}

/**
 * An interface for things that have a location. */
export interface Located {
  x :number
  y :number
  z :number
}

/**
 * Configuration for the 3D aspects of an actor. This will probably move. */
export interface ActorModel {
  model :string
  /** Idle animation. */
  idle? :string
  readyToHatch? :string
  /** Eggs use the hatch animation at the end of their lives, other actors at the beginning. */
  hatch? :string
  walk? :string
  attack? :string
  hitReact? :string
  faint? :string
  sleep? :string
  wakeUp? :string
  eat? :string
  happyReact? :string
}

export class PathRec {

  constructor (
    /** The source location. */
    readonly src :Vector3,
    /** The destination location. */
    readonly dest :Vector3,
    /** The orientation while traversing this segment. */
    readonly orient :number,
    /** The duration. */
    readonly duration :number,
    /** Any next segment. */
    readonly next? :PathRec
  ) {
    this.timeLeft = duration
  }

  /** Ending timestamp (client only). */
  // TRANSIENT?
  stamp? :number

  /** Time left (server only) */
  // TRANSIENT?
  timeLeft :number
}

export interface ActorConfig {
  kind :ActorKind
  model :ActorModel
  spawn? :ActorConfig
  color? :number
}

// ActorAction -> ActorState, probably
// behind that will be a Behavior, which has its own internal state and moves between states
// behind that are _joneses_ which trigger different behaviors.
// maybe ActorState -> ActorUpdate

export const enum ActorAction {
  Idle = 1,
  ReadyToHatch,
  Hatching,
  Walking,
  Waiting,
  SeekingFood,
  Eating,
  Sleepy,
  Sleeping,
  Waking,
  Unknown,
}

/**
 * Represents 1 "instant action" that an actor can have. */
export const enum ActorInstant {
  None = 0,
  Touched,
  Hit,
}

/**
 * Runtime information about an actor's state. */
export class ActorState {

  constructor (
    /** The position of this actor. */
    readonly pos :Vector3,
    /** The actor's scale. */
    readonly scale :number,
    /** The actor's orientation. */
    readonly orient :number,
    /** The current activity of the actor. */
    readonly action :ActorAction,
    /** Any path segments the actor is following. */
    readonly path? :PathRec,
    /** Are we being touched by a user? */
    readonly instant :ActorInstant = ActorInstant.None,
  ) {}

  static createDummy () :ActorState {
    return new ActorState(new Vector3(), 1, 0, ActorAction.Unknown)
  }
}

export interface PathInfo {
}

/**
 * The latest public update from an actor.  */
export interface ActorUpdate extends Located {
  x :number
  y :number
  z :number
  scale :number
  orient :number
  action :ActorAction    // rename to "state"
  instant :ActorInstant // TODO: WILL BE REMOVED
  path? :PathInfo
}

/**
 * Return a blank (dummy) ActorUpdate. */
export function blankActorUpdate () :ActorUpdate {
  return {
    x: 0,
    y: 0,
    z: 0,
    scale: 0,
    orient: 0,
    action: ActorAction.Idle,
    instant: ActorInstant.None,
    path: undefined,
  }
}

/**
 * An actor's "private" "server-side" data. */
export interface ActorData extends Located {
  /** The actor's health (hit points). Actors are removed when this is 0 or less. */
  hp :number
  x :number
  y :number
  z :number

  action :ActorAction
  hunger :number
  counter :number       // TODO: going away, subsumed into new "Behavior" type
  scale :number
  path :PathInfo
  orient :number
  instant :ActorInstant // TODO: going away
  stateStack :ActorAction[] // Almost certainly going away because Behavior will handle it
}

/**
 * Return a new ActorData, mostly blank. */
export function newActorData (kind? :ActorKind, locProps? :Located) :ActorData {
  let x = 0, y = 0, z = 0
  const hp = kind ? ActorKindAttributes.initialHealth(kind) : 1
  if (locProps) ({x, y, z} = locProps)
  return {
    x, y, z,
    hp,
    action: ActorAction.Idle,
    hunger: 0,
    scale: 1,
    path: {},
    orient: 0,
    stateStack: [],

    instant: ActorInstant.None,
    counter: 0,
  }
}

/**
 * Publish an actor update derived from the specified ActorData. */
export function actorDataToUpdate (data :ActorData) :ActorUpdate {
  const {x, y, z, scale, orient, action, instant} = data
  return {
    x, y, z,
    scale,
    orient,
    action,
    instant,
  }
}

/**
 * An actor. */
type ConstructableActorClass = { new (...args :any[]) :Actor }
abstract class Actor {
  /** Location. */
  pos :Vector3

  /** All actors have health. */
  health :number

  constructor (
    readonly id :number,
    readonly config :ActorConfig,
    position :Vector3,
    public action :ActorAction,
  ) {
    this.pos = position.clone()
    this.health = ActorKindAttributes.initialHealth(config.kind)
    this.postConstruct()
  }

  /**
   * Additional constructor logic for subclasses without having to reimpl the constructor. */
  protected postConstruct () :void {
  }

  abstract tick (model :RanchModel, dt :number) :void

  /**
   * This actor has been touched by a user.
   */
  setTouched (model :RanchModel) :void {
    // by default do nothing
  }

  toState () :ActorState {
    return new ActorState(
        this.pos.clone(), this.getScale(), this.getOrient(),
        this.action, this.getPath(), this.getInstant())
  }

  getScale () :number {
    return 1
  }

  getOrient () :number {
    return 0
  }

  getPath () :PathRec|undefined {
    return undefined
  }

  getInstant () :ActorInstant {
    return ActorInstant.None
  }
}

class Egg extends Actor {

  // override
  setTouched (model :RanchModel) :void {
    switch (this.action) {
      case ActorAction.ReadyToHatch:
        this.action = ActorAction.Hatching
        model.addActor(this.config.spawn!, this.pos, ActorAction.Hatching)
        break

      default:
        // do nothing  (Maybe play wiggle once?)
        break
    }
  }

  tick (model :RanchModel, dt :number) :void {
    switch (this.action) {
      case ActorAction.Idle:
        if (--this.health < 20 * MONSTER_ACCELERANT) {
          this.action = ActorAction.ReadyToHatch
        }
        break;

      case ActorAction.Hatching:
        --this.health
        break

      default:
        // do nothing
        break
    }
  }
}

class Monster extends Actor {

  tick (model :RanchModel, dt :number) :void {
    // clear the "instant"
    this._instant = ActorInstant.None

    switch (this.action) {
      case ActorAction.Waiting:
        if (--this._counter <= 0) {
          this.setAction(ActorAction.Idle)
        }
        break

      case ActorAction.Hatching:
        this.setAction(ActorAction.Waiting, 3)
        break

      case ActorAction.Walking:
      case ActorAction.Sleepy:
      case ActorAction.SeekingFood:
        // advance along our path positions
        let path = this._path
        while (path) {
          if (dt < path.timeLeft) {
            path.timeLeft -= dt
            // update our position along this path piece
            this.pos.lerpVectors(path.dest, path.src, path.timeLeft / path.duration)
            return
          }
          // otherwise we used-up a path segment
          if (path.next) {
            dt -= path.timeLeft
          } else {
            // otherwise we have finished!
            this.pos.copy(path.dest)
            this.setAction(this.popState(), this._counter)
            // proceed to assign path to undefined, and we'll fall out of the while.
          }
          path = this._path = path.next
        }
        break

      case ActorAction.Eating:
        if (--this._counter <= 0) {
          this._hunger = 0
          this._scale *= 1.2
          const newpos = model.randomPositionFrom(this.pos, 2)
          if (newpos) {
            this.setAction(ActorAction.Sleepy)
            this.pushState(ActorAction.Sleeping)
            this._counter = 100 / MONSTER_ACCELERANT
            this.walkTo(model, newpos, .5)
          } else {
            this.setAction(ActorAction.Sleeping, 100 / MONSTER_ACCELERANT)
          }
        }
        break

      case ActorAction.Sleeping:
        if (--this._counter <= 0) {
          this.setAction(ActorAction.Waking)
        }
        break

      case ActorAction.Waking:
        this.setAction(ActorAction.Waiting, 8 / MONSTER_ACCELERANT)
        break

      case ActorAction.Unknown: // Do nothing for a little while
        if (--this._counter <= 0) {
          this.setAction(this.popState())
        }
        break

      case ActorAction.Idle:
        if (++this._hunger > 100 / MONSTER_ACCELERANT) {
          const food = model.getNearestActor(this.pos,
              actor => (actor.config.kind === ActorKind.Food))
          if (food) {
            if (this.pos.distanceTo(food.pos) < .1) {
              food.health -= 10
              this.setAction(ActorAction.Eating, 10 / MONSTER_ACCELERANT)
            } else {
              this.setAction(ActorAction.SeekingFood)
              this.walkTo(model, food.pos, 1.5)
            }
            break
          }
          // no food? Fall back to wandering...
        }

        // Maybe go visit a nice egg
        if (Math.random() < .2) {
          const isEgg = (actor :Actor) :boolean => (actor.config.kind === ActorKind.Egg)
          const isReadyEgg = (actor :Actor) :boolean =>
              (isEgg(actor) && (actor.action === ActorAction.ReadyToHatch))
          const egg = model.getNearestActor(this.pos, isReadyEgg) ||
              model.getNearestActor(this.pos, isEgg)
          if (egg) {
            const nearEgg = model.randomPositionFrom(egg.pos, 5)
            if (nearEgg) {
              this.walkTo(model, nearEgg, 1.2)
            }
          }
          break
        }

        // Wander randomly!
        if (Math.random() < .075) {
          const newpos = model.randomPositionFrom(this.pos, 10)
          if (newpos) {
            this.walkTo(model, newpos)
          }
        }
        break

      default:
        log.warn("Unhandled action in Monster.tick", "action", this.action)
        break
    }
  }

  setTouched (model :RanchModel) :void {
    switch (this.action) {
      case ActorAction.Sleeping:
        this.setAction(ActorAction.Waking)
        break

      default:
        this._instant = (Math.random() < .8) ? ActorInstant.Touched : ActorInstant.Hit
        break
    }

    switch (this.action) {
      case ActorAction.Waiting:
      case ActorAction.Idle:
        this._orient = 0 // rotate forward
        break
    }
  }

  getScale () :number {
    return this._scale
  }

  getOrient () :number {
    return this._orient
  }

  /** Get the actor's speed specified in distance per second. */
  getSpeed () :number {
    return ActorKindAttributes.baseMovementSpeed(this.config.kind) * this._scale
  }

  getPath () :PathRec|undefined {
    return this._path
  }

  getInstant () :ActorInstant {
    return this._instant
  }

  protected pushState (state :ActorAction) :void {
    this._stateStack.push(state)
  }

  protected popState () :ActorAction {
    return this._stateStack.pop() || ActorAction.Idle
  }

  protected walkTo (model :RanchModel, newPos :Vector3, speedFactor = 1) :void {
    const path = model.findPath(new Vector3().copy(this.pos), newPos)
    if (!path) {
      log.warn("Unable to find path",
          "src", this.pos,
          "dest", newPos)
      this.setAction(ActorAction.Unknown)
      return
    }

    // TEMP?
    // make sure we would be able to find a path back!
    const pathBack = model.findPath(newPos, path[0])
    if (!pathBack) {
      log.warn("Unable to find a path BACK from point. Skipping",
          "point", newPos)
      this.setAction(ActorAction.Unknown)
      return
    }
    // END: TEMP

    let rec :PathRec|undefined = undefined
    const speed = 1000 / (this.getSpeed() * speedFactor)
    while (path.length > 1) {
      const dest = path.pop()!
      const src = path[path.length - 1]
      const duration = src.distanceTo(dest) * speed
      const orient = Math.atan2(dest.x - src.x, dest.z - src.z)
      rec = new PathRec(src, dest, orient, duration, rec)
    }
    this._path = rec
    if (!this.isWalkingState(this.action)) {
      this.setAction(ActorAction.Walking)
    }
    // set our final angle to something wacky
    this._orient = Math.random() * Math.PI * 2
  }

  protected isWalkingState (act :ActorAction) :boolean
  {
    switch (act) {
      case ActorAction.Walking:
      case ActorAction.Sleepy:
      case ActorAction.SeekingFood:
        return true

      default: return false
    }
  }

  protected setAction (action :ActorAction, counterInit :number = 0) :void {
    this.action = action
    this._counter = Math.trunc(counterInit)
  }

  protected _counter :number = 0
  protected _hunger :number = 0
  protected _scale :number = 1
  protected _path? :PathRec
  protected _orient :number = 0

  protected _instant :ActorInstant = ActorInstant.None

  protected _stateStack :ActorAction[] = []
}

class Food extends Actor {

  tick (model :RanchModel) :void {
    this.health -= .01 // food decays
  }
}

export class RanchModel {

  /** The public view of actor state. */
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

  /**
   * Set the navmesh. */
  // TODO: this will be loaded some other way on the server
  setNavMesh (navmesh :Mesh) :void {
    // configure pathfinding
    this._pathFinder = new Pathfinding()
    this._pathFinder.setZoneData(RanchModel.RANCH_ZONE,
        Pathfinding.createZone(navmesh.geometry as any))
  }

  /**
   * Called from client. */
  actorTouched (id :number) :void {
    const actor = this._actorData.get(id)
    if (actor) {
      actor.setTouched(this)
      // re-publish that actor immediately
      this._actors.set(actor.id, actor.toState())
    }
  }

  /**
   * Called from client. */
  addActor (config :ActorConfig, pos :Vector3, action = ActorAction.Idle) :void {
    this.validateConfig(config)
    // TODO: validate location? // We could pathfind from a known good location on the ranch
    // and then take the final position of the path.

    const id = this._nextActorId++
    const clazz = this.pickActorClass(config)
    const data = new clazz(id, config, pos, action)
    this.actorConfig.set(id, config)
    this._actorData.set(id, data)
    // finally, publish the state of the actor
    this._actors.set(data.id, data.toState())
  }

  protected validateConfig (config :ActorConfig) {
    switch (config.kind) {
      case ActorKind.Egg:
        if (!config.spawn) {
          throw new Error("Eggs must specify a spawn config.")
        }
        // validate the spawn too
        this.validateConfig(config.spawn)
        break
    }
  }

  protected pickActorClass (config :ActorConfig) :ConstructableActorClass {
    switch (config.kind) {
      case ActorKind.Egg: return Egg
      case ActorKind.Food: return Food
      default: return Monster
    }
  }

  protected removeActor (data :Actor) {
    this._actorData.delete(data.id)
    this._actors.delete(data.id)
    // unmap the config last in the reverse of how we started
    this.actorConfig.delete(data.id)
  }

  getNearestActor (
      pos :Vector3,
      predicate :(actor :Actor) => boolean,
      maxDist :number = Infinity) :Actor|undefined {
    let nearest = undefined
    for (const actor of this._actorData.values()) {
      if (predicate(actor)) {
        const dd = pos.distanceTo(actor.pos)
        if (dd < maxDist) {
          maxDist = dd
          nearest = actor
        }
      }
    }
    return nearest
  }

  /**
   * Find a new random location reachable from the specified location. */
  randomPositionFrom (pos :Vector3, maxDist = Infinity) :Vector3|undefined {
    if (!this._pathFinder) {
      log.warn("Pathfinder unknown. Movement limited.")
      return pos
    }
    const groupId = this._pathFinder.getGroup(RanchModel.RANCH_ZONE, pos)
    if (groupId === null) return undefined
    return this._pathFinder.getRandomPositionFrom(RanchModel.RANCH_ZONE, groupId, pos, maxDist)
  }

  findPath (src :Vector3, dest :Vector3) :Vector3[]|undefined {
    if (!this._pathFinder) {
      log.warn("Pathfinder unknown. Can't path.")
      return undefined
    }
    const groupId = this._pathFinder.getGroup(RanchModel.RANCH_ZONE, src)
    if (groupId === null) return undefined
    const foundPath = this._pathFinder.findPath(src, dest, RanchModel.RANCH_ZONE, groupId)
    if (!foundPath) return undefined
    // put the damn src back on the start of the list
    foundPath.unshift(src)
    return foundPath
  }

  /**
   * Advance the simulation.
   * @param dt delta time, in milliseconds.  */
  tick (dt :number) :void {
    for (const actor of this._actorData.values()) {
      actor.tick(this, dt)
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

  protected _pathFinder? :Pathfinding

  protected _nextActorId :number = 0
  protected readonly _actorData :Map<number, Actor> = new Map()
  /** A mutable view of our public actors RMap. */
  protected readonly _actors :MutableMap<number, ActorState> = MutableMap.local()

  private static RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
