import {Disposable, Disposer} from "tfw/core/util"
import {UUID} from "tfw/core/uuid"

import {App} from "./app"
import {ProfileObject} from "./data"

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
