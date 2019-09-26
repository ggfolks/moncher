import {Data} from "tfw/core/data"
import {log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth} from "tfw/data/data"
import {Vector3} from "three"
import {RanchObject, RanchReq, ProfileType, profileQ, channelQ} from "./data"
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

const MAX_MONSTER_SCALE = 4
const DEFAULT_MONSTER_SCALE = 1
const MIN_MONSTER_SCALE = .8

// TODO Don't hardcode distances. Sort out something based on the monster's scale maybe?
const CLOSE_EAT_DISTANCE = .1
const NAP_NEAR_FOOD_DISTANCE = 3
const MAX_WANDER_DISTANCE = 12
const RANDOM_MEET_DISTANCE = 5 // when one monster is walking past another, they might meet-up!

// walk speed variations
const WALK_TO_FOOD_SPEED = 1.4
const WALK_TO_NAP_SPEED = .5

/** The hunger level at which a monster is ready to eat. */
const HUNGRY_HUNGER = 100
/** The hunger level at which a monster shrinks due to lack of food. */
const STARVING_HUNGER = 1.5 * 24 * 60 * 60 // 1.5 days

const EATING_DURATION = 5
const HATCHING_DURATION = 6
const NORMAL_SLEEP_DURATION = 5 * 60
const CHAT_CIRCLE_MAX_DURATION = 30 //30 * 60 // 30 minutes

/** How often do monsters act happy together? */
const CHAT_BOUNCE_INTERVAL = 4.8

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
    touchActor(ctx, req.id, req.arg)
    break

  case "setActorName":
    setActorName(ctx, auth.id, req.id, req.name)
    break

  case "tick":
//    if (!auth.isSystem) {
//      log.warn("Rejecting tick from client.")
//      return
//    }
    const now = Date.now()
    const diff = now - obj.lastTick.current
    if (diff >= 1000) {
      //log.debug("Tick with delta " + diff)
      tickRanch(ctx, Math.min(diff, 5000) / 1000) // 5s max tick
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
   * Is the specified actor using this behavior? */
  isBehaved (actor :Actor) :boolean {
    return (this.code === actor.data.data.code)
  }

  maybeInit (actor :Actor, arg? :any) :void {
    if (!this.isBehaved(actor)) this.init(actor, arg)
  }

  /**
   * Initialize this actor's when it starts using this Behavior. */
  init (actor :Actor, arg? :any) :void {
    const data :BehaviorData = {}
    actor.data.info = undefined // clear out any previous "BehaviorInfo"
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
  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    // nothin'
  }

  /**
   * Handle a client "touching" this actor.
   * @return true if something changed and we should publish this actor.
   */
  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
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

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    actor.data.hp -= (dt / 100) // food decays
    actor.data.dirty = true
  }
}

/**
 * Behavior for an egg. */
class EggBehavior extends Behavior {
  static INSTANCE = new EggBehavior(ActorKind.Egg)

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
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

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
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
  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    super.tick(ctx, actor, dt)
    advanceWalk(ctx, actor, dt)
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

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
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
  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    super.tick(ctx, actor, dt)

    const data = actor.data
    if (data.instant !== ActorInstant.None) {
      data.instant = ActorInstant.None
      data.dirty = true
    }

    if (data.hunger < STARVING_HUNGER) {
      data.hunger += dt
      data.dirty = true
    }
  }

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
    const data = actor.data
    data.instant = (Math.random() < .8) ? ActorInstant.Touched : ActorInstant.Hit
    data.orient = 0 // face forward
    data.dirty = true

    // TEMP: debug sizes
    if (arg && arg["debug"]) {
      stopWalkingOutsideTick(ctx, actor)
      switch (data.scale) {
      default:
        data.scale = MAX_MONSTER_SCALE
        break

      case MAX_MONSTER_SCALE:
        data.scale = MIN_MONSTER_SCALE
        break

      case MIN_MONSTER_SCALE:
        data.scale = DEFAULT_MONSTER_SCALE
        break
      }
    } // END: TEMP
    return true // publish!
  }
}

class ChatCircleBehavior extends MonsterBehavior {
  static INSTANCE = new ChatCircleBehavior()

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)
    data.bounce = 0
    data.counter = 0
    setState(actor.data, ActorState.RandomMeet)

    if (arg) {
      actor.data.info = arg
    }
  }

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    super.tick(ctx, actor, dt)

    if (isWalking(actor.data)) return

    const data = actor.data
    const bd = data.data
    bd.bounce += dt
    if (bd.bounce > CHAT_BOUNCE_INTERVAL) {
      data.instant = ActorInstant.Touched
      bd.bounce -= (Math.random() * CHAT_BOUNCE_INTERVAL)
    }

    bd.counter += dt
    if (bd.counter > CHAT_CIRCLE_MAX_DURATION) {
      // break it up!
      // find all monsters nearby in this "Same circle" (TODO: same circle?)
      // TODO: or just do a hacky distance check. But I think we could possibly have a behavior
      // data arg that gives each chat circle a custom id or something...
      visitActors(ctx, actor => {
        if (this.isBehaved(actor)) {
          // it's ok if a chatter is still walking, they'll finish the walk in Wander
          WanderBehavior.INSTANCE.init(actor)
        }
      })
    }
    data.dirty = true // oh yeah, you like it when I mark dirty, don't you?
  }
}

class WanderBehavior extends MonsterBehavior {
  static INSTANCE = new WanderBehavior(...ActorKindAttributes.getAllMonsters())

  initData (actor :Actor, data :BehaviorData, arg :any) :void {
    super.initData(actor, data, arg)
    setState(actor.data, ActorState.Default)
  }

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    super.tick(ctx, actor, dt)

    const data = actor.data

    // see if we're passing near another monster
    if (Math.random() < .1) {
      const isStandingMonst = (other :Actor) :boolean =>
          (other.data !== actor.data) && // omit self
          ActorKindAttributes.isMonster(other.config.kind) &&
          !isWalking(other.data) &&
          (WanderBehavior.INSTANCE.isBehaved(other) ||
            ChatCircleBehavior.INSTANCE.isBehaved(other))
      const monst = getNearestActor(ctx, data, isStandingMonst, RANDOM_MEET_DISTANCE * data.scale)
      if (monst) {
        // TODO: circle up?
        const nearMonst = getRandomPositionFrom(ctx, monst.data,
            RANDOM_MEET_DISTANCE * data.scale)
        if (nearMonst) {
          const existingCircle = ChatCircleBehavior.INSTANCE.isBehaved(monst)
          const arg :Located = existingCircle
              ? monst.data.info as any as Located
              : nearMonst
          // find a new position near THAT
          const nearCircle = getRandomPositionFrom(ctx, arg, RANDOM_MEET_DISTANCE / 2) || nearMonst
          walkTo(ctx, actor, nearCircle)
          // face the center of the circle
          actor.data.orient = Math.atan2(arg.x - nearCircle.x, arg.z - nearCircle.z)
          // put them both into ChatCircle mode
          ChatCircleBehavior.INSTANCE.init(actor, arg)
          ChatCircleBehavior.INSTANCE.maybeInit(monst, arg)
          return
        }
      }
    }

    if (isWalking(data)) return

    if (data.hunger >= HUNGRY_HUNGER && Math.random() < .2) {
      EatFoodBehavior.INSTANCE.init(actor)
      return
    }

    if (Math.random() < .5) {
      const newpos = getRandomPositionFrom(ctx, data, MAX_WANDER_DISTANCE * data.scale)
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

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    super.tick(ctx, actor, dt)

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
      data.dirty = true
      break

    case 1: // we didn't find food
      if (data.hunger >= STARVING_HUNGER) {
        shrinkMonster(data)
        data.hunger = HUNGRY_HUNGER // still hungry after shrinking
      }
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
      data.dirty = true
      break

    case 3: // looking for a nap spot
      const newpos = getRandomPositionFrom(ctx, data, NAP_NEAR_FOOD_DISTANCE * data.scale)
      if (newpos) {
        walkTo(ctx, actor, newpos, WALK_TO_NAP_SPEED)
        bd.phase = 4
      } else {
        // let's just try again next tick?
      }
      data.dirty = true
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

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    const bd = actor.data.data!
    bd.time -= dt
    actor.data.dirty = true
    if (bd.time <= 0) {
      WanderBehavior.INSTANCE.init(actor)
    }
  }

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
    // wake up early
    WanderBehavior.INSTANCE.init(actor)
    return true
  }
}

// mother-fricking compiler doesn't know that the INSTANCES handle it!
if (false) {
  log.debug("Gruntle: " + FoodBehavior + EggBehavior + WanderBehavior +
      ChatCircleBehavior + EatFoodBehavior + SleepBehavior)
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
    scale: DEFAULT_MONSTER_SCALE,
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
  const {x, y, z, scale, orient, state, instant, owner, name, path} = data
  return {
    x, y, z,
    scale,
    orient,
    state,
    instant,
    owner,
    name,
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
  dt :number, // in seconds
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
    behavior.tick(ctx, actor, dt)
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
  const MAX_INCREMENT = .20
  // get us 1/4th of the way to max size
  const increment = Math.min(MAX_INCREMENT, Math.max(0, (MAX_MONSTER_SCALE - data.scale)) * .25)
  data.scale = Math.min(MAX_MONSTER_SCALE, data.scale + increment)
  data.dirty = true
}

function shrinkMonster (data :ActorData) :void {
  const SHRINKAGE_FACTOR = .1
  const decrement = data.scale * SHRINKAGE_FACTOR
  data.scale = Math.max(MIN_MONSTER_SCALE, data.scale - decrement)
  data.dirty = true
}

/**
 * Handle "touching" an actor. */
function touchActor (
  ctx :RanchContext,
  id :UUID,
  arg? :Data,
) :void {
  const actor = getActor(ctx, id)
  if (!actor) {
    log.warn("Client asked to touch missing actor?", "id", id)
    return
  }
  const beh = Behavior.getBehavior(actor)
  if (beh.touch(ctx, actor, arg)) {
    ctx.obj.actors.set(actor.id, actorDataToUpdate(actor.data))
    ctx.obj.actorData.set(actor.id, actor.data)
  }
}

// hackity hack hack
function actorPhotoURL (config :ActorConfig) {
  return `https://demo1.tfw.dev/moncher/monsters/photo/${config.photo}`
}

function setActorName (ctx :RanchContext, ownerId :UUID, id :UUID, name :string) {
  const actor = getActor(ctx, id)
  if (!actor) log.warn("Client asked to name missing actor?", "id", id)
  else if (actor.data.owner !== ownerId) log.warn(
    "Non-owner asked to name actor?", "asker", ownerId, "id", id)
  else {
    log.info("Renaming actor", "id", id, "name", name)
    const oname = actor.data.name
    actor.data.name = name
    actor.data.dirty = true
    // TODO: push an immediate actor update?

    // update this monster's profile
    if (name !== oname) ctx.obj.source.post(profileQ(id), {
      type: "update", name, photo: actorPhotoURL(actor.config), ptype: ProfileType.npc})
    // if this is the first time the name is set, send a welcome message to the channel
    if (!oname) ctx.obj.source.post(
      channelQ(ctx.obj.key), {type: "post", sender: id, text: "Hi everybody!"})
  }
}

function setState (data :ActorData, state :ActorState) :void {
  data.state = state
  data.dirty = true
}

function visitActors (ctx :RanchContext, visitor :(actor :Actor) => void) :void {
  ctx.obj.actorData.forEach((data :ActorData, id :UUID) => {
    const config = ctx.obj.actorConfigs.get(id)
    if (!config) {
      log.warn("Missing actor config?", "id", id)
      return
    }
    const oActor :Actor = {id, config, data}
    visitor(oActor)
  })
}

function getNearestActor (
  ctx :RanchContext,
  loc :Located,
  predicate :(actor :Actor) => boolean,
  maxDist :number = Infinity
) :Actor|undefined {
  let nearest = undefined
  visitActors(ctx, actor => {
    if (predicate(actor)) {
      const dd = getDistance(loc, actor.data)
      if (dd < maxDist) {
        maxDist = dd
        nearest = actor
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

/**
 * Stop a monster walking dead in its tracks. Should be called after super.tick() on a mobile
 * behavior so that the location in the monster's data is up-to-date.
 *
 * Note that this method isn't necessary.
 * - if you want to start a new walk you can just call walkTo().
 * - if you want to stop the actor but let them face any direction, just clear the path.
 */
function stopWalking (
  ctx :RanchContext,
  actor :Actor,
) :void {
  if (actor.data.path) {
    // override their ending orientation with the current path segment's orientation
    actor.data.orient = actor.data.path.orient
    actor.data.path = undefined
    actor.data.dirty = true
  }
}

/**
 * Stop walking, outside of tick().
 * Because we don't have timestamps we have deltas, we need to advance the walk before
 * stopping it. */
function stopWalkingOutsideTick (
  ctx :RanchContext,
  actor :Actor,
) :void {
  if (!actor.data.path) return

  // fake like we received a tick, but just for this walk
  const dt = Date.now() - ctx.obj.lastTick.current
  advanceWalk(ctx, actor, dt)
  stopWalking(ctx, actor)
}

/**
 * Walk to a location. */
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
  const speed = getSpeed(ctx, actor) * speedFactor
  while (path.length > 1) {
    const dest = path.pop()!
    const src = path[path.length - 1]
    const duration = src.distanceTo(dest) / speed
    const orient = Math.atan2(dest.x - src.x, dest.z - src.z)
    info = { src: vec2loc(src), dest: vec2loc(dest), orient, duration, timeLeft: duration,
        next: info }
  }
  actor.data.path = info
  // set our final angle to something wacky
  actor.data.orient = Math.random() * Math.PI * 2
  actor.data.dirty = true
}

function advanceWalk (ctx :RanchContext, actor :Actor, dt :number) :void {
  const data = actor.data
  let path = data.path
  while (path) {
    if (dt < path.timeLeft) {
      path.timeLeft -= dt
      // update our position along this path piece
      const perc = path.timeLeft / path.duration // percentage towards src
      data.x = (path.src.x - path.dest.x) * perc + path.dest.x
      data.y = (path.src.y - path.dest.y) * perc + path.dest.y
      data.z = (path.src.z - path.dest.z) * perc + path.dest.z
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
