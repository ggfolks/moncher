import {ActorConfig, ActorKind, ActorModel} from "./moncher"

export class MonsterDb
{
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
      hatch: "monsters/Egg.glb#Hatch",
    }
    return new ActorConfig(ActorKind.EGG, eggModel, monster)
  }

  /**
   * Init method, in case we need to do more complicated monster setup. */
  private static _initMonsters () :void {
    const monsters :ActorConfig[] = MonsterDb._monsters = []

    monsters.push(new ActorConfig(ActorKind.LOBBER, <ActorModel>{
      model:    "monsters/LobberBlue.glb",
      idle:     "monsters/LobberBlue.glb#Idle",
      hatch:    "monsters/LobberBlue.glb#Hatch",
      walk:     "monsters/LobberBlue.glb#Walk",
      attack:   "monsters/LobberBlue.glb#Attack",
      hitReact: "monsters/LobberBlue.glb#HitReact",
      faint:    "monsters/LobberBlue.glb#Faint",
      sleep:    "monsters/LobberBlue.glb#Sleep",
      wakeUp:   "monsters/LobberBlue.glb#WakeUp",
    }))

    monsters.push(new ActorConfig(ActorKind.LOBBER, <ActorModel>{
      model:    "monsters/LobberGreen.glb",
      idle:     "monsters/LobberGreen.glb#Idle",
      walk:     "monsters/LobberGreen.glb#Walk",
      attack:   "monsters/LobberGreen.glb#Attack",
      hitReact: "monsters/LobberGreen.glb#HitReact",
      faint:    "monsters/LobberGreen.glb#Faint",

      // TODO: use correct hatch animation
      hatch:    "monsters/LobberBlue.glb#Hatch",
    }))

    monsters.push(new ActorConfig(ActorKind.LOBBER, <ActorModel>{
      idle:     "monsters/LobberRed.glb#Idle",
      walk:     "monsters/LobberRed.glb#Walk",
      attack:   "monsters/LobberRed.glb#Attack",
      model:    "monsters/LobberRed.glb",
      hitReact: "monsters/LobberRed.glb#HitReact",
      faint:    "monsters/LobberRed.glb#Faint",

      // TODO: use correct hatch animation
      hatch:    "monsters/LobberBlue.glb#Hatch",
    }))
  }

  private static _monsters? :ActorConfig[]
}
