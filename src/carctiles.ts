import {GridTileSceneConfig, GridTileSceneModel} from "./gridtiles"

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

/**
 * Generate a GridTileSceneModel from a set of CarcTiles.
 * @param width the width in logical carctile units
 * @param height the height in logical carctile units
 */
export function generateGridModel (
  tiles :Array<CarcTile>, width :number, height :number, cfg :GridTileSceneConfig)
  :GridTileSceneModel
{
  let board = new Array<Array<Array<CarcTile>>>(width)
  for (let xx = 0; xx < width; xx++) {
    board[xx] = new Array<Array<CarcTile>>(height)
  }

  // TEMP: populate the board with random tiles
  for (let xx = 0; xx < width; xx++) {
    for (let yy = 0; yy < height; yy++) {
      board[xx][yy] = [ tiles[Math.trunc(Math.random() * tiles.length)] ]
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
