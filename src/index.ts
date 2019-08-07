import {App} from "./app"
import {GridTileInfo, GridTileSceneConfig, GridTileSceneModel, GridTileSceneViewMode} from "./gridtiles"
import {FringeConfig} from "./fringer"
import * as Fringer from "./fringer"
import {CarcTile, generateGridModel} from "./carctiles"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
app.start()

const fringeConfig :FringeConfig = [
  Fringer.SOUTHEAST, // 1, according to Rick's legend
  Fringer.SOUTHERN,  // 2
  Fringer.SOUTHWEST, // 3
  Fringer.EASTERN,
  Fringer.WESTERN,
  Fringer.NORTHEAST,
  Fringer.NORTHERN,
  Fringer.NORTHWEST,
  Fringer.WESTERN | Fringer.NORTHERN, // 9
  Fringer.WESTERN | Fringer.SOUTHERN | Fringer.EASTERN, // 10
  Fringer.EASTERN | Fringer.NORTHERN, // 11
  Fringer.NORTHERN | Fringer.EASTERN | Fringer.SOUTHERN,
  Fringer.NORTHERN | Fringer.WESTERN | Fringer.SOUTHERN,
  Fringer.WESTERN | Fringer.SOUTHERN,
  Fringer.NORTHERN | Fringer.EASTERN | Fringer.WESTERN,
  Fringer.EASTERN | Fringer.SOUTHERN // 16
]

const dirt = "dirt"
const grass = "grass"
const cobble = "cobble"
const gridConfig :GridTileSceneConfig = {
  width: 40,
  height: 40,
  scale: 2,
  tiles: [
    new GridTileInfo(dirt, "tiles/dirt.png", 0),
    new GridTileInfo(grass, "tiles/grass.png", 1, "tiles/grass_fringe.png"),
    new GridTileInfo(cobble, "tiles/cobble.png", 2, "tiles/cobble_fringe.png"),
  ],
  fringeConfig: fringeConfig,
}

const roadN = new CarcTile(dirt, cobble, dirt,
                           dirt, cobble, dirt,
                           dirt, dirt, dirt)
const roadS = new CarcTile(dirt, dirt, dirt,
                           dirt, cobble, dirt,
                           dirt, cobble, dirt)
const roadE = new CarcTile(dirt, dirt, dirt,
                           dirt, cobble, cobble,
                           dirt, dirt, dirt)
const roadW = new CarcTile(dirt, dirt, dirt,
                           cobble, cobble, dirt,
                           dirt, dirt, dirt)
const roadNS = new CarcTile(dirt, cobble, dirt,
                            dirt, cobble, dirt,
                            dirt, cobble, dirt)
const roadEW = new CarcTile(dirt, dirt, dirt,
                            cobble, cobble, cobble,
                            dirt, dirt, dirt)
const roadNW = new CarcTile(dirt, cobble, dirt,
                            cobble, cobble, dirt,
                            dirt, dirt, dirt)
const roadNE = new CarcTile(dirt, cobble, dirt,
                            dirt, cobble, cobble,
                            dirt, dirt, dirt)
const roadSE = new CarcTile(dirt, dirt, dirt,
                            dirt, cobble, cobble,
                            dirt, cobble, dirt)
const roadSW = new CarcTile(dirt, dirt, dirt,
                            cobble, cobble, dirt,
                            dirt, cobble, dirt)
const roadNEW = new CarcTile(dirt, cobble, dirt,
                             cobble, cobble, cobble,
                             dirt, dirt, dirt)
const roadSEW = new CarcTile(dirt, dirt, dirt,
                             cobble, cobble, cobble,
                             dirt, cobble, dirt)
const roadNWS = new CarcTile(dirt, cobble, dirt,
                             cobble, cobble, dirt,
                             dirt, cobble, dirt)
// skip roadNES to give our map ~personality~
const dirtNEWS = new CarcTile(dirt, dirt, dirt,
                              dirt, dirt, dirt,
                              dirt, dirt, dirt)
let tiles = [ roadN, roadS, roadE, roadW,
              roadNS, roadEW,
              roadNW, roadNE, roadSE, roadSW,
              roadNEW, roadSEW, roadNWS, /*roadNES,*/
              dirtNEWS ]
let model :GridTileSceneModel = generateGridModel(tiles, 12, 12, gridConfig)
app.setMode(new GridTileSceneViewMode(app, model))
