import {ActorConfig, ActorKind, ActorModel} from "./moncher"

export class MonsterDb {

  static getRandomMonster () :ActorConfig {
    if (!MonsterDb._monsters) MonsterDb._initMonsters()
    return MonsterDb._monsters![Math.trunc(Math.random() * MonsterDb._monsters!.length)]
  }

  static getRandomEgg () :ActorConfig {
    return MonsterDb.makeEgg(MonsterDb.getRandomMonster())
  }

  static makeEgg (monster :ActorConfig) :ActorConfig {
    const eggModel :ActorModel = {
      model: "monsters/Egg.glb",
      idle: "monsters/Egg.glb#Idle",
      readyToHatch: "monsters/Egg.glb#Ready",
      hatch: "monsters/Egg.glb#Hatch",
    }
    const color = MonsterDb._colors[Math.trunc(Math.random() * MonsterDb._colors.length)]
    return new ActorConfig(ActorKind.Egg, eggModel, monster, color)
  }

  /**
   * Init method, in case we need to do more complicated monster setup. */
  private static _initMonsters () :void {
    const monsters :ActorConfig[] = MonsterDb._monsters = []

    monsters.push(new ActorConfig(ActorKind.Lobber, <ActorModel>{
      model:      "monsters/LobberBlue.glb",
      idle:       "monsters/LobberBlue.glb#Idle",
      hatch:      "monsters/LobberBlue.glb#Hatch",
      walk:       "monsters/LobberBlue.glb#Walk",
      attack:     "monsters/LobberBlue.glb#Attack",
      hitReact:   "monsters/LobberBlue.glb#HitReact",
      eat:        "monsters/LobberBlue.glb#Eat",
      faint:      "monsters/LobberBlue.glb#Faint",
      sleep:      "monsters/LobberBlue.glb#Sleep",
      wakeUp:     "monsters/LobberBlue.glb#WakeUp",
      happyReact: "monsters/LobberBlue.glb#HappyReact",
    }))

    monsters.push(new ActorConfig(ActorKind.Lobber, <ActorModel>{
      model:      "monsters/LobberGreen.glb",
      idle:       "monsters/LobberGreen.glb#Idle",
      hatch:      "monsters/LobberGreen.glb#Hatch",
      walk:       "monsters/LobberGreen.glb#Walk",
      attack:     "monsters/LobberGreen.glb#Attack",
      hitReact:   "monsters/LobberGreen.glb#HitReact",
      eat:        "monsters/LobberGreen.glb#Eat",
      faint:      "monsters/LobberGreen.glb#Faint",
      sleep:      "monsters/LobberGreen.glb#Sleep",
      wakeUp:     "monsters/LobberGreen.glb#WakeUp",
      happyReact: "monsters/LobberGreen.glb#HappyReact",
    }))

    monsters.push(new ActorConfig(ActorKind.Lobber, <ActorModel>{
      model:      "monsters/LobberRed.glb",
      idle:       "monsters/LobberRed.glb#Idle",
      hatch:      "monsters/LobberRed.glb#Hatch",
      walk:       "monsters/LobberRed.glb#Walk",
      attack:     "monsters/LobberRed.glb#Attack",
      hitReact:   "monsters/LobberRed.glb#HitReact",
      eat:        "monsters/LobberRed.glb#Eat",
      faint:      "monsters/LobberRed.glb#Faint",
      sleep:      "monsters/LobberRed.glb#Sleep",
      wakeUp:     "monsters/LobberRed.glb#WakeUp",
      happyReact: "monsters/LobberRed.glb#HappyReact",
    }))

    monsters.push(new ActorConfig(ActorKind.Runner, <ActorModel>{
      model:      "monsters/PonyBlue.glb",
      idle:       "monsters/anim/PonyAnim.glb#Idle",
      hatch:      "monsters/anim/PonyAnim.glb#Hatch",
      walk:       "monsters/anim/PonyAnim.glb#Walk",
      attack:     "monsters/anim/PonyAnim.glb#Attack",
      hitReact:   "monsters/anim/PonyAnim.glb#HitReact",
      eat:        "monsters/anim/PonyAnim.glb#Eat",
      faint:      "monsters/anim/PonyAnim.glb#Faint",
      sleep:      "monsters/anim/PonyAnim.glb#Sleep",
      wakeUp:     "monsters/anim/PonyAnim.glb#WakeUp",
      happyReact: "monsters/anim/PonyAnim.glb#HappyReact",
    }))
    monsters.push(new ActorConfig(ActorKind.Runner, <ActorModel>{
      model:      "monsters/PonyGreen.glb",
      idle:       "monsters/anim/PonyAnim.glb#Idle",
      hatch:      "monsters/anim/PonyAnim.glb#Hatch",
      walk:       "monsters/anim/PonyAnim.glb#Walk",
      attack:     "monsters/anim/PonyAnim.glb#Attack",
      hitReact:   "monsters/anim/PonyAnim.glb#HitReact",
      eat:        "monsters/anim/PonyAnim.glb#Eat",
      faint:      "monsters/anim/PonyAnim.glb#Faint",
      sleep:      "monsters/anim/PonyAnim.glb#Sleep",
      wakeUp:     "monsters/anim/PonyAnim.glb#WakeUp",
      happyReact: "monsters/anim/PonyAnim.glb#HappyReact",
    }))
    monsters.push(new ActorConfig(ActorKind.Runner, <ActorModel>{
      model:      "monsters/PonyRed.glb",
      idle:       "monsters/anim/PonyAnim.glb#Idle",
      hatch:      "monsters/anim/PonyAnim.glb#Hatch",
      walk:       "monsters/anim/PonyAnim.glb#Walk",
      attack:     "monsters/anim/PonyAnim.glb#Attack",
      hitReact:   "monsters/anim/PonyAnim.glb#HitReact",
      eat:        "monsters/anim/PonyAnim.glb#Eat",
      faint:      "monsters/anim/PonyAnim.glb#Faint",
      sleep:      "monsters/anim/PonyAnim.glb#Sleep",
      wakeUp:     "monsters/anim/PonyAnim.glb#WakeUp",
      happyReact: "monsters/anim/PonyAnim.glb#HappyReact",
    }))
  }

  private static _monsters? :ActorConfig[]

  private static _colors = [0x74c0ff, 0xff8f2f, 0xfff474, 0x7a7fbb, 0xe193c8]
}
