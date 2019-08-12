import {Scale} from "tfw/core/ui"
import {Disposer} from "tfw/core/util"
import {mat2d, vec2, vec2zero} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {Subject, Value} from "tfw/core/react"
import {
  Component,
  DenseValueComponent,
  Domain,
  Matcher,
  System,
  Vec2Component} from "tfw/entity/entity"
import {GLC, Texture, TextureConfig, Tile, makeTexture} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {TransformComponent, DynamicsSystem} from "tfw/scene2/entity"
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

/**
 * Configuration of a monster.
 */
export class MonsterConfig
{
  constructor (
    /** What the monster looks like, can be a shared object between multiple monsters. */
    readonly info :PropTileInfo
  ) {}
}

/**
 * Runtime information about a monster's visual state.
 */
export class MonsterVisualState
{
  constructor (
    readonly x :number,
    readonly y :number,
    readonly state :string // TODO: walking, eating, pooping, mating...
  ) {}

  /**
   * Compares two MonsterVisualState's for equality.
   */
  static eq (a :MonsterVisualState, b :MonsterVisualState) :boolean
  {
    return (a.x === b.x) && (a.y === b.y) && (a.state === b.state)
  }
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

class MonsterSprite
{
  /** The tile for drawing the monster. */
  public tile? :Tile

  /** Position. */
  public pos :vec2 = vec2.create()

  /** A disposer just for this sprite. */
  public disposer :Disposer = new Disposer()

  constructor (
    /** The most recent state. */
    public state :MonsterVisualState
  ) {}
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

/**
 * Load the tiles for a prop.
 */
function makeProp (glc :GLC, tcfg :TextureConfig, cfg :PropTileInfo) :Subject<PropTile> {
  return makeTexture(glc, loadImage(cfg.base), tcfg).map(tex => {
    let tiles :Array<Tile>
    if (cfg.width !== undefined && cfg.height !== undefined) {
      tiles = chopTiles(tex, cfg.width, cfg.height)
    } else {
      tiles = [ tex ] // just use the whole thing!
    }
    return { id: cfg.id, tiles: tiles }
  })
}

function makeGridTiles (glc :GLC, tcfg :TextureConfig, image :string, cfg :GridTileSceneConfig)
    :Subject<Array<Tile>> {
  return makeTexture(glc, loadImage(image), tcfg)
      .map(tex => chopTiles(tex, cfg.tileWidth, cfg.tileHeight))
}

function makeGridTile (
  glc :GLC, tcfg :TextureConfig, tileInfo :GridTileInfo, cfg :GridTileSceneConfig
) :Subject<GridTile> {
  let tiles :Array<Subject<Array<Tile>>> = []
  tiles.push(makeGridTiles(glc, tcfg, tileInfo.base, cfg))
  if (tileInfo.fringe) {
    tiles.push(makeGridTiles(glc, tcfg, tileInfo.fringe, cfg))
  }
  return Subject.join(...tiles).map(v => {
    const tile :GridTile = { id: tileInfo.id, tiles: v[0] }
    if (v[1]) {
      tile.fringe = v[1]
    }
    return tile
  })
}

function makeGridTileSet (glc :GLC, cfg :GridTileSceneConfig) :Subject<GridTileSet>
{
  const tcfg = { ...Texture.DefaultConfig, scale: new Scale(cfg.scale) }
  const sets :Array<Subject<GridTile>> = []
  for (const tileset of cfg.tiles) {
    sets.push(makeGridTile(glc, tcfg, tileset, cfg))
  }
  const propSets :Array<Subject<PropTile>> = []
  if (cfg.props) {
    for (const prop of cfg.props) {
      propSets.push(makeProp(glc, tcfg, prop))
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

/**
 * Adapt Mike's "flappy" bounce system.
 */
class BounceSystem extends System {
  constructor (domain :Domain,
               readonly view :GridTileSceneViewMode,
               readonly trans :TransformComponent,
               readonly vel :Vec2Component) {
    super(domain, Matcher.hasAllC(trans.id, vel.id))
  }

  update () {
    const tmp = vec2.create()
    const sw = 1000, sh = 1000 //this.view.width, sh = this.view.height
    this.onEntities(id => {
      this.trans.readTranslation(id, tmp)
      const tx = tmp[0], ty = tmp[1]
      let dx = 0, dy = 0 // desired directions
      if (tx < 0) dx = 1; else if (tx > sw) dx = -1
      if (ty < 0) dy = 1; else if (ty > sh) dy = -1
      if (dx != 0 || dy != 0) {
        this.vel.read(id, tmp)
        if (dx != 0 && ((tmp[0] < 0) != (dx < 0))) {
          tmp[0] *= -1
        }
        if (dy != 0 && ((tmp[1] < 0) != (dy < 0))) {
          tmp[1] *= -1
        }
        this.vel.update(id, tmp)
      }
    })
  }
}

class SurfaceRenderSystem extends System {
  //private readonly ttrans = mat2d.create()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly tile :Component<Tile>) {
    super(domain, Matcher.hasAllC(trans.id, tile.id))
  }

  update () {
    this.trans.updateMatrices()
  }

  render (surf :Surface, offset :vec2) {
    surf.saveTx()
    this.onEntities(id => {
      const tile = this.tile.read(id)
      this.trans.readMatrix(id, surf.tx)
      mat2d.scale(surf.tx, surf.tx, [2 , 2])
      surf.translate(offset)
      surf.drawAt(tile, vec2zero)
    })
    surf.restoreTx()
  }
}

export class GridTileSceneViewMode extends SurfaceMode {
  constructor (protected _app :App, protected _model :GridTileSceneModel) {
    super(_app)

    const tss :Subject<GridTileSet> = makeGridTileSet(_app.renderer.glc, _model.config)
    this.onDispose.add(tss.onValue(tileset => {
      this._viz = this.makeViz(_model, tileset)
    }))
    this.onDispose.add(_app.renderer.size.onValue(() => this.adjustOffset()))
    this._app.root.addEventListener("mousemove", this._onMouseMove)
    this.onDispose.add(() => this._app.root.removeEventListener("mousemove", this._onMouseMove))
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
   * Add a monster to the system.
   */
  addMonster (config :MonsterConfig, viz :Value<MonsterVisualState>) :void {
    const sprite = new MonsterSprite(viz.current)
    this._monsters.set(viz, sprite)
    this.onDispose.add(sprite.disposer)
    sprite.disposer.add(viz.onEmit(val => this.updateMonsterSprite(sprite, val)))

    // Async lookup monster sprite tile
    // TODO: monster resources can be shared by monsters with the same look
    // (maybe the texture system already does this?)
    const tcfg = { ...Texture.DefaultConfig, scale: new Scale(this._model.config.scale) }
    const img :Subject<Texture> = makeTexture(
        this._app.renderer.glc, loadImage(config.info.base), tcfg)
    const remover = img.onValue(tex => {
      sprite.tile = tex
      // let's just call into updateMonsterSprite to rejiggle the location
      this.updateMonsterSprite(sprite, sprite.state)
    })
    sprite.disposer.add(remover)
  }

  /**
   * Remove a monster from the system.
   */
  removeMonster (...TODO :any[]) :void {
    // remove from map, remove the disposer from our dispose, but then call the disposer
  }

  protected configureEcs (defaultTile :Tile) :void {

    // set up our ECS for controlling monsters?
    const batchBits = 10
    const trans = this._transComp = new TransformComponent("trans", batchBits)
    const tile = new DenseValueComponent<Tile>("tile", defaultTile)
    const vel = this._velComp = new Vec2Component("vel", vec2zero, batchBits)

    this._domain = new Domain({}, { trans, tile, vel })
    this._dynamicsSys = new DynamicsSystem(this._domain, trans, vel)
    this._bounceSys = new BounceSystem(this._domain, this, trans, vel)
    this._renderSys = new SurfaceRenderSystem(this._domain, trans, tile)
  }

  /**
   * Update a monster sprite.
   */
  protected updateMonsterSprite (sprite :MonsterSprite, state :MonsterVisualState)
  {
    sprite.state = state // just copy the latest state in
    let xx = state.x * this._model.config.tileWidth
    let yy = state.y * this._model.config.tileHeight
    if (sprite.tile) {
      xx -= sprite.tile.size[0] / 2
      yy -= sprite.tile.size[1] / 2
    }
    vec2.set(sprite.pos, xx, yy)
  }

  adjustOffset () {
    const surfSize = this._app.renderer.size.current
    const overlapW = Math.max(0, this.logicalWidth - surfSize[0])
    const overlapH = Math.max(0, this.logicalHeight - surfSize[1])
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
    surf.saveTx()
    surf.translate(this._offset)
    const xi = this._model.config.tileWidth
    const yi = this._model.config.tileHeight
    const pos = vec2.create() //vec2.clone(this._offset)
    // draw tiles
    for (let xx = 0; xx < viz.tiles.length; xx++, pos[0] += xi) {
      const col = viz.tiles[xx]
      pos[1] = 0 //this._offset[1]
      for (let yy = 0; yy < col.length; yy++, pos[1] += yi) {
        for (const tile of col[yy]) {
          surf.drawAt(tile, pos)
        }
      }
    }
    // draw props
    for (let prop of viz.props) {
      //vec2.add(pos, prop.pos, this._offset)
      //surf.drawAt(prop.tile, pos)
      surf.drawAt(prop.tile, prop.pos)
    }
    // draw monsters
    for (const monst of this._monsters.values()) {
      if (monst.tile) {
        surf.drawAt(monst.tile, monst.pos)
      }
    }

    if (this._domain) {
      this._dynamicsSys!.update(clock)
      this._bounceSys!.update()
      this._renderSys!.update()
      this._renderSys!.render(surf, this._offset)
    }
    surf.restoreTx()
  }

  /**
   * Make the visualization model for the scene. This involves picking specific tiles
   * for features where more than one will do.
   */
  protected makeViz (model :GridTileSceneModel, tileset :GridTileSet) :GridTileSceneViz
  {
    const viz = {
      tiles: new Array<Array<Array<Tile>>>(),
      props: new Array<PropViz>() }
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

  /** The visualization of the scene, when we have it. */
  protected _viz? :GridTileSceneViz

  protected readonly _monsters :Map<Value<MonsterVisualState>, MonsterSprite> = new Map()

  protected readonly _mouse :vec2 = vec2.create()
  protected readonly _offset :vec2 = vec2.create()
  protected readonly _onMouseMove = (event :MouseEvent) => {
    vec2.set(this._mouse, event.offsetX, event.offsetY)
    this.adjustOffset()
  }

  protected _domain? :Domain
  protected _transComp? :TransformComponent
  protected _velComp? :Vec2Component
  protected _dynamicsSys? :DynamicsSystem
  protected _bounceSys? :BounceSystem
  protected _renderSys? :SurfaceRenderSystem
}
