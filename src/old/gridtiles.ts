import {Scale} from "tfw/core/ui"
import {clamp, vec2} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {ResourceLoader} from "tfw/core/assets"
import {Subject} from "tfw/core/react"
import {MapChange} from "tfw/core/rcollect"
import {Hand, Pointer} from "tfw/input/hand"
import {GLC, Texture, TextureConfig, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App, SurfaceMode} from "../app"
import {FringeConfig, FringeAdder, applyFringe} from "./fringer"

abstract class TileInfo
{
  constructor (
    /** An identifier for this type "dirt", "grass". */
    readonly id :string,
    /** The image tile strip containing base tiles. */
    readonly base :string
  ) {}
}

export class GridTileInfo extends TileInfo
{
  constructor (id :string, base :string,
    /** Higher priority tiles only fringe atop lower priority. */
    readonly priority :number,
    /** The image tile strip to load for fringe tiles, according to the fringe configuration. */
    readonly fringe? :string
  ) {
    super(id, base)
  }
}

export class PropTileInfo extends TileInfo
{
  constructor (id :string, base :string,
    /** The width of this prop, or omitted to just use the base image size. */
    readonly width? :number,
    /** The height of this prop, or omitted to just use the base image size. */
    readonly height? :number,
    /** An override scale. */
    readonly scale? :number
  ) {
    super(id, base)
  }
}

export interface GridTileSceneConfig  {
  /** The width of each tile. */
  tileWidth :number
  /** The height of each tile. */
  tileHeight :number
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
    readonly id :string,
    /** The x coordinate. */
    readonly x :number,
    /** The y coordinate. */
    readonly y :number
  ) {}
}

export class GridTileSceneModel
{
  /** The raw tile data. */
  readonly tiles :string[][]
  readonly props :PropPlacement[] = []

  constructor (
    readonly config :GridTileSceneConfig,
    readonly sceneWidth :number,
    readonly sceneHeight :number
  ) {
    //this.tiles = new Array<string[]>(sceneWidth)
    this.tiles = []
    for (let xx = 0; xx < sceneWidth; xx++) {
      //this.tiles[xx] = new Array<string>(sceneHeight)
      this.tiles[xx] = []
    }
  }
}

type GridTile = {
  /** The id of this type of tile. */
  id :string
  /** The tiles from which to pick randomly for the base tile. */
  tiles :Tile[]
  /** Fringe tiles, arranged according to the FringeConfig. */
  fringe? :Tile[]
}

type PropTile = {
  id :string
  tiles :Tile[]
}

export interface GridTileSet {
  sets: {[key :string] :GridTile}
  props: {[key :string] :PropTile}
}

type PropViz = {
  tile :Tile
  pos :vec2
}

type GridTileSceneViz = {
  /** At each x/y position, a stack of Tiles to render. */
  tiles :Tile[][][]
  props :PropViz[]
}

/**
 * Chop the texture into uniform tiles of size [w, h], ignoring any extra pixels.
 */
function chopTiles (tex :Texture, w :number, h :number) :Tile[] {
  const retval :Tile[] = []
  for (let xx = 0; xx + w <= tex.size[0]; xx += w) {
    for (let yy = 0; yy + h <= tex.size[1]; yy += h) {
      retval.push(tex.tile(xx, yy, w, h))
    }
  }
  return retval
}

/**
 * Load the tiles for a prop.
 */
function makeProp (
  loader :ResourceLoader, glc :GLC, tcfg :TextureConfig, cfg :PropTileInfo
) :Subject<PropTile> {
  if (cfg.scale !== undefined) {
    tcfg = {...tcfg, scale: new Scale(cfg.scale)}
  }
  return makeTexture(glc, loader.getImage(cfg.base), tcfg).map(tex => {
    let tiles :Tile[]
    if (cfg.width !== undefined && cfg.height !== undefined) {
      tiles = chopTiles(tex, cfg.width, cfg.height)
    } else {
      tiles = [ tex ] // just use the whole thing!
    }
    return { id: cfg.id, tiles: tiles }
  })
}

function makeGridTiles (
  loader :ResourceLoader, glc :GLC, tcfg :TextureConfig, image :string, cfg :GridTileSceneConfig
) :Subject<Tile[]> {
  return makeTexture(glc, loader.getImage(image), tcfg)
      .map(tex => chopTiles(tex, cfg.tileWidth, cfg.tileHeight))
}

function makeGridTile (
  loader :ResourceLoader, glc :GLC, tcfg :TextureConfig, tileInfo :GridTileInfo,
  cfg :GridTileSceneConfig
) :Subject<GridTile> {
  let tiles :Subject<Tile[]>[] = []
  tiles.push(makeGridTiles(loader, glc, tcfg, tileInfo.base, cfg))
  if (tileInfo.fringe) {
    tiles.push(makeGridTiles(loader, glc, tcfg, tileInfo.fringe, cfg))
  }
  return Subject.join(...tiles).map(v => {
    const tile :GridTile = { id: tileInfo.id, tiles: v[0] }
    if (v[1]) {
      tile.fringe = v[1]
    }
    return tile
  })
}

function makeGridTileSet (
  loader :ResourceLoader, glc :GLC, cfg :GridTileSceneConfig
) :Subject<GridTileSet> {
  const tcfg = { ...Texture.DefaultConfig, scale: new Scale(cfg.scale) }
  const sets :Subject<GridTile>[] = []
  for (const tileset of cfg.tiles) {
    sets.push(makeGridTile(loader, glc, tcfg, tileset, cfg))
  }
  const propSets :Subject<PropTile>[] = []
  if (cfg.props) {
    for (const prop of cfg.props) {
      propSets.push(makeProp(loader, glc, tcfg, prop))
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

export class GridTileSceneViewMode extends SurfaceMode {
  constructor (protected _app :App, protected _model :GridTileSceneModel) {
    super(_app)

    const tss :Subject<GridTileSet> = makeGridTileSet(_app.loader, this.renderer.glc, _model.config)
    this.onDispose.add(tss.onValue(tileset => {
      this._viz = this.makeViz(_model, tileset)
    }))
    this.onDispose.add(this.renderer.size.onValue(this._adjustOffset))
    this.onDispose.add(this._hand = new Hand(this._app.root))
    this.onDispose.add(this._hand.pointers.onChange(this._handChanged))
  }

  /** Get the logical width of the scene we're rendering. */
  protected get logicalWidth () :number {
    return this._model.config.tileWidth * this._model.sceneWidth
  }

  /** Get the logical height of the scene we're rendering. */
  protected get logicalHeight () :number {
    return this._model.config.tileHeight * this._model.sceneHeight
  }

  /**
   * Helper for subclass.
   */
  protected getTexture (texture :string, scale? :number) :Subject<Texture> {
    const theScale = (scale === undefined) ? this._model.config.scale : scale
    const tcfg = { ...Texture.DefaultConfig, scale: new Scale(theScale) }
    return makeTexture(this.renderer.glc, this._app.loader.getImage(texture), tcfg)
  }

  renderTo (clock :Clock, surf :Surface) {
    if (!this._viz) {
      surf.clearTo(0.5, 0.5, 0.5, 1)
      return
    }

    // update the hand, which may trigger an offset adjustment
    this._hand.update()

    surf.clearTo(1, 1, 1, 1)
    surf.saveTx()
    surf.translate(this._offset)
    try {
      this.renderToOffset(clock, surf)
    } finally {
      surf.restoreTx()
    }
  }

  /**
   * Render during surface translation.
   */
  protected renderToOffset (clock :Clock, surf :Surface) :void {
    const viz = this._viz! // this method doesn't get called unless viz is defined
    const xi = this._model.config.tileWidth
    const yi = this._model.config.tileHeight
    const pos = vec2.create()
    // draw tiles
    for (let xx = 0; xx < viz.tiles.length; xx++, pos[0] += xi) {
      const col = viz.tiles[xx]
      pos[1] = 0
      for (let yy = 0; yy < col.length; yy++, pos[1] += yi) {
        for (const tile of col[yy]) {
          surf.drawAt(tile, pos)
        }
      }
    }
    // draw props
    for (let prop of viz.props) {
      surf.drawAt(prop.tile, prop.pos)
    }
  }

  /**
   * Make the visualization model for the scene. This involves picking specific tiles
   * for features where more than one will do.
   */
  protected makeViz (model :GridTileSceneModel, tileset :GridTileSet) :GridTileSceneViz {
    const viz :GridTileSceneViz = {
      tiles: [],
      props: [],
    }
    for (let xx = 0; xx < model.tiles.length; xx++) {
      const col :Tile[][] = []
      viz.tiles.push(col)
      for (let yy = 0; yy < model.tiles[xx].length; yy++) {
        const stack :Tile[] = []
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
      const x :number = (placement.x * model.config.tileWidth) - (tile.size[0] / 2)
      const y :number = (placement.y * model.config.tileHeight) - (tile.size[1] / 2)
      viz.props.push({ tile: tile, pos: vec2.fromValues(x, y) })
    }
    const adder :FringeAdder = (x :number, y :number, fringe :Tile) :void => {
      viz.tiles[x][y].push(fringe)
    }
    applyFringe(model, tileset, adder)
    return viz
  }

  protected pointerUpdated (p :Pointer) :void {
    if (p.pressed) {
      vec2.add(this._offset, this._offset, p.movement)
      this._adjustOffset()
    }
  }

  /** The visualization of the scene, when we have it. */
  protected _viz? :GridTileSceneViz

  protected readonly _hand :Hand

  protected readonly _handPos :vec2 = vec2.create()
  protected readonly _offset :vec2 = vec2.create()

  /** Adjust our drawing offset after the mouse moves or renderer changes size. */
  protected readonly _adjustOffset = () => {
    const surfSize = this.renderer.size.current
    const offset = this._offset
    offset[0] = clamp(offset[0], Math.min(0, surfSize[0] - this.logicalWidth), 0)
    offset[1] = clamp(offset[1], Math.min(0, surfSize[1] - this.logicalHeight), 0)
  }

  /** React to mouse/touch events. */
  protected readonly _handChanged = (change :MapChange<number, Pointer>) =>
    {
      if (change.type === "set") {
        this.pointerUpdated(change.value)
      }
    }
}
