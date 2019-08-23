import {loadImage} from "tfw/core/assets"
import {vec2zero} from "tfw/core/math"
import {Mutable, Value} from "tfw/core/react"
import {log, Disposable, Disposer} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {Host, RootConfig} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {moncherStyles, moncherTheme} from "./uistyles"

export class Hud
  implements Disposable
{
  /** The status label text, or "" to hide it. */
  readonly statusLabel :Mutable<string> = Mutable.local("")
  /** Action button text. */
  readonly actionButton :Mutable<string> = Mutable.local("")
  /** Action button action, or undefined to hide it. */
  readonly action :Mutable<Function|undefined> = Mutable.local<Function|undefined>(undefined)

  constructor (
    host :Host,
    renderer :Renderer,
  ) {
    log.debug("Compiler anal about unused imports")

    const model :ModelData = {
      status: {
        text: this.statusLabel,
        visible: this.statusLabel.map(v => (v !== "")), // visible if label isn't blank
      },
      button: {
        text: this.actionButton,
        visible: this.action.map(v => (v !== undefined)),
        clicked: () => this.actionClicked(),
      },
      blank: {
        text: Value.constant(""),
      }
    }

    const rootConfig :RootConfig = {
      type: "root",
      scale: renderer.scale,
      contents: {
        type: "abslayout",
        contents: [{
          type: "column",
          constraints: {stretchX: true, stretchY: true},
          contents: [{
            type: "label",
            text: "blank.text",
            constraints: {stretch: true},
          }, {
            type: "button",
            constraints: {stretch: false},
            visible: "button.visible",
            onClick: "button.clicked",
            contents: {
              type: "box",
              contents: {
                type: "label",
                text: "button.text",
                style: {
                  font: {size: 64}, // le big egg
                },
              },
            },
          }, {
            type: "box",
            constraints: {stretch: false},
            visible: "status.visible",
            contents: {
              type: "label",
              text: "status.text",
            },
            style: {
              padding: 10,
              background: {fill: {type: "color", color: "$transWhite"}},
            },
          }],
        }],
      },
    }
    const resolver :ImageResolver = {
      resolve: loadImage,
    }
    const ui = new UI(moncherTheme, moncherStyles, resolver)

    const root = ui.createRoot(rootConfig, new Model(model))
    this._disposer.add(renderer.size.onValue(sz => { root.pack(sz[0], sz[1]) }))
    host.addRoot(root, vec2zero)
  }

  // from Disposable
  public dispose () :void {
    this._disposer.dispose()
  }

  protected actionClicked () :void {
    const fn = this.action.current
    if (fn) fn()
    else console.log("No action but action clicked")
  }

  protected readonly _disposer :Disposer = new Disposer()
}
