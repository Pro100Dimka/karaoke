import React from "react";
import { createRoot } from "react-dom/client";
import Grid from "../../src/theme/ui/Grid";

const cell = { background: "#e6e6ff", paddingBlock: 16, textAlign: "center" };

createRoot(document.getElementById("root")).render(
  <>
    <h1>Размеры отдельных ячеек</h1>
    <Grid container gap={16} data-testid="sizes">
      <Grid item xs={12} sm={6} md={8} lg={3} xl={2} sx={cell} data-testid="first">
        A: 12 / 6 / 8 / 3 / 2
      </Grid>
      <Grid item xs={12} sm={6} md={4} lg={9} xl={10} sx={cell} data-testid="second">
        B: 12 / 6 / 4 / 9 / 10
      </Grid>
      <Grid size={12} sx={cell}>
        C: всегда вся строка
      </Grid>
    </Grid>
    <h2>Наследование xs → sm и md → lg → xl</h2>
    <Grid container gap={16} data-testid="inheritance">
      <Grid xs={12} md={6} sx={cell} data-testid="inherited">
        xs=12, md=6
      </Grid>
      <Grid size={{ xs: 12, md: 6 }} sx={cell}>
        size: xs=12, md=6
      </Grid>
    </Grid>
    <h2>Вложенная сетка</h2>
    <Grid container columns={{ xs: 4, md: 12 }} gap={16}>
      <Grid container item xs={4} md={6} columns={2} gap={8} data-testid="nested">
        <Grid xs={1} sx={cell}>
          Nested A
        </Grid>
        <Grid xs={1} sx={cell}>
          Nested B
        </Grid>
      </Grid>
    </Grid>
    <h2>Обычный Grid: три колонки</h2>
    <Grid columns={3} gap={16} data-testid="legacy">
      <div style={cell}>A</div>
      <div style={cell}>B</div>
      <div style={cell}>C</div>
    </Grid>
  </>
);
