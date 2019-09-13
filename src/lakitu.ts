import {
  Box3,
  //Math as ThreeMath,
  Quaternion,
  Vector3,
} from "three"
import {Clock} from "tfw/core/clock"

/**
 * Camera controller!
 */
export class Lakitu
{
  constructor (
    /** A Function to possibly override the Y value of our target with one from a navmesh. */
    protected readonly setY :(into :Vector3, terrainFallback? :boolean) => void,
    /** A Function to update the camera. */
    protected readonly updateCamera :(loc :Vector3, rot :Quaternion) => void,
  ) {}

  // TEMP?
  get focusBounds () :Box3 {
    return this._focusBounds
  }

  // TEMP?
  updateFocusBounds (box :Box3) :void {
    this._focusBounds.copy(box)
    this._dirty = true
  }

  // TEMP
  get focus () :Vector3 {
    return this._focus
  }

  // TEMP?
  set dirty (isDirty :boolean) {
    this._dirty = this._dirty || isDirty
  }

  /** The current distance of the camera from its target. */
  get distance () :number {
    return this._distance
  }

  /** The current distance expressed as a number between 0 and 1. */
  get zoom () :number {
    return (this._distance - Lakitu.MIN_DISTANCE) / (Lakitu.MAX_DISTANCE - Lakitu.MIN_DISTANCE)
  }

  /** The current camera angle. */
  get angle () :number {
    return Lakitu.ANGLE_AT_MIN + (this.zoom * (Lakitu.ANGLE_AT_MAX - Lakitu.ANGLE_AT_MIN))
  }

  adjustDistance (deltaDistance :number) :void {
    const newValue = Math.max(Lakitu.MIN_DISTANCE, Math.min(Lakitu.MAX_DISTANCE,
        this._distance + deltaDistance))
    if (newValue !== this._distance) {
      this._distance = newValue
      this._dirty = true
      // TODO: just update the quat here?
    }
  }

  adjustPosition (deltaX :number, deltaZ :number) :void {
    const p = this._focus
    const box = this._focusBounds
    // TODO: only dirty if necessary?
    p.x = Math.max(box.min.x, Math.min(box.max.x, p.x + deltaX))
    p.z = Math.max(box.min.z, Math.min(box.max.z, p.z + deltaZ))
    this.setY(p, false)
    p.y = Math.max(box.min.y, Math.min(box.max.y, p.y))
    this._dirty = true
  }

  update (clock :Clock) :void {
    if (this._dirty) {
      const quat = this._quat
      const loc = this._loc
      quat.setFromAxisAngle(loc.set(-1, 0, 0), this.angle)
      loc.set(0, 0, 1).multiplyScalar(this._distance).applyQuaternion(quat).add(this._focus)
      this.updateCamera(loc, quat)
      this._dirty = false
    }
  }

  /*
   * TODO: camera easing
- We definitely want smooth easing if you track a new actor.
  - if already easing, start a new ease from the actual
  (prevent further zoom-out unless warranted?)

original -> actual -> target

- if the user drags or uses the arrow keys: do an instant adjust from
  the current "actual"

- if the user changes zoom:
  - if on track, update target zoom and then apply the delta to actual and original too
  - if not on track, adjust immediate

- if the tracked actor moves:
  - if on track, adjust the target position but update nothing else
  - if not on track, adjust actual
   */


  protected _distance :number = Lakitu.DEFAULT_DISTANCE
  protected _focus :Vector3 = new Vector3(0, 0, 0)
  protected _focusBounds :Box3 = new Box3( // default box constructor does them the other way
      new Vector3(-Infinity, -Infinity, -Infinity), new Vector3(Infinity, Infinity, Infinity))
  protected _dirty :boolean = true
  protected _quat :Quaternion = new Quaternion()
  protected _loc :Vector3 = new Vector3()

  private static readonly MAX_DISTANCE = 25
  private static readonly DEFAULT_DISTANCE = 10
  private static readonly MIN_DISTANCE = 5
  private static readonly ANGLE_AT_MAX = Math.PI / 4 // 45 degrees above
  private static readonly ANGLE_AT_MIN = Math.PI / 18 // 10 degrees above
}
