import {GridTileSceneModel, GridTileSet} from "./gridtiles"
import {Tile} from "tfw/scene2/gl"

export const NORTHWEST = 1
export const NORTH = 2
export const NORTHEAST = 4
export const WEST = 8
export const EAST = 16
export const SOUTHWEST = 32
export const SOUTH = 64
export const SOUTHEAST = 128

export const SOUTHERN = SOUTH | SOUTHWEST | SOUTHEAST
export const WESTERN = WEST | SOUTHWEST | NORTHWEST
export const NORTHERN = NORTH | NORTHWEST | NORTHEAST
export const EASTERN = EAST | SOUTHEAST | NORTHEAST

/** An array representing the x/y offsets and which fringe bits are represented. */
//const INFLUENCES :Array<Array<number>> = [
//  [ NORTHWEST, NORTHERN, NORTHEAST ],
//  [ WESTERN, 0, EASTERN ],
//  [ SOUTHWEST, SOUTHERN, SOUTHEAST ]
//]

/** For each fringe tile, put the bits required for it in the corresponding array index. */
export type FringeConfig = Array<number>

export type FringeAdder = (x :number, y :number, fringes :Array<Tile>) => void

export function applyFringe (
  model :GridTileSceneModel, tileset :GridTileSet, adder :FringeAdder
) :void {
  // build a mapping of base type to priority
  const priorityMap = {}
  for (let gti of model.config.tiles) {
    priorityMap[gti.id] = gti.priority
  }
  // etc
  let tiles :Array<Tile> = [ tileset.sets["grass"].fringe![5] ]
  for (let xx = 0; xx < model.sceneWidth; xx += 2) {
    for (let yy = 0; yy < model.sceneHeight; yy++) {
      adder(xx, yy, tiles)
    }
  }
  adder(0, 0, [ tileset.sets["cobble"].fringe![13]])
}

