import {loadImage} from "tfw/core/assets"
import {Value} from "tfw/core/react"
import {Disposable, Disposer, log} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {ElementConfig, Host, Root, RootConfig} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {moncherStyles, moncherTheme} from "./uistyles"
import {RanchMode} from "./moncher3d"

export const enum UiState {
  Default,
  PlacingEgg,
  PlacingFood,
}

export class Hud
  implements Disposable {

  constructor (
    readonly host :Host,
    readonly renderer :Renderer,
    private readonly _ranchMode :RanchMode,
  ) {
    const resolver :ImageResolver = {
      resolve: loadImage,
    }
    this._ui = new UI(moncherTheme, moncherStyles, resolver)
  }

  /**
   * Update to reflect our current UI state. */
  updateUiState (uiState :UiState) :void {
    if (this._stateRoot) {
      this.host.removeRoot(this._stateRoot)
    }
    this._stateRoot = this.createRoot(uiState)
    if (this._stateRoot) {
      this._stateRoot.bindOrigin(this.renderer.size, "center", "bottom", "center", "bottom")
      this.host.addRoot(this._stateRoot)
    }
  }

  /**
   * Create the root for the specified ui state.
   */
  protected createRoot (uiState :UiState) :Root|undefined {
    let contents :ElementConfig
    const model :ModelData = {}

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
                  type: "label",
                  text: "egg.text",
                  style: {
                    font: {size: 128},
                  },
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
                  width: 128,
                },
              },
            }],
          }, {
            type: "box",
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
          text: Value.constant("🥚"),
          clicked: () => this._ranchMode.setUiState(UiState.PlacingEgg),
        }
        model.food = {
          img: Value.constant("ui/AcornIcon.png"),
          clicked: () => this._ranchMode.setUiState(UiState.PlacingFood),
        }
        model.status = {
          text: Value.constant("Hold SPACE to see the navmesh"),
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
    }

    const rootConfig :RootConfig = {
      type: "root",
      scale: this.renderer.scale,
      autoSize: true,
      hintSize: this.renderer.size,
      contents: contents,
    }
    return this._ui.createRoot(rootConfig, new Model(model))
  }

  // from Disposable
  public dispose () :void {
    if (this._stateRoot) {
      this.host.removeRoot(this._stateRoot)
      this._stateRoot = undefined
    }

    this._disposer.dispose()
  }

  protected _ui :UI
  protected _stateRoot? :Root

  protected readonly _disposer :Disposer = new Disposer()
}
