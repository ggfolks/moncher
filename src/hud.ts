import {Value} from "tfw/core/react"
import {Disposable, Disposer, log} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {ElementConfig, Host, Root, RootConfig} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {RanchMode} from "./moncher"
import {App} from "./app"

export const enum UiState {
  Default = 1,
  PlacingEgg,
  PlacingFood,
  Debug,
}

export class Hud
  implements Disposable {
  screenWidth :Value<number>

  constructor (
    readonly app :App,
    readonly host :Host,
    readonly renderer :Renderer,
    private readonly _ranchMode :RanchMode,
  ) {
    this.screenWidth = app.renderer.size.map(sz => sz[0])
  }

  /**
   * Update to reflect our current UI state. */
  updateUiState (uiState :UiState) :void {
    if (this._stateRoot) {
      this.host.removeRoot(this._stateRoot)
    }
    const root = this._stateRoot = this.createRoot(uiState)
    if (root) {
      const pos = (this.screenWidth.current >= 600) ? "bottom" : "top"
      root.bindOrigin(this.renderer.size, "right", pos, "right", pos)
      this.host.addRoot(root)
    }
  }

  /**
   * Create the root for the specified ui state. */
  protected createRoot (uiState :UiState) :Root|undefined {
    let contents :ElementConfig
    const model :ModelData = {}
    const BUTTON_WIDTH = 64
    const showTip = this.screenWidth.map(w => w >= 600)

    switch (uiState) {
    default:
      log.warn("Unknown uiState " + uiState)
      return undefined

    case UiState.Default:
      contents = {
        type: "column",
        constraints: {stretchX: true, stretchY: false},
        contents: [{
          type: "row",
          contents: [{
            type: "button",
            onClick: "egg.clicked",
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
      model.egg = {
        img: Value.constant("ui/EggButton.png"),
        clicked: () => this._ranchMode.setUiState(UiState.PlacingEgg),
      }
      model.food = {
        img: Value.constant("ui/AcornButton.png"),
        clicked: () => this._ranchMode.setUiState(UiState.PlacingFood),
      }
      model.status = {
        text: Value.constant("Hold F1 to see the navmesh"),
      }
      break // end: Default

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
        text: Value.constant((uiState == UiState.PlacingEgg)
            ? "Cancel egg placement"
            : "Cancel food drop"),
        clicked: () => this._ranchMode.setUiState(UiState.Default),
      }
      break // end: PlacingEgg & PlacingFood

    case UiState.Debug:
      contents = {
        type: "column",
        constraints: {stretchX: true, stretchY: false},
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
          onClick: "cancel.clicked",
          contents: {
            type: "box",
            contents: {
              type: "label",
              text: "cancel.text",
            }
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
      break // end: Debug
    }

    const rootConfig :RootConfig = {
      type: "root",
      scale: this.renderer.scale,
      autoSize: true,
      hintSize: this.renderer.size,
      contents: contents,
      visible: "notGuest",
    }
    model.notGuest = this.app.client.auth.map(sess => sess.source !== "guest")
    return this.app.ui.createRoot(rootConfig, new Model(model))
  }

  // from Disposable
  public dispose () :void {
    if (this._stateRoot) {
      this.host.removeRoot(this._stateRoot)
      this._stateRoot = undefined
    }

    this._disposer.dispose()
  }

  protected _stateRoot? :Root

  protected readonly _disposer :Disposer = new Disposer()
}
