import {GridTileSceneModel, GridTileInfo, GridTileSet} from "./gridtiles"
import {Tile} from "tfw/scene2/gl"

export const NORTH = 1
export const NORTHEAST = 2
export const EAST = 4
export const SOUTHEAST = 8
export const SOUTH = 16
export const SOUTHWEST = 32
export const WEST = 64
export const NORTHWEST = 128
const FRINGEBITS = 8

export const SOUTHERN = SOUTH | SOUTHWEST | SOUTHEAST
export const WESTERN = WEST | SOUTHWEST | NORTHWEST
export const NORTHERN = NORTH | NORTHWEST | NORTHEAST
export const EASTERN = EAST | SOUTHEAST | NORTHEAST

/** An array representing the x/y offsets and which fringe bits are represented. */
const INFLUENCES :number[][] = [
  [ NORTHWEST, WESTERN, SOUTHWEST ],
  [ NORTHERN, 0, SOUTHERN ],
  [ NORTHEAST, EASTERN, SOUTHEAST ]
 ]

/** For each fringe tile, put the bits required for it in the corresponding array index. */
export type FringeConfig = number[]

export type FringeAdder = (x :number, y :number, fringes :Tile) => void

class FringeRec {
  constructor (readonly info :GridTileInfo, public bits :number = 0) {}
}

export function applyFringe (
  model :GridTileSceneModel, tileset :GridTileSet, adder :FringeAdder
) :void {
  if (!model.config.fringeConfig) return // no fringe configuration

  // create a reverse mapping of bits to index
  const bitsToIndex :Map<number, number> = new Map()
  for (let ii = 0; ii < model.config.fringeConfig.length; ii++) {
    bitsToIndex.set(model.config.fringeConfig[ii], ii)
  }

  // build a mapping of base type id to the record of it
  const idMap :Map<string, GridTileInfo> = new Map()
  for (let gti of model.config.tiles) {
    idMap.set(gti.id, gti)
  }

  // storage for fringerecs as we examine things
  const fringeMap :Map<string, FringeRec> = new Map()

  const addFringe = (x :number, y :number, rec :FringeRec, bits :number) :boolean => {
      const index = bitsToIndex.get(bits)
      if (index !== undefined) {
        // We check that the tileset actually has fringe tiles below, so it's safe to assert
        // that it's not undefined here.
        adder(x, y, tileset.sets[rec.info.id].fringe![index])
        return true
      }
      return false
    }

  // examine every tile in the logical scene
  for (let xx = 0; xx < model.sceneWidth; xx++) {
    for (let yy = 0; yy < model.sceneHeight; yy++) {
      const baseInfo = idMap.get(model.tiles[xx][yy])
      if (!baseInfo) continue
      fringeMap.clear()
      // for each tile, look at the tiles that influence it
      for (let curx = xx - 1, maxx = xx + 2; curx < maxx; curx++) {
        for (let cury = yy - 1, maxy = yy + 2; cury < maxy; cury++) {
          // skip out-of-bounds and our own tile
          if (((curx === xx) && (cury === yy)) ||
              (curx < 0) || (cury < 0) ||
              (curx >= model.sceneWidth) || (cury >= model.sceneHeight)) {
            continue
          }
          const oTile = model.tiles[curx][cury]
          const oBaseInfo = idMap.get(oTile)
          if (!oBaseInfo || !oBaseInfo.fringe || !tileset.sets[oTile].fringe ||
              (oBaseInfo.priority <= baseInfo.priority)) continue
          let oFringe = fringeMap.get(oTile)
          if (!oFringe) fringeMap.set(oTile, oFringe = new FringeRec(oBaseInfo))
          oFringe.bits |= INFLUENCES[curx - xx + 1][cury - yy + 1]
        }
      }

      // now let's sort according to their priority
      const fringeRecs :FringeRec[] = Array.from(fringeMap.values())
          .sort((rec1, rec2) => rec1.info.priority - rec2.info.priority)
      for (const rec of fringeRecs) {
        // if we have a fringe tile for it straightaway, use it
        if (addFringe(xx, yy, rec, rec.bits)) continue

        // We did not find a single tile to represent the fringe, see if we can use more than 1.
        let start = 0 // find an empty fringebit
        while ((((1 << start) & rec.bits) !== 0) && (start < FRINGEBITS)) {
          start++
        }
        // If we never found an empty fringebit then we have nothing else to try
        if (start === FRINGEBITS) continue
        let weebits = 0
        for (let ii = (start + 1) % FRINGEBITS; ii !== start; ii = (ii + 1) % FRINGEBITS) {
          if (((1 << ii) & rec.bits) !== 0) {
            weebits |= (1 << ii)
          } else if (weebits !== 0) {
            addFringe(xx, yy, rec, weebits)
            weebits = 0
          }
        }
        if (weebits !== 0) {
          addFringe(xx, yy, rec, weebits)
        }
      }
    }
  }
}
