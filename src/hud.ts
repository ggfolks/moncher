import {Mutable, Value} from "tfw/core/react"
import {Disposable, Disposer, log} from "tfw/core/util"
import {Element, Root} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {label, checkBox} from "./ui"
import {RanchMode} from "./ranchmode"
import {App} from "./app"

export const enum UiState {
  Default = 1,
  Petting,
  PlacingEgg,
  PlacingFood,
  Debug,
}

export class Hud
  implements Disposable {
  screenWidth :Value<number>

  constructor (readonly app :App, private readonly _ranchMode :RanchMode) {
    this.screenWidth = app.rootSize.map(sz => sz[0])

    let tip = 0
    const handle = setInterval(() => {
      tip = (tip + 1) % this._tips.length
      this._tip.update(this._tips[tip])
    }, 5000)
    this._disposer.add(() => {clearInterval(handle)})
  }

  /**
   * Update to reflect our current UI state. */
  updateUiState (uiState :UiState) :void {
    if (this._stateRoot) {
      this.app.host.removeRoot(this._stateRoot)
    }
    const root = this._stateRoot = this.createRoot(uiState)
    if (root) {
      const pos = (this.screenWidth.current >= 600) ? "bottom" : "top"
      root.bindOrigin(this.app.rootBounds, "right", pos, "right", pos)
      this.app.host.addRoot(root)
    }
  }

  /**
   * Create the root for the specified ui state. */
  protected createRoot (uiState :UiState) :Root|undefined {
    let contents :Element.Config
    const model :ModelData = {}
    const BUTTON_WIDTH = 64
    const notGuest = Value.join2(this.app.notGuest, this._ranchMode.debugMode).map(
      ([ng, debug]) => ng || debug)
    const showTip = Value.join2(this.screenWidth, notGuest).map(([w, ng]) => (w >= 600) && ng)

    switch (uiState) {
    default:
      log.warn("Unknown uiState " + uiState)
      return undefined

    case UiState.Default:
      contents = {
        type: "column",
        offPolicy: "stretch",
        constraints: {stretchX: true, stretchY: false},
        contents: [{
          type: "row",
          contents: [{
            type: "spacer",
            constraints: {stretch: true},
          }, {
            type: "button",
            onClick: "hand.clicked",
            visible: "notGuest",
            contents: {
              type: "box",
              contents: {
                type: "image",
                image: "hand.img",
                width: BUTTON_WIDTH,
              },
              style: {
                background: null,
                border: null,
              },
            },
          }, {
            type: "button",
            onClick: "egg.clicked",
            visible: "notGuest",
            contents: {
              type: "box",
              contents: {
                type: "image",
                image: "egg.img",
                width: BUTTON_WIDTH,
              },
              style: {
                background: null,
                border: null,
              },
            },
          }, {
            type: "button",
            onClick: "food.clicked",
            visible: "notGuest",
            contents: {
              type: "box",
              contents: {
                type: "image",
                image: "food.img",
                width: BUTTON_WIDTH,
              },
              style: {
                background: null,
                border: null,
              },
            },
          }],
        }, {
          type: "box",
          visible: showTip,
          contents: {
            type: "label",
            text: "status.text",
          },
          style: {
            padding: 10,
            background: {fill: {type: "color", color: "$transWhite"}},
          },
        }],
      }
      model.hand = {
        img: Value.constant("ui/HandButton.png"),
        clicked: () => this._ranchMode.setUiState(UiState.Petting),
      }
      model.egg = {
        img: Value.constant("ui/EggButton.png"),
        clicked: () => this._ranchMode.setUiState(UiState.PlacingEgg),
      }
      model.food = {
        img: Value.constant("ui/AcornButton.png"),
        clicked: () => this._ranchMode.setUiState(UiState.PlacingFood),
      }
      model.status = {
        text: this._tip,
      }
      break // end: Default

    case UiState.Petting:
    case UiState.PlacingEgg:
    case UiState.PlacingFood:
      contents = {
        type: "button",
        onClick: "cancel.clicked",
        contents: {
          type: "box",
          contents: {
            type: "label",
            text: "cancel.text",
          },
        },
      }
      model.cancel = {
        text: Value.constant((uiState === UiState.PlacingEgg)
            ? "Cancel egg placement"
            : (uiState === UiState.PlacingFood) ? "Cancel food drop" : "Cancel touch"),
        clicked: () => this._ranchMode.setUiState(UiState.Default),
      }
      break // end: PlacingEgg & PlacingFood

    case UiState.Debug:
      contents = {
        type: "column",
        offPolicy: "stretch",
        constraints: {stretchX: true, stretchY: false},
        gap: 5,
        contents: [{
          type: "button",
          onClick: "reset.clicked",
          contents: {
            type: "box",
            contents: {
              type: "label",
              text: "reset.text",
            },
          },
        }, {
          type: "button",
          onClick: "next.clicked",
          contents: {
            type: "box",
            contents: {
              type: "label",
              text: "next.text",
            },
          },
        }, {
          type: "button",
          onClick: "nextMine.clicked",
          contents: {
            type: "box",
            contents: {
              type: "label",
              text: "nextMine.text",
            },
          },
        }, {
          type: "row",
          gap: 5,
          contents: [label("debug.text"), checkBox("debug.active", "debug.toggle")],
        }, {
          type: "button",
          onClick: "cancel.clicked",
          contents: {
            type: "box",
            contents: {
              type: "label",
              text: "cancel.text",
            },
          },
        }],
      }
      model.reset = {
        text: Value.constant("Reset Ranch"),
        clicked: () => this._ranchMode.resetRanch(),
      }
      model.cancel = {
        text: Value.constant("Exit Debug Menu"),
        clicked: () => this._ranchMode.setUiState(UiState.Default),
      }
      model.next = {
        text: Value.constant("Next actor"),
        clicked: () => this._ranchMode.targetNextActor(false),
      }
      model.nextMine = {
        text: Value.constant("Next actor (mine)"),
        clicked: () => this._ranchMode.targetNextActor(true),
      }
      model.debug = {
        text: Value.constant("Debug"),
        active: this._ranchMode.debugMode,
        toggle: () => this._ranchMode.setDebug(!this._ranchMode.debugMode.current),
      }
      break // end: Debug
    }

    const rootConfig :Root.Config = {
      type: "root",
      scale: this.app.scale,
      autoSize: true,
      hintSize: this.app.rootSize,
      contents: contents,
    }
    model.notGuest = notGuest
    return this.app.ui.createRoot(rootConfig, new Model(model))
  }

  // from Disposable
  public dispose () :void {
    if (this._stateRoot) {
      this.app.host.removeRoot(this._stateRoot)
      this._stateRoot = undefined
    }

    this._disposer.dispose()
  }

  protected _stateRoot? :Root

  protected readonly _disposer :Disposer = new Disposer()

  protected readonly _tips :string[] = [
    "Hold F1 to see the navmesh",
    "Press F2 for next owned actor",
    "Press F3 for next actor",
    "Press F4 (or 5-finger tap) for debug menu",
  ]

  protected readonly _tip :Mutable<string> = Mutable.local(this._tips[0])
}
