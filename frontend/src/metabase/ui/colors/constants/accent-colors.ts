/* eslint-disable metabase/no-color-literals -- we define chart colors here to avoid duplication */

import type { ChartColorV2 } from "../types";

import { getBaseColorsForThemeDefinitionOnly } from "./base-colors";

const baseColors = getBaseColorsForThemeDefinitionOnly();

// Sekufin fork: paleta de series rebrandeada con naranja #ff6c2f como primario.
// Los siguientes colores complementan visualmente sin competir por atención.
export const DEFAULT_ACCENT_COLORS: ChartColorV2[] = [
  "#ff6c2f", // accent0 - Sekufin brand orange
  "#3fa66b", // accent1 - green (positivo/conservación)
  "#4A90E2", // accent2 - blue (serie secundaria fría)
  "#d9534f", // accent3 - red (pérdidas/alertas)
  "#f7c948", // accent4 - yellow (pendiente/neutral)
  "#7f66d4", // accent5 - purple
  "#49b3c8", // accent6 - teal
  "#8b6d4e", // accent7 - brown
];

export const LIGHT_THEME_ACCENT_COLORS: ChartColorV2[] = [
  ...DEFAULT_ACCENT_COLORS,
  {
    base: baseColors.orion[10],
    tint: baseColors.orion[5],
    shade: baseColors.orion[20],
  },
];

export const DARK_THEME_ACCENT_COLORS: ChartColorV2[] = [
  ...DEFAULT_ACCENT_COLORS,
  {
    base: baseColors.orion[80],
    tint: baseColors.orion[80],
    shade: baseColors.orion[110],
  },
];
