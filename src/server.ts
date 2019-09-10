import * as fs from "fs"
import * as firebase from "firebase/app"
import "firebase/auth"

import {TextEncoder, TextDecoder} from "util"
import {setTextCodec} from "tfw/core/codec"
import {DataStore, Server} from "tfw/data/server"
import {ServerObject} from "./data"

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

async function initFirebase () {
  if (!fs.existsSync("creds.json")) {
    console.log(`No creds.json file, not authing with firebase.`)
    return
  }

  // wow, this is tedious
  let creds = {email: "", password: ""}
  try {
    creds = JSON.parse(fs.readFileSync("creds.json", "utf-8"))
  } catch (error) {
    console.warn(`Failed to read creds.json: ${error}`)
    return
  }
  if (!creds.email) {
    console.warn(`Missing 'email' in creds.json.`)
    return
  }
  if (!creds.password) {
    console.warn(`Missing 'password' in creds.json.`)
    return
  }

  firebase.initializeApp({
    apiKey: "AIzaSyBqGwobKx4ReOufFpoQcKD8qv_jY4lgRSk",
    authDomain: "tfwchat.firebaseapp.com",
    databaseURL: "https://tfwchat.firebaseio.com",
    projectId: "tfwchat",
    storageBucket: "tfwchat.appspot.com",
    messagingSenderId: "733313051370",
    appId: "1:733313051370:web:ef572661b45a730f8d8593"
  })

  try {
    const res = await firebase.auth().signInWithEmailAndPassword(creds.email, creds.password)
    if (res.user) {
      console.log(`Connected to Firebase as ${res.user.email}`)
    } else {
      console.log(`Got no user from Firebase auth?`)
      console.dir(res)
    }
  } catch (error) {
    var errorCode = error.code
    var errorMessage = error.message
    var credential = error.credential
    console.log(`Firebase auth error [code=${errorCode}, msg=${errorMessage}, cred=${credential}]`)
  }
}
initFirebase()

const store = new DataStore(ServerObject)
const server = new Server(store)
server.state.onValue(ss => {
  console.log(`Server state: ${ss}`)
})
