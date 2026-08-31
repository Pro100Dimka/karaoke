import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/theme/ui/base";
import Box from "../../src/theme/ui/Box";
import GetFormExample from "../../src/theme/ui/GetForm/Example";

createRoot(document.getElementById("root")).render(
  <Box sx={{ padding: 32, minHeight: "100vh", background: "#14060a", color: "#fff" }}>
    <GetFormExample />
  </Box>
);
