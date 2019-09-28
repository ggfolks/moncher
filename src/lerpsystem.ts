import {Clock} from "tfw/core/clock"
import {log} from "tfw/core/util"
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
  static DUMMY = new LerpRecord(0, [], [])

  constructor (
    readonly cycleTime :number,
    readonly sources :any[],
    readonly paths :string[],
  ) {}
}

// TODO: Maybe the infrequent-updating is pulled out into a wrapper System that
// merely maintains its own dt and then fakes-up a Clock object to pass to its
// contained system(s)

const scratchV = new Vector3()
const scratchQ = new Quaternion()
export class LerpSystem extends System {

  constructor (
    domain :Domain,
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
      for (const path of rec.paths) {
        this.lerpValue(id, path, src1, src2, dest, perc)
      }
    })
  }

  /**
   * Lerp a field.
   * TODO: maybe there can be custom lerping methods specified in the config? */
  protected lerpValue (
    id :ID, path :string, src1 :any, src2 :any, dest :any, perc :number
  ) :void {
    // TODO: full path dot notation for properties? Ha!
    const v1 = src1[path]
    const v2 = src2[path]

    if (v1 instanceof Vector3) {
      this.trans.updatePosition(id, scratchV.lerpVectors(v1, v2, perc))

    } else if (v1 instanceof Quaternion) {
      this.trans.updateQuaternion(id, Quaternion.slerp(v1, v2, scratchQ, perc))

    } else if (v1 instanceof Color) {
      const color = dest[path] as Color
      color.copy(v1)
      color.lerp(v2, perc)

    } else if (typeof v1 === "number") {
      // assume it's a number
      const newValue = v1 + ((v2 - v1) * perc)
      dest[path] = newValue

    } else {
      log.warn("Can't lerp unknown type", "path", path, "v1", v1, "v2", v2)
    }
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)

    // set-up the LerpRecord
    const cfg :LerpComponentConfig = config.components[this.lerps.id]
    const count = cfg.sources.length
    const sources = new Array(count)
    this.lerps.update(id, new LerpRecord(cfg.cycleTime, sources, cfg.paths))

    // load the sources into the record
    for (let ii = 0; ii < count; ii++) {
      const index = ii
      createObject3D(cfg.sources[index]).onValue((v :any) => sources[index] = v)
    }
  }

  protected _dt :number = 0
  protected _timeCount :number = 0
}
