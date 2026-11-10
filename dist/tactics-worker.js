import { proveVCF } from "./game.js";
self.onmessage = ({ data }) =>
  self.postMessage(
    proveVCF(data.board, data.color, { maxPly: 9, maxNodes: 200 }),
  );
