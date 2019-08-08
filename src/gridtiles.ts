import {Subject} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {GLC, Texture, TextureConfig, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App, SurfaceMode} from "./app"
import {FringeConfig, FringeAdder, applyFringe} from "./fringer"

abstract class TileInfo
{
  constructor (
    /** An identifier for this type "dirt", "grass". */
    public readonly id :string,
    /** The image tile strip containing base tiles. */
    public readonly base :string
  ) {}
}

export class GridTileInfo extends TileInfo
{
  constructor (id :string, base :string,
    /** Higher priority tiles only fringe atop lower priority. */
    public readonly priority :number,
    /** The image tile strip to load for fringe tiles, according to the fringe configuration. */
    public readonly fringe? :string
  ) {
    super(id, base)
  }
}

export class PropTileInfo extends TileInfo
{
  constructor (id :string, base :string,
    /** The width of this prop, or omitted to just use the base image size. */
    public readonly width? :number,
    /** The height of this prop, or omitted to just use the base image size. */
    public readonly height? :number
  ) {
    super(id, base)
  }
}


export type GridTileSceneConfig = {
  /** The width of each tile. */
  width :number
  /** The height of each tile. */
  height :number
  /** The scale factor. */
  scale :number
  /** The tile information. */
  tiles :GridTileInfo[]
  /** Fringe tile configuration. */
  fringeConfig? :FringeConfig
  /** Prop tile configuration. */
  props? :PropTileInfo[]
}

export class PropPlacement
{
  constructor (
    /** The id of the prop to place. */
    public readonly id :string,
    /** The x coordinate. */
    public readonly x :number,
    /** The y coordinate. */
    public readonly y :number
  ) {}
}

export class GridTileSceneModel
{
  /** The raw tile data. */
  readonly tiles :Array<Array<string>>
  readonly props :Array<PropPlacement> = []

  constructor (
    readonly config :GridTileSceneConfig,
    readonly sceneWidth :number,
    readonly sceneHeight :number
  ) {
    this.tiles = new Array<Array<string>>(sceneWidth)
    for (let xx = 0; xx < sceneWidth; xx++) {
      this.tiles[xx] = new Array<string>(sceneHeight)
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

type PropTile = {
  id :string
  tiles :Array<Tile>
}

export type GridTileSet = {
  sets: {[key :string] :GridTile}
  props: {[key :string] :PropTile}
}

type PropViz = {
  tile :Tile
  pos :vec2
}

type GridTileSceneViz = {
  /** At each x/y position, a stack of Tiles to render. */
  tiles :Array<Array<Array<Tile>>>
  props :Array<PropViz>
}

/**
 * Chop the texture into uniform tiles of size [w, h], ignoring any extra pixels.
 */
function chopTiles (tex :Texture, w :number, h :number) :Tile[]
{
  const retval = new Array<Tile>()
  for (let xx = 0; xx < tex.size[0]; xx += w) {
    for (let yy = 0; yy < tex.size[1]; yy += h) {
      retval.push(tex.tile(xx, yy, w, h))
    }
  }
  return retval
}

function makeProp (glc :GLC, textureConfig :TextureConfig, cfg :PropTileInfo) :Subject<PropTile> {
  return makeTexture(glc, loadImage(cfg.base), textureConfig).map(tex => {
    let tiles :Array<Tile>
    if (cfg.width !== undefined && cfg.height !== undefined) {
      tiles = chopTiles(tex, cfg.width, cfg.height)
    } else {
      tiles = [ tex ] // just use the whole thing!
    }
    return { id: cfg.id, tiles: tiles }
  })
}

function makeGridTiles (glc :GLC, textureConfig :TextureConfig,
                    image :string, cfg :GridTileSceneConfig) :Subject<Array<Tile>> {
  return makeTexture(glc, loadImage(image), textureConfig)
      .map(tex => chopTiles(tex, cfg.width, cfg.height))
}

function makeGridTile (glc :GLC, textureConfig :TextureConfig,
                       tileInfo :GridTileInfo,
                       cfg :GridTileSceneConfig) :Subject<GridTile> {
  let tiles :Array<Subject<Array<Tile>>> = []
  tiles.push(makeGridTiles(glc, textureConfig, tileInfo.base, cfg))
  if (tileInfo.fringe) {
    tiles.push(makeGridTiles(glc, textureConfig, tileInfo.fringe, cfg))
  }
  return Subject.join(...tiles).map(v => {
    const tile :GridTile = { id: tileInfo.id, tiles: v[0] }
    if (v[1]) {
      tile.fringe = v[1]
    }
    return tile
  })
}

function makeGridTileSet (glc :GLC, textureConfig :TextureConfig,
                          cfg :GridTileSceneConfig) :Subject<GridTileSet>
{
  const sets :Array<Subject<GridTile>> = []
  for (const tileset of cfg.tiles) {
    sets.push(makeGridTile(glc, textureConfig, tileset, cfg))
  }
  const propSets :Array<Subject<PropTile>> = []
  if (cfg.props) {
    for (const prop of cfg.props) {
      propSets.push(makeProp(glc, textureConfig, prop))
    }
  }
  return Subject.join2(Subject.join(...sets), Subject.join(...propSets)).map(v => {
    const tileset :GridTileSet = { sets: {}, props: {}}
    for (const tset of v[0]) {
      tileset.sets[tset.id] = tset
    }
    for (const pset of v[1]) {
      tileset.props[pset.id] = pset
    }
    return tileset
  })
}

function makeViz (model :GridTileSceneModel, tileset :GridTileSet) :GridTileSceneViz
{
  const viz = { tiles: new Array<Array<Array<Tile>>>(), props: new Array<PropViz>() }
  for (let xx = 0; xx < model.tiles.length; xx++) {
    const col = new Array<Array<Tile>>()
    viz.tiles.push(col)
    for (let yy = 0; yy < model.tiles[xx].length; yy++) {
      const stack = new Array<Tile>()
      col.push(stack)
      // pick a base tile for this spot
      const base :string = model.tiles[xx][yy]
      const tileinfo :GridTile = tileset.sets[base]
      if (tileinfo) {
        stack.push(tileinfo.tiles[Math.trunc(Math.random() * tileinfo.tiles.length)])
      }
    }
  }
  // calculate the placement of props
  for (let placement of model.props) {
    const prop :PropTile = tileset.props[placement.id]
    const tile :Tile = prop.tiles[Math.trunc(Math.random() * prop.tiles.length)]
    const x :number = (placement.x * model.config.width) - (tile.size[0] / 2)
    const y :number = (placement.y * model.config.height) - (tile.size[1] / 2)
    viz.props.push({ tile: tile, pos: vec2.fromValues(x, y) })
  }
  const adder :FringeAdder = (x :number, y :number, fringe :Tile) :void => {
    viz.tiles[x][y].push(fringe)
  }
  applyFringe(model, tileset, adder)
  return viz
}

export class GridTileSceneViewMode extends SurfaceMode {

  /** The visualization of the scene, when we have it. */
  protected _viz :GridTileSceneViz|undefined = undefined

  constructor (protected _app :App, protected _model :GridTileSceneModel) {
    super(_app)

    const tcfg = {...Texture.DefaultConfig, scale: new Scale(_model.config.scale)}
    const tss :Subject<GridTileSet> = makeGridTileSet(_app.renderer.glc, tcfg, _model.config)
    this.onDispose.add(tss.onValue(tileset => {
      this._viz = makeViz(_model, tileset)
    }))
    this.onDispose.add(_app.renderer.size.onValue(() => this.adjustOffset()))
    this._app.root.addEventListener("mousemove", this._onMouseMove)
    this.onDispose.add(() => this._app.root.removeEventListener("mousemove", this._onMouseMove))
  }

  adjustOffset () {
    const sceneW = this._model.config.width * this._model.sceneWidth
    const sceneH = this._model.config.height * this._model.sceneHeight
    const surfSize = this._app.renderer.size.current
    const overlapW = Math.max(0, sceneW - surfSize[0])
    const overlapH = Math.max(0, sceneH - surfSize[1])
    vec2.set(this._offset,
        (this._mouse[0] / surfSize[0]) * -overlapW, (this._mouse[1] / surfSize[1]) * -overlapH)
  }

  renderTo (clock :Clock, surf :Surface) {
    const viz = this._viz
    if (!viz) {
      surf.clearTo(0.5, 0.5, 0.5, 1)
      return
    }
    surf.clearTo(1, 1, 1, 1)
    const xi = this._model.config.width
    const yi = this._model.config.height
    const pos = vec2.clone(this._offset)
    // draw tiles
    for (let xx = 0; xx < viz.tiles.length; xx++, pos[0] += xi) {
      const col = viz.tiles[xx]
      pos[1] = this._offset[1]
      for (let yy = 0; yy < col.length; yy++, pos[1] += yi) {
        for (const tile of col[yy]) {
          surf.drawAt(tile, pos)
        }
      }
    }
    // draw props
    for (let prop of viz.props) {
      vec2.add(pos, prop.pos, this._offset)
      surf.drawAt(prop.tile, pos)
    }
  }

  protected readonly _mouse :vec2 = vec2.create()
  protected readonly _offset :vec2 = vec2.create()
  protected readonly _onMouseMove = (event :MouseEvent) => {
    vec2.set(this._mouse, event.offsetX, event.offsetY)
    this.adjustOffset()
  }
}
