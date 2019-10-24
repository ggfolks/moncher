import {Value} from "tfw/core/react"
import {RMap} from "tfw/core/rcollect"
import {Disposer, Remover} from "tfw/core/util"

import {App} from "./app"
import {ChannelObject, Message} from "./data"

class ChannelInfo {
  /** How many references to this channel? */
  refs = 0
  /** Our disposer, for cleaning up this channel. */
  disposer = new Disposer()
  /** A singleton remover we pass to referers. */
  remover = () => {
    if (--this.refs === 0) this.disposer.dispose()
  }

  constructor (readonly channel :ChannelObject, readonly msgs :RMap<string, Message>) {
  }

  makeRef () :[ChannelObject, RMap<string, Message>, Remover] {
    this.refs++
    return [this.channel, this.msgs, this.remover]
  }
}

export class ChatDirector {

  constructor (readonly app :App) {
  }

  getChannel (id :string) :[ChannelObject, RMap<string, Message>, Remover] {
    const info = this._channels.get(id)
    if (info) return info.makeRef()

    const [channel, unchannel] = this.app.store.resolve(["channels", id], ChannelObject)
    const [msgs, unmsgs] = this.app.store.resolveView(channel.msgsBySent)

    const ninfo = new ChannelInfo(channel, msgs)
    ninfo.disposer.add(unchannel)
    ninfo.disposer.add(unmsgs)
    // once we have the channel data, if we're not a guest, and haven't joined the channel, do so
    ninfo.disposer.add(
      Value.join3(channel.state, this.app.notGuest, this.app.client.manager.ackedId)
        .onValue(([cs, ng, id]) => {
          if (cs === "active" && ng && !channel.members.has(id)) {
            channel.channelq.post({type: "join"})
          }
          // TODO: leave the channel?
        }))
    ninfo.disposer.add(() => this._channels.delete(id))
    this._channels.set(id, ninfo)
    return ninfo.makeRef()
  }

  protected readonly _channels = new Map<string, ChannelInfo>()
}
