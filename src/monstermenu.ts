import {loadImage} from "tfw/core/assets"
import {Color} from "tfw/core/color"
import {vec2} from "tfw/core/math"
import {Mutable, Value} from "tfw/core/react"
import {/*log,*/ Disposer} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {ElementConfig, RootConfig} from "tfw/ui/element"
import {Host2} from "tfw/ui/host2"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver, StyleDefs} from "tfw/ui/style"
import {Theme, UI} from "tfw/ui/ui"
import {MonsterConfig, MonsterState} from "./moncher"

export class MonsterMenu
{
  public readonly disposer :Disposer = new Disposer()

  constructor (
    renderer :Renderer,
    config :MonsterConfig,
    public state :Value<MonsterState|undefined>,
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

    let canRangeAttack :Value<boolean> = state.map(
        state => (state !== undefined) && config.kind.canRangeAttack && (state.actionPts > 10))
    let canHeal :Value<boolean> = state.map(
        state => (state !== undefined) && config.kind.canHeal && (state.actionPts > 10))
    let invertBoolean = (v :boolean) => !v
    let attackText :Value<string> = state.map(
        state => (state === undefined) ? "undefined" : `Attack! ${state.actionPts}`)

    // TEMP: Watch attackText so we can see it changing
    this.disposer.add(attackText.onValue(v => console.log(v)))

    const model :ModelData = {
      attack: {
        text: attackText,
        visible: canRangeAttack,
        enabled: Mutable.local(true),
        clicked: () => { console.log("I have clicked attack")},
      },
      attackShim: {
        visible: canRangeAttack.map(invertBoolean),
      },
      heal: {
        text: Mutable.local("Heal!"),
        visible: canHeal,
        enabled: Mutable.local(true),
        clicked: () => { console.log("I have clicked heal")},
      },
      healShim: {
        visible: canHeal.map(invertBoolean),
      },
      close: {
        text: Value.constant("X"),
        clicked: () => { console.log("CLOSE!") },
      },
      shim: {
        text: Value.constant(""),
      }
    }

    const shim :ElementConfig = {
      type: "label",
      text: "shim.text"
    }

    const elements = new Array<ElementConfig>()
    // Attack button
    elements.push({
      type: "button",
      visible: "attack.visible",
      enabled: "attack.enabled",
      onClick: "attack.clicked",
      contents: {
        type: "box",
        contents: {type: "label", text: "attack.text"},
      },
    })
    // Attack Shim
    elements.push({...shim, visible: "attackShim.visible"})

    // Heal button
    elements.push({
      type: "button",
      visible: "heal.visible",
      enabled: "heal.enabled",
      onClick: "heal.clicked",
      contents: {
        type: "box",
        contents: {type: "label", text: "heal.text"},
      },
    })
    // Heal Shim
    elements.push({...shim, visible: "healShim.visible"})

    // add an X button to close it out
    elements.push({
      type: "button",
      onClick: "close.clicked",
      contents: {
        type: "box",
        contents: {type: "label", text: "close.text"},
      },
    })

    const rootConfig :RootConfig = {
      type: "root",
      scale: renderer.scale,
      contents: {
        type: "column",
        offPolicy: "stretch",
        gap: 10,
        contents: elements,
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
    root.pack(MonsterMenu.RADIAL_SIZE, MonsterMenu.RADIAL_SIZE)
    this._host.addRoot(root, vec2.fromValues(
        Math.max(0, centerX - (MonsterMenu.RADIAL_SIZE / 2)),
        Math.max(0, centerY - (MonsterMenu.RADIAL_SIZE / 2))))
  }

  public render (surf :Surface)
  {
//    console.log("Rendering a menu!")
    this._host.render(surf)
  }

  protected static readonly RADIAL_SIZE = 130

  protected readonly _host :Host2
}
