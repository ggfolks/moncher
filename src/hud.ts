import {loadImage} from "tfw/core/assets"
import {Mutable, Value} from "tfw/core/react"
import {log, Disposable, Disposer} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {Host, RootConfig} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {moncherStyles, moncherTheme} from "./uistyles"

// TODO: actually, UIs are wholly recreated when something changes, it would seem
export interface Action {
  /** Button text. */
  label? :string
  /** Button paint style, maybe instead of image. */
  image? :string
  /** Called on button press. */
  action :Function
  /** Is the button disabled? */
  disabled? :boolean
//  /** The priority of the button relative to others. */
//  priority? :number
}

type ActionOpt = Action|undefined

export class Hud
  implements Disposable
{
  /** The status label text, or "" to hide it. */
  readonly statusLabel :Mutable<string> = Mutable.local("")

  readonly button1 :Mutable<ActionOpt> = Mutable.local<ActionOpt>(undefined)
  readonly button2 :Mutable<ActionOpt> = Mutable.local<ActionOpt>(undefined)

  constructor (
    host :Host,
    renderer :Renderer,
  ) {
    log.debug("Compiler anal about unused imports")

    // a bunch of helper bits to ease creation of standard buttons
    const getActionVisible = (v :ActionOpt) => (v !== undefined)
    const getActionText = (v :ActionOpt) => v && (v.label !== undefined) ? v.label : ""
    const getActionImage = (v :ActionOpt) => v ? v.image : undefined
    const getActionEnabled = (v :ActionOpt) => v && !v.disabled
    const getLabelVisible = (v :ActionOpt) => v && (v.label !== undefined)
    const getImageVisible = (v :ActionOpt) => v && (v.image !== undefined)
    const makeButtonModel = (v :Value<ActionOpt>) => {
      return {
        visible: v.map(getActionVisible),
        text: v.map(getActionText),
        image: v.map(getActionImage),
        enabled: v.map(getActionEnabled),
        clicked: () => this.buttonClicked(v),
        labelVis: v.map(getLabelVisible),
        imageVis: v.map(getImageVisible),
      }
    }
    const makeButtonConfig = (name :string) => {
      return {
        type: "box",
        contents: {
          type: "button",
          visible: name + ".visible",
          enabled: name + ".enabled",
          onClick: name + ".clicked",
          contents: {
            type: "box",
            contents: {
              type: "row",
              contents: [{
                type: "label",
                visible: name + ".labelVis",
                text: name + ".text",
                style: {
                  font: {size: 128},
                },
              }, {
                type: "image",
                visible: name + ".imageVis",
                image: name + ".image",
                width: 100,
              }],
            },
          },
        },
      }
    }

    const model :ModelData = {
      status: {
        text: this.statusLabel,
        visible: this.statusLabel.map(v => (v !== "")), // visible if label isn't blank
      },
      button1: makeButtonModel(this.button1),
      button2: makeButtonModel(this.button2),
    }

    const rootConfig :RootConfig = {
      type: "root",
      scale: renderer.scale,
      autoSize: true,
      hintSize: renderer.size,
      contents: {
        type: "abslayout",
        contents: [{
          type: "column",
          constraints: {stretchX: true, stretchY: false},
          contents: [{
            type: "row",
            contents: [
              makeButtonConfig("button1"),
              makeButtonConfig("button2"),
            ],
          }, {
            type: "box",
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
    root.bindOrigin(renderer.size, "center", "bottom", "center", "bottom")
    host.addRoot(root)
  }

  // from Disposable
  public dispose () :void {
    this._disposer.dispose()
  }

  protected buttonClicked (action :Value<ActionOpt>) :void {
    const act = action.current
    if (act) act.action()
    else console.log("Button clicked with no action?")
  }

  protected readonly _disposer :Disposer = new Disposer()
}
