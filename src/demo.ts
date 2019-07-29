import {App} from "./app"
import {ShowTilesetMode} from "./tiles"

const root = document.getElementById("root")
if (!root) throw new Error(`No root?`)

const app = new App(root)
app.start()

const tilesInfo = {
  image: "tiles.png",
  scale: 2,
  tiles: {
    t001: {x: 0, y: 192, width: 64, height: 64},
    t002: {x: 0, y: 128, width: 64, height: 64},
    t003: {x: 0, y: 64, width: 64, height: 64},
    t004: {x: 0, y: 0, width: 64, height: 64},
    t005: {x: 384, y: 576, width: 64, height: 64},
    t006: {x: 832, y: 256, width: 64, height: 64},
    t007: {x: 832, y: 192, width: 64, height: 64},
    t008: {x: 832, y: 128, width: 64, height: 64},
    t009: {x: 832, y: 64, width: 64, height: 64},
    t010: {x: 832, y: 0, width: 64, height: 64},
    t011: {x: 768, y: 832, width: 64, height: 64},
    t012: {x: 768, y: 768, width: 64, height: 64},
    t013: {x: 768, y: 704, width: 64, height: 64},
    t014: {x: 768, y: 640, width: 64, height: 64},
    t015: {x: 768, y: 576, width: 64, height: 64},
    t016: {x: 768, y: 512, width: 64, height: 64},
    t017: {x: 768, y: 448, width: 64, height: 64},
    t018: {x: 768, y: 384, width: 64, height: 64},
    t019: {x: 768, y: 320, width: 64, height: 64},
    t020: {x: 768, y: 256, width: 64, height: 64},
    t021: {x: 768, y: 192, width: 64, height: 64},
    t022: {x: 768, y: 128, width: 64, height: 64},
    t023: {x: 768, y: 64, width: 64, height: 64},
    t024: {x: 768, y: 0, width: 64, height: 64},
    t025: {x: 704, y: 832, width: 64, height: 64},
    t026: {x: 704, y: 768, width: 64, height: 64},
    t027: {x: 704, y: 704, width: 64, height: 64},
    t028: {x: 704, y: 640, width: 64, height: 64},
    t029: {x: 704, y: 576, width: 64, height: 64},
    t030: {x: 704, y: 512, width: 64, height: 64},
    t031: {x: 704, y: 448, width: 64, height: 64},
    t032: {x: 704, y: 384, width: 64, height: 64},
    t033: {x: 704, y: 320, width: 64, height: 64},
    t034: {x: 704, y: 256, width: 64, height: 64},
    t035: {x: 704, y: 192, width: 64, height: 64},
    t036: {x: 704, y: 128, width: 64, height: 64},
    t037: {x: 704, y: 64, width: 64, height: 64},
    t038: {x: 704, y: 0, width: 64, height: 64},
    t039: {x: 640, y: 832, width: 64, height: 64},
    t040: {x: 640, y: 768, width: 64, height: 64},
    t041: {x: 640, y: 704, width: 64, height: 64},
    t042: {x: 640, y: 640, width: 64, height: 64},
    t043: {x: 640, y: 576, width: 64, height: 64},
    t044: {x: 640, y: 512, width: 64, height: 64},
    t045: {x: 640, y: 448, width: 64, height: 64},
    t046: {x: 640, y: 384, width: 64, height: 64},
    t047: {x: 640, y: 320, width: 64, height: 64},
    t048: {x: 640, y: 256, width: 64, height: 64},
    t049: {x: 640, y: 192, width: 64, height: 64},
    t050: {x: 640, y: 128, width: 64, height: 64},
    t051: {x: 640, y: 64, width: 64, height: 64},
    t052: {x: 640, y: 0, width: 64, height: 64},
    t053: {x: 576, y: 832, width: 64, height: 64},
    t054: {x: 576, y: 768, width: 64, height: 64},
    t055: {x: 576, y: 704, width: 64, height: 64},
    t056: {x: 576, y: 640, width: 64, height: 64},
    t057: {x: 576, y: 576, width: 64, height: 64},
    t058: {x: 576, y: 512, width: 64, height: 64},
    t059: {x: 576, y: 448, width: 64, height: 64},
    t060: {x: 576, y: 384, width: 64, height: 64},
    t061: {x: 576, y: 320, width: 64, height: 64},
    t062: {x: 576, y: 256, width: 64, height: 64},
    t063: {x: 576, y: 192, width: 64, height: 64},
    t064: {x: 576, y: 128, width: 64, height: 64},
    t065: {x: 576, y: 64, width: 64, height: 64},
    t066: {x: 576, y: 0, width: 64, height: 64},
    t067: {x: 512, y: 832, width: 64, height: 64},
    t068: {x: 512, y: 768, width: 64, height: 64},
    t069: {x: 512, y: 704, width: 64, height: 64},
    t070: {x: 512, y: 640, width: 64, height: 64},
    t071: {x: 512, y: 576, width: 64, height: 64},
    t072: {x: 512, y: 512, width: 64, height: 64},
    t073: {x: 512, y: 448, width: 64, height: 64},
    t074: {x: 512, y: 384, width: 64, height: 64},
    t075: {x: 512, y: 320, width: 64, height: 64},
    t076: {x: 512, y: 256, width: 64, height: 64},
    t077: {x: 512, y: 192, width: 64, height: 64},
    t078: {x: 512, y: 128, width: 64, height: 64},
    t079: {x: 512, y: 64, width: 64, height: 64},
    t080: {x: 512, y: 0, width: 64, height: 64},
    t081: {x: 448, y: 832, width: 64, height: 64},
    t082: {x: 448, y: 768, width: 64, height: 64},
    t083: {x: 448, y: 704, width: 64, height: 64},
    t084: {x: 448, y: 640, width: 64, height: 64},
    t085: {x: 448, y: 576, width: 64, height: 64},
    t086: {x: 448, y: 512, width: 64, height: 64},
    t087: {x: 448, y: 448, width: 64, height: 64},
    t088: {x: 448, y: 384, width: 64, height: 64},
    t089: {x: 448, y: 320, width: 64, height: 64},
    t090: {x: 448, y: 256, width: 64, height: 64},
    t091: {x: 448, y: 192, width: 64, height: 64},
    t092: {x: 448, y: 128, width: 64, height: 64},
    t093: {x: 448, y: 64, width: 64, height: 64},
    t094: {x: 448, y: 0, width: 64, height: 64},
    t095: {x: 384, y: 832, width: 64, height: 64},
    t096: {x: 384, y: 768, width: 64, height: 64},
    t097: {x: 384, y: 704, width: 64, height: 64},
    t098: {x: 384, y: 640, width: 64, height: 64},
    t099: {x: 832, y: 320, width: 64, height: 64},
    t100: {x: 384, y: 512, width: 64, height: 64},
    t101: {x: 384, y: 448, width: 64, height: 64},
    t102: {x: 384, y: 384, width: 64, height: 64},
    t103: {x: 384, y: 320, width: 64, height: 64},
    t104: {x: 384, y: 256, width: 64, height: 64},
    t105: {x: 384, y: 192, width: 64, height: 64},
    t106: {x: 384, y: 128, width: 64, height: 64},
    t107: {x: 384, y: 64, width: 64, height: 64},
    t108: {x: 384, y: 0, width: 64, height: 64},
    t109: {x: 320, y: 832, width: 64, height: 64},
    t110: {x: 320, y: 768, width: 64, height: 64},
    t111: {x: 320, y: 704, width: 64, height: 64},
    t112: {x: 320, y: 640, width: 64, height: 64},
    t113: {x: 320, y: 576, width: 64, height: 64},
    t114: {x: 320, y: 512, width: 64, height: 64},
    t115: {x: 320, y: 448, width: 64, height: 64},
    t116: {x: 320, y: 384, width: 64, height: 64},
    t117: {x: 320, y: 320, width: 64, height: 64},
    t118: {x: 320, y: 256, width: 64, height: 64},
    t119: {x: 320, y: 192, width: 64, height: 64},
    t120: {x: 320, y: 128, width: 64, height: 64},
    t121: {x: 320, y: 64, width: 64, height: 64},
    t122: {x: 320, y: 0, width: 64, height: 64},
    t123: {x: 256, y: 832, width: 64, height: 64},
    t124: {x: 256, y: 768, width: 64, height: 64},
    t125: {x: 256, y: 704, width: 64, height: 64},
    t126: {x: 256, y: 640, width: 64, height: 64},
    t127: {x: 256, y: 576, width: 64, height: 64},
    t128: {x: 256, y: 512, width: 64, height: 64},
    t129: {x: 256, y: 448, width: 64, height: 64},
    t130: {x: 256, y: 384, width: 64, height: 64},
    t131: {x: 256, y: 320, width: 64, height: 64},
    t132: {x: 256, y: 256, width: 64, height: 64},
    t133: {x: 256, y: 192, width: 64, height: 64},
    t134: {x: 256, y: 128, width: 64, height: 64},
    t135: {x: 256, y: 64, width: 64, height: 64},
    t136: {x: 256, y: 0, width: 64, height: 64},
    t137: {x: 192, y: 832, width: 64, height: 64},
    t138: {x: 192, y: 768, width: 64, height: 64},
    t139: {x: 192, y: 704, width: 64, height: 64},
    t140: {x: 192, y: 640, width: 64, height: 64},
    t141: {x: 192, y: 576, width: 64, height: 64},
    t142: {x: 192, y: 512, width: 64, height: 64},
    t143: {x: 192, y: 448, width: 64, height: 64},
    t144: {x: 192, y: 384, width: 64, height: 64},
    t145: {x: 192, y: 320, width: 64, height: 64},
    t146: {x: 192, y: 256, width: 64, height: 64},
    t147: {x: 192, y: 192, width: 64, height: 64},
    t148: {x: 192, y: 128, width: 64, height: 64},
    t149: {x: 192, y: 64, width: 64, height: 64},
    t150: {x: 192, y: 0, width: 64, height: 64},
    t151: {x: 128, y: 832, width: 64, height: 64},
    t152: {x: 128, y: 768, width: 64, height: 64},
    t153: {x: 128, y: 704, width: 64, height: 64},
    t154: {x: 128, y: 640, width: 64, height: 64},
    t155: {x: 128, y: 576, width: 64, height: 64},
    t156: {x: 128, y: 512, width: 64, height: 64},
    t157: {x: 128, y: 448, width: 64, height: 64},
    t158: {x: 128, y: 384, width: 64, height: 64},
    t159: {x: 128, y: 320, width: 64, height: 64},
    t160: {x: 128, y: 256, width: 64, height: 64},
    t161: {x: 128, y: 192, width: 64, height: 64},
    t162: {x: 128, y: 128, width: 64, height: 64},
    t163: {x: 128, y: 64, width: 64, height: 64},
    t164: {x: 128, y: 0, width: 64, height: 64},
    t165: {x: 64, y: 832, width: 64, height: 64},
    t166: {x: 64, y: 768, width: 64, height: 64},
    t167: {x: 64, y: 704, width: 64, height: 64},
    t168: {x: 64, y: 640, width: 64, height: 64},
    t169: {x: 64, y: 576, width: 64, height: 64},
    t170: {x: 64, y: 512, width: 64, height: 64},
    t171: {x: 64, y: 448, width: 64, height: 64},
    t172: {x: 64, y: 384, width: 64, height: 64},
    t173: {x: 64, y: 320, width: 64, height: 64},
    t174: {x: 64, y: 256, width: 64, height: 64},
    t175: {x: 64, y: 192, width: 64, height: 64},
    t176: {x: 64, y: 128, width: 64, height: 64},
    t177: {x: 64, y: 64, width: 64, height: 64},
    t178: {x: 64, y: 0, width: 64, height: 64},
    t179: {x: 0, y: 832, width: 64, height: 64},
    t180: {x: 0, y: 768, width: 64, height: 64},
    t181: {x: 0, y: 704, width: 64, height: 64},
    t182: {x: 0, y: 640, width: 64, height: 64},
    t183: {x: 0, y: 576, width: 64, height: 64},
    t184: {x: 0, y: 512, width: 64, height: 64},
    t185: {x: 0, y: 448, width: 64, height: 64},
    t186: {x: 0, y: 384, width: 64, height: 64},
    t187: {x: 0, y: 320, width: 64, height: 64},
    t188: {x: 0, y: 256, width: 64, height: 64},
  }
}

app.setMode(new ShowTilesetMode(app, tilesInfo))