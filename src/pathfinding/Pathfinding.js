import * as THREE from "three";

import { Utils } from './Utils';
import { AStar } from './AStar';
import { Builder } from './Builder';
import { Channel } from './Channel';

import {TFW_CHECK_ASTAR_RESULT, TFW_CHECK_POLYGON} from "./TfwMods"

/**
 * Defines an instance of the pathfinding module, with one or more zones.
 */
class Pathfinding {
 constructor () {
  this.zones = {};
 }

 /**
  * (Static) Builds a zone/node set from navigation mesh geometry.
  * @param  {THREE.BufferGeometry} geometry
  * @return {Zone}
  */
 static createZone (geometry) {
  if ( geometry.isGeometry ) {
   // Haven't actually implemented support for BufferGeometry yet, but Geometry is somewhat
   // not-recommended these days, so go ahead and start warning.
   //console.warn('[three-pathfinding]: Use THREE.BufferGeometry, not THREE.Geometry, to create zone.');
  } else {
   geometry = new THREE.Geometry().fromBufferGeometry(geometry);
  }

  return Builder.buildZone(geometry);
 }

 /**
  * Sets data for the given zone.
  * @param {string} zoneID
  * @param {Zone} zone
  */
 setZoneData (zoneID, zone) {
  this.zones[zoneID] = zone;
 }

 /**
  * Returns a random node within a given range of a given position.
  * @param  {string} zoneID
  * @param  {number} groupID
  * @param  {THREE.Vector3} nearPosition
  * @param  {number} nearRange
  * @return {THREE.Vector3}
  */
 getRandomNode (zoneID, groupID, nearPosition, nearRange) {

  if (!this.zones[zoneID]) return new THREE.Vector3();

  nearPosition = nearPosition || null;
  nearRange = nearRange || 0;

  const candidates = [];
  const polygons = this.zones[zoneID].groups[groupID];

  polygons.forEach((p) => {
   if (nearPosition && nearRange) {
    if (Utils.distanceToSquared(nearPosition, p.centroid) < nearRange * nearRange) {
     candidates.push(p.centroid);
    }
   } else {
    candidates.push(p.centroid);
   }
  });

  return Utils.sample(candidates) || new THREE.Vector3();
 }

 /**
  * Returns a random-ish point within a given range of a given position.
  * Unlike getRandomNode, this will pick a random point on each face.
  *
  * @param  {string} zoneID
  * @param  {number} groupID
  * @param  {THREE.Vector3} nearPosition
  * @param  {number} maxDist
  * @return {THREE.Vector3|undefined}
  */
 getRandomPositionFrom (zoneID, groupID, nearPosition, maxDist = Infinity) {
   const zone = this.zones[zoneID];
   if (!zone) return undefined;

   const candidates = [];
   const polygons = this.zones[zoneID].groups[groupID];
   const maxDistSq = maxDist * maxDist
   polygons.forEach((p) => {
      const a = Math.random(), b = Math.random(), c = Math.random();
      const vv = new THREE.Vector3()
          .addScaledVector(zone.vertices[p.vertexIds[0]], a)
          .addScaledVector(zone.vertices[p.vertexIds[1]], b)
          .addScaledVector(zone.vertices[p.vertexIds[2]], c)
          .divideScalar(a + b + c);
      if (nearPosition.distanceToSquared(vv) < maxDistSq) candidates.push(vv);
   });

   return Utils.sample(candidates); // or undefined
 }

 /**
  * Returns the closest node to the target position.
  * @param  {THREE.Vector3} position
  * @param  {string}  zoneID
  * @param  {number}  groupID
  * @param  {boolean} checkPolygon
  * @return {Node}
  */
 getClosestNode (position, zoneID, groupID, checkPolygon = false) {
  const nodes = this.zones[zoneID].groups[groupID];
  const vertices = this.zones[zoneID].vertices;
  let closestNode = null;
  let closestDistance = Infinity;

  nodes.forEach((node) => {
   const distance = Utils.distanceToSquared(node.centroid, position);
   if (distance < closestDistance
     && (!checkPolygon || Utils.isVectorInPolygon(position, node, vertices))) {
    closestNode = node;
    closestDistance = distance;
   }
  });

  return closestNode;
 }

 /**
  * Returns a path between given start and end points. If a complete path
  * cannot be found, will return the nearest endpoint available.
  *
  * @param  {THREE.Vector3} startPosition Start position.
  * @param  {THREE.Vector3} targetPosition Destination.
  * @param  {string} zoneID ID of current zone.
  * @param  {number} groupID Current group ID.
  * @return {Array<THREE.Vector3>} Array of points defining the path.
  */
 findPath (startPosition, targetPosition, zoneID, groupID) {
  const nodes = this.zones[zoneID].groups[groupID];
  const vertices = this.zones[zoneID].vertices;

  const closestNode = this.getClosestNode(startPosition, zoneID, groupID, TFW_CHECK_POLYGON);
  const farthestNode = this.getClosestNode(targetPosition, zoneID, groupID, TFW_CHECK_POLYGON);

  // If we can't find any node, just go straight to the target
  if (!closestNode || !farthestNode) {
   return null;
  }

  const paths = AStar.search(nodes, closestNode, farthestNode);
  if (TFW_CHECK_ASTAR && (paths.length === 0)) return null

  const getPortalFromTo = function (a, b) {
   for (var i = 0; i < a.neighbours.length; i++) {
    if (a.neighbours[i] === b.id) {
     return a.portals[i];
    }
   }
  };

  // We have the corridor, now pull the rope.
  const channel = new Channel();
  channel.push(startPosition);
  for (let i = 0; i < paths.length; i++) {
   const polygon = paths[i];
   const nextPolygon = paths[i + 1];

   if (nextPolygon) {
    const portals = getPortalFromTo(polygon, nextPolygon);
    channel.push(
     vertices[portals[0]],
     vertices[portals[1]]
    );
   }
  }
  channel.push(targetPosition);
  channel.stringPull();

  // Return the path, omitting first position (which is already known).
  const path = channel.path.map((c) => new THREE.Vector3(c.x, c.y, c.z));
  path.shift();
  return path;
 }


 // RJG 2019-10-02: Adapted from babylon.js navigation code. Doesn't seem to work for me.
 // Falling back to just using the Raycaster.
// /**
//  * Project a point onto the navmesh.
//  *
//  * @param  {THREE.Vector3} position Start position.
//  * @param  {string} zoneID ID of current zone.
//  * @param  {number} groupID Current group ID.
//  * @return {THREE.Vector3} Position on the navmesh, or null.
//  */
//  projectOnNavmesh (position, zoneID, groupID) {
//    const nodes = this.zones[zoneID].groups[groupID];
//    const vertices = this.zones[zoneID].vertices;
//
//    let closestNode = null;
//    let distance = Infinity;
//    let finalProj = null,
//      proj = null,
//      node = null,
//      measuredDistance = 0;
//
//    for (let i = 0; i < nodes.length; i++) {
//      node = nodes[i];
//
//      proj = this._getProjectionOnNode(position, node, vertices);
//      measuredDistance = position.distanceToSquared(proj);
//
//      if (measuredDistance < distance) {
//        distance = measuredDistance;
//        //this.meshes[3].position.copyFrom(proj);
//        finalProj = proj;
//        closestNode = node;
//      }
//
//    }
//
//    return finalProj;
//  }
//
//  _projectPointOnPlane (point, plane) {
//    const coef = point.dot(plane.normal) + plane.d;
//    const proj = point.clone().sub(plane.normal.clone().multiplyScalar(coef));
//
//    return proj;
//  }
//
// /**
//  * Project a point onto one node (is that a face?).
//  *
//  * @param  {THREE.Vector3} position Start position.
//  * @param  {Node} node the node
//  * @param  {number} groupID Current group ID.
//  * @return {THREE.Vector3} Position on the navmesh, or null.
//  */
//  _getProjectionOnNode (position, node, vertices) {
//
//    const A = this._getVectorFrom(vertices, node.vertexIds[0]);
//    const B = this._getVectorFrom(vertices, node.vertexIds[1]);
//    const C = this._getVectorFrom(vertices, node.vertexIds[2]);
//    const u = B.clone().sub(A);
//    const v = C.clone().sub(A);
//    const n = u.clone().cross(v).normalize();
//
//    const plane = {
//      normal: n,
//      d: -A.dot(n)
//    };
//    const p = this._projectPointOnPlane(position, plane);
//    // Compute barycentric coordinates (u, v, w) for
//    // point p with respect to triangle (a, b, c)
//    const barycentric = function (p, a, b, c) {
//      const ret = {};
//
//      const v0 = c.clone().sub(a),
//        v1 = b.clone().sub(a),
//        v2 = p.clone().sub(a);
//
//      const d00 = v0.dot(v0);
//      const d01 = v0.dot(v1);
//      const d02 = v0.dot(v2);
//      const d11 = v1.dot(v1);
//      const d12 = v1.dot(v2);
//      const denom = d00 * d11 - d01 * d01;
//      ret.u = (d11 * d02 - d01 * d12) / denom;
//      ret.v = (d00 * d12 - d01 * d02) / denom;
//      ret.w = 1 - ret.u - ret.v;
//
//      return ret;
//    };
//
//    const bary = barycentric(p, A, B, C);
//
//    bary.u = Math.min(Math.max(bary.u, 0), 1);
//    bary.v = Math.min(Math.max(bary.v, 0), 1);
//
//    if (bary.u + bary.v >= 1) {
//      const sum = bary.u + bary.v;
//      bary.u /= sum;
//      bary.v /= sum;
//    }
//
//    const proj = A.clone().add(B.clone().sub(A).multiplyScalar(bary.v).add(C.clone().sub(A).multiplyScalar(bary.u)));
//
//    return proj;
//  }
//
//  _getVectorFrom (vertices, id,/* _vector*/) {
////    if (_vector) {
////      return _vector.set(vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]);
////    }
//    return new THREE.Vector3(vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]);
//  }
}

/**
 * Returns closest node group ID for given position.
 * @param  {string} zoneID
 * @param  {THREE.Vector3} position
 * @return {number}
 */
Pathfinding.prototype.getGroup = (function() {
 const plane = new THREE.Plane();
 return function (zoneID, position, checkPolygon = false) {
  if (!this.zones[zoneID]) return null;

  let closestNodeGroup = null;
  let distance = Math.pow(50, 2);
  const zone = this.zones[zoneID];

  for (let i = 0; i < zone.groups.length; i++) {
   const group = zone.groups[i];
   for (const node of group) {
    if (checkPolygon) {
     plane.setFromCoplanarPoints(
      zone.vertices[node.vertexIds[0]],
      zone.vertices[node.vertexIds[1]],
      zone.vertices[node.vertexIds[2]]
     );
     if (Math.abs(plane.distanceToPoint(position)) < 0.01) {
      const poly = [
       zone.vertices[node.vertexIds[0]],
       zone.vertices[node.vertexIds[1]],
       zone.vertices[node.vertexIds[2]]
      ];
      if(Utils.isPointInPoly(poly, position)) {
       return i;
      }
     }
    }
    const measuredDistance = Utils.distanceToSquared(node.centroid, position);
    if (measuredDistance < distance) {
     closestNodeGroup = i;
     distance = measuredDistance;
    }
   }
  }

  return closestNodeGroup;
 };
}());

/**
 * Clamps a step along the navmesh, given start and desired endpoint. May be
 * used to constrain first-person / WASD controls.
 *
 * @param  {THREE.Vector3} start
 * @param  {THREE.Vector3} end Desired endpoint.
 * @param  {Node} node
 * @param  {string} zoneID
 * @param  {number} groupID
 * @param  {THREE.Vector3} endTarget Updated endpoint.
 * @return {Node} Updated node.
 */
Pathfinding.prototype.clampStep = (function () {
 const point = new THREE.Vector3();
 const plane = new THREE.Plane();
 const triangle = new THREE.Triangle();

 const endPoint = new THREE.Vector3();

 let closestNode;
 let closestPoint = new THREE.Vector3();
 let closestDistance;

 return function (startRef, endRef, node, zoneID, groupID, endTarget) {
  const vertices = this.zones[zoneID].vertices;
  const nodes = this.zones[zoneID].groups[groupID];

  const nodeQueue = [node];
  const nodeDepth = {};
  nodeDepth[node.id] = 0;

  closestNode = undefined;
  closestPoint.set(0, 0, 0);
  closestDistance = Infinity;

  // Project the step along the current node.
  plane.setFromCoplanarPoints(
   vertices[node.vertexIds[0]],
   vertices[node.vertexIds[1]],
   vertices[node.vertexIds[2]]
  );
  plane.projectPoint(endRef, point);
  endPoint.copy(point);

  for (let currentNode = nodeQueue.pop(); currentNode; currentNode = nodeQueue.pop()) {

   triangle.set(
    vertices[currentNode.vertexIds[0]],
    vertices[currentNode.vertexIds[1]],
    vertices[currentNode.vertexIds[2]]
   );

   triangle.closestPointToPoint(endPoint, point);

   if (point.distanceToSquared(endPoint) < closestDistance) {
    closestNode = currentNode;
    closestPoint.copy(point);
    closestDistance = point.distanceToSquared(endPoint);
   }

   const depth = nodeDepth[currentNode];
   if (depth > 2) continue;

   for (let i = 0; i < currentNode.neighbours.length; i++) {
    const neighbour = nodes[currentNode.neighbours[i]];
    if (neighbour.id in nodeDepth) continue;

    nodeQueue.push(neighbour);
    nodeDepth[neighbour.id] = depth + 1;
   }
  }

  endTarget.copy(closestPoint);
  return closestNode;
 };
}());

/**
 * Defines a zone of interconnected groups on a navigation mesh.
 *
 * @type {Object}
 * @property {Array<Group>} groups
 * @property {Array<THREE.Vector3} vertices
 */
const Zone = {}; // jshint ignore:line

/**
 * Defines a group within a navigation mesh.
 *
 * @type {Object}
 */
const Group = {}; // jshint ignore:line

/**
 * Defines a node (or polygon) within a group.
 *
 * @type {Object}
 * @property {number} id
 * @property {Array<number>} neighbours IDs of neighboring nodes.
 * @property {Array<number} vertexIds
 * @property {THREE.Vector3} centroid
 * @property {Array<Array<number>>} portals Array of portals, each defined by two vertex IDs.
 * @property {boolean} closed
 * @property {number} cost
 */
const Node = {}; // jshint ignore:line

export { Pathfinding };
