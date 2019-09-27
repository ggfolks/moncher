import {Clock} from "tfw/core/clock"
import {log} from "tfw/core/util"
import {Light, Object3D, ObjectLoader, Quaternion, Vector3} from "three"

export class LightLerper {
  constructor (
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
    light.position.lerpVectors(this._vectors[slice], this._vectors[next], perc)
    light.quaternion.copy(this._quats[slice])
    light.quaternion.slerp(this._quats[next], perc)
  }

  protected configureSlice (light :Object3D, index :number) :void {
    if (!(light instanceof Light)) {
      log.warn("Not a light?")
      return
    }
    this._quats[index] = light.quaternion
    this._vectors[index] = light.position
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
