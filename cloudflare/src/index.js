// Workers interprets every entrypoint export as a handler. Keep test helpers
// and protocol constants in worker.js, not among the deployed entrypoints.
export { default, KaraokeRoom } from "./worker.js";
