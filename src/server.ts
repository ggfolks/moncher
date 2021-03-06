import * as firebase from "firebase/app"
import * as admin from "firebase-admin"
import * as http from "http"
import * as fs from "fs"
import "module-alias/register"

import {TextEncoder, TextDecoder} from "util"
import {setTextCodec} from "tfw/core/codec"
import {log} from "tfw/core/util"
import {ChannelServer} from "tfw/channel/server"
import {DataStore, MemoryDataStore, channelHandlers} from "tfw/data/server"
import {FirebaseDataStore} from "tfw/data/firebase"
import {guestValidator} from "tfw/auth/auth"
import {FirebaseAuthValidator} from "tfw/auth/firebase"
import {ServerObject} from "./data"
import {ZonedPathfinding} from "./zonedpathfinding"
import {SERVER_FUNCS} from "./ranchdata"
import {handleRanchReq, noteOccupant, NAVMESH_GLOBAL, PATHFINDER_GLOBAL} from "./ranchserver"
import {Notifier} from "./notifier"
import {Ticker} from "./ticker"

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

const haveFBCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS
const fireConfig = {
  apiKey: "AIzaSyBqGwobKx4ReOufFpoQcKD8qv_jY4lgRSk",
  authDomain: "tfwchat.firebaseapp.com",
  databaseURL: "https://tfwchat.firebaseio.com",
  projectId: "tfwchat",
  storageBucket: "tfwchat.appspot.com",
  messagingSenderId: "733313051370",
  appId: "1:733313051370:web:ef572661b45a730f8d8593"
}
if (haveFBCreds) fireConfig["credential"] = admin.credential.applicationDefault()
firebase.initializeApp(fireConfig)

function mimeType (path :string) :string {
  const ldidx = path.lastIndexOf("."), suff = path.substring(ldidx+1).toLowerCase()
  switch (suff) {
  case "html": return "text/html; charset=utf-8"
  case "js": return "application/javascript; charset=utf-8"
  case "json": return "application/json; charset=utf-8"
  case "png": return "image/png"
  case "jpg": return "image/jpeg"
  case "gif": return "image/gif"
  default: return "text/plain; charset=utf-8"
  }
}

// a ranch URL is either /{ranchid} or /{ranchid}/{inviteid}
const ranchUrlR = /^\/[A-Za-z0-9]{22}(\+[A-Za-z0-9]{22})?$/
function urlToPath (url :string) :string {
  if (url === "/") return "index.html"
  // if there's just a UUID hash as the path, that's the ranch id, return index.html
  else if (url.match(ranchUrlR)) return "index.html"
  else return url
}

const httpPort = parseInt(process.env.HTTP_PORT || "8080")
const httpServer = http.createServer((req, rsp) => {
  const path = urlToPath(req.url || "/")
  // log.info("HTTP request", "url", req.url, "path", path)
  fs.readFile(`dist/${path}`, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        rsp.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        rsp.end(`Not found: ${path}`)
      } else {
        rsp.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
        rsp.end("Internal error: " + err.code)
      }
    } else {
      rsp.setHeader('Access-Control-Allow-Origin', '*')
      rsp.writeHead(200, { "Content-Type": mimeType(path) })
      rsp.end(content, "utf-8")
    }
  })
})
httpServer.listen(httpPort)
log.info("Listening for connections", "port", httpPort)

function createStore () :[DataStore, () => Promise<void>] {
  if (haveFBCreds) {
    log.info("Using Firebase data store")
    const store = new FirebaseDataStore(ServerObject)
    return [store, () => store.shutdown()]
  } else {
    log.info("Using memory data store")
    return [new MemoryDataStore(ServerObject), () => Promise.resolve(undefined)]
  }
}
const [store, shutdownStore] = createStore()

const server = new ChannelServer({
  httpServer,
  authers: {guest: guestValidator, firebase: new FirebaseAuthValidator()},
  handlers: channelHandlers(store),
})
server.state.onValue(ss => {
  log.info(`Server state: ${ss}`)
})
server.errors.onEmit(error => {
  log.warn("HTTP/WS server error", error)
})

// shut down when we receive SIGINT or SIGTERM
const signalHandler = () => {
  httpServer.close()
  server.shutdown()
  shutdownStore().then(_ => {
    log.info("Server shutdown complete")
    process.exit(0)
  })
}
process.on('SIGTERM', signalHandler)
process.on('SIGINT', signalHandler)

if (haveFBCreds) {
  const adminApp = admin.initializeApp()
  // this guy sends out FCM notifications for chat channel messages
  const notifier = new Notifier(adminApp, store)
  server.state.whenOnce(s => s === "terminated", _ => notifier.dispose())
}

// this guy ticks active ranches
const ticker = new Ticker(store)
server.state.whenOnce(s => s === "terminated", _ => ticker.dispose())

/** Configure serverside handlers in a special global object to hide from the client. */
global[SERVER_FUNCS] = {
  handleRanchReq,
  noteOccupant,
}

// Load the navmesh GLB and put our pathfinder into global
global["Blob"] = require("web-blob").constructor
const Loader = require("three-gltf-loader")
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
  global[PATHFINDER_GLOBAL] = new ZonedPathfinding(navMesh.geometry)
  global[NAVMESH_GLOBAL] = navMesh
}
