import {Data, Record} from "tfw/core/data"
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
import {copyloc, loc2vec, locsEqual, vec2loc} from "./ranchutil"

const stripTrailingSlash = (url :string) => url.endsWith("/") ? url.substring(0, url.length-1) : url
const serverUrl = stripTrailingSlash(process.env.SERVER_URL || "http://localhost:3000/")

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
const CHAT_CIRCLE_RADIUS = 2

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
const CHAT_CIRCLE_MAX_DURATION = 2 * 60 // 2 minutes

/** How often do monsters act happy together? */
const CHAT_BOUNCE_INTERVAL = 4.8

/** Dirty flags. */
const SERVER_DIRTY = 1 << 0
const CLIENT_DIRTY = 1 << 1

const MAX_FIREFLIES = 10 // maximum number of fireflies to have in the scene?

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
    log.warn("Missing actor config?", "id", id)
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
    actor.data.dirty = CLIENT_DIRTY

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
   * @return true if something changed and we should publish ALL dirty actors.
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
class DecayBehavior extends Behavior {
  static INSTANCE = new DecayBehavior(ActorKind.Food, ActorKind.Firefly)

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    actor.data.hp -= (dt / 100) // food decays
    dirtyServer(actor.data)
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
      dirtyServer(actor.data)
      break

    case ActorState.Hatching: // we are only hatching for a moment
      setState(data, ActorState.Hatched)
      break

    case ActorState.Hatched:
      data.hp -= dt // deplete until removed
      dirtyServer(actor.data)
      break
    }
  }

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
    const data = actor.data
    if (data.state === ActorState.ReadyToHatch) {
      setState(data, ActorState.Hatching)
      // spawn monster with the same owner at the same location
      addActor(ctx, data.owner, actor.config.spawn!, data /*Located*/, HatchingBehavior.INSTANCE)
      data.owner = UUID0 // update the EGG to be owned by nobody
      dirtyClient(data)
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
      dirtyClient(data)
    }

    if (data.hunger < STARVING_HUNGER) {
      data.hunger += dt
      dirtyServer(data)
    }
  }

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
    const data = actor.data
    data.instant = (Math.random() < .8) ? ActorInstant.Touched : ActorInstant.Hit
    data.orient = 0 // face forward
    dirtyClient(data)

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
//      log.info("Placed monster in chat circle", "arg", arg)
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
      this.breakCircle(ctx, data.info as any as Located, true)
    }
    dirtyClient(data)
  }

  touch (ctx :RanchContext, actor :Actor, arg? :Data) :boolean {
    const circleArg = actor.data.info as any as Located
    // let's just leave the chat circle
    WanderBehavior.INSTANCE.init(actor)
    // if there's only one other actor in the circle, break-it-up?
    this.breakCircle(ctx, circleArg)
    return true
  }

  protected breakCircle (ctx :RanchContext, circleArg :Located, force? :boolean) :void {
    const isInCircle :(actor :Actor) => boolean =
        actor => this.isBehaved(actor) && locsEqual(circleArg, actor.data.info as any as Located)
    if (!force) {
      let count = 0
      visitActors(ctx, actor => {
        if (isInCircle(actor)) count += 1
      })
      if (count === 0 || count > 1) return
    }
    visitActors(ctx, actor => {
      if (isInCircle(actor)) {
        WanderBehavior.INSTANCE.init(actor)
      }
    })
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
        const existingCircle = ChatCircleBehavior.INSTANCE.isBehaved(monst)
        const loc :Located = existingCircle
            ? monst.data.info as any as Located
            : copyloc(monst.data)
        // find a new position near THAT
        const nearCircle = getRandomPositionFrom(ctx, loc, CHAT_CIRCLE_RADIUS) || loc
        walkTo(ctx, actor, nearCircle)
        // face the center of the circle
        actor.data.orient = Math.atan2(loc.x - nearCircle.x, loc.z - nearCircle.z)
        // put them both into ChatCircle mode
        ChatCircleBehavior.INSTANCE.init(actor, loc)
        if (!existingCircle) {
          // walk the other monster over to a good spot too
          const near2 = getRandomPositionFrom(ctx, loc, CHAT_CIRCLE_RADIUS)
          if (near2) {
            walkTo(ctx, monst, near2)
            monst.data.orient = Math.atan2(loc.x - near2.x, loc.z - near2.z)
          }
          ChatCircleBehavior.INSTANCE.maybeInit(monst, loc)
        }
        return
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
          dirtyServer(foodData)
          bd.phase = 2
          bd.time = EATING_DURATION
          setState(data, ActorState.Eating)

        } else {
          walkTo(ctx, actor, foodData, WALK_TO_FOOD_SPEED)
        }
      } else {
        // can't find food: we're just going to wait one tick and reset
        bd.phase = 1
        // if we haven't complained lately, message our owner asking for food
        if (canPost(actor)) sendActorPost(ctx, actor, "I'm hungry and there's no food!", "hungry")
        dirtyServer(data)
      }
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
      dirtyServer(data)
      break

    case 3: // looking for a nap spot
      const newpos = getRandomPositionFrom(ctx, data, NAP_NEAR_FOOD_DISTANCE * data.scale)
      if (newpos) {
        walkTo(ctx, actor, newpos, WALK_TO_NAP_SPEED)
        bd.phase = 4
        dirtyServer(data)
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

  tick (ctx :RanchContext, actor :Actor, dt :number) :void {
    const bd = actor.data.data!
    bd.time -= dt
    dirtyServer(actor.data)
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
  log.debug("Gruntle: " + DecayBehavior + EggBehavior + WanderBehavior +
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
    dirty: CLIENT_DIRTY, // start dirty!
  }
  const actor :Actor = { id, config, data }
  if (!behavior) behavior = Behavior.getBehavior(actor) // get default
  behavior.init(actor)

  return data
}

/**
 * Publish an actor update derived from the specified ActorData. */
function actorDataToUpdate (data :ActorData) :ActorUpdate {
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

/**
 * Remove dead actors, publish dirty ones. */
function publishChanges (ctx :RanchContext) :void {
  // After ticking every actor (actors may modify each other), re-publish any that are dirty
  ctx.obj.actorData.forEach((data :ActorData, id :UUID) => {
    if (data.hp <= 0) {
      removeActor(ctx, id)
    } else if (data.dirty) {
      if (data.dirty & CLIENT_DIRTY) {
        ctx.obj.actors.set(id, actorDataToUpdate(data))
      }
      delete data.dirty
      ctx.obj.actorData.set(id, data)
    }
  })
}

function tickRanch (
  ctx :RanchContext,
  dt :number, // in seconds
) :void {

  checkFireflies(ctx)

  visitActors(ctx, actor => {
    const behavior :Behavior = Behavior.getBehavior(actor)
    behavior.tick(ctx, actor, dt)
  })
  publishChanges(ctx)
}

function checkFireflies (ctx :RanchContext) :void {
  if (!ctx.path) return
  if (Math.random() > .1 ||
      countActors(ctx, a => (a.config.kind === ActorKind.Firefly)) >= MAX_FIREFLIES) return
  // add a firefly!
  const vec = ctx.path.getRandomPositionFrom(new Vector3())
  if (vec) {
    addActor(ctx, UUID0, MonsterDb.getFirefly(), vec2loc(vec))
  }
}

function growMonster (data :ActorData) :void {
  // this could probably be smoother and better
  const MAX_INCREMENT = .20
  // get us 1/4th of the way to max size
  const increment = Math.min(MAX_INCREMENT, Math.max(0, (MAX_MONSTER_SCALE - data.scale)) * .25)
  data.scale = Math.min(MAX_MONSTER_SCALE, data.scale + increment)
  dirtyClient(data)
}

function shrinkMonster (data :ActorData) :void {
  const SHRINKAGE_FACTOR = .1
  const decrement = data.scale * SHRINKAGE_FACTOR
  data.scale = Math.max(MIN_MONSTER_SCALE, data.scale - decrement)
  dirtyClient(data)
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
    publishChanges(ctx)
  }
}

// hackity hack hack
function actorImageURL (config :ActorConfig, type :string) {
  if (!config.imageBase) {
    log.warn("Requested image URL For actor with no image base", "config", config, "type", type)
    return `${serverUrl}/monsters/emoji/AcornIcon.png` // TODO: error image?
  }
  return `${serverUrl}/monsters/images/${type}_${config.imageBase}.jpg`
}

function makeRanchLink (ctx :RanchContext, focusId? :UUID) :string {
  const url = `${serverUrl}/${ctx.obj.key}`
  return focusId ? `${url}+${focusId}` : url
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
    dirtyClient(actor.data)
    // TODO: push an immediate actor update?

    // update this monster's profile
    if (name !== oname) ctx.obj.source.post(profileQ(id), {
      type: "update", name, photo: actorImageURL(actor.config, "photo"), ptype: ProfileType.npc})
    // if this is the first time the name is set, send a welcome message to the channel
    if (!oname) sendActorPost(ctx, actor, "Hi everybody!")
  }
}

// don't let actors spam the channel more often than once an hour (TODO: probably way less)
const MIN_POST_INTERVAL = 60 * 60 * 1000

function canPost (actor :Actor) {
  const now = Date.now()
  return (actor.data.lastPost === undefined || now - actor.data.lastPost >= MIN_POST_INTERVAL)
}

function sendActorPost (ctx :RanchContext, actor :Actor, text :string, imageType? :string) {
  if (!canPost(actor)) {
    log.debug("Dropping post from chatty actor", "actor", actor.id, "text", text)
    return
  }
  const post :Record = {type: "post", sender: actor.id, text}
  if (imageType) {
    post["image"] = actorImageURL(actor.config, imageType)
    post["link"] = makeRanchLink(ctx)
  }
  ctx.obj.source.post(channelQ(ctx.obj.key), post)
  actor.data.lastPost = Date.now()
}

function setState (data :ActorData, state :ActorState) :void {
  data.state = state
  dirtyClient(data)
}

/**
 * Visit all actors on the ranch. */
function visitActors (ctx :RanchContext, visitor :(actor :Actor) => void) :void {
  ctx.obj.actorData.forEach((data :ActorData, id :UUID) => {
    const config = ctx.obj.actorConfigs.get(id)
    if (!config) {
      log.warn("Missing actor config?", "id", id)
      return
    }
    const actor :Actor = {id, config, data}
    visitor(actor)
  })
}

function countActors (ctx :RanchContext, pred :(actor :Actor) => boolean) :number {
  let count = 0
  visitActors(ctx, a => { if (pred(a)) count++ })
  return count
}

/**
 * Find the nearest actor that satisfies the predicate. Note that it checks all actors,
 * so you may need to exclude "yourself". */
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
    dirtyClient(actor.data)
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
  const dt = (Date.now() - ctx.obj.lastTick.current) / 1000
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
  dirtyClient(actor.data)
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
      dirtyClient(data)
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
    dirtyClient(data)
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

function dirtyServer (data :ActorData) :void {
  dirty(data, SERVER_DIRTY)
}

function dirtyClient (data :ActorData) :void {
  dirty(data, CLIENT_DIRTY)
}

function dirty (data :ActorData, level :number) :void {
  if (data.dirty === undefined) data.dirty = level
  else data.dirty |= level
}
