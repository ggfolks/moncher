import * as firebase from "firebase/app"
import * as admin from "firebase-admin"

import {TextEncoder, TextDecoder} from "util"
import {setTextCodec} from "tfw/core/codec"
import {log} from "tfw/core/util"
import {Server} from "tfw/data/server"
import {FirebaseDataStore} from "tfw/data/firebase"
import {FirebaseAuthValidator} from "tfw/auth/firebase"
import {ServerObject} from "./data"
import {ZonedPathfinding} from "./zonedpathfinding"
import {SERVER_FUNCS} from "./ranchdata"
import {handleRanchReq} from "./ranchserver"

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

/** Configure serverside handlers in a special global object to hide from the client. */
global[SERVER_FUNCS] = {
    handleRanchReq,
  }

// Load the navmesh GLB and put our pathfinder into global
global["Blob"] = require("web-blob").constructor
const Loader = require("three-gltf-loader")
const fs = require("fs")
fs.readFile("dist/ranch/RanchNavmesh.glb", (err :any, data :any) => {
    if (err) {
      log.warn("Error reading navmesh GLB file", "err", err)
      return
    }
    if (!(data instanceof Buffer)) {
      log.warn("Unrecognized data from filesystem load. Not loading navmesh.")
      return
    }
    const loader = new Loader()
    loader.parse(data.buffer, "./",
      (gltf :any) => {
        configureNavMesh(gltf)
      },
      (error :any) => {
        log.warn("Error loading navmesh GLB", "err", error)
      })
  })

function configureNavMesh (gltf :any) :void {
  const scene = gltf.scene
  const navMesh = scene.getObjectByName("NavMesh")
//  log.debug("I got something: " + navMesh)
//  log.debug("It's a mesh? " + (navMesh instanceof Mesh))
  global["_ranchPathfinder"] = new ZonedPathfinding(navMesh.geometry)
}
