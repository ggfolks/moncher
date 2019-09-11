import {Disposable, Disposer} from "tfw/core/util"
import {Mutable, Value} from "tfw/core/react"
import {Root} from "tfw/ui/element"
import {Model, mapProvider} from "tfw/ui/model"

import {App} from "./app"
import {ChannelObject, channelQ} from "./data"
import {box, label} from "./ui"

const sausageCorner = 12

const chatUiConfig = {
  type: "box",
  style: {
    valign: "bottom",
    padding: 10,
    // TODO: why does 'margin: 10' cause UI to disappear
  },
  contents: {
    type: "column",
    offPolicy: "stretch",
    gap: 5,
    contents: [{
      type: "list",
      offPolicy: "stretch",
      gap: 5,
      data: "msgdata",
      keys: "msgkeys",
      element: {
        type: "box",
        style: {
          halign: "left",
        },
        contents: {
          type: "box",
          style: {
            halign: "left",
            padding: [5, 10, 3, 10],
            // border: {stroke: {type: "color", color: "#999999"}, cornerRadius: sausageCorner},
            background: {fill: "$orange", cornerRadius: sausageCorner},
          },
          contents: {
            type: "row",
            gap: 5,
            contents: [{
              type: "label",
              text: "speaker",
              style: {
                fill: {type: "color", color: "#333333"}
              }
            }, {
              type: "label",
              text: "text",
              style: {
                fill: {type: "color", color: "#FFFFFF"}
              }
            }]
          }
        }
      }
    }, {
      type: "row",
      gap: 5,
      contents: [label(Value.constant("➤"), {fill: "$orange", font: "$icon"}), {
        type: "text",
        constraints: {stretch: true},
        text: "input",
        onEnter: "sendChat",
        contents: box(label("input", {fill: "$white"}), {
          padding: [5, 10, 3, 10],
          border: undefined,
          background: {fill: "$orange", cornerRadius: sausageCorner},
          halign: "left"
        })
      }, {
        type: "button",
        // visible: Value.constant(false),
        onClick: "sendChat",
        contents: label(Value.constant("+"), {fill: "$orange", font: "$icon"})
      }]
    }]
  }
}

export class ChatView implements Disposable {
  private _onDispose = new Disposer()
  readonly root :Root
  readonly model :Model

  constructor (readonly app :App) {
    // TODO: ranchId should not be a value, it's not going to change
    const channelId = app.state.ranchId.current
    const [channel, unchannel] = app.client.resolve(["channels", channelId], ChannelObject)
    this._onDispose.add(unchannel)

    channel.msgs.onChange(foo => console.log(foo))

    const modelData = {
      msgdata: mapProvider(channel.msgs, msg => ({
        text: msg.map(m => m.text),
        speaker: msg.switchMap(m => app.profiles.profile(m.sender).name)
      })),
      // TODO: sort these by timestamp?
      msgkeys: channel.msgs.map(msgs => Array.from(msgs.keys())),
      input: Mutable.local(""),
      sendChat: () => {
        const text = modelData.input.current.trim()
        if (text.length > 0) {
          channel.source.post(channelQ(channelId), {type: "speak", text})
          modelData.input.update("")
        }
      }
    }
    this.model = new Model(modelData)

    this.root = app.ui.createRoot({
      type: "root",
      scale: app.renderer.scale,
      autoSize: true,
      hintSize: app.renderer.size,
      contents: chatUiConfig,
    }, this.model)
  }

  dispose () {
    this._onDispose.dispose()
  }
}
