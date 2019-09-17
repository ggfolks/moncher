import {Timestamp, log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth, DObject, MetaMsg} from "tfw/data/data"
import {dcollection, dobject, dset, dmap, dqueue, dvalue} from "tfw/data/meta"
import {MonsterDb} from "./monsterdb"
import {
  ActorConfig, ActorData, ActorUpdate, LocProps,
  newActorData, actorDataToUpdate,
} from "./moncher"

const guestName = (id :UUID) => `Guest ${id.substring(0, 4)}`
const guestPhoto = (id :UUID) => "ui/DefaultAvatar.png"
const ranchName = (id :UUID) => `Ranch ${id.substring(0, 4)}`

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
    {type :"touch", id :number} |
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

function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) :void {
  switch (req.type) {
    case "touch":
      log.debug("I would like to touch an actor", "id", req.id)
      break

    case "tick":
      log.debug("Someone wants us to tick")
      break

    case "setName":
      log.debug("Got setname " + req.name)
      obj.name.update(req.name)
      break

    case "dropEgg":
      addActor(obj, MonsterDb.getRandomEgg(), req)
      break

    case "dropFood":
      addActor(obj, MonsterDb.getFood(), req)
      break

    default:
      log.warn("Unhandled ranch request", "req", req)
      break
  }
}

/**
 * Handle adding an actor. */
function addActor (
    obj :RanchObject,
    config :ActorConfig,
    locProps :LocProps,
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
  obj.actorConfigs.set(uuid, config)
  obj.actorData.set(uuid, data)
  obj.actors.set(uuid, update)
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
