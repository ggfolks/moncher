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
    return new ActorConfig(undefined, eggModel, ActorKind.EGG, monster)
  }

  /**
   * Init method, in case we need to do more complicated monster setup. */
  private static _initMonsters () :void {
    const monsters :ActorConfig[] = MonsterDb._monsters = []

    monsters.push(new ActorConfig(undefined, <ActorModel>{
      model: "monsters/LobberBlue.glb",
      idle:   "monsters/LobberBlue.glb#Idle",
      hatch:  "monsters/LobberBlue.glb#Hatch",
      walk:   "monsters/LobberBlue.glb#Walk",
      attack: "monsters/LobberBlue.glb#Attack",
    }))

    monsters.push(new ActorConfig(undefined, <ActorModel>{
      model: "monsters/LobberGreen.glb",
      idle: "monsters/LobberGreen.glb#Idle",
      walk: "monsters/LobberGreen.glb#Walk",
      attack: "monsters/LobberGreen.glb#Attack",
    }))

    monsters.push(new ActorConfig(undefined, <ActorModel>{
      idle: "monsters/LobberRed.glb#Idle",
      walk: "monsters/LobberRed.glb#Walk",
      attack: "monsters/LobberRed.glb#Attack",
      model: "monsters/LobberRed.glb",
    }))
  }

  private static _monsters? :ActorConfig[]
}
