import {Clock} from "tfw/core/clock"
import {log} from "tfw/core/util"
import {ResourceLoader} from "tfw/asset/loader"
import {Component, Domain, EntityConfig, ID, Matcher, System} from "tfw/entity/entity"
import {TransformComponent} from "tfw/space/entity"
import {JsonConfig, GLTFConfig, createObject3D} from "tfw/scene3/entity"
import {Color, Object3D, Quaternion, Vector3} from "three"

/** The kinds of things we can load for the source of lerping properties. */
export type LerpSourceConfig = JsonConfig | GLTFConfig

export interface LerpComponentConfig {
  cycleTime :number
  sources :LerpSourceConfig[]
  paths :string[] // TODO: support real paths with full dot notation?
}

export class LerpRecord {
  static DUMMY = new LerpRecord(0, [], 0)

  readonly sources :any[]
  readonly fns :LerpFn[]

  constructor (
    readonly cycleTime :number,
    readonly paths :string[],
    sourceCount :number,
  ) {
    this.sources = new Array(sourceCount)
    this.fns = new Array(sourceCount)
  }
}


// TODO: Maybe the infrequent-updating is pulled out into a wrapper System that
// merely maintains its own dt and then fakes-up a Clock object to pass to its
// contained system(s)
//export class IntermittentClocker {
//  constructor (
//    protected readonly toWrap :(clock :Clock) => void,
//    protected readonly updateFrequency :number
//  ) {}
//
//  update (clock :Clock) :void {
//    this._dt += clock.dt
//    if (this._dt < this.updateFrequency) return
//    const slowClock :Clock = {time: clock.time, elapsed: clock.elapsed, dt: this._dt}
//    this.toWrap(slowClock)
//    this._dt = 0
//  }
//
//  protected _dt :number = 0
//}

const scratchV = new Vector3()
const scratchQ = new Quaternion()
export class LerpSystem extends System {

  constructor (
    domain :Domain,
    readonly loader :ResourceLoader,
    readonly lerps :Component<LerpRecord>,
    readonly trans :TransformComponent,
    readonly obj :Component<Object3D>,
    protected readonly updateFrequency :number = 0,
  ) {
    super(domain, Matcher.hasAllC(lerps.id, trans.id, obj.id))
  }

  update (clock :Clock) :void {
    this._dt += clock.dt
    if (this._dt < this.updateFrequency) return
    this._timeCount += this._dt
    this._dt = 0

    this.onEntities(id => {
      const rec = this.lerps.read(id)
      const stamp = this._timeCount % rec.cycleTime
      const progress = stamp / (rec.cycleTime / rec.sources.length)
      const slice = Math.trunc(progress)
      const next = (slice + 1) % rec.sources.length
      const perc = progress - slice
//      log.debug("Lerpin", "slice", slice, "next", next, "perc", perc)

      const src1 = rec.sources[slice]
      const src2 = rec.sources[next]
      const dest = this.obj.read(id)
      if (src1 === undefined || src2 === undefined) return // can't lerp yet!
      for (let ii = 0; ii < rec.paths.length; ii++) {
        const path = rec.paths[ii]
        rec.fns[ii](this.trans, id, dest, path, src1[path], src2[path], perc)
      }
    })
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)

    // set-up the LerpRecord
    const cfg :LerpComponentConfig = config.components[this.lerps.id]
    const sourceCount = cfg.sources.length
    const rec :LerpRecord = new LerpRecord(cfg.cycleTime, cfg.paths, sourceCount)
    this.lerps.update(id, rec)

    // load the sources into the record
    for (let ii = 0; ii < sourceCount; ii++) {
      const index = ii
      createObject3D(this.loader, cfg.sources[index]).onValue(
        (v :any) => this.configureSource(rec, index, v))
    }
  }

  protected configureSource (rec :LerpRecord, index :number, src :any) :void {
    rec.sources[index] = src

    // see if we need to figure out lerpfns
    if (rec.fns[0] !== undefined) return
    for (let ii = 0; ii < rec.paths.length; ii++) {
      rec.fns[ii] = findLerpFn(src[rec.paths[ii]])
    }
  }

  protected _dt :number = 0
  protected _timeCount :number = 0
}

type LerpFn = (trans :TransformComponent, id :ID, dest :any, path :string,
               v1 :any, v2 :any, perc :number) => void

const lerpNoop :LerpFn = (trans, id, dest, path, v1, v2, perc) => {}
const lerpNumbers :LerpFn = (trans, id, dest, path, v1, v2, perc) =>
  dest[path] = v1 + ((v2 - v1) * perc)
const lerpColors :LerpFn = (trans, id, dest, path, v1, v2, perc) =>
  (dest[path] as Color).copy(v1).lerp(v2, perc)
const lerpVectors :LerpFn = (trans, id, dest, path, v1, v2, perc) =>
  trans.updatePosition(id, scratchV.lerpVectors(v1, v2, perc))
const lerpQuaternions :LerpFn = (trans, id, dest, path, v1, v2, perc) =>
  trans.updateQuaternion(id, Quaternion.slerp(v1, v2, scratchQ, perc))

function findLerpFn (value :any) :LerpFn {
  if (value instanceof Vector3) return lerpVectors
  else if (value instanceof Quaternion) return lerpQuaternions
  else if (value instanceof Color) return lerpColors
  else if (typeof value === "number") return lerpNumbers
  log.warn("Can't lerp unknown type", "value", value)
  return lerpNoop
}
