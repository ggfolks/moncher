import {BufferGeometry, Geometry, Vector3} from "three"
import {Pathfinding} from "./pathfinding"

/**
 * Pathfinding that simplifies some things by having only one zone and managing the groupId
 * internally.
 */
export class ZonedPathfinding {
  constructor (geom :Geometry|BufferGeometry) {
    this._pather.setZoneData("", Pathfinding.createZone(geom as any))
  }

  /**
   * Get a random-ish point near the specified point. */
  getRandomPositionFrom (pos :Vector3, maxDist = Infinity) :Vector3|undefined {
    const groupId = this._pather.getGroup("", pos)
    if (groupId === null) return undefined
    return this._pather.getRandomPositionFrom("", groupId, pos, maxDist)
  }

  /**
   * Find a path from src to dest. Note: Path will omit src.  */
  findPath (src :Vector3, dest :Vector3) :Vector3[]|null {
    const groupId = this._pather.getGroup("", src)
    if (groupId === null) return null
    return this._pather.findPath(src, dest, "", groupId)
  }

  protected readonly _pather :Pathfinding = new Pathfinding()
}
