import { Socket } from "node:net";

// Offline child evidence must fail closed if a future import attempts I/O.
const refuseNetwork = () => {
  throw new Error("Generation fixture forbids network access");
};
globalThis.fetch = refuseNetwork;
Socket.prototype.connect = refuseNetwork;
