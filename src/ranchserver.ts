import {log} from "tfw/core/util"
import {UUID, uuidv1} from "tfw/core/uuid"
import {Auth} from "tfw/data/data"
import {Vector3} from "three"
import {RanchObject, RanchReq} from "./data"
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
  BehaviorData,
  Located,
  PathInfo,
} from "./ranchdata"
import {loc2vec, vec2loc} from "./ranchutil"
import {MONSTER_ACCELERANT} from "./debug"

/**
 * Context object passed to most request handlers. */
interface RanchContext {
  obj :RanchObject
  path? :ZonedPathfinding
}

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

interface Actor {
  id :UUID
  config :ActorConfig
  data :ActorData
}

abstract class Behavior {
  /**
   * Retrieve a Behavior from the code stored in the data's BehaviorData. */
  static getBehavior (actor :Actor) :Behavior {
    const code = (actor.data.data && actor.data.data.code) ? actor.data.data.code : 0
    return Behavior._byCode.get(code) || Behavior._byKind.get(actor.config.kind)!
  }

  /** The code for this behavior, computed from the class name. */
  readonly code :number

  /**
   * The base Behavior constructor: registers the behavior by its calculated code and
   * the kinds of actors for which it is the default. */
  constructor (...defaultForKinds :ActorKind[]) {
    const name = this.constructor.name
    let hash = 0
    for (let ii = 0, nn = name.length; ii < nn; ii++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(ii)
      hash |= 0 // force to integer
    }
    //log.debug("Behavior", "name", name, "code", hash)
    this.code = hash
    if (Behavior._byCode.has(hash)) {
      log.warn("Uh-oh, two Behaviors have the same 'code'. Change something!")
    } else {
      Behavior._byCode.set(hash, this)
    }
    for (const kind of defaultForKinds) {
      Behavior._byKind.set(kind, this)
    }
  }

  /**
   * Initialize this actor's when it starts using this Behavior. */
  init (actor :Actor) :void {
    const data :BehaviorData = {}
    this.initData(actor, data)
    data.code = this.code
    actor.data.data = data
  }

  /**
   * Initialize any behavior-specific data (specific to THIS behavior). */
  initData (actor :Actor, data :BehaviorData) :void {
    // nothing by default
  }

  /**
   * Tick an actor's behavior. */
  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    // nothin'
  }

  // TODO: move? Move to MobileBehavior, or just somewhere else entirely
  _isWalking (data :ActorData) :boolean {
    return (data.path !== undefined)
  }

  /** A mapping of code to Behavior. */
  protected static readonly _byCode :Map<number, Behavior> = new Map()

  /** A mapping of actor type to default behavior. */
  protected static readonly _byKind :Map<ActorKind, Behavior> = new Map()

  /** The default behavior. */
  protected static _defaultBehavior :Behavior // why is it not an error that it's not initialized?
}

class FoodBehavior extends Behavior {
  constructor () {
    super(ActorKind.Food)
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    actor.data.hp -= .01 // food decays
  }
}

class EggBehavior extends Behavior {
  constructor () {
    super(ActorKind.Egg)
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    const data = actor.data
    switch (data.action) {
    case ActorAction.Idle:
      if (--data.hp < 20 * MONSTER_ACCELERANT) {
        data.action = ActorAction.ReadyToHatch
      }
      break

    case ActorAction.Hatching: // we are only hatching for a moment
      data.action = ActorAction.Hatched
      break

    case ActorAction.Hatched:
      --data.hp // deplete until removed
      break
    }
  }
}

abstract class MobileBehavior extends Behavior {
  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)

    // process any walking
    const data = actor.data
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
}

abstract class MonsterBehavior extends MobileBehavior {
  // All I got is this busket!

  // TEMP: defer to oldschool tick method
  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)
    tickMonster(ctx, dt, actor)
  }
}

class WanderBehavior extends MonsterBehavior {
  constructor () {
    super(...ActorKindAttributes.getAllMonsters())
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)

//    if (!this._isWalking(actor.data)) {
//      if (Math.random() < .1) {
//        // TODO HERE
//      }
//    }
  }
}

class EatFoodBehavior extends MobileBehavior {
  // TODO
}

// Create all the behavior subclass instances to register them (side-effects of their constructor)
new FoodBehavior()
new EggBehavior()
new WanderBehavior()
new EatFoodBehavior()

/**
 * Return a new ActorData, mostly blank. */
function newActorData (
  id :UUID,
  config :ActorConfig,
  loc :Located,
  action = ActorAction.Idle // TODO: remove
) :ActorData {
  const data :ActorData = {
    x: loc.x,
    y: loc.y,
    z: loc.z,
    hp: ActorKindAttributes.initialHealth(config.kind),
    hunger: 0,
    scale: 1,
    orient: 0,
    stateStack: [],

    instant: ActorInstant.None,
    counter: 0,

    action, // TODO: remove, probably
  }
  const actor :Actor = { id, config, data }
  const behavior = Behavior.getBehavior(actor)
  behavior.init(actor)

  return data
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
  const data = newActorData(uuid, config, locProps, action)
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
    if (!config) {
       log.warn("Missing actor config?", "key", key) // this simply shouldn't happen
       return
    }
    const actor :Actor = {id: key, config, data}
    const behavior :Behavior = Behavior.getBehavior(actor)
    behavior.tick(ctx, dt, actor)
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

/**
 * Handle monster tick (for now) */
function tickMonster (
  ctx :RanchContext,
  dt :number,
  actor :Actor,
) :void {
  // clear any "instant"
  const data = actor.data
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
  case ActorAction.SeekingFood: // NOTE: these have moved to Behavior now
    // TODO: clean up!
    // for now we need to ensure we popState
    if (data.path === undefined) {
      setAction(ctx, data, popState(data), data.counter)
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
        walkTo(ctx, actor, newpos, .5)
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
      const isFood = (actor :Actor) :boolean => (actor.config.kind === ActorKind.Food)
      const food = getNearestActor(ctx, data, isFood)
      if (food) {
        const foodData = food.data
        if (getDistance(data, foodData) < .1) {
          foodData.hp -= 10
          setAction(ctx, data, ActorAction.Eating, 10 / MONSTER_ACCELERANT)
        } else {
          setAction(ctx, data, ActorAction.SeekingFood)
          walkTo(ctx, actor, foodData, 1.5)
        }
        break
      }
      // no food? Fall back to wandering...
    }

    // Maybe go visit a nice egg
    if (Math.random() < .2) {
      const isEgg = (actor :Actor) :boolean => (actor.config.kind === ActorKind.Egg)
      const isReadyEgg = (actor :Actor) :boolean =>
          isEgg(actor) && (actor.data.action === ActorAction.ReadyToHatch)
      const egg = getNearestActor(ctx, data, isReadyEgg) ||
          getNearestActor(ctx, data, isEgg)
      if (egg) {
        const nearEgg = getRandomPositionFrom(ctx, egg.data, 5)
        if (nearEgg) {
          walkTo(ctx, actor, nearEgg, 1.2)
        }
      }
      break
    }

    // Wander randomly!
    if (Math.random() < .075) {
      const newpos = getRandomPositionFrom(ctx, data, 10)
      if (newpos) {
        walkTo(ctx, actor, newpos)
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
  predicate :(actor :Actor) => boolean,
  maxDist :number = Infinity
) :Actor|undefined {
  let nearest = undefined
  ctx.obj.actorData.forEach((data :ActorData, id :UUID) => {
    const config = ctx.obj.actorConfigs.get(id)
    if (!config) {
      log.warn("Missing actor config?", "id", id)
      return
    }
    const oActor :Actor = {id, config, data}
    if (predicate(oActor)) {
      const dd = getDistance(loc, data)
      if (dd < maxDist) {
        maxDist = dd
        nearest = oActor
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

function getSpeed (ctx :RanchContext, actor :Actor) :number {
  return ActorKindAttributes.baseMovementSpeed(actor.config.kind) * actor.data.scale
}

function walkTo (
  ctx :RanchContext,
  actor :Actor,
  newPos :Located,
  speedFactor = 1
) :void {
  const path = findPath(ctx, actor.data, newPos)
  if (!path) {
    log.warn("Unable to find path",
      "src", actor.data,
      "dest", newPos)
    setAction(ctx, actor.data, ActorAction.Unknown)
    return
  }

  // TEMP!?
  // make sure we can path-back
  const pathBack = findPath(ctx, newPos, actor.data)
  if (!pathBack) {
    log.warn("Unable to find a path BACK from a point. Skipping",
      "point", newPos)
    setAction(ctx, actor.data, ActorAction.Unknown)
    return
  }
  // END TEMP

  let info :PathInfo|undefined = undefined
  const speed = 1000 / (getSpeed(ctx, actor) * speedFactor)
  while (path.length > 1) {
    const dest = path.pop()!
    const src = path[path.length - 1]
    const duration = src.distanceTo(dest) * speed
    const orient = Math.atan2(dest.x - src.x, dest.z - src.z)
    info = { src: vec2loc(src), dest: vec2loc(dest), orient, duration, timeLeft: duration,
        next: info }
  }
  actor.data.path = info
  if (!isWalkingState(actor.data.action)) {
    setAction(ctx, actor.data, ActorAction.Walking)
  }
  // set our final angle to something wacky
  actor.data.orient = Math.random() * Math.PI * 2
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

function isWalkingState (act :ActorAction) :boolean { // TODO: will be nixed
  switch (act) {
  case ActorAction.Walking:
  case ActorAction.Sleepy:
  case ActorAction.SeekingFood:
    return true

  default: return false
  }
}
