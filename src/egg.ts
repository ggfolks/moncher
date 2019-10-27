import {Remover} from "tfw/core/util"
import {UUID} from "tfw/core/uuid"
import {Mutable, Value} from "tfw/core/react"
import {showGoogleLogin} from "tfw/auth/firebase"

import {App} from "./app"
import {label, button, createDialog} from "./ui"

function makeInviteUrl (app :App, ranchId :UUID, eggId :UUID) :string {
  const {protocol, host} = window.location
  return `${protocol}//${host}${app.state.appPath}${ranchId}+${eggId}`
}

export function showEggInvite (app :App, ranchId :UUID, eggId :UUID) :Remover {
  const status = Mutable.local("Click the URL to copy it to the clipboard.")
  const inviteUrl = makeInviteUrl(app, ranchId, eggId)
  return createDialog(app, "Put this egg up for adoption!", [
    label(Value.constant("Send this URL to a friend and they can adopt this egg:")),
    button("inviteUrl", "copyInviteUrl"),
    label("status"),
  ], {
    inviteUrl: Value.constant(inviteUrl),
    copyInviteUrl: () => navigator.clipboard.writeText(inviteUrl).then(
      _ => status.update("URL copied to clipboard. Paste like the wind!"),
      error => status.update(`Failed to copy URL to clipboard: ${error}`)
    ),
    status,
  })
}

export function showEggAuth (app :App) {
  const close = createDialog(app, "Log in to adopt this egg!", [
    button(Value.constant("Login with Google"), "loginGoogle")
  ], {
    loginGoogle: () => showGoogleLogin(),
  })
  app.notGuest.whenOnce(ng => ng === true, _ => close())
}

const adjectives = ["Big", "Chubby", "Fuzzy", "Lil", "Shiny", "Tiny", "Wee"]

const names = ["Alex", "Angel", "Baby", "Bailey", "Boots", "Brandy", "Buddy", "Buster", "Callie",
               "Casey", "Charlie", "Chloe", "Cleo", "Daisy", "Dakota", "Duke", "Dusty", "Fluffy",
               "Gizmo", "Jake", "Kitty", "Lucky", "Lucy", "Maggie", "Max", "Midnight", "Milo",
               "Missy", "Misty", "Mittens", "Molly", "Oliver", "Oreo", "Oscar", "Patch", "Pepper",
               "Precious", "Princess", "Pumpkin", "Rocky", "Rusty", "Sam", "Samantha", "Sammy",
               "Sassy", "Shadow", "Shelby", "Simba", "Simon ", "Smokey", "Snowball", "Socks",
               "Sophie", "Spike", "Sylvester", "Taz", "Tiger", "Toby", "Whiskers"]

const pick = <T>(values :T[]) => values[Math.floor(Math.random()*values.length)]

export const generateName = () => `${pick(adjectives)} ${pick(names)}`
