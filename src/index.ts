import {Mutable} from "tfw/core/react"
import {App} from "./app"
import {
  GridTileInfo,
  GridTileSceneConfig,
  GridTileSceneModel,
  GridTileSceneViewMode,
  MonsterConfig,
  MonsterVisualState,
  PropPlacement,
  PropTileInfo
} from "./gridtiles"
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
const tree = "tree"
const rock = "rock"
const gridConfig :GridTileSceneConfig = {
  tileWidth: 40,
  tileHeight: 40,
  scale: 2,
  tiles: [
    new GridTileInfo(dirt, "tiles/dirt.png", 0, "tiles/dirt_fringe.png"),
    new GridTileInfo(grass, "tiles/grass.png", 1, "tiles/grass_fringe.png"),
    new GridTileInfo(cobble, "tiles/cobble.png", -1, "tiles/cobble_fringe.png"),
  ],
  fringeConfig: fringeConfig,
  props: [
    new PropTileInfo(tree, "props/tree_1.png"),
    new PropTileInfo(rock, "props/rock_1a.png"),
  ]
}

const roadN = new CarcTile(dirt, cobble, dirt,
                           dirt, cobble, dirt,
                           dirt, dirt, dirt, .01,
                           new PropPlacement(rock, 1.5, 2.5))
const roadS = new CarcTile(dirt, dirt, dirt,
                           dirt, cobble, dirt,
                           dirt, cobble, dirt, .01,
                           new PropPlacement(rock, 1.5, .5))
const roadE = new CarcTile(dirt, dirt, dirt,
                           dirt, cobble, cobble,
                           dirt, dirt, dirt, .01,
                           new PropPlacement(rock, .5, 1.5))
const roadW = new CarcTile(dirt, dirt, dirt,
                           cobble, cobble, dirt,
                           dirt, dirt, dirt, .01,
                           new PropPlacement(rock, 2.5, 1.5))
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
                             dirt, dirt, dirt, .5)
const roadSEW = new CarcTile(dirt, dirt, dirt,
                             cobble, cobble, cobble,
                             dirt, cobble, dirt, .5)
const roadNWS = new CarcTile(dirt, cobble, dirt,
                             cobble, cobble, dirt,
                             dirt, cobble, dirt, .5)
// skip roadNES to give our map ~personality~
const dirtNEWS = new CarcTile(dirt, dirt, dirt,
                              dirt, dirt, dirt,
                              dirt, dirt, dirt, 5)
const grassNEWS = new CarcTile(grass, grass, grass,
                               grass, grass, grass,
                               grass, grass, grass, 5)
const grassN = new CarcTile(grass, grass, grass,
                            grass, grass, grass,
                            dirt, dirt, dirt)
const grassS = new CarcTile(dirt, dirt, dirt,
                            grass, grass, grass,
                            grass, grass, grass)
const grassW = new CarcTile(grass, grass, dirt,
                            grass, grass, dirt,
                            grass, grass, dirt)
const grassE = new CarcTile(dirt, grass, grass,
                            dirt, grass, grass,
                            dirt, grass, grass)
const grassNW = new CarcTile(grass, grass, dirt,
                             grass, grass, dirt,
                             dirt, dirt, dirt)
const grassNE = new CarcTile(dirt, grass, grass,
                             dirt, grass, grass,
                             dirt, dirt, dirt)
const grassSW = new CarcTile(dirt, dirt, dirt,
                             grass, grass, dirt,
                             grass, grass, dirt)
const grassSE = new CarcTile(dirt, dirt, dirt,
                             dirt, grass, grass,
                             dirt, grass, grass)
const grassRoadNS = new CarcTile(grass, cobble, grass,
                                 grass, cobble, grass,
                                 grass, cobble, grass)
const grassRoadN = new CarcTile(grass, cobble, grass,
                                grass, cobble, grass,
                                dirt, cobble, dirt)
const grassRoadS = new CarcTile(dirt, cobble, dirt,
                                grass, cobble, grass,
                                grass, cobble, grass)
const grassRoadEW = new CarcTile(grass, grass, grass,
                                 cobble, cobble, cobble,
                                 grass, grass, grass)
const grassRoadE = new CarcTile(dirt, grass, grass,
                                cobble, cobble, cobble,
                                dirt, grass, grass)
const grassRoadW = new CarcTile(grass, grass, dirt,
                                cobble, cobble, cobble,
                                grass, grass, dirt)
const grassRoadNW = new CarcTile(grass, cobble, grass,
                                 cobble, cobble, grass,
                                 grass, grass, grass)
const grassRoadNE = new CarcTile(grass, cobble, grass,
                                 grass, cobble, cobble,
                                 grass, grass, grass)
const grassRoadSE = new CarcTile(grass, grass, grass,
                                 grass, cobble, cobble,
                                 grass, cobble, grass)
const grassRoadSW = new CarcTile(grass, grass, grass,
                                 cobble, cobble, grass,
                                 grass, cobble, grass)
const grassRoadNEWS = new CarcTile(grass, cobble, grass,
                                   cobble, cobble, cobble,
                                   grass, cobble, grass)
const grassNW2 = new CarcTile(grass, grass, grass,
                              grass, grass, grass,
                              grass, grass, dirt, 1)
const grassNE2 = new CarcTile(grass, grass, grass,
                              grass, grass, grass,
                              dirt, grass, grass, 1)
const grassSW2 = new CarcTile(grass, grass, dirt,
                              grass, grass, grass,
                              grass, grass, grass, 1)
const grassSE2 = new CarcTile(dirt, grass, grass,
                              grass, grass, grass,
                              grass, grass, grass, 1)
const grassRoadNES = new CarcTile(grass, cobble, grass,
                                  grass, cobble, cobble,
                                  grass, cobble, grass)
const grassWithTree = new CarcTile(grass, grass, grass,
                                   grass, grass, grass,
                                   grass, grass, grass, 1,
                                   new PropPlacement(tree, 1.5, 1.5))
const grassWithCopse = new CarcTile(grass, grass, grass,
                                   grass, grass, grass,
                                   grass, grass, grass, 50,
                                   new PropPlacement(tree, .2, .2),
                                   new PropPlacement(tree, 2.2, .6),
                                   new PropPlacement(tree, .5, 1),
                                   new PropPlacement(tree, 1.8, 1.4),
                                   new PropPlacement(tree, 2.9, 1.8),
                                   new PropPlacement(tree, .3, 2.2),
                                   new PropPlacement(tree, 2.3, 2.6))

// ADDITIONAL TILES, created so that all road types are represented on both grass and dirt,
// to see if this eases the pain that the solver has in building a scene.
const roadNES = new CarcTile(dirt, cobble, dirt,
                             dirt, cobble, cobble,
                             dirt, cobble, dirt, .5)
const grassRoadNEW = new CarcTile(grass, cobble, grass,
                                  cobble, cobble, cobble,
                                  grass, grass, grass, .5)
const grassRoadSEW = new CarcTile(grass, grass, grass,
                                  cobble, cobble, cobble,
                                  grass, cobble, grass, .5)
const grassRoadNWS = new CarcTile(grass, cobble, grass,
                                  cobble, cobble, grass,
                                  grass, cobble, grass, .5)
const grassRoadNend = new CarcTile(grass, cobble, grass,
                           grass, cobble, grass,
                           grass, grass, grass, .01)
const grassRoadSend = new CarcTile(grass, grass, grass,
                           grass, cobble, grass,
                           grass, cobble, grass, .01)
const grassRoadEend = new CarcTile(grass, grass, grass,
                           grass, cobble, cobble,
                           grass, grass, grass, .01)
const grassRoadWend = new CarcTile(grass, grass, grass,
                           cobble, cobble, grass,
                           grass, grass, grass, .01)
let additional = [ roadNES, grassRoadNEW, grassRoadSEW, grassRoadNWS,
                   grassRoadNend, grassRoadSend, grassRoadWend, grassRoadEend ]

let tiles = [ roadN, roadS, roadE, roadW,
              roadNS, roadEW,
              roadNW, roadNE, roadSE, roadSW,
              roadNEW, roadSEW, roadNWS, /*roadNES,*/
              dirtNEWS, grassNEWS, grassWithTree, grassWithCopse,
              grassN, grassE, grassW, grassS,
              grassNE, grassNW, grassSE, grassSW,
              grassNE2, grassNW2, grassSE2, grassSW2,
              grassRoadNS, grassRoadN, grassRoadS,
              grassRoadEW, grassRoadW, grassRoadE,
              grassRoadNW, grassRoadNE, grassRoadSE, grassRoadSW,
              grassRoadNES,
              grassRoadNEWS ]
let model :GridTileSceneModel = generateGridModel(tiles.concat(additional), 30, 30, gridConfig)
let mode = new GridTileSceneViewMode(app, model)
app.setMode(mode)

//const batchBits = 10
//const hunger =
let viz = new MonsterVisualState(4.5, 4.5, "")
const val = Mutable.local(viz, MonsterVisualState.eq)
mode.addMonster(new MonsterConfig(new PropTileInfo("mtx", "props/mountain_1.png")), val)


//setInterval(() => { model.tick() }, 200)
