import {Mutable, Subject} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {Disposer} from "tfw/core/util"
import {mat2d, vec2, vec2zero} from "tfw/core/math"
import {Clock} from "tfw/core/clock"
import {loadImage} from "tfw/core/assets"
import {MapChange, MutableMap, RMap} from "tfw/core/rcollect"
import {
  Component,
  DenseValueComponent,
  Domain,
  ID,
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
 * Runtime information about the monster in the scene.
 */
export class MonsterData
{
  readonly location :Mutable<vec2>

  constructor (
    /** An id only guaranteed to be unique among monsters. */
    readonly id :ID,
    /** The monster's configuration. TODO: in a separate map? */
    readonly config :MonsterConfig,
    /** The current location of the monster. Uses grid tile coordinates. */
    location? :vec2
  ) {
    this.location = Mutable.local(location || vec2.create(), vec2.equals)
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
  readonly monsters :RMap<ID, MonsterData>

  constructor (
    readonly config :GridTileSceneConfig,
    readonly sceneWidth :number,
    readonly sceneHeight :number
  ) {
    this.tiles = new Array<Array<string>>(sceneWidth)
    for (let xx = 0; xx < sceneWidth; xx++) {
      this.tiles[xx] = new Array<string>(sceneHeight)
    }
    this.monsters = this._monsters = MutableMap.local()
  }

  addMonster (monster :MonsterConfig, location? :vec2) :MonsterData {
    const id = this._nextId++
    const data = new MonsterData(id, monster, location)
    this._monsters.set(id, data)
    return data
  }

  updateMonster (monster :MonsterData)
  {
    this._monsters.set(monster.id, monster)
  }

  public tick () :void
  {
    for (const monst of this._monsters.values()) {
      const loc = monst.location.current
      const newLoc = vec2.add(vec2.create(), loc, [.04, .04])
      monst.location.update(newLoc)
//      monst.location.update(vec2.add(loc, loc, [.04, .04]))
    }
  }

  protected _monsters :MutableMap<ID, MonsterData>
  protected _nextId :number = 0
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

type MonsterViz = {
  tile? :Tile
  pos :vec2
  disposer :Disposer
}

type GridTileSceneViz = {
  /** At each x/y position, a stack of Tiles to render. */
  tiles :Array<Array<Array<Tile>>>
  props :Array<PropViz>
  /** The present location of monsters, indexed by their ID. */
  monsters :Map<ID, MonsterViz>
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
    const sw = this.view.width, sh = this.view.height
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
      _model.monsters.forEach((monster, id) => {
        this.updateMonster(id, monster)
      })
      this.onDispose.add(_model.monsters.onChange(change => this.monsterChange(change)))
    }))
    this.onDispose.add(_app.renderer.size.onValue(() => this.adjustOffset()))
    this._app.root.addEventListener("mousemove", this._onMouseMove)
    this.onDispose.add(() => this._app.root.removeEventListener("mousemove", this._onMouseMove))
  }

  get width () :number {
    return this.logicalWidth * this._model.config.scale
  }

  get height () :number {
    return this.logicalHeight * this._model.config.scale
  }

  /** Get the logical width of the scene we're rendering. */
  protected get logicalWidth () :number {
    return this._model.config.tileWidth * this._model.sceneWidth
  }

  /** Get the logical height of the scene we're rendering. */
  protected get logicalHeight () :number {
    return this._model.config.tileHeight * this._model.sceneHeight
  }

  addMonster (url :string) {
    const tcfg = { ...Texture.DefaultConfig, scale: new Scale(this._model.config.scale) }
    this.addMonsterTexture(makeTexture(this._app.renderer.glc, loadImage(url), tcfg))
  }

  addMonsterTexture (img :Subject<Tile>) {
    this.onDispose.add(img.onValue(tex => this.addMonsterTile(tex)))
  }

  addMonsterTile (monster :Tile) {
    if (!this._domain) {
      this.configureEcs(monster)
    }

    const econfig = {
      components: {
        trans: {},
        tile: { initial: monster },
        vel: {}
      }
    }
    const id = this._domain!.add(econfig)
    this._transComp!.updateOrigin(id, monster.size[0]/2, monster.size[1]/2)
    this._transComp!.updateTranslation(id,
       Math.random() * this.logicalWidth, Math.random() * this.logicalHeight)
    this._velComp!.update(id,
        vec2.fromValues((Math.random() * -.5) * 200, (Math.random() * -.5) * 200))
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
   * Called when there's a change to monster data in our underlying map.
   */
  protected monsterChange (change :MapChange<ID, MonsterData>) {
    if (change.type == "set") {
      this.updateMonster(change.key, change.value)

    } else { // deleted
      this.deleteMonster(change.key, change.prev)
    }
  }

  protected updateMonster (id :ID, monster :MonsterData)
  {
    const viz = this._viz
    if (!viz) return
    let sprite = viz.monsters.get(id)
    if (!sprite) {
      sprite = { pos: vec2.create(), disposer: new Disposer() }
      viz.monsters.set(id, sprite)
      this.onDispose.add(sprite.disposer)

      // Async lookup monster sprite tile
      const tcfg = { ...Texture.DefaultConfig, scale: new Scale(this._model.config.scale) }
      const img :Subject<Texture> = makeTexture(
        this._app.renderer.glc, loadImage(monster.config.info.base), tcfg)
      const remover = img.onValue(tex => {
         if (sprite) {
           sprite.tile = tex
           sprite.pos[0] -= tex.size[0] / 2
           sprite.pos[1] -= tex.size[1] / 2
        }
      })
      sprite.disposer.add(remover)
      // also let's listen to the value
      sprite.disposer.add(
        monster.location.onEmit((val) => { this.updateMonsterLocation(id, monster, sprite!) }))
    }
    this.updateMonsterLocation(id, monster, sprite)
  }

  protected updateMonsterLocation (id :ID, monster :MonsterData, sprite :MonsterViz)
  {
    let xx = monster.location.current[0] * this._model.config.tileWidth
    let yy = monster.location.current[1] * this._model.config.tileHeight
    if (sprite.tile) {
      xx -= (sprite.tile.size[0] / 2)
      yy -= (sprite.tile.size[1] / 2)
    }
    vec2.set(sprite.pos, xx, yy)
  }

  protected deleteMonster (id :ID, monster :MonsterData)
  {
    const viz = this._viz
    if (!viz) return
    const sprite = viz.monsters.get(id)
    if (!sprite) return
    viz.monsters.delete(id)
    this.onDispose.remove(sprite.disposer)
    sprite.disposer.dispose()
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
    for (let monst of viz.monsters.values()) {
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
      props: new Array<PropViz>(),
      monsters: new Map<ID, MonsterViz>() }
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
