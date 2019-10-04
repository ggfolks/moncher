import {Record} from "tfw/core/data"
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
  Healer = 5,
  Firefly = 6,

  /** A player-controlled actor. */
  Avatar = 100,
}

/**
 * Static methods to go with ActorKind. */
export class ActorKindAttributes {
  /**
   * Get all the kinds that represent monsters. */
  static getAllMonsters () :ActorKind[] {
    return [ ActorKind.Lobber, ActorKind.Runner, ActorKind.Healer ]
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
    case ActorKind.Avatar: return 1.4
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
  imageBase? :string
}

export const enum ActorState {
  Default = 1,

  ReadyToHatch = 101,
  Hatching = 102,
  Hatched = 103,

  Hungry = 201,
  Eating = 202,

  Sleepy = 301,
  Sleeping = 302,

  RandomMeet = 401,
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
  ended? :boolean // CLIENT
}

/**
 * The latest public update from an actor.  */
export interface ActorUpdate extends Located {
  x :number
  y :number
  z :number
  scale :number
  orient :number
  state :ActorState
  instant :ActorInstant // TODO: WILL BE REMOVED ? Renamed?
  owner :UUID
  name? :string
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
    state: ActorState.Default,
    instant: ActorInstant.None,
  }
}

/** The behavior data for an actor. */
export type BehaviorData = PMap<number>

/** Extended information about a behavior. Oh god. */
export type BehaviorInfo = Record

/**
 * An actor's "private" "server-side" data. */
export interface ActorData extends Located {
  /** The actor's health (hit points). Actors are removed when this is 0 or less. */
  hp :number
  x :number
  y :number
  z :number

  /** Hunger... not applicable for some actors. Sigh. Maybe get more entity-like on the server? */
  hunger :number
  owner :UUID
  name? :string
  state :ActorState
  scale :number
  path? :PathInfo
  orient :number
  instant :ActorInstant // TODO: going away
  lastPost? :number

  /** Data related to the current behavior. */
  data :BehaviorData

  /** Unchanging data regarding the behavior. */
  info? :BehaviorInfo

  /** The circle that this actor belongs to, or 0. */
  circleId? :number

  /** Flags containing the dirtyness level of this data. If the SERVER flag is on, the
   *  ActorData will be re-set() in the Map to persist it. If the CLIENT flag is also on,
   *  then a new ActorUpdate is published (and persisted). */
  dirty? :number
}

//export interface ChatCircleUpdate extends Located {
//}

export interface ChatCircle extends Located {
  /** The (reused) numeric (nonzero) id of this circle. */
  id :number

  /** The very center of the chat circle. */
  x :number
  y :number
  z :number

  /** The circle's radius. */
  radius :number

  /** The valid positions around the circle, specified as radians. */
  positions :number[]

  /** The ids of actors in positions, or the empty string. */
  members :string[]
}
