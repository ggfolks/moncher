import {Timestamp, log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth, DObject, MetaMsg} from "tfw/data/data"
import {dcollection, dobject, dset, dmap, dqueue, dvalue} from "tfw/data/meta"
import {Vector3} from "three"
import {MonsterDb} from "./monsterdb"
import {
  ActorAction, ActorConfig, ActorData, ActorInstant, ActorKind, ActorUpdate, Located,
  newActorData, actorDataToUpdate,
} from "./moncher"
import {Pathfinding} from "./pathfinding"
import {MONSTER_ACCELERANT} from "./debug"

const guestName = (id :UUID) => `Guest ${id.substring(0, 4)}`
const guestPhoto = (id :UUID) => "ui/DefaultAvatar.png"
const ranchName = (id :UUID) => `Ranch ${id.substring(0, 4)}`

/** A zoneId for three-pathfinding. */
// TODO: make a fucking ZonedPathfinder that just encapsulates this crap
export const RANCH_ZONE_ID = "ranch"

@dobject
export class ProfileObject extends DObject {

  @dvalue("string", true)
  name = this.value(guestName(this.key))

  @dvalue("string", true)
  photo = this.value(guestPhoto(this.key))

  canSubscribe (auth :Auth) { return true }
  canWrite (prop :string, auth :Auth) { return auth.id === this.key || super.canWrite(prop, auth) }
}

@dobject
export class UserObject extends DObject {

  @dvalue("uuid")
  ranch = this.value<UUID>(UUID0)

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
}

export const userQ = (id :UUID) => UserObject.queueAddr(["users", id], "userq")

type UserReq = {type :"enter", ranch :UUID}

// function sendJoined (obj :UserObject, ranch :UUID) {
//   obj.source.post(ranchQ(ranch), {type: "joined", id: obj.key, name: obj.name.current})
// }

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  log.info("handleUserReq", "auth", auth, "req", req)
  switch (req.type) {
  case "enter":
    if (auth.isSystem) obj.ranch.update(req.ranch)
    break
  }
}

interface Message {
  sender :UUID
  text :string
  sent :Timestamp
  edited? :Timestamp
}

@dobject
export class ChannelObject extends DObject {

  @dmap("uuid", "record")
  msgs = this.map<UUID, Message>()

  @dqueue(handleChannelReq)
  channelq = this.queue<ChannelReq>()

  addMessage (sender :UUID, text :string) {
    const mid = uuidv1()
    this.msgs.set(mid, {sender, sent: Timestamp.now(), text})
  }

  canSubscribe (auth :Auth) { return true /* TODO: ranch/channel membership */ }
}

export const channelQ = (id :UUID) => ChannelObject.queueAddr(["channels", id], "channelq")

type ChannelReq = {type :"speak", text :string}

function handleChannelReq (obj :ChannelObject, req :ChannelReq, auth :Auth) {
  log.info("handleChannelReq", "auth", auth, "req", req)
  switch (req.type) {
  case "speak":
    obj.addMessage(auth.id, req.text)
    break

  // case "edit":
  //   const msg = obj.messages.get(req.mid)
  //   if (msg && msg.sender === auth.id) {
  //     obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
  //   }
  //   break
  }
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

@dobject
export class RanchObject extends DObject {

  @dvalue("string", true)
  name = this.value(ranchName(this.key))

  @dset("uuid")
  occupants = this.set<UUID>()

  @dqueue(handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  /** The queue on which all client requests are handled. */
  @dqueue(handleRanchReq)
  ranchq = this.queue<RanchReq>()

  /** The map of actor configs, which is updated prior to the actor being added. */
  @dmap("uuid", "record", false)
  actorConfigs = this.map<UUID, ActorConfig>()

  /** The latest snapshot of each actor. */
  @dmap("uuid", "record", false)
  actors = this.map<UUID, ActorUpdate>()

  /** The "server-side" data about each actor. */
  @dmap("uuid", "record", false)
  actorData = this.map<UUID, ActorData>()

  canRead (prop :keyof RanchObject, auth :Auth) :boolean {
    switch (prop) {
      case "actorData": return auth.isSystem
      default: return super.canRead(prop, auth)
    }
  }

  canSubscribe (auth :Auth) { return true /* TODO: ranch membership */ }
}

export const ranchQ = (id :UUID) => RanchObject.queueAddr(["ranches", id], "ranchq")

function handleMetaMsg (obj :RanchObject, msg :MetaMsg, auth :Auth) {
  switch (msg.type) {
  case "subscribed":
    obj.occupants.add(msg.id)
    break
  case "unsubscribed":
    obj.occupants.delete(msg.id)
    break
  }
}

interface RanchContext {
  obj :RanchObject
  path? :Pathfinding
}

function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) :void {
  const ctx = { obj, path: global["_ranchPathfinder"] }
  switch (req.type) {
    case "touch":
      touchActor(ctx, req.id)
      break

    case "tick":
      tickRanch(ctx, 1000) // TODO
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

/**
 * Handle adding an actor. */
function addActor (
  ctx :RanchContext,
  config :ActorConfig,
  locProps :Located,
) :void {
//  if (true) {
//    obj.actorConfigs.clear()
//    obj.actorData.clear()
//    obj.actors.clear()
//    return
//  }

  const uuid = uuidv1()
  const data = newActorData(config.kind, locProps)
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
//			let path = data.path
//			while (path) {
//				if (dt < path.timeLeft) {
//					path.timeLeft -= dt
//					// update our position along this path piece
//					this.pos.lerpVectors(path.dest, path.src, path.timeLeft / path.duration)
//					return
//				}
//				// otherwise we used-up a path segment
//				if (path.next) {
//					dt -= path.timeLeft
//				} else {
//					// otherwise we have finished!
//					this.pos.copy(path.dest)
//					this.setAction(this.popState(), this._counter)
//					// proceed to assign path to undefined, and we'll fall out of the while.
//				}
//				path = this._path = path.next
//			}
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
          walkTo(ctx, data, newpos, .5)
				} else {
					setAction(ctx, data, ActorAction.Sleeping, 100 / MONSTER_ACCELERANT)
				}
			}
			break

		case ActorAction.Sleeping:
			if (--data.counter <= 0) {
				setAction(ctx, data, ActorAction.Waking)
			}
			break

		case ActorAction.Waking:
			setAction(ctx, data, ActorAction.Waiting, 8 / MONSTER_ACCELERANT)
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
            walkTo(ctx, data, foodData, 1.5)
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
            walkTo(ctx, data, nearEgg, 1.2)
          }
        }
        break
      }

      // Wander randomly!
      if (Math.random() < .075) {
        const newpos = getRandomPositionFrom(ctx, data, 10)
        if (newpos) {
          walkTo(ctx, data, newpos)
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
        addActor(ctx, config.spawn!, data)
        publish = true
      }
      break

    case ActorKind.Lobber:
    case ActorKind.Runner:
      switch (data.action) {
        case ActorAction.Sleeping:
          setAction(ctx, data, ActorAction.Waking)
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
  const groupId = ctx.path.getGroup(RANCH_ZONE_ID, vec)
  if (groupId === null) return undefined
  const result = ctx.path.getRandomPositionFrom(RANCH_ZONE_ID, groupId, vec, maxDist)
  if (result) return vec2loc(result)
  else return undefined
}

function getDistance (one :Located, two :Located) :number {
  const dx = one.x - two.x, dy = one.y - two.y, dz = one.z - two.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function loc2vec (loc :Located, into? :Vector3) :Vector3 {
  return (into || new Vector3()).set(loc.x, loc.y, loc.z)
}

function vec2loc (vec :Vector3, into? :Located) :Located {
  if (!into) into = <Located>{}
  into.x = vec.x
  into.y = vec.y
  into.z = vec.z
  return into
}

function walkTo (ctx :RanchContext, data :ActorData, newPos :Located, speedFactor = 1) :void {
  // FOR NOW, simply update our location to the new loc!
  data.x = newPos.x
  data.y = newPos.y
  data.z = newPos.z

  // when we finish walking this happens: (remove from here)
  setAction(ctx, data, popState(data), data.counter)
}

@dobject
export class ServerObject extends DObject {

  @dcollection(ProfileObject)
  profiles = this.collection<ProfileObject>()

  @dcollection(UserObject)
  users = this.collection<UserObject>()

  @dcollection(ChannelObject)
  channels = this.collection<ChannelObject>()

  @dcollection(RanchObject)
  ranches = this.collection<RanchObject>()
}
