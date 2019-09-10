import {Timestamp, log} from "tfw/core/util"
import {UUID, UUID0} from "tfw/core/uuid"
import {Auth, DObject, MetaMsg} from "tfw/data/data"
import {dcollection, dobject, dmap, dqueue, dvalue} from "tfw/data/meta"

const guestName = (id :UUID) => `Guest ${id.substring(0, 4)}`
const guestPhoto = (id :UUID) => "https://api.adorable.io/avatars/128/${id}.png"
const ranchName = (id :UUID) => `Ranch ${id.substring(0, 4)}`

@dobject
export class UserObject extends DObject {

  @dvalue("string")
  name = this.value(guestName(this.key))

  @dvalue("string")
  photo = this.value(guestPhoto(this.key))

  @dvalue("uuid")
  ranch = this.value<UUID>(UUID0)

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
}

export const userQ = (id :UUID) => UserObject.queueAddr(["users", id], "userq")

type UserReq = {type :"setinfo", name :string, photo :string}
             | {type :"enter", ranch :UUID}

function sendJoined (obj :UserObject, ranch :UUID) {
  obj.source.post(ranchQ(ranch), {type: "joined", id: obj.key, name: obj.name.current})
}

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  log.info("handleUserReq", "auth", auth, "req", req)
  switch (req.type) {
  case "enter":
    if (auth.isSystem) {
      obj.ranch.update(req.ranch)
      sendJoined(obj, req.ranch)
    }
    break
  case "setinfo":
    obj.name.update(req.name)
    obj.photo.update(req.photo)
    const ranch = obj.ranch.current
    if (ranch != UUID0) sendJoined(obj, ranch)
    break
  }
}

type MID = number

interface Message {
  sender :UUID
  sent :Timestamp
  name: string
  text :string
  edited? :Timestamp
}

interface OccupantInfo {
  name :string
  photo :string
}

@dobject
export class RanchObject extends DObject {

  @dvalue("string")
  name = this.value(ranchName(this.key))

  @dmap("uuid", "record")
  occupants = this.map<UUID, OccupantInfo>()

  @dvalue("size32")
  nextMsgId = this.value(1)

  @dmap("size32", "record")
  messages = this.map<MID, Message>()

  @dqueue(handleRanchReq)
  ranchq = this.queue<RanchReq>()

  @dqueue(handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  canSubscribe (auth :Auth) { return true /* TODO: ranch membership */ }

  addMessage (sender :UUID, name :string, text :string) {
    const mid = this.nextMsgId.current
    this.nextMsgId.update(mid+1)
    this.messages.set(mid, {sender, sent: Timestamp.now(), text, name})
  }
}

export const ranchQ = (id :UUID) => RanchObject.queueAddr(["ranches", id], "ranchq")

type RanchReq = {type :"join"}
                | {type :"joined", id :UUID, name :string, photo :string}
                | {type :"speak", text :string}
                | {type :"edit", mid :MID, newText :string}
                | {type :"delete"}

function handleRanchReq (obj :RanchObject, req :RanchReq, auth :Auth) {
  log.info("handleRanchReq", "auth", auth, "req", req)
  switch (req.type) {
  case "joined":
    if (auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (!info) log.info("Missing occupant for 'joined'", "req", req)
      else {
        obj.occupants.set(req.id, {...info, name: req.name, photo: req.photo})
        obj.addMessage(UUID0, "", `'${info.name}' changed to '${req.name}'`)
      }
    }
    break

  case "speak":
    const info = obj.occupants.get(auth.id)
    if (info) obj.addMessage(auth.id, info.name, req.text)
    else log.warn("Missing occupant for 'speak'", "req", req, "auth", auth)
    break

  case "edit":
    const msg = obj.messages.get(req.mid)
    if (msg && msg.sender === auth.id) {
      obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
    }
    break
  }
}

function handleMetaMsg (obj :RanchObject, msg :MetaMsg, auth :Auth) {
  switch (msg.type) {
  case "subscribed":
    const name = guestName(msg.id), photo = guestPhoto(msg.id)
    obj.occupants.set(msg.id, {name, photo})
    obj.addMessage(UUID0, "", `'${name}' entered.`)
    break
  case "unsubscribed":
    const info = obj.occupants.get(msg.id)
    if (info) {
      obj.occupants.delete(msg.id)
      obj.addMessage(UUID0, "", `'${info.name}' left.`)
    } else log.warn("Missing occupant for unsubscribe", "auth", auth)
    break
  }
}

@dobject
export class ServerObject extends DObject {

  @dcollection(UserObject)
  users = this.collection<UserObject>()

  @dcollection(RanchObject)
  ranches = this.collection<RanchObject>()
}
