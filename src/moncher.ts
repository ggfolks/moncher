import {loadImage} from "tfw/core/assets"
import {Clock} from "tfw/core/clock"
import {Color} from "tfw/core/color"
import {vec2} from "tfw/core/math"
import {Mutable, Subject} from "tfw/core/react"
import {MapChange, MutableMap, RMap} from "tfw/core/rcollect"
import {Disposer} from "tfw/core/util"
import {Renderer, Texture, Tile} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {RootConfig} from "tfw/ui/element"
import {Host2} from "tfw/ui/host2"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver, StyleDefs} from "tfw/ui/style"
import {Theme, UI} from "tfw/ui/ui"
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

//  /**
//   * Compares two MonsterVisualState's for equality.
//   */
//  static eq (a :MonsterVisualState, b :MonsterVisualState) :boolean
//  {
//    return (a.x === b.x) && (a.y === b.y) && (a.state === b.state)
//  }
}

type ScoreFn = (x :number, y :number) => number


/**
 * Secret internal monster data.
 */
class MonsterData
{
  public hunger :number = 0
  public lonliness :number = 0
  public boredom :number = 0
  public crowding :number = 0
  /** Recently visited locations, most recent at index 0. */
  public locationMemory :Array<vec2> = new Array<vec2>()
  public state :string = ""

  constructor (
    readonly id :number,
    readonly config :MonsterConfig,
    public x :number,
    public y :number
  ) {}

  public toVisualState () :MonsterVisualState
  {
    // TODO: Rethink? We keep monsters in tile coords but we center it for the visual state
    return new MonsterVisualState(this.x + .5, this.y + .5, this.state)
  }

  public setLocation (x :number, y :number) :void
  {
    this.x = x
    this.y = y
    if (this.rememberLocation(x, y)) {
      this.boredom = Math.max(0, this.boredom - 20)
    }
  }

  public rememberLocation (x :number, y :number) :boolean
  {
    const newLoc = vec2.fromValues(x, y)
    const index = this.getMemoryIndex(newLoc)
    if (index !== -1) {
      // splice it out of the old location
      this.locationMemory.splice(index, 1)

    } else if (this.locationMemory.length === MonsterData.MEMORY_SIZE) {
      // if we're already at the size, make room for the new location
      this.locationMemory.pop()
    }

    // always add the new location to the front
    this.locationMemory.unshift(newLoc)
    return (index === -1)
  }

  public isInMemory (x :number, y :number) :boolean
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
  public get monsters () :RMap<number, MonsterVisualState> {
    return this._monsters
  }

  /** The configuration data for a monster, guaranteed to be populated prior to
   *  'monsters' being updated. */
  public monsterConfig :Map<number, MonsterConfig> = new Map<number, MonsterConfig>()

  constructor (
    /** The model we're on. */
    public readonly model :GridTileSceneModel
  ) {
    this._monsters = MutableMap.local()
  }

  /**
   * Add a new monster.
   */
  public addMonster (config :MonsterConfig, x :number, y :number) :void
  {
    const id = this._nextMonsterId++
    const data = new MonsterData(id, config, Math.trunc(x), Math.trunc(y))
    this.monsterConfig.set(id, config)
    this._monsterData.set(id, data)
    // move the monster to its current location to map it by location and publish state
    this.moveMonster(data, data.x, data.y)
  }

  protected moveMonster (data :MonsterData, newX :number, newY :number)
  {
    // remove from the old location in the map
    const oldKey = this.locToKey(data.x, data.y)
    const oldVals = this._monstersByLocation.get(oldKey)
    if (oldVals) {
      const dex = oldVals.indexOf(data)
      if (dex !== -1) {
        oldVals.splice(dex, 1)
      }
    }

    // actually update the location
    data.setLocation(newX, newY)
    const newKey = this.locToKey(newX, newY)
    let newVals = this._monstersByLocation.get(newKey)
    if (!newVals) {
      newVals = new Array<MonsterData>()
      this._monstersByLocation.set(newKey, newVals)
    }
    newVals.push(data)

    this._monsters.set(data.id, data.toVisualState())
  }

  public getMonsters (x :number, y :number) :Array<MonsterData>
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
  public tick () :void
  {
    // first update the internal states of all monsters
    for (const monst of this._monsterData.values()) {
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
          const neighbs = this.getMonsters(monst.x + xx, monst.y + yy)
          if (xx === 0 && yy === 0) {
            monst.crowding += neighbs.length - 1 // subtract one for ourselves
            social += neighbs.length - 1
          } else if (xx === 0 || yy === 0) {
            social += neighbs.length
          } else {
            social += neighbs.length / 2 // lesser influence at the corners
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
  }

  protected getScoreFn (monst :MonsterData) :ScoreFn|undefined
  {
    let fns = new Array<ScoreFn>()
    if (monst.hunger > 50) {
      fns.push((x, y) => ("grass" === this.getFeature(x, y)) ? monst.hunger : 0)
    }
    if (monst.lonliness > 50) {
      // TODO: this is counting monsters during moves, so it will count wrong
      fns.push((x, y) => (this.getMonsters(x, y).length > 0) ? monst.lonliness : 0)
    }
    if (monst.boredom > 50) {
      fns.push((x, y) => monst.isInMemory(x, y) ? 0 : monst.boredom)
    }
    if (monst.crowding > 50) {
      fns.push((x, y) => (this.getMonsters(x, y).length > 0) ? 0 : monst.crowding)
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
  protected _monsterData :Map<number, MonsterData> = new Map()
  /** A mutable view of our public monsters RMap. */
  protected _monsters :MutableMap<number, MonsterVisualState>
  protected _monstersByLocation :Map<number, Array<MonsterData>> = new Map()
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

    this.onDispose.add(_ranch.monsters.onChange(this._monsterChange))
    _ranch.monsters.forEach((monster, id) => { this.updateMonster(id, monster) })

    // TODO: change these mouse event handlers
    const theRoot = this._app.root
    theRoot.addEventListener("mousedown", this._onMouseDown)
    this.onDispose.add(() => theRoot.removeEventListener("mousedown", this._onMouseDown))
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

  protected renderToOffset (clock :Clock, surf :Surface) :void
  {
    super.renderToOffset(clock, surf)

    // draw monsters
    for (const monst of this._monsters.values()) {
      if (monst.tile) {
        surf.drawAt(monst.tile, monst.pos)
      }
    }

    // finally, more stuff:
    if (this._menu) this._menu.render(surf)
  }

  protected updateMonster (id :number, state :MonsterVisualState)
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

  protected mouseDown (x :number, y :number) :void
  {
    if (this._menu) {
      // TODO!
      this.onDispose.remove(this._menu.disposer)
      this._menu.disposer.dispose()
      this._menu = undefined
      return
    }

    x = Math.trunc((x - this._offset[0]) / this._model.config.tileWidth)
    y = Math.trunc((y - this._offset[1]) / this._model.config.tileHeight)
    //console.log("mouse: " + x + ", " + y)
    if (x >= 0 && y >= 0 && x < this._model.sceneWidth && y < this._model.sceneHeight) {
      this.tileClicked(x, y)
    }
  }

  protected tileClicked (x :number, y :number) :void
  {
    const monst = this._ranch.getMonsters(x, y)[0]
    if (!monst) return
    this._menu = new MonsterMenu(
        this._app.renderer, monst,
        (x + .5) * this._model.config.tileWidth,
        (y + .5) * this._model.config.tileHeight)
    this.onDispose.add(this._menu.disposer)
  }

  protected readonly _monsterChange = (change :MapChange<number, MonsterVisualState>) => {
    if (change.type === "set") {
      this.updateMonster(change.key, change.value)
    } else {
      this.deleteMonster(change.key)
    }
  }

  protected _menu? :MonsterMenu

  protected readonly _onMouseDown = (event :MouseEvent) => this.mouseDown(event.x, event.y)

  protected readonly _monsters :Map<number, MonsterSprite> = new Map()
}

class MonsterMenu
{
  public readonly disposer :Disposer = new Disposer()

  constructor (
    renderer :Renderer,
    public data :MonsterData,
    centerX :number,
    centerY :number,
  ) {
    const buttonCorner = 5
    const styles :StyleDefs = {
      colors: {
        transWhite: Color.fromARGB(.3, 1, 1, 1),
      },
      shadows: {},
      fonts: {
        base: {family: "Helvetica", size: 16},
      },
      paints: {
        white: {type: "color", color: "#FFFFFF"},
        black: {type: "color", color: "#000000"},
        lightGray: {type: "color", color: "#999999"},
        darkGray: {type: "color", color: "#666666"},
      },
      borders: {
        button: {stroke: {type: "color", color: "#999999"}, cornerRadius: buttonCorner},
        buttonFocused: {stroke: {type: "color", color: "#FFFFFF"}, cornerRadius: buttonCorner},
      },
      backgrounds: {
        buttonNormal: {
          fill: {type: "color", color: "#99CCFF"},
          cornerRadius: buttonCorner,
          shadow: {offsetX: 2, offsetY: 2, blur: 5, color: "#000000"}
        },
        buttonPressed: {fill: {type: "color", color: "#77AADD"}, cornerRadius: buttonCorner},
        buttonDisabled: {fill: {type: "color", color: "$transWhite"}, cornerRadius: buttonCorner},
      },
    }
    const theme :Theme = {
      default: {
        label: {
          font: "$base",
          fill: "$black",
          disabled: {
            fill: "$darkGray",
          },
          selection: {
            fill: "$lightGray",
          }
        },
        box: {},
      },
      button: {
        box: {
          padding: 10,
          border: "$button",
          background: "$buttonNormal",
          disabled: {background: "$buttonDisabled"},
          focused: {border: "$buttonFocused"},
          pressed: {border: "$buttonFocused", background: "$buttonPressed"},
        },
      },
    }
    const rootConfig :RootConfig = {
      type: "root",
      scale: renderer.scale,
      contents: {
        type: "column",
        offPolicy: "stretch",
        gap: 10,
        contents: [{
          type: "button",
          onClick: "button.clicked",
          contents: {
            type: "box",
            contents: {type: "label", text: "button.text"},
          },
        }],
      },
    }

    const model :ModelData = {
      button: {
        text: Mutable.local("Cheese"),
        enabled: Mutable.local(false),
        clicked: () => { console.log("I have clicked")},
      },
    }

    const resolver :ImageResolver = {
      resolve: loadImage,
    }

    const ui = new UI(theme, styles, resolver, new Model(model))
    this._host = new Host2(renderer)
    this.disposer.add(this._host)
    this.disposer.add(this._host.bind(renderer.canvas))

    const root = ui.createRoot(rootConfig)
    root.pack(150, 150)
    this._host.addRoot(root, vec2.fromValues(centerX - 75, centerY - 75))
  }

  public render (surf :Surface)
  {
//    console.log("Rendering a menu!")
    this._host.render(surf)
  }

  protected readonly _host :Host2
}
