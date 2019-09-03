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
    readonly startingHealth :number = 50,
    readonly maximumHealth :number = 50,
    readonly startingActionPts :number = 5,
    readonly maxActionPts :number = 10,
    readonly regenActionPts :number = .2,
  ) {}
}

export const enum ActorAction {
  Idle,
  Hatching,
  Eating,
  Sleeping,
  Waking,
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

  abstract tick (model :RanchModel) :void

  toState () :ActorState
  {
    return new ActorState(this.pos.clone(), this.getScale(), this.action)
  }

  getScale () :number {
    return 1
  }
}

class Egg extends Actor
{
  protected postConstruct () :void {
    // force health because we're going to do modify it in tick
    this.health = 50
  }

  tick (model :RanchModel) :void {
    this.health -= 1
    if (this.action === ActorAction.Idle && (this.health < 20)) {
      this.action = ActorAction.Hatching
      model.addActor(this.config.spawn!, this.pos, ActorAction.Hatching)
    }
  }
}

class Monster extends Actor
{
  protected static DEBUG_FACTOR = 5

  tick (model :RanchModel) :void {
    switch (this.action) {
      case ActorAction.Hatching:
        if (++this._counter >= 20 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Idle)
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
          this.setAction(ActorAction.Waking)
        }
        break

      case ActorAction.Waking:
        if (++this._counter >= 10 / Monster.DEBUG_FACTOR) {
          this.setAction(ActorAction.Idle)
        }
        break

      default:
        if (++this._hunger > 100 / Monster.DEBUG_FACTOR) {
          const food = model.getNearestActor(this.pos,
              actor => (actor.config.kind === ActorKind.FOOD))
          if (food) {
            if (this.pos.distanceTo(food.pos) < .1) {
              if (++this._counter >= 10 / Monster.DEBUG_FACTOR) {
                food.health -= 10
                this.setAction(ActorAction.Eating)
              }
            } else {
              this.pos.copy(food.pos)
              // TODO: maybe we split off an ActorAction.FindingFood or Walking
              this._counter = 0
            }
            break
          }
          // no food? Fall back to wandering...
        }

        // Wander randomly!
        if (Math.random() < (.025 * Monster.DEBUG_FACTOR)) {
          const newpos = model.randomPositionFrom(this.pos)
          if (newpos) {
            this.pos.copy(newpos)
          }
        }
        break
    }
  }

  getScale () :number {
    return this._scale
  }

  protected setAction (action :ActorAction) :void
  {
    this.action = action
    this._counter = 0
  }

  protected _counter :number = 0
  protected _hunger :number = 0
  protected _scale :number = 1
}

class Food extends Actor
{
  tick (model :RanchModel) :void {
    this.health -= .01
  }
}

export class RanchModel
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

  /**
   * Set the navmesh. */
  // TODO: this will be loaded some other way on the server
  setNavMesh (navmesh :Mesh) :void {
    this._navMesh = navmesh

    // configure pathfinding
    this._pathFinder = new Pathfinding()
    this._pathFinder.setZoneData(RanchModel.RANCH_ZONE, Pathfinding.createZone(navmesh.geometry))
  }

  addActor (config :ActorConfig, pos :Vector3, action = ActorAction.Idle) :void
  {
    this.validateConfig(config)

    const id = this._nextActorId++
    const clazz = this.pickActorClass(config)
    const data = new clazz(id, config, pos, action)
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

  getNearestActor (pos :Vector3, predicate :(actor :Actor) => boolean) :Actor|undefined {
    let nearest = undefined
    let dist = Number.POSITIVE_INFINITY
    for (const actor of this._actorData.values()) {
      if (predicate(actor)) {
        const dd = pos.distanceToSquared(actor.pos)
        if (dd < dist) {
          dist = dd
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
    const node = this._pathFinder.getRandomNode(
        RanchModel.RANCH_ZONE, groupId, pos, Number.POSITIVE_INFINITY)
    return node
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

  protected _navMesh? :Mesh
  protected _pathFinder? :Pathfinding

  protected _nextActorId :number = 0
  protected readonly _actorData :Map<number, Actor> = new Map()
  /** A mutable view of our public actors RMap. */
  protected readonly _actors :MutableMap<number, ActorState> = MutableMap.local()

  private static RANCH_ZONE = "ranch" // zone identifier needed for pathfinding
}
