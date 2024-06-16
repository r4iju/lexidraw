/* eslint-disable @typescript-eslint/no-unused-vars */

declare type AssertEqual<T, U> = T extends U ? (U extends T ? T : never) : never;

declare type Prettify<T> = {
  [K in keyof T]: T[K];
};

export { }