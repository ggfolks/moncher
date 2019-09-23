import {Disposer, Remover, log} from "tfw/core/util"
import {UUID} from "tfw/core/uuid"
import {DataStore} from "tfw/data/server"

import {ServerObject, RanchObject} from "./data"

export class Ticker {
  private readonly _onDispose = new Disposer()
  private readonly _ranches = new Map<UUID,Remover>();

  constructor (readonly store :DataStore) {
    // TEMP: eventually this will be a (server privileged) client running in a separate VM
    const server = store.resolve([]).object as ServerObject

    this._onDispose.add(server.activeRanches.onChange(change => {
      if (change.type === "added") this.observeRanch(change.elem)
      else this.clearRanch(change.elem)
    }))
    for (const ranch of server.activeRanches) this.observeRanch(ranch)
  }

  dispose () {
    this._ranches.forEach(r => r())
    this._ranches.clear()
    this._onDispose.dispose()
  }

  protected observeRanch (id :UUID) {
    const ranch = this.store.resolve(["ranches", id]).object as RanchObject
    log.info("Ticking ranch", "id", id)
    const ticker = setTimeout(() => ranch.ranchq.post({type: "tick"}), 1000)
    this._ranches.set(id, () => clearTimeout(ticker))
  }

  protected clearRanch (id :UUID) {
    const remover = this._ranches.get(id)
    if (remover) remover()
    else log.warn("Unknown ranch cleared?", "id", id)
  }
}
