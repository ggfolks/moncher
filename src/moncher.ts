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
  path? :PathInfo
  orient :number
  instant :ActorInstant // TODO: going away
  stateStack :ActorAction[] // Almost certainly going away because Behavior will handle it
}

/**
 * Return a new ActorData, mostly blank. */
export function newActorData (
  kind? :ActorKind,
  locProps? :Located,
  action = ActorAction.Idle
) :ActorData {
  let x = 0, y = 0, z = 0
  const hp = kind ? ActorKindAttributes.initialHealth(kind) : 1
  if (locProps) ({x, y, z} = locProps)
  return {
    x, y, z,
    hp,
    action,
    hunger: 0,
    scale: 1,
    orient: 0,
    stateStack: [],

    instant: ActorInstant.None,
    counter: 0,
  }
}

/**
 * Publish an actor update derived from the specified ActorData. */
export function actorDataToUpdate (data :ActorData) :ActorUpdate {
  const {x, y, z, scale, orient, action, instant, path} = data
  return {
    x, y, z,
    scale,
    orient,
    action,
    instant,
    path,
  }
}
