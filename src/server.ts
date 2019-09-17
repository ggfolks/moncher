import * as firebase from "firebase/app"
import * as admin from "firebase-admin"

import {TextEncoder, TextDecoder} from "util"
import {setTextCodec} from "tfw/core/codec"
import {Server} from "tfw/data/server"
import {FirebaseDataStore} from "tfw/data/firebase"
import {FirebaseAuthValidator} from "tfw/auth/firebase"
import {ServerObject} from "./data"

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

firebase.initializeApp({
  apiKey: "AIzaSyBqGwobKx4ReOufFpoQcKD8qv_jY4lgRSk",
  authDomain: "tfwchat.firebaseapp.com",
  credential: admin.credential.applicationDefault(),
  databaseURL: "https://tfwchat.firebaseio.com",
  projectId: "tfwchat",
  storageBucket: "tfwchat.appspot.com",
  messagingSenderId: "733313051370",
  appId: "1:733313051370:web:ef572661b45a730f8d8593"
})

const store = new FirebaseDataStore(ServerObject)
const server = new Server(store, {firebase: new FirebaseAuthValidator()})
server.state.onValue(ss => {
  console.log(`Server state: ${ss}`)
})
