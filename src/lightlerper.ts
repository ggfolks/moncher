import {Clock} from "tfw/core/clock"
import {log} from "tfw/core/util"
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
    ...jsonUrls :string[]
  ) {
    this._slices = jsonUrls.length
    const loader = new ObjectLoader()
    for (let ii = 0; ii < jsonUrls.length; ii++) {
      const index = ii
      // TODO: error handling!
      loader.load(jsonUrls[index], (light :Object3D) => this.configureSlice(light, index))
    }
  }

  // TODO: absolute time of some sort
  update (clock :Clock) :void {
    if (this._slicesLoaded < this._slices) return

    this._timeCount = (this._timeCount + clock.dt) % (this._slices * this.secondsPerSlice)
    const progress = this._timeCount / this.secondsPerSlice
    const slice = Math.trunc(progress)
    const next = (slice + 1) % this._slices
    const perc = progress - slice

    const light = this.light
    light.intensity = this._intensities[slice] +
        (this._intensities[next] - this._intensities[slice]) * perc
    light.color.r = this._reds[slice] + ((this._reds[next] - this._reds[slice]) * perc)
    light.color.g = this._greens[slice] + ((this._greens[next] - this._greens[slice]) * perc)
    light.color.b = this._blues[slice] + ((this._blues[next] - this._blues[slice]) * perc)

    this.trans.updatePosition(this.id,
        scratchV.lerpVectors(this._vectors[slice], this._vectors[next], perc))
    this.trans.updateQuaternion(this.id,
        Quaternion.slerp(this._quats[slice], this._quats[next], scratchQ, perc))
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
  protected _timeCount :number = 0
}
