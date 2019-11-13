import {Disposable, Disposer, Remover, NoopRemover} from "tfw/core/util"
import {dim2} from "tfw/core/math"
import {UUID} from "tfw/core/uuid"
import {Mutable, Value} from "tfw/core/react"
import {Action, Spec} from "tfw/ui/model"
import {LabelStyle} from "tfw/ui/text"
import {BoxStyle} from "tfw/ui/box"
import {Insets} from "tfw/ui/style"
import {Element} from "tfw/ui/element"
import {Model, ModelData, makeModel} from "tfw/ui/model"

import {RanchObject, ranchQ} from "./data"
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

export function column (gap :number, ...contents :Element.Config[]) {
  return {type: "column", gap, contents}
}
export function stretchColumn (gap :number, ...contents :Element.Config[]) {
  return {type: "column", offPolicy: "stretch", gap, contents}
}

export function row (gap :number, ...contents :Element.Config[]) {
  return {type: "row", gap, contents}
}
export function stretchRow (gap :number, ...contents :Element.Config[]) {
  return {type: "row", offPolicy: "stretch", gap, contents}
}

export function hshim (width :number) {
  return {type: "spacer", width, constraints: {stretch: true}}
}
export function vshim (height :number) {
  return {type: "spacer", height, constraints: {stretch: true}}
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

type Pos = "top" | "left" | "right" | "bottom" | "center"

export function createDialog (app :App, title :string, contents :Element.Config[],
                              data :ModelData, pos :Pos = "center") :Remover {
  const margin :Insets = [0, 0, 0, 0]
  switch (pos) {
  case "top": margin[0] = 20 ; break
  case "left": margin[3] = 20 ; break
  case "right": margin[1] = 20 ; break
  case "bottom": margin[2] = 20 ; break
  }

  const headerL = label(Value.constant(title), {font: "$header"}, {constraints: {stretch: true}})
  const closeB = closeButton("closeDialog")
  const config = box(stretchColumn(10, row(10, headerL, closeB), ...contents), {
    padding: 10,
    margin,
    halign: "stretch",
    valign: "stretch",
    background: {fill: "$orange", cornerRadius: sausageCorner},
  })

  const disposer = new Disposer()
  const closeDialog = () => disposer.dispose()

  const root = app.ui.createRoot({
    type: "root",
    scale: app.scale,
    autoSize: true,
    hintSize: app.rootSize,
    // TODO: allow subclass to specify?
    minSize: Value.constant(dim2.fromValues(300, 0)),
    contents: config,
  }, new Model({...data, closeDialog}))
  disposer.add(() => app.host.removeRoot(root))

  switch (pos) {
  case    "top": root.bindOrigin(app.rootBounds, "center", "top", "center", "top") ; break
  case   "left": root.bindOrigin(app.rootBounds, "left", "center", "left", "center") ; break
  case "bottom": root.bindOrigin(app.rootBounds, "center", "bottom", "center", "bottom") ; break
  case  "right": root.bindOrigin(app.rootBounds, "right", "center", "right", "center") ; break
  case "center": root.bindOrigin(app.rootBounds, "center", "center", "center", "center") ; break
  }
  app.host.addRoot(root)

  return closeDialog
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

function showGetApp (app :App) :Value<boolean> {
  // only show get the app if we're not a guest but we have no notification tokens (which either
  // means we've never installed the app or we refused to allow it to send us notifications; so this
  // is not perfect, but it'll have to do for now)
  const tokens = app.user.userValue.switchMap(
    user => user ? user.tokens.sizeValue : Value.constant(0))
  return Value.join2(app.notGuest, tokens).map(([ng, toks]) => ng && toks === 0)
}

export class InstallAppView implements Disposable {
  private _onDispose = new Disposer()

  constructor (readonly app :App) {
    const installAppUI = box({
      type: "button",
      onClick: "openAppPage",
      contents: {
        type: "box",
        contents: row(
          0, {type: "image", width: 40, height: 40, image: Value.constant("ui/app@2x.png")},
          column(0, label(Value.constant("Get the")), label(Value.constant("chat app!"))))
      },
    }, {margin: 5})
    const root = app.ui.createRoot({
      type: "root",
      scale: app.scale,
      autoSize: true,
      contents: installAppUI,
      visible: showGetApp(app),
    }, new Model({
      openAppPage: () => window.open(getAppURL())
    }))
    root.bindOrigin(app.rootBounds, "left", "top", "left", "top")
    app.host.addRoot(root)
    this._onDispose.add(() => app.host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}

export class OccupantsView implements Disposable {
  private _onDispose = new Disposer()

  constructor (readonly app :App) {
    const [ranch, unranch] = app.store.resolve(["ranches", app.state.ranchId], RanchObject)
    this._onDispose.add(unranch)
    const occupantsUI = box({
      type: "hlist",
      gap: 5,
      model: "occmodel",
      // TODO: tooltip with person's name...
      element: {type: "image", image: "photo", height: 20},
    }, {margin: 5})
    const root = app.ui.createRoot({
      type: "root",
      scale: app.scale,
      autoSize: true,
      contents: occupantsUI,
      visible: showGetApp(app).map(s => !s),
    }, new Model({
      occmodel: makeModel<UUID>(ranch.occupants, key => {
        const profile = app.profiles.profile(key)
        return {name: profile.name, photo: profile.photo}
      }),
    }))
    root.bindOrigin(app.rootBounds, "left", "top", "left", "top")
    app.host.addRoot(root)
    this._onDispose.add(() => app.host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}

export function createEditNameDialog (app :App, title :string, id :UUID, pos :Pos = "top") {
  const profile = app.profiles.profile(id)
  const name = Mutable.local(profile.name.current)
  const unlisten = profile.name.onChange(nname => name.update(nname))
  let closeDialog = NoopRemover
  const nameModel = {
    name,
    photo: profile.photo,
    updateName: () => {
      app.store.post(ranchQ(app.state.ranchId), {type: "setActorName", id, name: name.current})
      nameModel.close()
    },
    close: () => {
      unlisten()
      closeDialog()
    }
  }
  const nameUI = [
    row(5, {type: "image", image: "photo", height: 20},
        textBox("name", "updateName", {constraints: {stretch: true}})),
    row(0, button(Value.constant("Cancel"), "close"), hshim(20),
        button(Value.constant("Save"), "updateName"))
  ]
  return closeDialog = createDialog(app, title, nameUI, nameModel, pos)
}
