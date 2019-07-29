import {App} from "./app"
import {GridTileSceneConfig, GridTileSceneModel, GridTileSceneViewMode} from "./gridtiles"
import {FringeConfig} from "./fringer"
import * as Fringer from "./fringer"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
app.start()

const fringeConfig :FringeConfig = [
  Fringer.SOUTHEAST, // 1
  Fringer.SOUTHERN,  // 2
  Fringer.SOUTHWEST, // 3
  Fringer.WESTERN,
  Fringer.EASTERN,
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

const dirt = "dirt";
const grass = "grass";
const cobble = "cobble";

const dirtInfo = {
  id: dirt,
  priority: 0,
  base: "tiles/dirt.png",
  //fringe: "tiles/dirt_fringe.png",
}

const grassInfo = {
  id: grass,
  priority: 1,
  base: "tiles/grass.png",
  fringe: "tiles/grass_fringe.png",
}

const cobbleInfo = {
  id: cobble,
  priority: 2,
  base: "tiles/cobble.png",
  fringe: "tiles/cobble_fringe.png",
}

const gridConfig :GridTileSceneConfig = {
  width: 20,
  height: 20,
  scale: 2,
  tiles: [ dirtInfo, grassInfo, cobbleInfo ],
  fringeConfig: fringeConfig,
}

const model = new GridTileSceneModel(gridConfig);

// fill in the scene
for (let xx = 0; xx < model.config.width; xx++) {
  let col = model.tiles[xx];
  for (let yy = 0; yy < model.config.height; yy++) {
    col[yy] = dirt;
  }
}

function addFeatures (tiles :Array<Array<string>>, feature :string, maxNumber :number,
    maxSize :number) :void {
  for (let num = Math.trunc(Math.random() * maxNumber); num > 0; num--) {
    let size = Math.trunc(Math.random() * maxSize);
    let xpos = Math.trunc(Math.random() * (tiles.length - size));
    let ypos = Math.trunc(Math.random() * (tiles[0].length - size));
    for (let xx = 0; xx < size; xx++) {
      for (let yy = 0; yy < size; yy++) {
        model.tiles[xx + xpos][yy + ypos] = feature;
      }
    }
  }
}

addFeatures(model.tiles, "grass", 20, 10)
addFeatures(model.tiles, "cobble", 10, 5)

app.setMode(new GridTileSceneViewMode(app, model))
