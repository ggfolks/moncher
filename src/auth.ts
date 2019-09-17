import {Disposable, Disposer} from "tfw/core/util"
import {Value} from "tfw/core/react"
import {Host} from "tfw/ui/element"
import {Model} from "tfw/ui/model"
import {showGoogleLogin} from "tfw/auth/firebase"

import {App} from "./app"
import {box, label, button, closeButton} from "./ui"

const sausageCorner = 12

const authUiConfig = box({
  type: "column",
  offPolicy: "stretch",
  gap: 10,
  contents: [{
    type: "row",
    contents: [
      label(Value.constant("Account"), {font: "$header"}, {constraints: {stretch: true}}),
      closeButton("closeDialog")
    ]
  }, {
    type: "row",
    contents: [box({
      type: "image",
      image: "profilePhoto",
      height: 20,
    }, {padding: [0, 5, 0, 0]}), label("profileName")]
  // }, {
  //   type: "row",
  //   contents: [label("uuid")]
  }, {
    type: "row",
    contents: [
      button(Value.constant("Logout"), "logout", {}, {visible: "loggedIn"}),
      button(Value.constant("Login with Google"), "loginGoogle", {}, {visible: "loggedOut"})
    ]
  }]
}, {
  padding: 10,
  background: {fill: "$orange", cornerRadius: sausageCorner},
})

export class AuthDialog implements Disposable {
  private _onDispose = new Disposer()

  constructor (app :App, host :Host) {
    const loggedOut = app.client.auth.map(auth => auth.source === "guest")
    const curProfile = app.client.auth.map(sess => app.profiles.profile(sess.id))
    const modelData = {
      loggedIn: loggedOut.map(l => !l),
      loggedOut,
      uuid: curProfile.map(p => p.key),
      profileName: curProfile.switchMap(p => p.name),
      profilePhoto: curProfile.switchMap(p => p.photo),
      closeDialog: () => this.dispose(),
      logout: () => {},
      loginGoogle: () => showGoogleLogin(),
    }

    const root = app.ui.createRoot({
      type: "root",
      scale: app.renderer.scale,
      autoSize: true,
      hintSize: app.renderer.size,
      // minSize: Value.constant(dim2.fromValues(300, 0)),
      contents: authUiConfig,
    }, new Model(modelData))

    root.bindOrigin(app.renderer.size, "center", "center", "center", "center")
    host.addRoot(root)
    this._onDispose.add(() => host.removeRoot(root))
  }

  dispose () {
    this._onDispose.dispose()
  }
}
