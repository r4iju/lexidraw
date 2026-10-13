/** Cached pako 2.0.3 inflate-only build; upstream MIT/Zlib notices are preserved. */
declare class Inflate {
  constructor(options: { chunkSize: number; windowBits: number });
  strm: {
    total_in: number;
    total_out: number;
    avail_in: number;
    avail_out: number;
    output: Uint8Array;
    next_out: number;
  };
  ended: boolean;
  err: number;
  onData: (chunk: Uint8Array) => void;
  push(bytes: Uint8Array, final: boolean): boolean;
}

declare const pako: { Inflate: typeof Inflate };
export = pako;
