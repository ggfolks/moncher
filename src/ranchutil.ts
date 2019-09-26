import {Vector3} from "three"
import {Located} from "./ranchdata"

export function loc2vec (loc :Located, into? :Vector3) :Vector3 {
  return (into || new Vector3()).set(loc.x, loc.y, loc.z)
}

export function vec2loc (vec :Vector3, into? :Located) :Located {
  if (!into) into = <Located>{} // dangerous if Located changes...
  into.x = vec.x
  into.y = vec.y
  into.z = vec.z
  return into
}

export function copyloc (loc :Located, into? :Located) :Located {
  if (!into) into = <Located>{}
  into.x = loc.x
  into.y = loc.y
  into.z = loc.z
  return into
}

export function locsEqual (loc1 :Located, loc2 :Located) :boolean {
  return loc1.x === loc2.x && loc1.y === loc2.y && loc1.z === loc2.z
}
