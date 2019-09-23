import {Disposable, Disposer} from "tfw/core/util"
import {MutableList, RList} from "tfw/core/rcollect"
import {UUID} from "tfw/core/uuid"

import {App} from "./app"
import {ProfileObject, UserObject} from "./data"

export class ProfileStore implements Disposable {
  private _onDispose = new Disposer()
  private _profiles = new Map<UUID, ProfileObject>()

  constructor (readonly app :App) {}

  /*** Resolves the profile object for the user with `id`. */
  profile (id :UUID) :ProfileObject {
    const obj = this._profiles.get(id)
    if (obj) return obj
    const [nobj, unsub] = this.app.client.resolve(["profiles", id], ProfileObject)
    this._profiles.set(id, nobj)
    this._onDispose.add(unsub)
    return nobj
  }

  dispose () {
    this._onDispose.dispose()
  }
}

export type Feedback = {
  msg :string
  when :Date
}

export class FeedbackStore implements Disposable {
  private readonly _onDispose = new Disposer()
  private readonly _messages = MutableList.local<Feedback>()

  get messages () :RList<Feedback> { return this._messages }

  constructor (readonly app :App) {
    app.client.serverAuth.onValue(id => {
      this._onDispose.dispose()
      const [user, unlisten] = app.client.resolve(["users", id], UserObject)
      this._onDispose.add(unlisten)
      this._onDispose.add(user.feedback.onChange(msg => {
        console.log(`Feedback: ${msg}`)
        this._messages.append({msg, when: new Date()})
      }))
    })
  }

  dispose () {
    this._onDispose.dispose()
  }
}
