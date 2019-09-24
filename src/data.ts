import {Timestamp, log} from "tfw/core/util"
import {UUID, UUID0, uuidv1} from "tfw/core/uuid"
import {Auth, DObject, MetaMsg} from "tfw/data/data"
import {dcollection, dmap, dobject, dqueue, dset, dtable, dvalue, dview,
        orderBy} from "tfw/data/meta"
import {ActorConfig, ActorData, ActorUpdate, SERVER_FUNCS} from "./ranchdata"

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

  @dset("string", true)
  tokens = this.set<string>()

  @dvalue("string")
  feedback = this.value<string>("")

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
}

export const userQ = (id :UUID) => UserObject.queueAddr(["users", id], "userq")

function sendFeedback (from :DObject, uid :UUID, msg :string) {
  // TODO: this custom message will go away when we have generic set-value meta msgs
  from.source.post(userQ(uid), {type: "feedback", msg})
}

type UserReq = {type :"enter", ranch :UUID}
             | {type: "feedback", msg :string}

// function sendJoined (obj :UserObject, ranch :UUID) {
//   obj.source.post(ranchQ(ranch), {type: "joined", id: obj.key, name: obj.name.current})
// }

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  log.debug("handleUserReq", "auth", auth, "req", req)
  switch (req.type) {
  case "enter":
    if (auth.isSystem) obj.ranch.update(req.ranch)
    break
  case "feedback":
    if (auth.isSystem) obj.feedback.update(req.msg)
    break
  }
}

export type Message = {
  sender :UUID
  text :string
  sent :Timestamp
  edited? :Timestamp
}

const NoMessage = {
  sender: UUID0,
  text: "",
  sent: new Timestamp(0)
}

@dobject
export class ChannelObject extends DObject {

  @dset("uuid")
  viewers = this.set<UUID>()

  @dset("uuid", true)
  members = this.set<UUID>()

  @dvalue("record")
  latestMsg = this.value<Message>(NoMessage)

  @dtable()
  msgs = this.table<Message>()

  @dview("msgs", [], [orderBy("sent", "desc")])
  msgsBySent = this.view<Message>()

  @dqueue(handleChannelReq)
  channelq = this.queue<ChannelReq>()

  @dqueue(handleChannelMetaMsg)
  metaq = this.queue<MetaMsg>()

  addMessage (sender :UUID, text :string) {
    const mid = uuidv1(), msg = {sender, text, sent: Timestamp.now()}
    this.msgs.create(mid, msg)
    this.latestMsg.update(msg)
  }

  canSubscribe (auth :Auth) { return true /* TODO: ranch/channel membership */ }
}

export const channelQ = (id :UUID) => ChannelObject.queueAddr(["channels", id], "channelq")

type ChannelReq = {type :"speak", text :string}

function handleChannelReq (obj :ChannelObject, req :ChannelReq, auth :Auth) {
  log.debug("handleChannelReq", "auth", auth, "req", req)
  switch (req.type) {
  case "speak":
    if (auth.isGuest) sendFeedback(obj, auth.id, "Please login if you wish to chat.")
    else obj.addMessage(auth.id, req.text)
    break

  // case "edit":
  //   const msg = obj.messages.get(req.mid)
  //   if (msg && msg.sender === auth.id) {
  //     obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
  //   }
  //   break
  }
}

function handleChannelMetaMsg (obj :ChannelObject, msg :MetaMsg, auth :Auth) {
  // log.debug("handleChannelMeta", "auth", auth, "msg", msg)
  if (!auth.isSystem) return
  switch (msg.type) {
  case "subscribed":
    if (msg.id === UUID0) return // ignore system subscribers
    if (obj.viewers.size === 0) obj.source.post(
      serverQ, {type: "active", what: "channel", id: obj.key})
    obj.viewers.add(msg.id)
    break
  case "unsubscribed":
    if (msg.id === UUID0) return // ignore system subscribers
    obj.viewers.delete(msg.id)
    if (obj.viewers.size === 0) obj.source.post(
      serverQ, {type: "inactive", what: "channel", id: obj.key})
    break
  }
}

@dobject
export class RanchObject extends DObject {

  @dvalue("string", true)
  name = this.value(ranchName(this.key))

  /** Is the ranch in debug mode? */
  @dvalue("boolean")
  debug = this.value(false)

  @dset("uuid")
  occupants = this.set<UUID>()

  /** The map of actor configs, which is updated prior to the actor being added. */
  @dmap("uuid", "record")
  actorConfigs = this.map<UUID, ActorConfig>()

  /** The latest snapshot of each actor. */
  @dmap("uuid", "record")
  actors = this.map<UUID, ActorUpdate>()

  /** The "server-side" data about each actor. */
  @dmap("uuid", "record")
  actorData = this.map<UUID, ActorData>()

  /** Keeps the last time we were ticked, from Date.now() */
  @dvalue("number")
  lastTick = this.value(0)

  @dqueue(handleRanchMetaMsg)
  metaq = this.queue<MetaMsg>()

  /** The queue on which all client requests are handled. */
  @dqueue(handleRanchReq)
  ranchq = this.queue<RanchReq>()

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
    /** Reset the ranch to a starting state (DEBUG?) */
    {type :"reset"} |
    /** Turn on or off debug mode. */
    {type :"debug", value :boolean} |
    /** A client-initiated tick (TEMP) */
    {type :"tick"}

//const ranchQ = (id :UUID) => RanchObject.queueAddr(["ranches", id], "ranchq")

function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) :void {
  global[SERVER_FUNCS].handleRanchReq(obj, req, auth)
}

function handleRanchMetaMsg (obj :RanchObject, msg :MetaMsg, auth :Auth) {
  // log.debug("handleRanchMeta", "auth", auth, "msg", msg)
  switch (msg.type) {
  case "subscribed":
    if (msg.id === UUID0) return // ignore system subscribers
    if (obj.occupants.size === 0) obj.source.post(
      serverQ, {type: "active", what: "ranch", id: obj.key})
    obj.occupants.add(msg.id)
    sendFeedback(obj, msg.id, `Welcome to ${obj.name.current}`)
    break
  case "unsubscribed":
    if (msg.id === UUID0) return // ignore system subscribers
    obj.occupants.delete(msg.id)
    if (obj.occupants.size === 0) obj.source.post(
      serverQ, {type: "inactive", what: "ranch", id: obj.key})
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

  @dset("uuid")
  activeChannels = this.set<UUID>()

  @dset("uuid")
  activeRanches = this.set<UUID>()

  @dcollection(RanchObject)
  ranches = this.collection<RanchObject>()

  @dqueue(handleServerReq)
  serverq = this.queue<ServerReq>()
}

type ServerReq = {type: "active", id :UUID, what :"ranch"|"channel"}
               | {type: "inactive", id :UUID, what :"ranch"|"channel"}

function handleServerReq (obj :ServerObject, req :ServerReq, auth :Auth) {
  // log.debug("handleServerReq", "auth", auth, "req", req)
  if (!auth.isSystem) return
  // TODO: create meta messages for this sort of super simple "make this change to this standard
  // distributed object property" machinery
  switch (req.type) {
  case "active":
    if (req.what === "channel") obj.activeChannels.add(req.id)
    else if (req.what === "ranch") obj.activeRanches.add(req.id)
    break
  case "inactive":
    if (req.what === "channel") obj.activeChannels.delete(req.id)
    else if (req.what === "ranch") obj.activeRanches.delete(req.id)
    break
  }
}

export const serverQ = ServerObject.queueAddr([], "serverq")
