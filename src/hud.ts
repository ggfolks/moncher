import {loadImage} from "tfw/core/assets"
import {vec2zero} from "tfw/core/math"
import {Mutable} from "tfw/core/react"
import {/*log,*/ Disposer} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {Host, RootConfig} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {moncherStyles, moncherTheme} from "./uistyles"

export class Hud
{
  readonly disposer :Disposer = new Disposer()

  readonly statusLabel :Mutable<string> = Mutable.local("") //Choose a location to drop your egg")

  readonly actionButton :Mutable<string> = Mutable.local("🥚") // egg

  constructor (
    host :Host,
    renderer :Renderer,
  ) {

    const model :ModelData = {
      status: {
        text: this.statusLabel,
        visible: this.statusLabel.map(v => (v !== "")), // visible if label isn't blank
      },
      button: {
        text: this.actionButton,
        clicked: () => { console.log("TODO") },
      },
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
            type: "button",
            onClick: "button.clicked",
            contents: {
              type: "box",
              contents: {type: "label", text: "button.text"},
            },
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
    this.disposer.add(renderer.size.onValue(sz => { root.pack(sz[0], sz[1]) }))
    host.addRoot(root, vec2zero)
  }
}
