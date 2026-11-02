/**
 * Growable typed arrays with doubling strategy.
 * Avoids per-line reallocation during indexing.
 */

export class GrowableFloat64Array {
  private buffer: Float64Array;
  private _length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Float64Array(initialCapacity);
  }

  get length(): number {
    return this._length;
  }

  push(value: number): void {
    if (this._length === this.buffer.length) {
      const newBuffer = new Float64Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.buffer[this._length++] = value;
  }

  /** Returns a trimmed view (no copy if length equals capacity). */
  trim(): Float64Array {
    return this._length === this.buffer.length
      ? this.buffer
      : this.buffer.subarray(0, this._length);
  }
}

export class GrowableUint8Array {
  private buffer: Uint8Array;
  private _length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  get length(): number {
    return this._length;
  }

  push(value: number): void {
    if (this._length === this.buffer.length) {
      const newBuffer = new Uint8Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.buffer[this._length++] = value;
  }

  /** Returns a trimmed view (no copy if length equals capacity). */
  trim(): Uint8Array {
    return this._length === this.buffer.length
      ? this.buffer
      : this.buffer.subarray(0, this._length);
  }
}

export class GrowableUint32Array {
  private buffer: Uint32Array;
  private _length = 0;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint32Array(initialCapacity);
  }

  get length(): number {
    return this._length;
  }

  push(value: number): void {
    if (this._length === this.buffer.length) {
      const newBuffer = new Uint32Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    this.buffer[this._length++] = value;
  }

  /** Returns a trimmed view (no copy if length equals capacity). */
  trim(): Uint32Array {
    return this._length === this.buffer.length
      ? this.buffer
      : this.buffer.subarray(0, this._length);
  }
}
