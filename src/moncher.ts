import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {Subject, Value} from "tfw/core/react"
import {Disposer} from "tfw/core/util"
import {Texture, Tile} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App} from "./app"
import {GridTileSceneModel, GridTileSceneViewMode, PropTileInfo} from "./gridtiles"

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


/**
 * Secret internal monster data.
 */
class MonsterData
{
  public hunger :number = 0
  public lonliness :number = 0
  public boredom :number = 0
  public crowding :number = 0
  public locationMemory :Array<vec2> = new Array<vec2>()
  public state :string = ""

  constructor (
    readonly config :MonsterConfig,
    public x :number,
    public y :number
  ) {}
}

export class RanchModel
{
  constructor (
    public readonly model :GridTileSceneModel
  ) {}

  /**
   * Add a new monster.
   */
  public addMonster (config :MonsterConfig, x :number, y :number) :void
  {
  }

  /**
   * Advance the simulation.
   */
  public tick () :void
  {
  }

  protected _nextMonsterId :number = 0
  protected _monsters :Map<number, MonsterData> = new Map<number, MonsterData>()
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


export class MonsterRancherMode extends GridTileSceneViewMode {
  constructor (
    app :App,
    protected _ranch :RanchModel
  ) {
    super(app, _ranch.model)
  }

  /**
   * Add a monster to the ranch.
   */
  addMonster (config :MonsterConfig, viz :Value<MonsterVisualState>) :void {
    const sprite = new MonsterSprite(viz.current)
    this._monsters.set(viz, sprite)
    this.onDispose.add(sprite.disposer)
    sprite.disposer.add(viz.onEmit(val => this.updateMonsterSprite(sprite, val)))

    // Async lookup monster sprite tile
    // TODO: monster resources can be shared by monsters with the same look
    // (maybe the texture system already does this?)
    const img :Subject<Texture> = this.getTexture(config.info.base)
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

  protected drawActors (clock :Clock, surf :Surface) :void
  {
    super.drawActors(clock, surf)
    // draw monsters
    for (const monst of this._monsters.values()) {
      if (monst.tile) {
        surf.drawAt(monst.tile, monst.pos)
      }
    }
  }

  protected readonly _monsters :Map<Value<MonsterVisualState>, MonsterSprite> = new Map()
}
