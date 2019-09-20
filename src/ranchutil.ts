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

