import {GridTileSceneConfig, GridTileSceneModel} from "./gridtiles"
//import {vec2} from "tfw/core/math"

export type Direction = "north" | "west" | "east" | "south"

/**
 * A larger logical tile that is made up of 3x3 base tiles.
 */
export class CarcTile
{
  constructor (
    /** The three features along the top. */
    nw :string, n :string, ne :string,
    /** The three features in the middle. */
    w :string, center: string, e :string,
    /** The three features along the bottom of the tile. */
    sw :string, s :string, se :string
  ) {
    this._features = [ nw, n, ne, w, center, e, sw, s, se ]
  }

  /**
   * Does this carctile match-up with the specified carctile in the specified direction?
   */
  matches (other :CarcTile, direction :Direction) :boolean {
    let dex, oDex, inc
    switch (direction) {
      case "north": dex = 0; oDex = 6; inc = 1; break
      case "west": dex = 0; oDex = 2; inc = 3; break
      case "south": return other.matches(this, "north")
      case "east": return other.matches(this, "west")
      default: throw new Error("Wat")
    }
    for (let ii = 0; ii < 3; ii++, dex += inc, oDex += inc) {
      if (this._features[dex] != other._features[oDex]) {
        return false
      }
    }
    return true
  }

  /**
   * Populate a grid model with this carctile at the specified location. (upper left)
   */
  populate (model :GridTileSceneModel, x :number, y :number) :void {
    for (let ii = 0; ii < 3; ii++) {
      let col = model.tiles[x + ii]
      let index = ii
      for (let jj = 0; jj < 3; jj++, index += 3) {
        col[jj + y] = this._features[index]
      }
    }
  }

  /** The features of this CarcTile. */
  protected _features :Array<string>
}

//type Board = Array<Array<Array<CarcTile>>>

/**
 * Pick a random CarcTile.
 */
function pick (tiles :Array<CarcTile>) :CarcTile
{
  // TODO: weighted!
  return tiles[Math.trunc(Math.random() * tiles.length)]
}

//function findMostRestrictive (board :Board) :vec2
//{
//  let result = vec2.fromValues(-1, -1)
//  let bestSize = Number.MAX_SAFE_INTEGER
//
//  for (let xx = 0; xx < board.length; xx++) {
//    let col = board[xx]
//    for (let yy = 0; yy < col.length; yy++) {
//      let spot = col[yy]
//      // having 1 tile in a position is what we want
//      if ((!spot) || (spot.length == 1) || (spot.length >= bestSize)) continue
//      vec2.set(result, xx, yy)
//      bestSize = spot.length
//    }
//  }
//  return result
//}

/**
 * Generate a GridTileSceneModel from a set of CarcTiles.
 * @param width the width in logical carctile units
 * @param height the height in logical carctile units
 */
export function generateGridModel (
  tiles :Array<CarcTile>, width :number, height :number, cfg :GridTileSceneConfig)
  :GridTileSceneModel
{
  for (let tries = 0; tries < 100; tries++) {
    let board = new Array<Array<Array<CarcTile>>>(width)
    for (let xx = 0; xx < width; xx++) {
      board[xx] = new Array<Array<CarcTile>>(height)
    }

    // in the very center tile, let it contain all the possible tiles to kick things off
    board[Math.trunc(width / 2)][Math.trunc(height / 2)] = tiles.concat()

    // TEMP: populate the board with random tiles
    for (let xx = 0; xx < width; xx++) {
      for (let yy = 0; yy < height; yy++) {
        board[xx][yy] = [ pick(tiles) ]
      }
    }
    // END: TEMP

    // create the model to return
    let model = new GridTileSceneModel(cfg, width * 3, height * 3)
    for (let xx = 0; xx < width; xx++) {
      for (let yy = 0; yy < height; yy++) {
        board[xx][yy][0].populate(model, xx * 3, yy * 3)
      }
    }
    return model
  }
  throw new Error("Unable to generate model from tiles")
}
