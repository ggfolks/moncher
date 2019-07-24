import {Value, Subject} from "tfw/core/react"
import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {loadImage} from "tfw/core/assets"
import {GLC, Texture, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App, SurfaceMode} from "./app"

type TileInfo = {x :number, y :number, width :number, height :number}
type TileSetInfo = {[key :string] :TileInfo}
type TileSet = {[key :string] :Tile}

const pixCfg = {...Texture.DefaultConfig, minFilter: GLC.NEAREST, magFilter: GLC.NEAREST}

export function makeTileSet (glc :GLC, image :string, info :TileSetInfo) :Subject<TileSet> {
  return makeTexture(glc, loadImage(image), Value.constant(pixCfg)).map(tex => {
    const ts :TileSet = {}
    for (const key in info) {
      const {x, y, width, height} = info[key]
      ts[key] = tex.tile(x, y, width, height)
    }
    return ts
  })
}

export class ShowTilesetMode extends SurfaceMode {
  tiles :TileSet|undefined = undefined

  constructor (app :App, image :string, info :TileSetInfo) {
    super(app)
    const tss = makeTileSet(app.renderer.glc, image, info)
    this.onDispose.add(tss.onValue(tiles => this.tiles = tiles))
  }

  renderTo (clock :Clock, surf :Surface) {
    const tiles = this.tiles
    const swidth = surf.target.size[0]/surf.target.scale[0] // TODO: this is ugly, fix hidpi stuff
    if (tiles) {
      const gap = 5, pos = vec2.fromValues(gap, gap)
      let maxH = 0
      surf.clearTo(1, 1, 1, 1)
      for (const id in tiles) {
        const tile = tiles[id]
        const right = pos[0] + tile.size[0]
        if (right > swidth) {
          pos[0] = gap
          pos[1] += maxH + gap
          maxH = 0
        }
        surf.drawAt(tile, pos)
        pos[0] += tile.size[0] + gap
        maxH = Math.max(tile.size[1], maxH)
      }
    } else {
      surf.clearTo(0.5, 0.5, 0.5, 1)
    }
  }
}
