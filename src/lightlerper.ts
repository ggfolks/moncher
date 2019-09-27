import {Clock} from "tfw/core/clock"
import {Noop, log} from "tfw/core/util"
import {Light, Object3D, ObjectLoader, Quaternion, Vector3} from "three"

import {ID} from "tfw/entity/entity"
import {TransformComponent} from "tfw/space/entity"


// TODO: make this a real system. much config; lerpfields galore
const scratchV = new Vector3()
const scratchQ = new Quaternion()
export class LightLerper {
  constructor (
    readonly trans :TransformComponent,
    protected readonly id :ID,
    protected readonly light :Light,
    protected readonly secondsPerSlice :number,
    protected readonly updateFrequency :number,
    ...jsonUrls :string[]
  ) {
    this._slices = jsonUrls.length
    const loader = new ObjectLoader()
    for (let ii = 0; ii < jsonUrls.length; ii++) {
      const index = ii
      loader.load(jsonUrls[index],
          (light :Object3D) => this.configureSlice(light, index),
          Noop /* onProgress */,
          error => {
            log.warn("Error loading light slice: " + error)
          })
    }
  }

  // TODO: absolute time of some sort
  update (clock :Clock) :void {
    this._dt += clock.dt
    if (this._slicesLoaded < this._slices) return
    if (this._dt < this.updateFrequency) return

    this._timeCount = (this._timeCount + this._dt) % (this._slices * this.secondsPerSlice)
    this._dt = 0
    const progress = this._timeCount / this.secondsPerSlice
    const slice = Math.trunc(progress)
    const next = (slice + 1) % this._slices
    const perc = progress - slice

    const light = this.light
    const ints = this._intensities, r = this._reds, g = this._greens, b = this._blues
    light.intensity = ints[slice] + (ints[next] - ints[slice]) * perc
    light.color.r = r[slice] + ((r[next] - r[slice]) * perc)
    light.color.g = g[slice] + ((g[next] - g[slice]) * perc)
    light.color.b = b[slice] + ((b[next] - b[slice]) * perc)

    const vecs = this._vectors, quats = this._quats
    this.trans.updatePosition(this.id, scratchV.lerpVectors(vecs[slice], vecs[next], perc))
    this.trans.updateQuaternion(this.id,
        Quaternion.slerp(quats[slice], quats[next], scratchQ, perc))
  }

  protected configureSlice (light :Object3D, index :number) :void {
    if (!(light instanceof Light)) {
      log.warn("Not a light?")
      return
    }
    this._quats[index] = light.quaternion
    this._vectors[index] = light.position
    this._reds[index] = light.color.r
    this._greens[index] = light.color.g
    this._blues[index] = light.color.b
    this._intensities[index] = light.intensity

    this._slicesLoaded++
  }

  protected readonly _slices :number
  protected readonly _vectors :Vector3[] = []
  protected readonly _quats :Quaternion[] = []
  protected readonly _reds :number[] = []
  protected readonly _greens :number[] = []
  protected readonly _blues :number[] = []
  protected readonly _intensities :number[] = []
  protected _slicesLoaded :number = 0
  protected _dt :number = 0
  protected _timeCount :number = 0
}
