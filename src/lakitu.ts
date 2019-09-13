import {
  Box3,
  //Math as ThreeMath,
  Quaternion,
  Vector3,
} from "three"
import {Clock} from "tfw/core/clock"

const scratchV = new Vector3()

/**
 * Camera controller!
 * A relatively simple camera easer that works by having a 'target' that the camera looks at
 * plus a 'distance'. The camera angle is computed from distance. */
export class Lakitu
{
  constructor (
    /** A Function to possibly override the Y value of our target with one from a navmesh. */
    protected readonly setY :(into :Vector3, terrainFallback? :boolean) => void,
    /** A Function to update the camera. */
    protected readonly updateCamera :(loc :Vector3, rot :Quaternion) => void,
  ) {
    this._updateQuaternion()
  }

  /** The current distance of the camera from its target. */
  get distance () :number {
    return this._distance
  }

  /** The current distance expressed as a number between 0 and 1. */
  get normalizedDistance () :number {
    return (this._distance - Lakitu.MIN_DISTANCE) / (Lakitu.MAX_DISTANCE - Lakitu.MIN_DISTANCE)
  }

  /** The current camera angle. */
  get angle () :number {
    return Lakitu.ANGLE_AT_MIN +
        (this.normalizedDistance * (Lakitu.ANGLE_AT_MAX - Lakitu.ANGLE_AT_MIN))
  }

  /**
   * Get a copy of the location we're currently targeting.
   * Note: if the camera is currently moving, this is the target it's moving to. */
  getTarget (into? :Vector3) :Vector3 {
    return (into || new Vector3()).copy(this._target)
  }

  /**
   * Update the valid boundaries of the target. */
  updateTargetBounds (box :Box3) :void {
    this._targetBounds.copy(box)
    this.updateTarget(this._target)
    this._dirty = true
  }

  /**
   * Ease the camera over to a new target.  */
  setNewTarget (loc :Vector3) :void {
    // TODO: EASING
    // Right now:
    this.updateTarget(loc)
  }

  /**
   * Update the camera target immediately, without easing to it.
   * If we're already easing then this will be the new destination of the ease. */
  updateTarget (pos :Vector3) :void {
    this._target.copy(pos)
    this._target.clamp(this._targetBounds.min, this._targetBounds.max)
    this._dirty = true
  }

  /**
   * Make a relative adjustment to the camera's distance from the target. */
  adjustDistance (deltaDistance :number) :void {
    const newValue = Math.max(Lakitu.MIN_DISTANCE, Math.min(Lakitu.MAX_DISTANCE,
        this._distance + deltaDistance))
    if (newValue !== this._distance) {
      this._distance = newValue
      this._updateQuaternion()
    }
  }

  /**
   * Do a relative adjustment on the current target.  */
  adjustTarget (deltaX :number, deltaZ :number) :void {
    const targ = this._target
    targ.x += deltaX
    targ.z += deltaZ
    this.setY(targ, false)
    this.updateTarget(targ)
  }

  /**
   * Update the position of the camera before rendering, if needed. */
  update (clock :Clock) :void {
    if (this._dirty) {
      const quat = this._quat
      scratchV.set(0, 0, 1).multiplyScalar(this._distance).applyQuaternion(quat).add(this._target)
      this.updateCamera(scratchV, quat)
      this._dirty = false
    }
  }

  protected _updateQuaternion () :void {
    this._quat.setFromAxisAngle(scratchV.set(-1, 0, 0), this.angle)
    this._dirty = true
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
  protected _target :Vector3 = new Vector3(0, 0, 0)
  protected _targetBounds :Box3 = new Box3( // default box constructor does them the other way
      new Vector3(-Infinity, -Infinity, -Infinity), new Vector3(Infinity, Infinity, Infinity))
  protected _dirty :boolean = true

  /** Camera's current rotation. */
  protected _quat :Quaternion = new Quaternion()

  private static readonly MAX_DISTANCE = 25
  private static readonly DEFAULT_DISTANCE = 10
  private static readonly MIN_DISTANCE = 5
  private static readonly ANGLE_AT_MAX = Math.PI / 4 // 45 degrees above
  private static readonly ANGLE_AT_MIN = Math.PI / 18 // 10 degrees above
}
