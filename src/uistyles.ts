import {Color} from "tfw/core/color"
import {StyleDefs} from "tfw/ui/style"
import {Theme} from "tfw/ui/ui"

const buttonCorner = 5
export const moncherStyles :StyleDefs = {
  colors: {
    transWhite: Color.fromARGB(.3, 1, 1, 1),
  },
  shadows: {},
  fonts: {
    base: {family: "Helvetica", size: 16},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    black: {type: "color", color: "#000000"},
    lightGray: {type: "color", color: "#999999"},
    darkGray: {type: "color", color: "#666666"},
  },
  borders: {
    button: {stroke: {type: "color", color: "#999999"}, cornerRadius: buttonCorner},
    buttonFocused: {stroke: {type: "color", color: "#FFFFFF"}, cornerRadius: buttonCorner},
  },
  backgrounds: {
    buttonNormal: {
      fill: {type: "color", color: "#99CCFF"},
      cornerRadius: buttonCorner,
      shadow: {offsetX: 2, offsetY: 2, blur: 5, color: "#000000"}
    },
    buttonPressed: {fill: {type: "color", color: "#77AADD"}, cornerRadius: buttonCorner},
    buttonDisabled: {fill: {type: "color", color: "$transWhite"}, cornerRadius: buttonCorner},
  },
}

export const moncherTheme :Theme = {
  default: {
    label: {
      font: "$base",
      fill: "$black",
      disabled: {
        fill: "$darkGray",
      },
      selection: {
        fill: "$lightGray",
      }
    },
    box: {},
  },
  button: {
    box: {
      padding: 10,
      border: "$button",
      background: "$buttonNormal",
      disabled: {background: "$buttonDisabled"},
      focused: {border: "$buttonFocused"},
      pressed: {border: "$buttonFocused", background: "$buttonPressed"},
    },
  },
}

