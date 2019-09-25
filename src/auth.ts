import {Value} from "tfw/core/react"
import {Host} from "tfw/ui/element"
import {showGoogleLogin, firebaseLogout} from "tfw/auth/firebase"

import {App} from "./app"
import {box, label, button, createDialog} from "./ui"

export function showAuthDialog (app :App, host :Host) {
  const loggedOut = app.client.auth.map(auth => auth.source === "guest")
  const curProfile = app.client.auth.map(sess => app.profiles.profile(sess.id))

  createDialog(app, host, "Account", [{
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
  }], {
    loggedIn: loggedOut.map(l => !l),
    loggedOut,
    uuid: curProfile.map(p => p.key),
    profileName: curProfile.switchMap(p => p.name),
    profilePhoto: curProfile.switchMap(p => p.photo),
    logout: () => firebaseLogout(),
    loginGoogle: () => showGoogleLogin(),
  })
}
