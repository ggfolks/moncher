import {dim2} from "tfw/core/math"
import {Disposable, Disposer} from "tfw/core/util"
import {Mutable, Value} from "tfw/core/react"
import {Model, mapModel} from "tfw/ui/model"
import {Root} from "tfw/ui/element"

import {App} from "./app"
import {Message} from "./data"
import {box, label} from "./ui"
import {showAuthDialog} from "./auth"

//import {log} from "tfw/core/util"

const sausageCorner = 12

// TODO: figure out exactly where Safari is differing from Chrome/Firefox in text metrics and
// account for that somewhere at a lower level... yay
const safariTextPadding :[number, number, number, number] = [3, 10, 5, 10]
const otherTextPadding :[number, number, number, number] = [5, 10, 3, 10]
const userAgent = navigator ? navigator.userAgent : ""
const isSafari = userAgent.includes("Safari/")
const textPadding = isSafari ? safariTextPadding : otherTextPadding

const chatUiConfig = {
  type: "box",
  style: {
    halign: "stretch",
    valign: "bottom",
    margin: 10,
  },
  contents: {
    type: "column",
    offPolicy: "stretch",
    gap: 5,
    contents: [{
      type: "vlist",
      offPolicy: "stretch",
      gap: 5,
      model: "msgmodel",
      element: {
        type: "box",
        style: {
          halign: "left",
        },
        contents: {
          type: "row",
          gap: 5,
          contents: [
          // TODO: tooltip with name?
          //{type: "label", text: "speaker", style: {fill: {type: "color", color: "#663333"}}},
          {
            type: "image",
            image: "photo",
            //width: 20, // reserving the width avoids a small bit of relayout, but the photo
            // still "flashes" when it loads-in.
            height: 20,
          }, {
            type: "box",
            style: {
              halign: "left",
              padding: textPadding,
              // border: {stroke: {type: "color", color: "#999999"}, cornerRadius: sausageCorner},
              background: {fill: "$orange", cornerRadius: sausageCorner},
            },
            contents: {
              type: "label",
              text: "text",
              style: {
                fill: {type: "color", color: "#FFFFFF"}
              }
            }
          }]
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
        visible: "showChatInput",
        text: "input",
        onEnter: "sendChat",
        contents: box(label("input", {fill: "$white"}), {
          padding: textPadding,
          border: undefined,
          background: {fill: "$orange", cornerRadius: sausageCorner},
          halign: "left"
        })
      }, {
        type: "button",
        visible: "showChatInput",
        onClick: "sendChat",
        contents: label(Value.constant("+"), {fill: "$orange", font: "$icon"})
      }]
    }]
  }
}

function tail<A> (elems :A[], count :number) :A[] {
  return (elems.length <= count) ? elems : elems.slice(elems.length-count, elems.length)
}

function latestMsgs (msgs :ReadonlyMap<string, Message>, count :number) {
  const entries = Array.from(msgs.entries())
  entries.sort((e1, e2) => e1[1].sent.millis - e2[1].sent.millis)
  return tail(entries.map(e => e[0]), count)
}

export class ChatView implements Disposable {
  private _onDispose = new Disposer()

  constructor (readonly app :App, mini? :boolean) {
    const channelId = app.state.ranchId
    const [channel, msgs, remover] = app.chatdir.getChannel(channelId)
    this._onDispose.add(remover)

    const modelData = {
      msgmodel: mapModel(msgs.map(msgs => latestMsgs(msgs, mini ? 3 : 6)), msgs, msg => ({
        text: msg.map(m => m.text),
        speaker: msg.switchMap(m => app.profiles.profile(m.sender).name),
        photo: msg.switchMap(m => app.profiles.profile(m.sender).photo),
      })),
      input: Mutable.local(""),
      sendChat: () => {
        const text = modelData.input.current.trim()
        if (text.length > 0) {
          channel.channelq.post({type: "speak", text})
          modelData.input.update("")
        }
      },
      showChatInput: app.notGuest,
      profilePhoto: app.client.auth.switchMap(sess => app.profiles.profile(sess.id).photo),
      showAuth: () => showAuthDialog(app),
    }

    let uiConfig = chatUiConfig
    if (mini) {
      uiConfig = Object.assign({}, uiConfig)
      uiConfig.contents = Object.assign({}, uiConfig.contents)
      // just cut out the row with the chat entry widget
      uiConfig.contents.contents = uiConfig.contents.contents.slice(0, 1)
    }

    const root = app.ui.createRoot({
      type: "root",
      scale: app.scale,
      autoSize: true,
      hintSize: app.rootSize.map(d => dim2.fromValues(Math.min(d[0], 700), d[1])),
      minSize: Value.constant(dim2.fromValues(300, 0)),
      contents: uiConfig,
    }, new Model(modelData))

    const bindTopBot = mini ? "top" : "bottom"
    root.bindOrigin("left", bindTopBot, Root.rectAnchor(app.rootBounds, "left", bindTopBot))
    app.host.addRoot(root)
    this._onDispose.add(() => app.host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}
