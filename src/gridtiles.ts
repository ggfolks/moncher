import {Value, Subject} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {GLC, Texture, TextureConfig, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App, SurfaceMode} from "./app"
import {FringeConfig} from "./fringer"
//import {Record} from "tfw/core/data"

export type GridTileInfo = {
  /** An identifier for this type "dirt", "grass". */
  id :string
  /** Higher priority tiles only fringe atop lower priority. */
  priority :number
  /** The image to load to find base tiles. */
  base :string
  /** The image to load for fringe tiles (optional). */
  fringe? :string
}

export type GridTileSystemConfig = {
  width :number
  height :number
  scale :number
  /** The tile information. */
  tiles :GridTileInfo[]
  fringeConfig? :FringeConfig
}

export class GridTileScene
{
  /** The raw tile data. */
  tiles :Array<Array<string>>

  constructor (readonly config :GridTileSystemConfig) {
    this.tiles = new Array<Array<string>>(config.width);
    for (let xx = 0; xx < config.width; xx++) {
      this.tiles[xx] = new Array<string>(config.height);
    }
  }
}

type GridTile = {
  /** The id of this type of tile. */
  id :string
  /** The tiles from which to pick randomly for the base tile. */
  tiles :Array<Tile>
  /** Fringe tiles, arranged according to the FringeConfig. */
  fringe? :Array<Tile>
}

type GridTileSet = {
  sets: {[key :string] :GridTile}
}

type GridTileSceneViz = {
  /** At each x/y position, a stack of Tiles to render. */
  tiles :Array<Array<Array<Tile>>>
}

function makeTiles (glc :GLC, textureConfig :Subject<TextureConfig>,
                    image :string, w :number, h :number) :Subject<Array<Tile>> {
  return makeTexture(glc, loadImage(image), textureConfig).map(tex => {
    const retval = new Array<Tile>()
    for (let xx = 0; xx < tex.size[0]; xx += w) {
      for (let yy = 0; yy < tex.size[1]; yy += h) {
        retval.push(tex.tile(xx, yy, w, h));
      }
    }
    return retval
  })
}

function makeGridTile (glc :GLC, textureConfig :Subject<TextureConfig>,
                      tileInfo :GridTileInfo,
                      cfg :GridTileSystemConfig) :Subject<GridTile> {
  let tiles :Array<Subject<Array<Tile>>> = []
  tiles.push(makeTiles(glc, textureConfig, tileInfo.base, cfg.width, cfg.height))
  if (tileInfo.fringe) {
    tiles.push(makeTiles(glc, textureConfig, tileInfo.fringe, cfg.width, cfg.height));
  }
  return Subject.join(...tiles).map(v => {
    const tile :GridTile = { id: tileInfo.id, tiles: v[0] }
    if (v[1]) {
      tile.fringe = v[1]
    }
    return tile
  })
}

function makeGridTileSet (glc :GLC, textureConfig :Subject<TextureConfig>,
                          cfg :GridTileSystemConfig) :Subject<GridTileSet>
{
  const sets :Array<Subject<GridTile>> = []
  for (const tileset of cfg.tiles) {
    sets.push(makeGridTile(glc, textureConfig, tileset, cfg));
  }
  return Subject.join(...sets).map(v => {
    const tileset :GridTileSet = { sets: {}}
    for (const tset of v) {
      tileset.sets[tset.id] = tset;
    }
    return tileset;
  })
}

function makeViz (scene :GridTileScene, tileset :GridTileSet) :GridTileSceneViz
{
  const viz = { tiles: new Array<Array<Array<Tile>>>() }
  for (let xx = 0; xx < scene.tiles.length; xx++) {
    const col = new Array<Array<Tile>>();
    viz.tiles.push(col);
    for (let yy = 0; yy < scene.tiles[xx].length; yy++) {
      let stack = new Array<Tile>();
      col.push(stack);
      // pick a base tile for this spot
      let base :string = scene.tiles[xx][yy];
      let tileinfo :GridTile = tileset.sets[base];
      if (tileinfo) {
        stack.push(tileinfo.tiles[Math.trunc(Math.random() * tileinfo.tiles.length)]);
        // TODO: add fringe tiles
      }
    }
  }
  return viz;
}

export class GridTiledSceneVizSurfaceMode extends SurfaceMode {

  /** The visualization of the scene, when we have it. */
  protected _viz :GridTileSceneViz|undefined = undefined

  constructor (app :App, protected _scene :GridTileScene) {
    super(app)
    console.log("I am trying things")
    const tcfg = {...Texture.DefaultConfig, scale: new Scale(_scene.config.scale)}
    const tss :Subject<GridTileSet> = makeGridTileSet(app.renderer.glc, Value.constant(tcfg),
        _scene.config);
    this.onDispose.add(tss.onValue(tileset => {
      this._viz = makeViz(_scene, tileset)
    }))
  }

  renderTo (clock :Clock, surf :Surface) {
    const viz = this._viz
    if (viz) {
      surf.clearTo(1, 1, 1, 1)
      const pos = vec2.create()
      for (let xx = 0; xx < viz.tiles.length; xx++) {
        pos[0] = xx * this._scene.config.width;
        let col = viz.tiles[xx];
        for (let yy = 0; yy < col.length; yy++) {
          pos[1] = yy * this._scene.config.height;
          for (const tile of col[yy]) {
            surf.drawAt(tile, pos)
          }
        }
      }
    } else {
      surf.clearTo(0.5, 0.5, 0.5, 1);
    }
  }
}
