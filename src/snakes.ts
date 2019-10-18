import {Clock} from "tfw/core/clock"
import {MapChange, RMap} from "tfw/core/rcollect"
import {Disposable, Disposer} from "tfw/core/util"
//import {log} from "tfw/core/util"
import {UUID} from "tfw/core/uuid"

import {Vector3} from "three"

import {ChatSnake, Located} from "./ranchdata"
import {copyloc, getDistance2d, loc2vec, locsEqual} from "./ranchutil"

interface Segment extends Located {
  /** The destination point of the segment, for matching it up. Sheesh. */
  x :number
  y :number
  z :number

  length :number

  /** The orientation of actors along this segment. */
  orient :number
}

type ActorUpdateFn = (id :UUID, pos :Vector3, rot :number) => void

const scratchV = new Vector3()

class SnakeRec {
	constructor (
		public snake :ChatSnake,
	) {
    this.updateSnake(snake)
	}

  updateSnake (snake :ChatSnake) :void {
    const segs = this._segments
    for (let ii = 0, nn = snake.points.length; ii < nn; ii++) {
      const loc = snake.points[ii]
      if (ii < segs.length && locsEqual(loc, segs[ii])) continue
      // otherwise push a new segment on
      const newSeg = <Segment>{}
      copyloc(loc, newSeg)
      if (ii < nn - 1) {
        const nextLoc = snake.points[ii + 1]
        newSeg.length = getDistance2d(loc, nextLoc)
        newSeg.orient = Math.atan2(loc.x - nextLoc.x, loc.z - nextLoc.z)
      } else {
        // the last segment is a bit of a dummy
        newSeg.length = 0
        newSeg.orient = 0
      }
      this._segments.splice(ii, 0, newSeg)
      // every time we add a new one, increase our index
      this._index++
    }
    // then, truncate the segments
    segs.length = snake.points.length
    // and reset the index (TODO: this could fuck up the progress tracking stuff. hm)
    if (this._index > segs.length - 2) {
      this._index = segs.length - 2
      this._progress = 0
    }

    // update our snake reference
    this.snake = snake

//    log.info("Snake updated",
//      "segments", segs,
//      "index", this._index)
  }

  update (clock :Clock, updateActor :ActorUpdateFn) :void {
    const segs = this._segments
    //if (segs.length === 0) return
    // we might just be done with this snake
    if (this._index === 0 && this._progress == segs[0].length) return

    // see how much to advance things
    const advance = this.snake.speed * clock.dt
    this._progress += advance
    while (this._progress > segs[this._index].length) {
      if (this._index > 0) {
        this._progress -= segs[this._index].length
        this._index--
      } else {
        this._progress = segs[this._index].length
        break
      }
    }

    // now calculate the positions of actors along the snake
    let index = this._index
    let dist = this._progress
    for (let ii = -1; ii < this.snake.members.length; ii++) {
      const id = (ii === -1) ? this.snake.owner : this.snake.members[ii]
      const perc = dist / segs[index].length
      scratchV.lerpVectors(loc2vec(segs[index + 1]), loc2vec(segs[index]), perc)
      updateActor(id, scratchV, segs[index].orient)

      if (ii < this.snake.members.length - 1) {
        dist -= this.snake.spacing
        while (dist < 0) {
          index++
          dist += segs[index].length
        }
      }
    }
  }

	protected _index :number = 0
  protected _progress :number = 0

  protected readonly _segments :Segment[] = []
}

/**
 * A class for managing positions along a snake. */
export class SnakeWrangler
	implements Disposable {

	constructor (
	  protected readonly updateActor :ActorUpdateFn,
	) {
	}

  start (snakes :RMap<UUID, ChatSnake>) :void {
		this._disposer.add(snakes.onChange(this._snakeChanged))
    snakes.forEach((snake, id) => this.snakeUpdated(id, snake))
  }

	/**
	 * Update the position of any actors along the snake. */
	update (clock :Clock) :void {
    for (const rec of this._recs.values()) {
      rec.update(clock, this.updateActor)
    }
	}

	// from Disposable
	dispose () :void {
		this._disposer.dispose()
	}

	protected snakeUpdated (id :UUID, snake :ChatSnake) :void {
    let rec = this._recs.get(id)
    if (rec) {
      rec.updateSnake(snake)
    } else {
      rec = new SnakeRec(snake)
      this._recs.set(id, rec)
    }
	}

	protected snakeDeleted (id :UUID) :void {
    this._recs.delete(id)
	}

  protected readonly _snakeChanged = (change :MapChange<UUID, ChatSnake>) => {
		if (change.type === "set") {
			this.snakeUpdated(change.key, change.value)
		} else {
			this.snakeDeleted(change.key)
		}
	}

	protected readonly _disposer = new Disposer()

	protected readonly _recs = new Map<UUID, SnakeRec>()
}

