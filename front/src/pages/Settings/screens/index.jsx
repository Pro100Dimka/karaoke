import About from "./about";
import Diagnostics from "./diagnostics";
import History from "./history";
import MemoryManager from "./memory";

export default [
  {
    id: "memory",
    component: MemoryManager
  },
  {
    id: "history",
    component: History
  },
  {
    id: "diagnostics",
    component: Diagnostics
  },
  {
    id: "about",
    component: About
  }
];
