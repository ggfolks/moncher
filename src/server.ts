import * as firebase from "firebase/app"
import * as admin from "firebase-admin"

import {TextEncoder, TextDecoder} from "util"
import {setTextCodec} from "tfw/core/codec"
import {Server} from "tfw/data/server"
import {FirebaseDataStore} from "tfw/data/firebase"
import {FirebaseAuthValidator} from "tfw/auth/firebase"
import {ServerObject} from "./data"
import {log} from "tfw/core/util"
import {Pathfinding} from "./pathfinding"

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


// Load the navmesh GLB and put our pathfinder into global
global["Blob"] = require("web-blob").constructor
const Loader = require("three-gltf-loader")
const fs = require("fs")
fs.readFile("dist/ranch/RanchNavmesh.glb", (err :any, data :any) => {
  if (err) {
    log.warn("Got an error", "err", err)
  } else {
    if (data instanceof Buffer) {
      log.info("It's a buffer!")
      const loader = new Loader()
      loader.parse(data.buffer, "./",
        (gltf :any) => {
          console.log("Holy crap we got it? " + gltf)
          configureNavMesh(gltf)
        },
        (error :any) => {
          console.error("I got an error " + error)
        })

    } else {
      log.info("Data is", typeof data, data)
    }
  }
})

function configureNavMesh (gltf :any) :void {
  const scene = gltf.scene
  const navMesh = scene.getObjectByName("NavMesh")
//  log.debug("I got something: " + navMesh)
//  log.debug("It's a mesh? " + (navMesh instanceof Mesh))
  const pather = new Pathfinding()
  pather.setZoneData("ranch", Pathfinding.createZone(navMesh.geometry))
  global["_ranchPathfinder"] = pather
}
