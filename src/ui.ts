import {Disposable, Disposer, Remover} from "tfw/core/util"
import {Mutable, Value} from "tfw/core/react"
import {Action, Spec} from "tfw/ui/model"
import {LabelStyle} from "tfw/ui/text"
import {BoxStyle} from "tfw/ui/box"
import {ElementConfig, Host} from "tfw/ui/element"
import {Model, ModelData} from "tfw/ui/model"

import {App} from "./app"

function mergeExtra<T extends Object> (config :T, extra? :Object) :T {
  // TODO: deal with all the inevitable edge cases
  if (extra) {
    for (const key in extra) {
      const value = extra[key];
      if (typeof value === "object") config[key] = mergeExtra(config[key] || {}, value)
      else config[key] = value
    }
  }
  return config
}

export function label (text :Spec<Value<string>>, style? :LabelStyle, extra? :Object) {
  return mergeExtra({type: "label", text, style}, extra)
}

export function box (contents :Object, style? :BoxStyle) {
  return {type: "box", contents, style}
}

export function textBox (text :Spec<Mutable<string>>, onEnter :Spec<Action>, extra? :Object) {
  const config = {type: "text", text, onEnter, contents: box(label(text), {halign: "left"})}
  return mergeExtra(config, extra)
}

export function button (text :Spec<Value<string>>, onClick :Spec<Action>,
                        style? :LabelStyle, extra? :Object) {
  return mergeExtra({type: "button", onClick, contents: box(label(text, style))}, extra)
}

const closeX = Value.constant("×")

export function closeButton (onClick :Spec<Action>, extra? :Object) {
  return mergeExtra({type: "button", onClick, contents: box(label(closeX), {
    padding: [4, 8, 4, 8],
  })}, extra)
}

const Check = "✔︎"
const checkCircle = box({type: "label", text: Value.constant(Check)},
                        {border: "$checkBox", padding: [3, 5, 0, 5]})
const emptyCircle = box({type: "label", text: Value.constant(" ")},
                        {border: "$checkBox", padding: [3, 8, 0, 7]})

export function checkBox (checked :Spec<Value<boolean>>, onClick :Spec<Action>) {
  return {type: "toggle", checked, onClick, contents: emptyCircle, checkedContents: checkCircle}
}

const sausageCorner = 12

export function createDialog (app :App, host :Host, title :string, contents :ElementConfig[],
                              data :ModelData) :Remover {
  const config = box({
    type: "column",
    offPolicy: "stretch",
    gap: 10,
    contents: [{
      type: "row",
      gap: 10,
      contents: [
        label(Value.constant(title), {font: "$header"}, {constraints: {stretch: true}}),
        closeButton("closeDialog")
      ]
    }, ...contents]
  }, {
    padding: 10,
    background: {fill: "$orange", cornerRadius: sausageCorner},
  })

  const disposer = new Disposer()
  const closeDialog = () => disposer.dispose()

  const root = app.ui.createRoot({
    type: "root",
    scale: app.renderer.scale,
    autoSize: true,
    hintSize: app.renderer.size,
    // TODO: allow subclass to specify?
    // minSize: Value.constant(dim2.fromValues(300, 0)),
    contents: config,
  }, new Model({...data, closeDialog}))
  disposer.add(() => host.removeRoot(root))
  root.bindOrigin(app.renderer.size, "center", "center", "center", "center")
  host.addRoot(root)

  return closeDialog
}

const installAppUI = {
  type: "box",
  style: {
    padding: 5,
    // TODO: why does 'margin: 5' cause UI to be weirdly smaller?
  },
  contents: {
    type: "button",
    onClick: "openAppPage",
    contents: {
      type: "box",
      contents: {
        type: "row",
        contents: [{
          type: "image",
          width: 40,
          height: 40,
          image: Value.constant("ui/app@2x.png"),
        }, {
          type: "column",
          contents: [
            label(Value.constant("Get the")),
            label(Value.constant("chat app!")),
          ]
        }]
      }
    },
  },
}

// from https://stackoverflow.com/questions/21741841
function getMobileOperatingSystem () {
  const userAgent = navigator.userAgent
  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) return "windows_phone"
  if (/android/i.test(userAgent)) return "android"
  // iOS detection from: https://stackoverflow.com/a/9039885/177710
  if (/iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream) return "ios"
  return "unknown"
}

function getAppURL () {
  switch (getMobileOperatingSystem()) {
  case "android": return "https://play.google.com/apps/testing/dev.tfw.chatapp"
  case "ios": return "https://tfw.dev/app.html" // TODO: real URL when we have one
  default: return "https://tfw.dev/app.html"
  }
}

export class InstallAppView implements Disposable {
  private _onDispose = new Disposer()

  constructor (readonly app :App, host :Host) {
    const modelData = {
      openAppPage: () => window.open(getAppURL())
    }

    const root = app.ui.createRoot({
      type: "root",
      scale: app.renderer.scale,
      autoSize: true,
      contents: installAppUI,
      visible: app.notGuest,
    }, new Model(modelData))

    root.bindOrigin(app.renderer.size, "left", "top", "left", "top")
    host.addRoot(root)
    this._onDispose.add(() => host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}
