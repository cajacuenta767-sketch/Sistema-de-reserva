export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now() {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return this.current;
  }
  set(d: Date) {
    this.current = d;
  }
}
