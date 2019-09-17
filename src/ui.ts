import {Mutable, Value} from "tfw/core/react"
import {Action, Spec} from "tfw/ui/model"
import {LabelStyle} from "tfw/ui/text"
import {BoxStyle} from "tfw/ui/box"

function mergeExtra<T extends Object> (config :T, extra? :Object) :T {
  // TODO: deal with all the inevitable edge cases
  if (extra) {
    for (const key in extra) {
      const value = extra[key];
      if (typeof value === "object") config[key] = mergeExtra(config[key] || {}, value)
      else config[key] = value
    }
  }
  return config
}

export function label (text :Spec<Value<string>>, style? :LabelStyle, extra? :Object) {
  return mergeExtra({type: "label", text, style}, extra)
}

export function box (contents :Object, style? :BoxStyle) {
  return {type: "box", contents, style}
}

export function textBox (text :Spec<Mutable<string>>, onEnter :Spec<Action>, extra? :Object) {
  const config = {type: "text", text, onEnter, contents: box(label(text), {halign: "left"})}
  return mergeExtra(config, extra)
}

export function button (text :Spec<Value<string>>, onClick :Spec<Action>,
                        style? :LabelStyle, extra? :Object) {
  return mergeExtra({type: "button", onClick, contents: box(label(text, style))}, extra)
}

const closeX = Value.constant("×")

export function closeButton (onClick :Spec<Action>, extra? :Object) {
  return mergeExtra({type: "button", onClick, contents: box(label(closeX), {
    padding: [4, 8, 4, 8],
  })}, extra)
}
