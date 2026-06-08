import { MAX_PASSENGERS } from './constants.js';

let nextId = 0;

export class Station {
  constructor(x, y, shape) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.shape = shape;
    this.passengers = {}; // shape -> count
    this.spawnTimer = Math.random() * 3;
    this.pulse = 0;
    this.isNew = true;
    this.newAnim = 0;
  }

  totalPassengers() {
    return Object.values(this.passengers).reduce((s, n) => s + n, 0);
  }

  addPassenger(destShape) {
    this.passengers[destShape] = (this.passengers[destShape] || 0) + 1;
  }

  takePassengers(destShape, max) {
    const n = this.passengers[destShape] || 0;
    const take = Math.min(n, max);
    if (take > 0) {
      this.passengers[destShape] -= take;
      if (this.passengers[destShape] <= 0) delete this.passengers[destShape];
    }
    return take;
  }

  dropPassengers(destShape, count) {
    this.passengers[destShape] = (this.passengers[destShape] || 0) + count;
  }

  isOverloaded() {
    return this.totalPassengers() >= MAX_PASSENGERS;
  }

  update(dt) {
    if (this.isNew) {
      this.newAnim = Math.min(1, this.newAnim + dt * 2.5);
      if (this.newAnim >= 1) this.isNew = false;
    }
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3);
  }

  pulseSnap() {
    this.pulse = 1;
  }
}
