import {Clock} from "tfw/core/clock"
import {vec2} from "tfw/core/math"
import {Subject} from "tfw/core/react"
import {MapChange, MutableMap, RMap} from "tfw/core/rcollect"
import {Disposer} from "tfw/core/util"
import {Pointer} from "tfw/input/hand"
import {Texture, Tile} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {App} from "./app"
import {GridTileSceneModel, GridTileSceneViewMode, PropTileInfo} from "./gridtiles"
import {MonsterMenu} from "./monstermenu"

/**
 * Broadly, the kind of monster.
 */
export class MonsterKind
{
  static readonly RUNNER :MonsterKind = new MonsterKind(true, false, false)
  static readonly HEALER :MonsterKind = new MonsterKind(false, true, true)
  static readonly TESTER :MonsterKind = new MonsterKind(true, true, true)

  private constructor (
    readonly canRangeAttack :boolean,
    readonly canMeleeAttack :boolean,
    readonly canHeal :boolean,
  ) {}
}

/**
 * Configuration of a monster.
 */
export class MonsterConfig
{
  constructor (
    /** What the monster looks like, can be a shared object between multiple monsters. */
    readonly info :PropTileInfo,
    readonly kind :MonsterKind = MonsterKind.TESTER,
    readonly startingHealth :number = 50,
    readonly maximumHealth :number = 50,
    readonly startingActionPts :number = 5,
    readonly maxActionPts :number = 10,
    readonly regenActionPts :number = .2,
  ) {}
}

/**
 * Runtime information about a monster's state.
 */
export class MonsterState
{
  constructor (
    /** Visual X coordinate (tile coordinates, floating point). */
    readonly x :number,
    /** Visual Y coordinate (tile coordinates, floating point). */
    readonly y :number,
    /** The monster's current amount of HP, possibly 0 if deceased during battle. */
    readonly health :number,
    /** The monster's current action points. */
    readonly actionPts :number,
    /** TODO */
    readonly state :string, // walking, eating, pooping, mating...?
  ) {}
}

type ScoreFn = (x :number, y :number) => number

/**
 * A monster.
 */
class Monster
{
  // Toy attributes while playing around. These will all go away.
  hunger :number = 0
  lonliness :number = 0
  boredom :number = 0
  crowding :number = 0

  health :number
  actionPts :number

  /** Recently visited locations, most recent at index 0. */
  locationMemory :Array<vec2> = new Array<vec2>()
  state :string = ""

  constructor (
    readonly id :number,
    readonly config :MonsterConfig,
    public x :number,
    public y :number
  ) {
    this.health = config.startingHealth
    this.actionPts = config.startingActionPts
  }

  toState () :MonsterState
  {
    // TODO: Rethink? We keep monsters in tile coords but we center it for the visual state
    return new MonsterState(this.x + .5, this.y + .5, this.health, this.actionPts, this.state)
  }

  setLocation (x :number, y :number) :void
  {
    this.x = x
    this.y = y
    if (this.rememberLocation(x, y)) {
      this.boredom = Math.max(0, this.boredom - 20)
    }
  }

  rememberLocation (x :number, y :number) :boolean
  {
    const newLoc = vec2.fromValues(x, y)
    const index = this.getMemoryIndex(newLoc)
    if (index !== -1) {
      // splice it out of the old location
      this.locationMemory.splice(index, 1)

    } else if (this.locationMemory.length === Monster.MEMORY_SIZE) {
      // if we're already at the size, make room for the new location
      this.locationMemory.pop()
    }

    // always add the new location to the front
    this.locationMemory.unshift(newLoc)
    return (index === -1)
  }

  isInMemory (x :number, y :number) :boolean
  {
    return this.getMemoryIndex(vec2.fromValues(x, y)) > -1
  }

  protected getMemoryIndex (loc :vec2) :number
  {
    return this.locationMemory.findIndex(v => vec2.equals(loc, v))
  }

  /** How much memory to keep. */
  protected static readonly MEMORY_SIZE = 16
}

export class RanchModel
{
  /** The public view of monster state. */
  get monsters () :RMap<number, MonsterState> {
    return this._monsters
  }

  /** The configuration data for a monster, guaranteed to be populated prior to
   *  'monsters' being updated. */
  monsterConfig :Map<number, MonsterConfig> = new Map<number, MonsterConfig>()

  constructor (
    /** The model we're on. */
    readonly model :GridTileSceneModel
  ) {
    this._monsters = MutableMap.local()
  }

  /**
   * Add a new monster.
   */
  addMonster (config :MonsterConfig, x :number, y :number) :void
  {
    const id = this._nextMonsterId++
    const data = new Monster(id, config, Math.trunc(x), Math.trunc(y))
    this.monsterConfig.set(id, config)
    this._monsterData.set(id, data)
    // move the monster to its current location to map it by location
    this.moveMonster(data, data.x, data.y)
    // finally, publish the state of the monster
    this._monsters.set(data.id, data.toState())
  }

  protected moveMonster (data :Monster, newX :number, newY :number)
  {
    // remove from the old location in the map
    const oldKey = this.locToKey(data.x, data.y)
    const oldVals = this._monstersByLocation.get(oldKey)
    if (oldVals) {
      const dex = oldVals.indexOf(data.id)
      if (dex !== -1) {
        oldVals.splice(dex, 1)
      }
    }

    // actually update the location
    data.setLocation(newX, newY)
    const newKey = this.locToKey(newX, newY)
    let newVals = this._monstersByLocation.get(newKey)
    if (!newVals) {
      newVals = new Array<number>()
      this._monstersByLocation.set(newKey, newVals)
    }
    newVals.push(data.id)
  }

  getMonsterCount (x :number, y :number) :number
  {
    return this.getMonsters(x, y).length
//    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
//      const array = this._monstersByLocation.get(this.locToKey(x, y))
//      if (array) return array.length
//    }
//    return 0
  }

  getMonsters (x :number, y :number) :Array<number>
  {
    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
      const array = this._monstersByLocation.get(this.locToKey(x, y))
      if (array) return array
    }
    return []
  }

  protected getFeature (x :number, y :number) :string
  {
    if (x >= 0 && y >= 0 && x < this.model.sceneWidth && y < this.model.sceneHeight) {
      return this.model.tiles[x][y]
    }
    return ""
  }

  protected locToKey (x :number, y :number) :number
  {
    // TODO: maybe we quantize to tile here?
    return (y * this.model.sceneWidth) + x
  }

  /**
   * Advance the simulation.
   */
  tick () :void
  {
    // first update the internal states of all monsters
    for (const monst of this._monsterData.values()) {
      // accumulate action points
      monst.actionPts += monst.config.regenActionPts

      // see what kind of tile we're on and react to that
      switch (this.getFeature(monst.x, monst.y)) {
      case "dirt":
        monst.hunger++
        monst.boredom += 2
        break

      case "grass":
        monst.hunger = Math.max(0, monst.hunger - 20)
        monst.boredom++
        break

      case "cobble":
        monst.hunger++
        // no change to boredom
        break
      }

      // examine the nearby tiles for monsters
      let social = 0
      for (let xx = -1; xx < 2; xx++) {
        for (let yy = -1; yy < 2; yy++) {
          const neighbs = this.getMonsterCount(monst.x + xx, monst.y + yy)
          if (xx === 0 && yy === 0) {
            monst.crowding += neighbs - 1 // subtract one for ourselves
            social += neighbs - 1
          } else if (xx === 0 || yy === 0) {
            social += neighbs
          } else {
            social += neighbs / 2 // lesser influence at the corners
          }
        }
      }
      if (social === 0) {
        monst.lonliness++
        monst.crowding = Math.max(0, monst.crowding - 50)
      } else {
        monst.lonliness = Math.max(0, monst.lonliness - social)
      }
    }

    // then figure out if a monster wants to update state/loc
    for (const monst of this._monsterData.values()) {
      const scoreFn :ScoreFn|undefined = this.getScoreFn(monst)
      if (scoreFn === undefined) continue
      let best :Array<vec2> = []
      let bestScore = Number.MIN_SAFE_INTEGER
      for (let xx = -1; xx < 2; xx++) {
        for (let yy = -1; yy < 2; yy++) {
          if (xx === 0 && yy === 0) continue
          const mx = xx + monst.x
          const my = yy + monst.y
          if (mx < 0 || my < 0 || mx >= this.model.sceneWidth || my >= this.model.sceneHeight) {
            continue
          }
          const score = scoreFn(mx, my)
          if (score > bestScore) {
            bestScore = score
            best = [ vec2.fromValues(mx, my) ]

          } else if (score == bestScore) {
            best.push(vec2.fromValues(mx, my))
          }
        }
      }
      if (bestScore !== Number.MIN_SAFE_INTEGER) {
        const bestLoc = best[Math.trunc(Math.random() * best.length)]
        this.moveMonster(monst, bestLoc[0], bestLoc[1])
      }
    }

    // publish all changes..
    for (const monst of this._monsterData.values()) {
      this._monsters.set(monst.id, monst.toState())
    }
  }

  protected getScoreFn (monst :Monster) :ScoreFn|undefined
  {
    let fns = new Array<ScoreFn>()
    if (monst.hunger > 50) {
      fns.push((x, y) => ("grass" === this.getFeature(x, y)) ? monst.hunger : 0)
    }
    if (monst.lonliness > 50) {
      // TODO: this is counting monsters during moves, so it will count wrong
      fns.push((x, y) => (this.getMonsterCount(x, y) > 0) ? monst.lonliness : 0)
    }
    if (monst.boredom > 50) {
      fns.push((x, y) => monst.isInMemory(x, y) ? 0 : monst.boredom)
    }
    if (monst.crowding > 50) {
      fns.push((x, y) => (this.getMonsterCount(x, y) > 0) ? 0 : monst.crowding)
    }
    switch (fns.length) {
      case 0: return undefined
      case 1: return fns[0]
      default: return (x, y) => {
          let weight = 0
          for (const fn of fns) {
            weight += fn(x, y)
          }
          return weight
        }
    }
  }

  protected _nextMonsterId :number = 0
  protected _monsterData :Map<number, Monster> = new Map()
  /** A mutable view of our public monsters RMap. */
  protected _monsters :MutableMap<number, MonsterState>
  /** Maps a location to monster ids. */
  protected _monstersByLocation :Map<number, Array<number>> = new Map()
}

class MonsterSprite
{
  /** The tile for drawing the monster. */
  tile? :Tile
  /** Position. */
  pos :vec2 = vec2.create()
  /** A disposer just for this sprite. */
  disposer :Disposer = new Disposer()

  constructor (
    /** The most recent state. */
    public state :MonsterState
  ) {}
}

export class MonsterRancherMode extends GridTileSceneViewMode {
  constructor (
    app :App,
    protected _ranch :RanchModel
  ) {
    super(app, _ranch.model)

    this.onDispose.add(_ranch.monsters.onChange(this._monsterChange))
    _ranch.monsters.forEach((monster, id) => { this.updateMonster(id, monster) })
  }

  /**
   * Update a monster sprite.
   */
  protected updateMonsterSprite (sprite :MonsterSprite, state :MonsterState)
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

  renderTo (clock :Clock, surf :Surface) :void
  {
    super.renderTo(clock, surf)

    if (this._menu) this._menu.render(clock, surf)
  }

  protected renderToOffset (clock :Clock, surf :Surface) :void
  {
    super.renderToOffset(clock, surf)

    // draw monsters
    for (const monst of this._monsters.values()) {
      if (monst.tile) {
        surf.drawAt(monst.tile, monst.pos)
      }
    }
  }

  protected updateMonster (id :number, state :MonsterState)
  {
    let sprite = this._monsters.get(id)
    if (!sprite) {
      // async lookup tile
      const cfg = this._ranch.monsterConfig.get(id)
      if (!cfg) {
        throw new Error("Monster doesn't have a config in the model")
      }

      sprite = new MonsterSprite(state)
      this._monsters.set(id, sprite)
      this.onDispose.add(sprite.disposer)
      // TODO: NOTE: we're not honoring the width/height in the PropTileInfo here
      const img :Subject<Texture> = this.getTexture(cfg.info.base, cfg.info.scale)
      const remover = img.onValue(tex => {
        sprite!.tile = tex
        // let's just call into updateMonsterSprite to rejiggle the location
        this.updateMonsterSprite(sprite!, sprite!.state)
      })
      sprite.disposer.add(remover)
    }
    this.updateMonsterSprite(sprite, state)
  }

  protected deleteMonster (id :number)
  {
    const sprite = this._monsters.get(id)
    if (!sprite) return
    this._monsters.delete(id)
    this.onDispose.remove(sprite.disposer)
    sprite.disposer.dispose()
  }

  protected pointerUpdated (p :Pointer) :void
  {
    if (this._menu) {
      if (p.pressed) {
        this.onDispose.remove(this._menu.disposer)
        this._menu.disposer.dispose()
        this._menu = undefined
      } else {
        return; // suppress any other mouse handling while menu is up
      }
    }

    super.pointerUpdated(p)

    if (p.pressed) {
      // see where that is in tile coordinates
      const x = Math.trunc((p.position[0] - this._offset[0]) / this._model.config.tileWidth)
      const y = Math.trunc((p.position[1] - this._offset[1]) / this._model.config.tileHeight)
      if (x >= 0 && y >= 0 && x < this._model.sceneWidth && y < this._model.sceneHeight) {
        this.tileClicked(x, y)
      }
    }
  }

  protected tileClicked (x :number, y :number) :void
  {
    const array :Array<number> = this._ranch.getMonsters(x, y)
    if (array.length === 0) return
    const id = array[array.length - 1]
    const config = this._ranch.monsterConfig.get(id)! // must be present
    const state = this._ranch.monsters.getValue(id)

    const screenX = Math.max(0, (x + .5) * this._model.config.tileWidth + this._offset[0])
    const screenY = Math.max(0, (y + .5) * this._model.config.tileHeight + this._offset[1])
    console.log(`Popping menu at ${screenX} ${screenY}`)

    this._menu = new MonsterMenu(this._app.renderer, config, state, screenX, screenY)
    this.onDispose.add(this._menu.disposer)
  }

  protected readonly _monsterChange = (change :MapChange<number, MonsterState>) => {
    if (change.type === "set") {
      this.updateMonster(change.key, change.value)
    } else {
      this.deleteMonster(change.key)
    }
  }

  protected _menu? :MonsterMenu

  protected readonly _monsters :Map<number, MonsterSprite> = new Map()
}
