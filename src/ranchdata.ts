import {UUID, UUID0} from "tfw/core/uuid"
import {PMap} from "tfw/core/util"

/** The name of the magical global object containing serverside request functions. */
export const SERVER_FUNCS = "_serverFuncs"

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
   * Get all the kinds that represent monsters. */
  static getAllMonsters () :ActorKind[] {
    return [ ActorKind.Lobber, ActorKind.Runner ]
  }

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
  // these are persisted, do not renumber!
  Idle = 1,

  ReadyToHatch = 101,
  Hatching = 102,
  Hatched = 103, // use by eggs once they hatch

  Walking = 201,
  Waiting = 202,
  SeekingFood = 203,
  Eating = 204,
  Sleepy = 205,
  Sleeping = 206,

  Unknown = 999,
}

/**
 * Represents 1 "instant action" that an actor can have. */
export const enum ActorInstant {
  // these are persisted, do not renumber!
  None = 0,
  Touched = 1,
  Hit = 2,
}

export interface PathInfo {
  src :Located
  dest :Located
  orient :number
  duration :number
  next? :PathInfo
  timeLeft :number // Server value (TBD)
  stamp? :number // CLIENT value (TBD!!)
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
  owner: UUID
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
    owner: UUID0,
    action: ActorAction.Idle,
    instant: ActorInstant.None,
    path: undefined,
  }
}

/** The behavior data for an actor. */
export type BehaviorData = PMap<number>

/**
 * An actor's "private" "server-side" data. */
export interface ActorData extends Located {
  /** The actor's health (hit points). Actors are removed when this is 0 or less. */
  hp :number
  x :number
  y :number
  z :number

  owner :UUID
  action :ActorAction
  hunger :number
  counter :number       // TODO: going away, subsumed into new "Behavior" type
  scale :number
  path? :PathInfo
  orient :number
  instant :ActorInstant // TODO: going away
  stateStack :ActorAction[] // Almost certainly going away because Behavior will handle it

  /** Data related to the current behavior, if any. */
  data? :BehaviorData
}
