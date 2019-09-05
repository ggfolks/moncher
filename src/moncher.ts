import {MutableMap, RMap} from "tfw/core/rcollect"
import {log} from "tfw/core/util"

import {Mesh, Vector3} from "three"
import {Pathfinding} from "three-pathfinding"

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
  sleep? :string
  wakeUp? :string
  eat? :string
  happyReact? :string
}

export class PathRec
{
  constructor (
    /** The source location. */
    readonly src :Vector3,
    /** The destination location. */
    readonly dest :Vector3,
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

/**
 * Configuration of an actor.
 */
export class ActorConfig
{
  constructor (
    readonly kind :ActorKind = ActorKind.TESTER,
    readonly model :ActorModel,
    readonly spawn? :ActorConfig,
    /** A Custom color that may be used to modify the model. */
    readonly color? :number,
    readonly startingHealth :number = 50,
    readonly maximumHealth :number = 50,
    readonly startingActionPts :number = 5,
    readonly maxActionPts :number = 10,
    readonly regenActionPts :number = .2,
    readonly baseWalkSpeed :number = 0.8,
  ) {}
}

export const enum ActorAction {
  Idle,
  Hatching,
  Walking,
  Eating,
  Sleeping,
  Waking,
  Unknown,
}

/**
 * Runtime information about an actor's state.
 */
export class ActorState
{
  constructor (
    /** The position of this actor. */
    readonly pos :Vector3,
    /** The actor's scale. */
    readonly scale :number,
    /** The current activity of the actor. */
    readonly action :ActorAction,
    /** Any path segments the actor is following. */
    readonly path? :PathRec,
    /** Are we being touched by a user? */
    readonly touched? :boolean,
  ) {}
}

/**
 * An actor.
 */
type ConstructableActorClass = { new (...args :any[]) :Actor }
abstract class Actor
{
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
    this.health = config.startingHealth
    this.postConstruct()
  }

  /**
   * Additional constructor logic for subclasses without having to reimpl the constructor. */
  protected postConstruct () :void
  {
  }

  abstract tick (model :RanchModel, dt :number) :void

  /**
   * This actor has been touched by a user.
   */
  touched () :void {
    // by default do nothing
  }

  toState () :ActorState
  {
    return new ActorState(
        this.pos.clone(), this.getScale(), this.action, this.getPath(), this.isTouched())
  }

  getScale () :number {
    return 1
  }

  getPath () :PathRec|undefined {
    return undefined
  }

  isTouched () :boolean {
    return false
  }
}

class Egg extends Actor
{
  protected postConstruct () :void {
    // force health because we're going to do modify it in tick
    this.health = 50
  }

  tick (model :RanchModel, dt :number) :void {
    this.health -= 1
    if (this.action === ActorAction.Idle && (this.health < 20)) {
      this.action = ActorAction.Hatching
      model.addActor(this.config.spawn!, this.pos, ActorAction.Hatching)
    }
  }
}

class Monster extends Actor
{
  protected static DEBUG_FACTOR = 1

  tick (model :RanchModel, dt :number) :void {
    if (this._touched > 0) this._touched--

    switch (this.action) {
      case ActorAction.Hatching:
        if (++this._counter >= 20 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Idle)
        }
        break

      case ActorAction.Walking:
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
            this.setAction(ActorAction.Idle)
            // proceed to assign path to undefined, and we'll fall out of the while.
          }
          path = this._path = path.next
        }
        break

      case ActorAction.Eating:
        if (++this._counter >= 20 / Monster.DEBUG_FACTOR) {
          this._hunger = 0
          this._scale *= 1.2
          this.setAction(ActorAction.Sleeping)
        }
        break

      case ActorAction.Sleeping:
        if (++this._counter >= 100 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Waking, Math.random() * 10)
        }
        break

      case ActorAction.Waking:
        if (++this._counter >= 10 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Idle) // just giving time to wake up fully
        }
        break

      case ActorAction.Unknown: // Do nothing for a little while
        if (++this._counter >= 20 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Idle)
        }
        break

      default: // Idle
        if (++this._hunger > 100 / Monster.DEBUG_FACTOR) {
          const food = model.getNearestActor(this.pos,
              actor => (actor.config.kind === ActorKind.FOOD))
          if (food) {
            if (this.pos.distanceTo(food.pos) < .1) {
              this.setAction(ActorAction.Eating)
            } else {
              this.walkTo(model, food.pos)
            }
            break
          }
          // no food? Fall back to wandering...
        }

        // Wander randomly!
        if (Math.random() < (.075 * Monster.DEBUG_FACTOR)) {
          const newpos = model.randomPositionFrom(this.pos)
          if (newpos) {
            this.walkTo(model, newpos)
          }
        }
        break
    }
  }

  touched () :void {
    this._touched = 2
  }

  getScale () :number {
    return this._scale
  }

  /** Get the actor's speed specified in distance per second. */
  getSpeed () :number {
    return this.config.baseWalkSpeed * this._scale
  }

  getPath () :PathRec|undefined {
    return this._path
  }

  isTouched () :boolean {
    return this._touched > 0
  }

  protected walkTo (model :RanchModel, newPos :Vector3) :void
  {
    const path = model.findPath(new Vector3().copy(this.pos), newPos)
    if (!path) {
      this.setAction(ActorAction.Unknown)
      return
    }

    let rec :PathRec|undefined = undefined
    const speed = 1000 / this.getSpeed()
    while (path.length > 1) {
      const dest = path.pop()!
      const src = path[path.length - 1]
      const duration = src.distanceTo(dest) * speed
      rec = new PathRec(src, dest, duration, rec)
    }
    this._path = rec
    this.setAction(ActorAction.Walking)
  }

  protected setAction (action :ActorAction, counterInit :number = 0) :void
  {
    this.action = action
    this._counter = Math.trunc(counterInit)
  }

  protected _counter :number = 0
  protected _hunger :number = 0
  protected _scale :number = 1
  protected _path? :PathRec

  // a countdown since the last time we were touched
  protected _touched :number = 0
}

class Food extends Actor
{
  tick (model :RanchModel) :void {
    this.health -= .01 // food decays
  }
}

export class RanchModel
{
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
    this._navMesh = navmesh

    // configure pathfinding
    this._pathFinder = new Pathfinding()
    this._pathFinder.setZoneData(RanchModel.RANCH_ZONE, Pathfinding.createZone(navmesh.geometry))
  }

  /**
   * Called from client. */
  actorTouched (id :number) :void
  {
    const actor = this._actorData.get(id)
    if (actor) {
      actor.touched()
      // re-publish that actor immediately
      this._actors.set(actor.id, actor.toState())
    }
  }

  /**
   * Called from client. */
  addActor (config :ActorConfig, pos :Vector3, action = ActorAction.Idle) :void
  {
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

  protected pickActorClass (config :ActorConfig) :ConstructableActorClass
  {
    switch (config.kind) {
      case ActorKind.EGG: return Egg
      case ActorKind.FOOD: return Food
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
      maxDist :number = Number.POSITIVE_INFINITY) :Actor|undefined {
    let nearest = undefined
    for (const actor of this._actorData.values()) {
      if (predicate(actor)) {
        const dd = pos.distanceToSquared(actor.pos)
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
  randomPositionFrom (pos :Vector3) :Vector3|undefined {
    if (!this._pathFinder) {
      log.warn("Pathfinder unknown. Movement limited.")
      return pos
    }

    const groupId = this._pathFinder.getGroup(RanchModel.RANCH_ZONE, pos)
    const node = (groupId === null)
        ? new Vector3()
        : this._pathFinder.getRandomNode(
            RanchModel.RANCH_ZONE, groupId, pos, Number.POSITIVE_INFINITY)
    return node
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
   * @param dt delta time, in milliseconds.
   */
  tick (dt :number) :void
  {
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

  protected _navMesh? :Mesh
  protected _pathFinder? :Pathfinding

  protected _nextActorId :number = 0
  protected readonly _actorData :Map<number, Actor> = new Map()
  /** A mutable view of our public actors RMap. */
  protected readonly _actors :MutableMap<number, ActorState> = MutableMap.local()

  private static RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
