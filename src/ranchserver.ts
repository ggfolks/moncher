import {log} from "tfw/core/util"
import {UUID, uuidv1} from "tfw/core/uuid"
import {Auth} from "tfw/data/data"
import {Vector3} from "three"
import {RanchObject} from "./data"
import {MonsterDb} from "./monsterdb"
import {ZonedPathfinding} from "./zonedpathfinding"
import {
  ActorAction,
  ActorData,
  ActorConfig,
  ActorKind,
  ActorKindAttributes,
  ActorInstant,
  ActorUpdate,
  Located,
  PathInfo,
} from "./ranchdata"
import {loc2vec, vec2loc} from "./ranchutil"
import {MONSTER_ACCELERANT} from "./debug"

// TODO: use this?
// Right now I'm going to proceed without it and see how annoying things get.
// It's a bit more expensive to look-up the config as well, usually, and I want to be
// consistent about what we're passing around. So many methods just take the data.
//interface Actor {
//  id :UUID
//  config :ActorConfig
//  data :ActorData
//}

/**
 * The queue handler for client-initiated requests to the ranch. */
export function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) :void {
  const ctx :RanchContext = { obj, path: global["_ranchPathfinder"] }
  switch (req.type) {
    case "touch":
      touchActor(ctx, req.id)
      break

    case "tick":
      const now = Date.now()
      const diff = now - obj.lastTick.current
      if (diff >= 1000) {
        //log.debug("Tick with delta " + diff)
        tickRanch(ctx, Math.min(diff, 5000)) // 5s max tick
        obj.lastTick.update(now)
      } else {
        //log.info("Rejecting client-initiated tick (multiple clients connected?)")
      }
      break

    case "setName":
      log.debug("Got setname " + req.name)
      obj.name.update(req.name)
      break

    case "dropEgg":
      addActor(ctx, MonsterDb.getRandomEgg(), req)
      break

    case "dropFood":
      addActor(ctx, MonsterDb.getFood(), req)
      break

    default:
      log.warn("Unhandled ranch request", "req", req)
      break
  }
}

abstract class Behavior {
  /**
   * Retrieve a Behavior from the code stored in the data's BehaviorData. */
  static getBehavior (data :ActorData) :Behavior {
    const code = (data.data && data.data.code) ? data.data.code : 0
    return Behavior._behaviors.get(code) || Behavior._defaultBehavior
  }

  /** The code for this behavior, computed from the class name. */
  readonly code :number

  constructor (makeDefault = false) {
    const name = this.constructor.name
    let hash = 0
    for (let ii = 0, nn = name.length; ii < nn; ii++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(ii)
      hash |= 0 // force to integer
    }
    log.debug("Behavior", "name", name, "code", hash)
    this.code = hash
    if (Behavior._behaviors.has(hash)) {
      log.warn("Uh-oh, two Behaviors have the same 'code'. Change something!")
    } else {
      Behavior._behaviors.set(hash, this)
    }
    if (makeDefault) {
      Behavior._defaultBehavior = this
    }
  }

  /**
   * Tick an actor's behavior. */
  tick (ctx :RanchContext, dt :number, data :ActorData) :void {
    // process any walking
    let path = data.path
    while (path) {
      if (dt < path.timeLeft) {
        path.timeLeft -= dt
        // update our position along this path piece
        const perc = path.timeLeft / path.duration
        data.x = (path.dest.x - path.src.x) * perc + path.src.x
        data.y = (path.dest.y - path.src.y) * perc + path.src.y
        data.z = (path.dest.z - path.src.z) * perc + path.src.z
        return
      }
      // otherwise we used-up a path segment
      if (path.next) {
        dt -= path.timeLeft
      } else {
        // otherwise we have finished!
        data.x = path.dest.x
        data.y = path.dest.y
        data.z = path.dest.z
        // proceed to assign path to undefined, and fall out of the while
      }
      path = data.path = path.next
    }
  }

  _isWalking (data :ActorData) :boolean {
    return (data.path !== undefined)
  }

  /** A mapping of code to Behavior. */
  protected static readonly _behaviors :Map<number, Behavior> = new Map()

  /** The default behavior. */
  protected static _defaultBehavior :Behavior
}

class WanderBehavior extends Behavior {

  tick (ctx :RanchContext, dt :number, data :ActorData) :void {
    super.tick(ctx, dt, data)

    if (!this._isWalking(data)) {
      if (Math.random() < .1) {
        // TODO HERE
      }
    }
  }
}

class EatFoodBehavior extends Behavior {
  // TODO
}

// Create all the behavior subclasses to register them (side-effects of their constructor)
new WanderBehavior(true)
new EatFoodBehavior()

/**
 * Return a new ActorData, mostly blank. */
function newActorData (
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
function actorDataToUpdate (data :ActorData) :ActorUpdate {
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

interface RanchContext {
  obj :RanchObject
  path? :ZonedPathfinding
}

/** Player requests to the ranch. */
export type RanchReq =
    /** A request to "touch" a particular actor. */
    {type :"touch", id :UUID} |
    /** Drop an egg at the specified location. */
    {type :"dropEgg", x :number, y :number, z :number} |
    /** Drop food at the specified location. */
    {type :"dropFood", x :number, y :number, z :number} |
    /** Set the name of the ranch. (TEMP?) */
    {type :"setName", name :string} |
    /** A client-initiated tick (TEMP) */
    {type :"tick"}

/**
 * Handle adding an actor. */
function addActor (
  ctx :RanchContext,
  config :ActorConfig,
  locProps :Located,
  action = ActorAction.Idle,
) :void {
//  if (true) {
//    obj.actorConfigs.clear()
//    obj.actorData.clear()
//    obj.actors.clear()
//    return
//  }

  const uuid = uuidv1()
  const data = newActorData(config.kind, locProps, action)
  const update = actorDataToUpdate(data)
  ctx.obj.actorConfigs.set(uuid, config)
  ctx.obj.actorData.set(uuid, data)
  ctx.obj.actors.set(uuid, update)

  //log.debug("We got a random position?", "pos", getRandomPositionFrom(ctx, data))
}

function removeActor (
  ctx :RanchContext,
  uuid :UUID,
) :void {
  ctx.obj.actorData.delete(uuid)
  ctx.obj.actors.delete(uuid)
  ctx.obj.actorConfigs.delete(uuid)
}

function tickRanch (
  ctx :RanchContext,
  dt :number,
) :void {
  // tick every actor
  ctx.obj.actorData.forEach((data :ActorData, key :UUID) => {
      const config = ctx.obj.actorConfigs.get(key)
      if (config) tickActor(ctx, dt, key, config, data)
      else log.warn("Missing actor config?", "key", key)
    })

  // publish changes (after ticking EVERY actor. Actors may modify each other.)
  ctx.obj.actorData.forEach((data :ActorData, key :UUID) => {
      if (data.hp <= 0) {
        removeActor(ctx, key)
      } else {
        ctx.obj.actors.set(key, actorDataToUpdate(data))
      }
    })
}

function tickActor (
  ctx :RanchContext,
  dt :number,
  key :UUID,
  config :ActorConfig,
  data :ActorData,
) :void {
  switch (config.kind) {
    case ActorKind.Food:
      data.hp -= .01 // food decays
      break

    case ActorKind.Egg:
      switch (data.action) {
        case ActorAction.Idle:
          if (--data.hp < 20 * MONSTER_ACCELERANT) {
            data.action = ActorAction.ReadyToHatch
          }
          break

        case ActorAction.Hatching:
          --data.hp // subtract health until we're dead
          break

        default: break
      }
      break

    case ActorKind.Lobber:
    case ActorKind.Runner:
      tickMonster(ctx, dt, key, config, data)
      break

    default:
      log.warn("Unhandled actor kind in tickActor", "kind", config.kind)
      break
  }
}

/**
 * Handle monster tick (for now) */
function tickMonster (
  ctx :RanchContext,
  dt :number,
  key :UUID,
  config :ActorConfig,
  data :ActorData,
) :void {
  // clear any "instant"
  data.instant = ActorInstant.None

  switch (data.action) {
  case ActorAction.Waiting:
    if (--data.counter <= 0) {
      setAction(ctx, data, ActorAction.Idle)
    }
    break

  case ActorAction.Hatching:
    setAction(ctx, data, ActorAction.Waiting, 3)
    break

  case ActorAction.Walking:
  case ActorAction.Sleepy:
  case ActorAction.SeekingFood:
    // advance along our path positions
    let path = data.path
    while (path) {
      if (dt < path.timeLeft) {
        path.timeLeft -= dt
        // update our position along this path piece
        const perc = path.timeLeft / path.duration
        data.x = (path.dest.x - path.src.x) * perc + path.src.x
        data.y = (path.dest.y - path.src.y) * perc + path.src.y
        data.z = (path.dest.z - path.src.z) * perc + path.src.z
        return
      }
      // otherwise we used-up a path segment
      if (path.next) {
        dt -= path.timeLeft
      } else {
        // otherwise we have finished!
        data.x = path.dest.x
        data.y = path.dest.y
        data.z = path.dest.z
        setAction(ctx, data, popState(data), data.counter)
        // proceed to assign path to undefined, and fall out of the while
      }
      path = data.path = path.next
    }
    break

  case ActorAction.Eating:
    if (--data.counter <= 0) {
      data.hunger = 0
      data.scale *= 1.2 // TODO
      const newpos = getRandomPositionFrom(ctx, data, 2)
      if (newpos) {
        setAction(ctx, data, ActorAction.Sleepy)
        pushState(data, ActorAction.Sleeping)
        data.counter = 100 / MONSTER_ACCELERANT
        walkTo(ctx, key, data, newpos, .5)
      } else {
        setAction(ctx, data, ActorAction.Sleeping, 100 / MONSTER_ACCELERANT)
      }
    }
    break

  case ActorAction.Sleeping:
    if (--data.counter <= 0) {
      setAction(ctx, data, ActorAction.Waiting, 8 / MONSTER_ACCELERANT)
    }
    break

  case ActorAction.Unknown: // Do nothing for a little while
    if (--data.counter <= 0) {
      setAction(ctx, data, popState(data))
    }
    break

  case ActorAction.Idle:
    if (++data.hunger > 100 / MONSTER_ACCELERANT) {
      const isFood = (key :UUID, config :ActorConfig, data :ActorData) :boolean =>
      (config.kind === ActorKind.Food)
      const food = getNearestActor(ctx, data, isFood)
      if (food) {
        const foodData = food[2]
        if (getDistance(data, foodData) < .1) {
          foodData.hp -= 10
          setAction(ctx, data, ActorAction.Eating, 10 / MONSTER_ACCELERANT)
        } else {
          setAction(ctx, data, ActorAction.SeekingFood)
          walkTo(ctx, key, data, foodData, 1.5)
        }
        break
      }
      // no food? Fall back to wandering...
    }

    // Maybe go visit a nice egg
    if (Math.random() < .2) {
      const isEgg = (key :UUID, config :ActorConfig, data :ActorData) :boolean =>
          (config.kind === ActorKind.Egg)
      const isReadyEgg = (key :UUID, config :ActorConfig, data :ActorData) :boolean =>
          (isEgg(key, config, data) && (data.action === ActorAction.ReadyToHatch))
      const egg = getNearestActor(ctx, data, isReadyEgg) ||
          getNearestActor(ctx, data, isEgg)
      if (egg) {
        const eggData = egg[2]
        const nearEgg = getRandomPositionFrom(ctx, eggData, 5)
        if (nearEgg) {
          walkTo(ctx, key, data, nearEgg, 1.2)
        }
      }
      break
    }

    // Wander randomly!
    if (Math.random() < .075) {
      const newpos = getRandomPositionFrom(ctx, data, 10)
      if (newpos) {
        walkTo(ctx, key, data, newpos)
      }
    }
    break

  default:
    log.warn("Unhandled action in Monster.tick", "action", data.action)
    break
  }
}

function pushState (data :ActorData, state :ActorAction) :void {
  data.stateStack.push(state)
}

function popState (data :ActorData) :ActorAction {
  return data.stateStack.pop() || ActorAction.Idle
}

/**
 * Handle "touching" an actor. */
function touchActor (
  ctx :RanchContext,
  id :UUID,
) :void {
  const data = ctx.obj.actorData.get(id)
  if (!data) {
    log.warn("Client asked to touch missing actor", "key", id)
    return
  }
  const config = ctx.obj.actorConfigs.get(id)
  if (!config) {
    log.warn("Missing actor config?", "key", id)
    return
  }
  // for now do it all here, maybe I'll move this
  let publish = false
  switch (config.kind) {
    case ActorKind.Egg:
      if (data.action === ActorAction.ReadyToHatch) {
        data.action = ActorAction.Hatching
        addActor(ctx, config.spawn!, data, ActorAction.Hatching)
        publish = true
      }
      break

    case ActorKind.Lobber:
    case ActorKind.Runner:
      switch (data.action) {
        case ActorAction.Sleeping:
          setAction(ctx, data, ActorAction.Idle)
          break

        default:
          data.instant = (Math.random() < .8) ? ActorInstant.Touched :ActorInstant.Hit
          break
      }
      switch (data.action) {
        case ActorAction.Waiting:
        case ActorAction.Idle:
          data.orient = 0 // rotate forward
          break
      }
      publish = true
      break

    default:
      log.warn("Unhandled actor kind in touchActor " + config.kind)
      break

    // do nothing cases
    case ActorKind.Food:
      break
  }

  if (publish) {
    ctx.obj.actors.set(id, actorDataToUpdate(data))
  }
}

function setAction (
  ctx :RanchContext, data :ActorData, action :ActorAction, counterInit :number = 0
) :void {
  data.action = action
  data.counter = Math.trunc(counterInit)
}

function getNearestActor (
  ctx :RanchContext,
  loc :Located,
  predicate :(key :UUID, config :ActorConfig, data :ActorData) => boolean,
  maxDist :number = Infinity
) :[ UUID, ActorConfig, ActorData ]|undefined {
  let nearest = undefined
  ctx.obj.actorData.forEach((data :ActorData, key :UUID) => {
    const config = ctx.obj.actorConfigs.get(key)
    if (!config) {
      log.warn("Missing actor config?", "key", key)
      return
    }
    if (predicate(key, config, data)) {
      const dd = getDistance(loc, data)
      if (dd < maxDist) {
        maxDist = dd
        nearest = [ key, config, data ]
      }
    }
  })
  return nearest
}

function getRandomPositionFrom (
  ctx :RanchContext,
  loc :Located,
  maxDist = Infinity
) :Located|undefined {
  if (!ctx.path) return undefined
  const vec = loc2vec(loc)
  const result = ctx.path.getRandomPositionFrom(vec, maxDist)
  if (result) return vec2loc(result)
  else return undefined
}

function getDistance (one :Located, two :Located) :number {
  const dx = one.x - two.x, dy = one.y - two.y, dz = one.z - two.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function getSpeed (ctx :RanchContext, key :UUID, data :ActorData) :number {
  const cfg = ctx.obj.actorConfigs.get(key)!
  return ActorKindAttributes.baseMovementSpeed(cfg.kind) * data.scale
}

function walkTo (
  ctx :RanchContext,
  key: UUID,
  data :ActorData,
  newPos :Located,
  speedFactor = 1
) :void {
  const path = findPath(ctx, data, newPos)
  if (!path) {
    log.warn("Unable to find path",
      "src", data,
      "dest", newPos)
    setAction(ctx, data, ActorAction.Unknown)
    return
  }

  // TEMP!?
  // make sure we can path-back
  const pathBack = findPath(ctx, newPos, data)
  if (!pathBack) {
    log.warn("Unable to find a path BACK from a point. Skipping",
      "point", newPos)
    setAction(ctx, data, ActorAction.Unknown)
    return
  }
  // END TEMP

  let info :PathInfo|undefined = undefined
  const speed = 1000 / (getSpeed(ctx, key, data) * speedFactor)
  while (path.length > 1) {
    const dest = path.pop()!
    const src = path[path.length - 1]
    const duration = src.distanceTo(dest) * speed
    const orient = Math.atan2(dest.x - src.x, dest.z - src.z)
    info = { src: vec2loc(src), dest: vec2loc(dest), orient, duration, timeLeft: duration,
        next: info }
  }
  data.path = info
  if (!isWalkingState(data.action)) {
    setAction(ctx, data, ActorAction.Walking)
  }
  // set our final angle to something wacky
  data.orient = Math.random() * Math.PI * 2
}

function findPath (ctx :RanchContext, src :Located, dest :Located) :Vector3[]|undefined {
  if (!ctx.path) {
    log.warn("Pathfinder unknown. Can't path.")
    return undefined
  }
  const srcVec = loc2vec(src)
  const foundPath = ctx.path.findPath(srcVec, loc2vec(dest))
  if (!foundPath) return undefined
  foundPath.unshift(srcVec) // put the damn src back on the start of the list
  //return foundPath.map(v => vec2loc(v))
  return foundPath
}

function isWalkingState (act :ActorAction) :boolean {
  switch (act) {
    case ActorAction.Walking:
    case ActorAction.Sleepy:
    case ActorAction.SeekingFood:
      return true

    default: return false
  }
}
