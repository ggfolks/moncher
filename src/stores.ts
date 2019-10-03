import {Disposable, Disposer} from "tfw/core/util"
import {Mutable, Value} from "tfw/core/react"
import {MutableList, RList} from "tfw/core/rcollect"
import {UUID, UUID0} from "tfw/core/uuid"

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
    const [nobj, unsub] = this.app.store.resolve(["profiles", id], ProfileObject)
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

export class UserStore implements Disposable {
  private readonly _onDispose = new Disposer()
  private readonly _feedback = MutableList.local<Feedback>()
  private _user = Mutable.local<UserObject|undefined>(undefined)

  get user () :UserObject {
    if (this._user.current) return this._user.current
    throw new Error(`UserObject not ready`)
  }

  get userValue () :Value<UserObject|undefined> {
    return this._user
  }

  get feedback () :RList<Feedback> { return this._feedback }

  constructor (readonly app :App) {
    app.client.manager.ackedId.onValue(id => {
      this._onDispose.dispose()
      if (id !== UUID0) {
        const [user, unlisten] = app.store.resolve(["users", id], UserObject)
        this._user.update(user)
        this._onDispose.add(unlisten)
        this._onDispose.add(user.feedback.onChange(msg => {
          console.log(`Feedback: ${msg}`)
          this._feedback.append({msg, when: new Date()})
        }))
      }
    })
  }

  dispose () {
    this._onDispose.dispose()
  }
}
