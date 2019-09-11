import {Color} from "tfw/core/color"
import {StyleDefs} from "tfw/ui/style"
import {Theme} from "tfw/ui/ui"

const buttonCorner = 5
const textCorner = 2

export const moncherStyles :StyleDefs = {
  colors: {
    transWhite: Color.fromARGB(.3, 1, 1, 1),
  },
  shadows: {},
  fonts: {
    base: {family: "Helvetica", size: 16},
    icon: {family: "Helvetica", size: 24},
  },
  paints: {
    white: {type: "color", color: "#FFFFFF"},
    black: {type: "color", color: "#000000"},
    lightGray: {type: "color", color: "#999999"},
    darkGray: {type: "color", color: "#666666"},
    orange: {type: "color", color: "#F29A38"},
  },
  borders: {
    debug: {stroke: {type: "color", color: "#FF0000"}},
    button: {stroke: {type: "color", color: "#999999"}, cornerRadius: buttonCorner},
    buttonFocused: {stroke: {type: "color", color: "#FFFFFF"}, cornerRadius: buttonCorner},
    textNormal: {stroke: {type: "color", color: "#999999"}, cornerRadius: textCorner},
    textDisabled: {stroke: {type: "color", color: "#666666"}, cornerRadius: textCorner},
    textFocused: {stroke: {type: "color", color: "#6666FF"}, cornerRadius: textCorner},
  },
  backgrounds: {
    buttonNormal: {
      fill: {type: "color", color: "#99CCFF"},
      cornerRadius: buttonCorner,
      shadow: {offsetX: 2, offsetY: 2, blur: 5, color: "#000000"}
    },
    buttonPressed: {fill: {type: "color", color: "#77AADD"}, cornerRadius: buttonCorner},
    buttonDisabled: {fill: {type: "color", color: "$transWhite"}, cornerRadius: buttonCorner},
    text: {fill: {type: "color", color: "#FFFFFF"}, cornerRadius: textCorner},
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
  text: {
    box: {
      padding: 10,
      border: "$textNormal",
      background: "$text",
      hovered: {cursor: "text"},
      disabled: {border: "$textDisabled"},
      focused: {border: "$textFocused", cursor: "text"},
      hoverFocused: {border: "$textFocused", cursor: "text"},
    },
    cursor: {
      stroke: "$white",
    },
  }
}

