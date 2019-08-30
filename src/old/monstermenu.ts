import {loadImage} from "tfw/core/assets"
import {Clock} from "tfw/core/clock"
import {dim2, vec2} from "tfw/core/math"
import {Mutable, Value} from "tfw/core/react"
import {/*log,*/ Disposer} from "tfw/core/util"
import {Renderer} from "tfw/scene2/gl"
import {Surface} from "tfw/scene2/surface"
import {ElementConfig, RootConfig} from "tfw/ui/element"
import {Host2} from "tfw/ui/host2"
import {Model, ModelData} from "tfw/ui/model"
import {ImageResolver} from "tfw/ui/style"
import {UI} from "tfw/ui/ui"
import {ActorConfig, ActorState} from "../moncher"
import {moncherStyles, moncherTheme} from "../uistyles"

export class MonsterMenu
{
  readonly disposer :Disposer = new Disposer()

  constructor (
    renderer :Renderer,
    config :ActorConfig,
    public state :Value<ActorState|undefined>,
    centerX :number,
    centerY :number,
  ) {
    let canRangeAttack :Value<boolean> = state.map(
        state => (state !== undefined) && config.kind.canRangeAttack && (state.actionPts > 10))
    let canHeal :Value<boolean> = state.map(
        state => (state !== undefined) && config.kind.canHeal && (state.actionPts > 10))
    let invertBoolean = (v :boolean) => !v

    const model :ModelData = {
      attack: {
        text: Value.constant("Attack"),
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

    const elements :ElementConfig[] = []
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

    const ui = new UI(moncherTheme, moncherStyles, resolver)
    this._host = new Host2(renderer)
    this.disposer.add(this._host)
    this.disposer.add(this._host.bind(renderer.canvas))

    const root = ui.createRoot(rootConfig, new Model(model))
    root.setSize(dim2.fromValues(MonsterMenu.RADIAL_SIZE, MonsterMenu.RADIAL_SIZE))
    vec2.set(root.origin,
             Math.max(0, centerX - (MonsterMenu.RADIAL_SIZE / 2)),
             Math.max(0, centerY - (MonsterMenu.RADIAL_SIZE / 2)))
    this._host.addRoot(root)
  }

  render (clock :Clock, surf :Surface)
  {
    this._host.update(clock)
//    console.log("Rendering a menu!")
    this._host.render(surf)
  }

  protected static readonly RADIAL_SIZE = 130

  protected readonly _host :Host2
}
