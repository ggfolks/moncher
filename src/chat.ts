import {dim2} from "tfw/core/math"
import {Disposable, Disposer} from "tfw/core/util"
import {Mutable, Value} from "tfw/core/react"
import {Host} from "tfw/ui/element"
import {Model, mapProvider} from "tfw/ui/model"

import {App} from "./app"
import {ChannelObject} from "./data"
import {box, label} from "./ui"
import {AuthDialog} from "./auth"

const sausageCorner = 12

const chatUiConfig = {
  type: "box",
  style: {
    halign: "stretch",
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
                fill: {type: "color", color: "#663333"}
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
      contents: [{
        type: "button",
        onClick: "showAuth",
        contents: {
          type: "image",
          image: "profilePhoto",
          height: 20,
        }
      }, {
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

function tail<A> (elems :A[], count :number) :A[] {
  return (elems.length <= count) ? elems : elems.slice(elems.length-count, elems.length)
}

export class ChatView implements Disposable {
  private _onDispose = new Disposer()

  constructor (readonly app :App, host :Host) {
    // TODO: ranchId should not be a value, it's not going to change
    const channelId = app.state.ranchId.current
    const [channel, unchannel] = app.client.resolve(["channels", channelId], ChannelObject)
    this._onDispose.add(unchannel)
    const [msgs, unmsgs] = app.client.resolveView(channel.msgsBySent)
    this._onDispose.add(unmsgs)

    const modelData = {
      msgdata: mapProvider(msgs, msg => ({
        text: msg.map(m => m.text),
        speaker: msg.switchMap(m => app.profiles.profile(m.sender).name)
      })),
      // TODO: sort these by timestamp?
      msgkeys: msgs.map(msgs => tail(Array.from(msgs.keys()), 6)),
      input: Mutable.local(""),
      sendChat: () => {
        const text = modelData.input.current.trim()
        if (text.length > 0) {
          channel.channelq.post({type: "speak", text})
          modelData.input.update("")
        }
      },
      profilePhoto: app.client.auth.switchMap(sess => app.profiles.profile(sess.id).photo),
      showAuth: () => new AuthDialog(app, host),
    }

    const root = app.ui.createRoot({
      type: "root",
      scale: app.renderer.scale,
      autoSize: true,
      hintSize: app.renderer.size.map(d => dim2.fromValues(Math.min(d[0], 700), d[1])),
      minSize: Value.constant(dim2.fromValues(300, 0)),
      contents: chatUiConfig,
    }, new Model(modelData))

    root.bindOrigin(app.renderer.size, "left", "bottom", "left", "bottom")
    host.addRoot(root)
    this._onDispose.add(() => host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}
