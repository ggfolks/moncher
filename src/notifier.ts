import * as admin from "firebase-admin"

import {Disposer, Remover, log} from "tfw/core/util"
import {UUID} from "tfw/core/uuid"
import {DObject} from "tfw/data/data"
import {DataStore} from "tfw/data/server"

import {ServerObject, ProfileObject, UserObject, ChannelObject, Message} from "./data"

function whenActive<T extends DObject> (obj :T, op :(obj:T) => void) {
  obj.state.whenOnce(s => s === "active", _ => op(obj))
}

export class Notifier {
  private readonly _onDispose = new Disposer()
  private readonly _channels = new Map<UUID,Remover>();
  // note: we only keep these local caches because that's what we'll need to do when we're a proper
  // client; also TODO: flush old profile & user objects based on LRU cache or something like that
  private readonly _profiles = new Map<UUID,ProfileObject>();
  private readonly _users = new Map<UUID,UserObject>();

  private readonly fcm :admin.messaging.Messaging

  constructor (readonly app :admin.app.App, readonly store :DataStore) {
    this.fcm = admin.messaging()
    // TEMP: eventually this will be a (server privileged) client running in a separate VM
    const server = store.resolve([]).object as ServerObject

    this._onDispose.add(server.activeChannels.onChange(change => {
      if (change.type === "added") this.observeChannel(change.elem)
      else this.clearChannel(change.elem)
    }))
    for (const channel of server.activeChannels) this.observeChannel(channel)
  }

  dispose () {
    this._channels.forEach(r => r())
    this._channels.clear()
    this._onDispose.dispose()
  }

  protected observeChannel (id :UUID) {
    const channel = this.store.resolve(["channels", id]).object as ChannelObject
    log.info("Notifying for channel", "id", id)
    this._channels.set(id, channel.latestMsg.onChange(msg => this.notifyChannelMsg(channel, msg)))
  }

  protected clearChannel (id :UUID) {
    const remover = this._channels.get(id)
    if (remover) remover()
    else log.warn("Unknown channel cleared?", "id", id)
  }

  protected notifyChannelMsg (channel :ChannelObject, msg :Message) {
    whenActive(this.profile(channel.key), cprofile => {
      whenActive(this.profile(msg.sender), sprofile => {
        const title = cprofile.name.current, body = `${sprofile.name.current}: ${msg.text}`
        for (const uid of channel.members) {
          whenActive(this.user(uid), user => {
            if (user.tokens.size > 0) {
              log.info("Sending notification", "user", uid, "tokens", user.tokens.size,
                       "title", title, "body", body)
              this.notifyUser(Array.from(user.tokens), title, body)
            }
          })
        }
      })
    })
  }

  protected user (uid :UUID) :UserObject {
    const user = this._users.get(uid)
    if (user) return user
    const nuser = this.store.resolve(["users", uid]).object as UserObject
    this._users.set(uid, nuser)
    return nuser
  }

  protected profile (id :UUID) :ProfileObject {
    const profile = this._profiles.get(id)
    if (profile) return profile
    const nprofile = this.store.resolve(["profiles", id]).object as ProfileObject
    this._profiles.set(id, nprofile)
    return nprofile
  }

  protected notifyUser (
    tokens :string[], title :string, body :string
  ) :Promise<admin.messaging.MessagingDevicesResponse> {
    return this.fcm.sendToDevice(tokens, {
      notification: {
        title,
        body,
        // icon: 'your-icon-url',
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      }
    })
  }
}
