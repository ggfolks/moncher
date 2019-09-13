import {
  Box3,
  Math as ThreeMath,
  Quaternion,
  Vector3,
} from "three"
import {Clock} from "tfw/core/clock"

interface Easing {
  /** Starting position of the ease. */
  from :Vector3
  /** The last computed position of the ease. */
  current :Vector3
  /** The duration of the ease. */
  duration :number
  /** Start stamp (to be filled). */
  startStamp? :number
}

const scratchV = new Vector3()

/**
 * Camera controller!
 * A relatively simple camera easer that works by having a 'target' that the camera looks at
 * plus a 'distance'. The camera angle is computed from distance. */
// TODO: possibly have the easing pull the camera back until halfway through the ease and
// then forward again during the second half. But that's a bit more complicated to let
// the user adjust distance as well as do the right thing if we start a new ease in the middle. TBD.
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

  // TODO: really a lot of these accessors could go away if we just had a logCameraDetails()

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
    // from is the current instantaneous target
    const from = (this._easing !== undefined)
        ? this._easing.current
        : new Vector3().copy(this._target)
    this.updateTarget(loc)
    this._easing = <Easing>{
      from,
      current: new Vector3().copy(from),
      duration: this._target.distanceTo(from) / Lakitu.EASING_SPEED
    }
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
    let target :Vector3 = this._target
    if (this._easing) {
      this._dirty = true
      const ease = this._easing
      if (ease.startStamp === undefined) {
        ease.startStamp = clock.time
      }
      const perc = ThreeMath.smootherstep(clock.time, // smooooooth!
          ease.startStamp, ease.startStamp + ease.duration)
      if (perc >= 1) {
        this._easing = undefined
      } else {
        target = ease.current.copy(ease.from).lerp(target, perc)
      }
    }

    if (this._dirty) {
      const quat = this._quat
      scratchV.set(0, 0, 1).multiplyScalar(this._distance).applyQuaternion(quat).add(target)
      this.updateCamera(scratchV, quat)
      this._dirty = false
    }
  }

  /**
   * Update our precomputed quaternion. */
  protected _updateQuaternion () :void {
    this._quat.setFromAxisAngle(scratchV.set(-1, 0, 0), this.angle)
    this._dirty = true
  }

  /** The current target of the camera. */
  protected _target :Vector3 = new Vector3(0, 0, 0)

  /** A box that we'll use to bound-in any adjustments to the target. */
  protected _targetBounds :Box3 = new Box3( // default box constructor does them the other way
      new Vector3(-Infinity, -Infinity, -Infinity), new Vector3(Infinity, Infinity, Infinity))

  /** Distance from the target to place the camera. */
  protected _distance :number = Lakitu.DEFAULT_DISTANCE

  /** Do we need to update the camera position on next update()? */
  protected _dirty :boolean = true

  /** Camera's current rotation. */
  protected _quat :Quaternion = new Quaternion()

  /** Our current easing parameters, if any. */
  protected _easing? :Easing

  /** Camera constants. These are tuned for our Ranch but in the future we can make these
   * configurable. */
  private static readonly MAX_DISTANCE = 25
  private static readonly DEFAULT_DISTANCE = 10
  private static readonly MIN_DISTANCE = 5
  private static readonly ANGLE_AT_MAX = Math.PI / 4 // 45 degrees above
  private static readonly ANGLE_AT_MIN = Math.PI / 18 // 10 degrees above
  private static readonly EASING_SPEED = 8 / 1000 // distance per millisecond (average)
}
