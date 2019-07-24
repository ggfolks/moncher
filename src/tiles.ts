import {Value, Subject} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {loadImage} from "tfw/core/assets"
import {GLC, Texture, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App, SurfaceMode} from "./app"

type TileInfo = {x :number, y :number, width :number, height :number}

type TileSetInfo = {
  image :string
  scale :number
  tiles: {[key :string] :TileInfo}
}

type TileSet = {[key :string] :Tile}

export function makeTileSet (glc :GLC, info :TileSetInfo) :Subject<TileSet> {
  const tcfg = {...Texture.DefaultConfig, scale: new Scale(info.scale)}
  return makeTexture(glc, loadImage(info.image), Value.constant(tcfg)).map(tex => {
    const ts :TileSet = {}, scale = info.scale
    for (const key in info.tiles) {
      const {x, y, width, height} = info.tiles[key]
      ts[key] = tex.tile(x/scale, y/scale, width/scale, height/scale)
    }
    return ts
  })
}

export class ShowTilesetMode extends SurfaceMode {
  tiles :TileSet|undefined = undefined

  constructor (app :App, info :TileSetInfo) {
    super(app)
    const tss = makeTileSet(app.renderer.glc, info)
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
        const tile = tiles[id], advance = tile.size[0] + gap, right = pos[0] + advance
        if (right > swidth) {
          pos[0] = gap
          pos[1] += maxH + gap
          maxH = 0
        }
        surf.drawAt(tile, pos)
        pos[0] += advance
        maxH = Math.max(tile.size[1], maxH)
      }
    } else {
      surf.clearTo(0.5, 0.5, 0.5, 1)
    }
  }
}
