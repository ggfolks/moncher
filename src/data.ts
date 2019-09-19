import {Timestamp, log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth, DObject, MetaMsg} from "tfw/data/data"
import {dcollection, dmap, dobject, dqueue, dset, dtable, dvalue, dview,
        orderBy} from "tfw/data/meta"
import {
  ActorConfig, ActorData, ActorUpdate, RanchReq, handleRanchReq,
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

  @dvalue("number", true)
  type = this.value(0)

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

export type Message = {
  sender :UUID
  text :string
  sent :Timestamp
  edited :Timestamp|undefined
}

@dobject
export class ChannelObject extends DObject {

  @dtable()
  msgs = this.table<Message>()

  @dview("msgs", [], [orderBy("sent", "desc")])
  msgsBySent = this.view<Message>()

  @dqueue(handleChannelReq)
  channelq = this.queue<ChannelReq>()

  addMessage (sender :UUID, text :string) {
    const mid = uuidv1()
    this.msgs.create(mid, {sender, text, sent: Timestamp.now()})
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

  /** Keeps the last time we were ticked, from Date.now() */
  @dvalue("number", false)
  lastTick = this.value(0)

  canRead (prop :keyof RanchObject, auth :Auth) :boolean {
    switch (prop) {
      default: return super.canRead(prop, auth)
      case "actorData":
      case "lastTick":
        return auth.isSystem
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
