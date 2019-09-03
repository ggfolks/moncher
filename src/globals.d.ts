declare module "three-pathfinding" {
  import {BufferGeometry, Geometry, Object3D, Vector3} from "three"

  export type Node = {
    id :number
    neighbors :number[]
    centroid :Vector3
    portals :number[][]
    closed :boolean
    cost :number
  }

  export type Zone = {
    groups :Group[]
  }

  export type Group = {}

  export class Pathfinding
  {
    constructor()

    static createZone (geometry :BufferGeometry|Geometry) :Zone

    setZoneData (zoneID :string, zone :Zone) :void

    getRandomNode (
        zoneID :string, groupID :number, nearPosition :Vector3, nearRange :number) :Node

    getClosestNode (
        position :Vector3, zoneID :string, groupID :number, checkPolygon? :boolean) :Node

    findPath (
        startPosition :Vector3, targetPosition :Vector3, zoneID :string, groupID :number) :Vector3[]

    getGroup (zoneID :string, position :Vector3, checkPolygon? :boolean) :number

    clampStep (
        start :Vector3, end :Vector3, node :Node, zoneID :string, groupID :number,
        endTarget :Vector3) :Node
  }

  export class PathfindingHelper extends Object3D
  {
    constructor()

    setPath (path :Vector3[]) :this

    setPlayerPosition (position :Vector3) :this

    setTargetPosition (position :Vector3) :this

    setNodePosition (position :Vector3) :this

    setStepPosition (position :Vector3) :this

    reset () :this
  }
}