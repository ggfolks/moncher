export const NORTHWEST = 1
export const NORTH = 2
export const NORTHEAST = 4
export const WEST = 8
export const EAST = 16
export const SOUTHWEST = 32
export const SOUTH = 64
export const SOUTHEAST = 128

export const SOUTHERN = SOUTH | SOUTHWEST | SOUTHEAST
export const WESTERN = WEST | SOUTHWEST | NORTHWEST
export const NORTHERN = NORTH | NORTHWEST | NORTHEAST
export const EASTERN = EAST | SOUTHEAST | NORTHEAST

/** An array representing the x/y offsets and which fringe bits are represented. */
//const INFLUENCES :Array<Array<number>> = [
//  [ NORTHWEST, NORTHERN, NORTHEAST ],
//  [ WESTERN, 0, EASTERN ],
//  [ SOUTHWEST, SOUTHERN, SOUTHEAST ]
//]

/** For each fringe tile, put the bits required for it in the corresponding array index. */
export type FringeConfig = Array<number>

