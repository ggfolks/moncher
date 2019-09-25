import {log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth} from "tfw/data/data"
import {Vector3} from "three"
import {RanchObject, RanchReq} from "./data"
import {MonsterDb} from "./monsterdb"
import {ZonedPathfinding} from "./zonedpathfinding"
import {
  ActorData,
  ActorConfig,
  ActorKind,
  ActorKindAttributes,
  ActorInstant,
  ActorState,
  ActorUpdate,
  BehaviorData,
  Located,
  PathInfo,
} from "./ranchdata"
import {loc2vec, vec2loc} from "./ranchutil"

/** The name of the pathfinder stuffed in global. */
export const PATHFINDER_GLOBAL = "_ranchPathfinder"

// TODO Don't hardcode distances. Sort out something based on the monster's scale maybe?
const CLOSE_EAT_DISTANCE = .1
const NAP_NEAR_FOOD_DISTANCE = 3
const MAX_WANDER_DISTANCE = 12

// walk speed variations
const WALK_TO_FOOD_SPEED = 1.4
const WALK_TO_NAP_SPEED = .5

const MAX_HUNGER = 100

const EATING_DURATION = 5000
const HATCHING_DURATION = 6000
const NORMAL_SLEEP_DURATION = 5 * 60 * 1000

/**
 * Context object passed to most request handlers. */
interface RanchContext {
  obj :RanchObject
  auth :Auth
  path? :ZonedPathfinding
}

/**
 * The queue handler for client-initiated requests to the ranch. */
export function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) :void {
  const ctx :RanchContext = { obj, auth, path: global[PATHFINDER_GLOBAL] }
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
    if (auth.isGuest && !obj.debug.current) {
      log.warn("Rejecting egg drop from guest", "auth", auth)
      return
    }
    addActor(ctx, ctx.auth.id, MonsterDb.getRandomEgg(), req)
    break

  case "dropFood":
    // food is owned by nobody
    addActor(ctx, UUID0, MonsterDb.getFood(), req)
    break

  case "debug":
    // TODO: restrict access to debug mode?
    log.warn("Setting debug mode: " + req.value)
    obj.debug.update(req.value)
    break

  case "reset":
    log.info("Resetting ranch due to client request.")
    obj.actorData.clear()
    obj.actors.clear()
    obj.actorConfigs.clear()
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

function getActor (ctx :RanchContext, id :UUID) :Actor|undefined {
  const data = ctx.obj.actorData.get(id)
  if (!data) return undefined
  const config = ctx.obj.actorConfigs.get(id)
  if (!config) {
    log.warn("Missing actor config?", "key", id)
    return undefined
  }
  return { id, config, data }
}

function isWalking (data :ActorData) :boolean {
  return (data.path !== undefined)
}

abstract class Behavior {
  /**
   * Retrieve a Behavior from the code stored in the data's BehaviorData. */
  static getBehavior (actor :Actor) :Behavior {
    const code = actor.data.data.code ? actor.data.data.code : 0
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
  init (actor :Actor, arg? :any) :void {
    const data :BehaviorData = {}
    this.initData(actor, data, arg)
    data.code = this.code
    actor.data.data = data
    actor.data.dirty = true

    //log.debug("Starting actor on " + this.constructor.name)
  }

  /**
   * Initialize any behavior-specific data (specific to THIS behavior). */
  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    // nothing by default
  }

  /**
   * Tick an actor's behavior. */
  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    // nothin'
  }

  /**
   * Handle a client "touching" this actor.
   * @return true if something changed and we should publish this actor.
   */
  touch (ctx :RanchContext, actor :Actor) :boolean {
    return false
  }

  /** A mapping of code to Behavior. */
  protected static readonly _byCode :Map<number, Behavior> = new Map()

  /** A mapping of actor type to default behavior. */
  protected static readonly _byKind :Map<ActorKind, Behavior> = new Map()

  /** The default behavior. */
  protected static _defaultBehavior :Behavior // why is it not an error that it's not initialized?
}

/**
 * Behavior for food. Still life. */
class FoodBehavior extends Behavior {
  static INSTANCE = new FoodBehavior(ActorKind.Food)

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    actor.data.hp -= .01 // food decays
    actor.data.dirty = true
  }
}

/**
 * Behavior for an egg. */
class EggBehavior extends Behavior {
  static INSTANCE = new EggBehavior(ActorKind.Egg)

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    const data = actor.data
    // since eggs only have one behavior, go ahead and use the actor's state for behavior state
    switch (data.state) {
    case ActorState.Default:
      data.hp -= dt
      if (data.hp < 20) {
        data.hp = 20
        setState(data, ActorState.ReadyToHatch)
      }
      data.dirty = true
      break

    case ActorState.Hatching: // we are only hatching for a moment
      setState(data, ActorState.Hatched)
      break

    case ActorState.Hatched:
      data.hp -= dt // deplete until removed
      data.dirty = true
      break
    }
  }

  touch (ctx :RanchContext, actor :Actor) :boolean {
    const data = actor.data
    if ((data.owner === ctx.auth.id) && (data.state === ActorState.ReadyToHatch)) {
      setState(data, ActorState.Hatching)
      // spawn monster with the same owner at the same location
      addActor(ctx, data.owner, actor.config.spawn!, data /*Located*/, HatchingBehavior.INSTANCE)
      data.owner = UUID0 // update the EGG to be owned by nobody
      data.dirty = true
      return true
    }
    return false
  }
}

/**
 * Behavior for things that move along paths. */
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
        data.dirty = true
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
      data.dirty = true
    }
  }
}

/**
 * Monster hatching behavior. */
class HatchingBehavior extends Behavior {
  static INSTANCE = new HatchingBehavior()

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)
    data.time = 0
    setState(actor.data, ActorState.Hatching)
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    const data = actor.data

    const bd = data.data
    bd.time += dt
    if (bd.time >= HATCHING_DURATION) {
      WanderBehavior.INSTANCE.init(actor)

    } else if (data.state === ActorState.Hatching) {
      // we are only Hatching for a split second
      setState(actor.data, ActorState.Default)
    }
  }
}

/**
 * Behavior common to all monsters. */
abstract class MonsterBehavior extends MobileBehavior {
  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)

    const data = actor.data
    if (data.instant !== ActorInstant.None) {
      data.instant = ActorInstant.None
      data.dirty = true
    }

    if (data.hunger < MAX_HUNGER) {
      data.hunger += dt
      data.dirty = true
    }
  }

  touch (ctx :RanchContext, actor :Actor) :boolean {
    const data = actor.data
    data.instant = (Math.random() < .8) ? ActorInstant.Touched : ActorInstant.Hit
    data.orient = 0 // face forward
    data.dirty = true
    return true // publish!
  }
}

class WanderBehavior extends MonsterBehavior {
  static INSTANCE = new WanderBehavior(...ActorKindAttributes.getAllMonsters())

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)
    setState(actor.data, ActorState.Default)
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)

    const data = actor.data
    if (isWalking(data)) return

    if (data.hunger >= MAX_HUNGER && Math.random() < .2) {
      EatFoodBehavior.INSTANCE.init(actor)
      return
    }

    if (Math.random() < .5) {
      const newpos = getRandomPositionFrom(ctx, data, MAX_WANDER_DISTANCE)
      if (newpos) {
        walkTo(ctx, actor, newpos)
      }
    }
  }
}

class EatFoodBehavior extends MonsterBehavior {
  static INSTANCE = new EatFoodBehavior()

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)

    // set up the first phase: seeking the food
    data.phase = 0
    setState(actor.data, ActorState.Hungry) // sets dirty
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    super.tick(ctx, dt, actor)

    const data = actor.data
    if (isWalking(data)) return

    const bd = data.data!
    switch (bd.phase) {
    case 0: // let's look for food
      const isFood = (actor :Actor) :boolean => (actor.config.kind === ActorKind.Food)
      const food = getNearestActor(ctx, data, isFood)
      if (food) {
        const foodData = food.data
        if (getDistance(data, foodData) < CLOSE_EAT_DISTANCE) {
          foodData.hp -= 50
          foodData.dirty = true
          bd.phase = 2
          bd.time = EATING_DURATION
          setState(data, ActorState.Eating)

        } else {
          walkTo(ctx, actor, foodData, WALK_TO_FOOD_SPEED)
        }
      } else {
        // can't find food: we're just going to wait one tick and reset
        bd.phase = 1
      }
      break

    case 1: // we didn't find food
      // let's just immediately transition to a new behavior for next time
      WanderBehavior.INSTANCE.init(actor)
      break

    case 2: // eating!
      bd.time -= dt
      if (bd.time <= 0) {
        // we've finished eating, let's grow
        data.hunger = 0
        growMonster(data)
        setState(data, ActorState.Sleepy)
        bd.phase = 3
      }
      break

    case 3: // looking for a nap spot
      const newpos = getRandomPositionFrom(ctx, data, NAP_NEAR_FOOD_DISTANCE)
      if (newpos) {
        walkTo(ctx, actor, newpos, WALK_TO_NAP_SPEED)
        bd.phase = 4
      } else {
        // let's just try again next tick?
      }
      break

    case 4: // we are now ready to sleep
      SleepBehavior.INSTANCE.init(actor)
      break
    }
  }
}

class SleepBehavior extends MonsterBehavior {
  static INSTANCE = new SleepBehavior()

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)

    setState(actor.data, ActorState.Sleeping)
    data.time = (arg !== undefined) ? arg as number : NORMAL_SLEEP_DURATION
  }

  tick (ctx :RanchContext, dt :number, actor :Actor) :void {
    const bd = actor.data.data!
    bd.time -= dt
    actor.data.dirty = true
    if (bd.time <= 0) {
      WanderBehavior.INSTANCE.init(actor)
    }
  }

  touch (ctx :RanchContext, actor :Actor) :boolean {
    // wake up early
    WanderBehavior.INSTANCE.init(actor)
    return true
  }
}

// mother-fricking compiler doesn't know that the INSTANCES handle it!
if (false) {
  log.debug("Gruntle: " + FoodBehavior + EggBehavior + WanderBehavior +
      EatFoodBehavior + SleepBehavior)
}

/**
 * Return a new ActorData, mostly blank. */
function newActorData (
  id :UUID,
  owner :UUID,
  config :ActorConfig,
  loc :Located,
  behavior? :Behavior,
) :ActorData {
  const data :ActorData = {
    x: loc.x,
    y: loc.y,
    z: loc.z,
    scale: 1,
    orient: 0,

    hp: ActorKindAttributes.initialHealth(config.kind),
    hunger: 0,

    owner,

    state: ActorState.Default,
    instant: ActorInstant.None,

    data: {}, // behavior data
    dirty: true, // start dirty!
  }
  const actor :Actor = { id, config, data }
  if (!behavior) behavior = Behavior.getBehavior(actor) // get default
  behavior.init(actor)

  return data
}

/**
 * Publish an actor update derived from the specified ActorData. */
function actorDataToUpdate (data :ActorData) :ActorUpdate {
  delete data.dirty
  const {x, y, z, scale, orient, state, instant, owner, path} = data
  return {
    x, y, z,
    scale,
    orient,
    state,
    instant,
    owner,
    path,
  }
}

/**
 * Handle adding an actor. */
function addActor (
  ctx :RanchContext,
  owner :UUID,
  config :ActorConfig,
  locProps :Located,
  behavior? :Behavior,
) :void {
  const id = uuidv1()
  const data = newActorData(id, owner, config, locProps, behavior)
  const update = actorDataToUpdate(data)
  ctx.obj.actorConfigs.set(id, config)
  ctx.obj.actorData.set(id, data)
  ctx.obj.actors.set(id, update)

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

  // After ticking every actor (actors may modify each other), re-publish any that are dirty
  ctx.obj.actorData.forEach((data :ActorData, key :UUID) => {
    if (data.hp <= 0) {
      removeActor(ctx, key)
    } else if (data.dirty) {
      ctx.obj.actors.set(key, actorDataToUpdate(data))
      ctx.obj.actorData.set(key, data)
    }
  })
}

function growMonster (data :ActorData) :void {
  // this could probably be smoother and better
  const MAX_SCALE = 4
  const MAX_INCREMENT = .20
  // get us 1/4th of the way to max size
  const increment = Math.min(MAX_INCREMENT, Math.max(0, (MAX_SCALE - data.scale)) * .25)
  data.scale = Math.min(MAX_SCALE, data.scale + increment)
  data.dirty = true
}

/**
 * Handle "touching" an actor. */
function touchActor (
  ctx :RanchContext,
  id :UUID,
) :void {
  const actor = getActor(ctx, id)
  if (!actor) {
    log.warn("Client asked to touch missing actor?", "id", id)
    return
  }
  const beh = Behavior.getBehavior(actor)
  if (beh.touch(ctx, actor)) {
    ctx.obj.actors.set(actor.id, actorDataToUpdate(actor.data))
    ctx.obj.actorData.set(actor.id, actor.data)
  }
}

function setState (data :ActorData, state :ActorState) :void {
  data.state = state
  data.dirty = true
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
    return
  }

  // TEMP!?
  // make sure we can path-back
  const pathBack = findPath(ctx, newPos, actor.data)
  if (!pathBack) {
    log.warn("Unable to find a path BACK from a point. Skipping",
      "point", newPos)
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
  // set our final angle to something wacky
  actor.data.orient = Math.random() * Math.PI * 2
  actor.data.dirty = true
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
