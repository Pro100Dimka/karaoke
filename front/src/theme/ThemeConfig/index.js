import createTheme from "./createTheme";
import motion from "./motion";
import setTheme from "./setTheme";
import shadows from "./shadows";
import shape from "./shape";
import spacing from "./spacing";
import states from "./states";
import typography from "./typography";
import zIndex from "./zIndex";

const theme = {
  typography,
  shape,
  shadows,
  spacing,
  motion,
  states,
  zIndex
};

export { createTheme, setTheme };
export default theme;
