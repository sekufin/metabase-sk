---
name: sekufin-dashboard-builder
description: Crea preguntas (cards) y dashboards en la instancia de Metabase de Sekufin a partir de solicitudes en lenguaje natural. Usa el schema analytics.* de la DB testing y publica vía la API REST de Metabase. Invocar cuando el usuario pida "crea un dashboard de...", "gráfica de...", "dame un chart de..." relacionado con pólizas, clientes, asesores o cualquier métrica del negocio de seguros.
allowed-tools: Read, Bash, Grep
---

# Sekufin Dashboard Builder

Este skill convierte peticiones en lenguaje natural (ej. "muéstrame la producción de vida por trimestre") en **cards** y **dashboards** de Metabase, usando:

1. El **schema `analytics.*`** en la DB `testing` (vistas curadas, read-only).
2. El **glosario de negocio** de seguros de Sekufin.
3. La **API REST de Metabase** (`http://localhost:3000/api`).

## Cuándo usar este skill

Invocar cuando el usuario pida cualquiera de:
- "Crea un dashboard de..."
- "Quiero una gráfica que muestre..."
- "Necesito un chart de producción / cartera / integralidad / cancelaciones / ..."
- "Agrega una tarjeta al dashboard X"

## Archivos de referencia

Lee estos archivos **a demanda** según la tarea:

| Archivo | Cuándo leerlo |
|---|---|
| [glosario.md](glosario.md) | Siempre que el usuario use un término de negocio ambiguo (ej. "producción", "integralidad", "prima nueva"). |
| [schema.md](schema.md) | Siempre al traducir NL → SQL. Define las vistas `analytics.*`, sus columnas y reglas de negocio críticas. |
| [metrics.yaml](metrics.yaml) | Definición canónica de métricas (producción, conservación, cumplimiento_meta, integralidad_promedio, ticket_promedio). **Accede vía `lookup_metric(name)`**, no leas directo. |
| [api.md](api.md) | Al llamar la API de Metabase (crear card, crear dashboard, agregar card al dashboard, obtener database_id). |

## Tools — orden de uso recomendado

1. **`lookup_concept(name)`** — **PRIMER paso** si el prompt menciona un término específico del negocio (ej. "prima de ubicación", "bono integral", "base retenida", "cartera asignada"). Estos conceptos tienen fórmula exacta mantenida por el negocio. NO reinventes. Si devuelve `ok: true`, usa `formula_sql` como base.
2. **`list_concepts(aplica_a?)`** — Si el prompt es ambiguo o quieres saber qué conceptos existen para un ramo (ej. todos los conceptos de GMM).
3. **`lookup_metric(name)`** — Métricas genéricas (producción, conservación, ticket_promedio). Úsalas si `lookup_concept` no matchea o como complemento.
4. **`sample_rows(view, where?, columns?)`** — Ver 5 filas reales de una `analytics.*` cuando dudas del formato.
5. **`dry_run_sql(sql)`** — Valida con EXPLAIN + preview. SIEMPRE antes de publicar un card.
6. **`create_card` / `create_dashboard` / `set_dashcards`** — Publica en Metabase.
7. **`done`** — Cierra con el resultado final.

### Jerarquía concepto vs. métrica

- **`lookup_concept`** = definición específica del negocio contribuida por un humano Sekufin (ej. "Prima de ubicación" en GMM = fórmula exacta que matchea con el dashboard del core). **Es la fuente de verdad cuando existe**.
- **`lookup_metric`** = fórmula genérica que aplica transversal (ej. "producción" = sum de prima en periodo). Úsala cuando no hay concepto específico.

Si ambas existen para el mismo término, **el concepto gana**.

### Usar `default_viz_settings` de las métricas

Cuando `lookup_metric` devuelve una métrica con `default_viz_settings`, **cópialas como base al crear el card**. Incluyen formato de moneda (MXN), escala (M para millones), goals (línea de meta 100% en cumplimiento), títulos de eje. Merge pattern:

```
viz_settings = {
  **lookup_metric_result["default_viz_settings"],
  "graph.dimensions": [tu_dim],
  "graph.metrics": [tu_metric_col],
}
```

**Respeta la convención `output_column`**: si la métrica dice `output_column: produccion`, escribe tu SQL con `AS produccion` (o el sufijo si agrupas — `sum(prima) AS produccion`). Los `column_settings` matchean por nombre exacto.

Los defaults de Metabase instancia ya incluyen locale `es` + separadores MX + moneda MXN, así que para números crudos no necesitas configurar nada adicional.

## Flujo de trabajo

### 1. Interpretar la intención

Extrae del request del usuario:
- **Métrica(s)**: `count(*)`, `sum(prima)`, `avg(prima_neta)`, etc.
- **Dimensiones de agrupación**: ramo, asesor, aseguradora, mes/trimestre, línea de negocio.
- **Filtros**: rango de fechas, estatus, ramo específico.
- **Tipo de visualización** (inferir si no lo dicen):
  - 1 número agregado → `scalar`
  - Dimensión categórica vs. métrica → `bar`
  - Tiempo vs. métrica → `line` (o `bar` si son pocos puntos)
  - Detalle / listado → `table`
  - Proporción del total (≤6 categorías) → `pie`

Si la intención es ambigua (ej. "un dashboard de ventas"), **pregunta 1-2 preguntas concretas** antes de generar SQL. No inventes.

### 2. Generar SQL

- **SIEMPRE** consulta `analytics.*`. Nunca toques `public.*`.
- Lee [schema.md](schema.md) para saber qué vista aplica.
- Aplica las reglas de negocio del glosario (ej. "prima nueva" ⇒ filtro `numero_renovacion IS NULL`).
- Usa `date_trunc('month'|'quarter'|'year', fecha_desde)` para series de tiempo.
- Termina con `LIMIT 10000` como salvaguarda (a menos que sea un scalar).

### 3. Validar antes de publicar

Antes de crear el card, ejecuta la query con el usuario `metabase_ro`:

```bash
PGPASSWORD='mb_ro_sk_kq8vN2pLx7' psql -h 161.35.228.144 -p 54320 -U metabase_ro -d testing -c "EXPLAIN <tu SQL>"
```

Si `EXPLAIN` falla o la query real regresa 0 filas cuando se esperaba data, **detente** y debug antes de publicar. Nunca crees un card roto.

### 4. Crear el card en Metabase

Ver [api.md](api.md) para el payload exacto. En resumen:

```
POST http://localhost:3000/api/card
{
  "name": "<título conciso en español>",
  "dataset_query": {
    "type": "native",
    "native": {"query": "<tu SQL>"},
    "database": <database_id del analytics>
  },
  "display": "<bar|line|scalar|table|pie>",
  "visualization_settings": {...},
  "collection_id": <id de "Mis Dashboards / {usuario}">
}
```

### 5. (Opcional) Agregar a un dashboard

Si la solicitud es "crea un dashboard de X" (no solo "una gráfica"):
1. Crea el dashboard con `POST /api/dashboard`.
2. Crea todas las cards.
3. Agrégalas con `POST /api/dashboard/{id}/cards`, calculando posiciones (ver api.md).

### 6. Devolver al usuario

Responde con:
- La **URL** del card o dashboard: `http://localhost:3000/question/{id}` o `/dashboard/{id}`.
- Una línea de qué hizo ("Creé un dashboard con 4 cards: ...").
- **NO guardes silenciosamente**. Marca como "borrador para revisión" durante la beta.

## Guardrails

1. **Nunca escribas contra `public.*`**. El usuario `metabase_ro` ni siquiera tiene acceso — si tu SQL lo intenta, falla rápido.
2. **Nunca `DROP`, `DELETE`, `UPDATE`, `CREATE`** en SQL. Solo `SELECT`.
3. **Valida con EXPLAIN** antes de crear el card. Un card roto en producción es peor que preguntar 1 vez.
3a. **NO uses sintaxis Mustache** (`{{#x}}...{{/x}}`, `{{^y}}...{{/y}}`). Postgres las recibe como `{` literal y falla.

3b. **Filtros interactivos SÍ están soportados** usando la sintaxis oficial de Metabase field filters. Cuando el usuario pida *"agrega filtros por X"* / *"dropdown de X"* / *"filtros interactivos"*:

   **Receta**:
   1. Escribe el SQL con `[[ AND {{nombre_tag}} ]]` para cada filtro. Los corchetes dobles marcan el clause como opcional (si el usuario no selecciona nada, desaparece).
   2. Llama `create_card` (o `update_card`) con el parámetro `filters` describiendo cada tag: column real (schema/table/column), widget_type.
   3. Metabase automáticamente genera el widget (dropdown, multi-select, date picker) a partir de los valores distintos de la columna.

   **Ejemplo** — card de pólizas con filtros por ramo y aseguradora:
   ```sql
   SELECT ramo, aseguradora_nombre, sum(prima) AS produccion
   FROM analytics.polizas
   WHERE 1=1
     [[ AND {{ramo_filter}} ]]
     [[ AND {{aseguradora_filter}} ]]
   GROUP BY ramo, aseguradora_nombre
   ORDER BY produccion DESC
   ```

   Con `filters`:
   ```json
   [
     {"name": "ramo_filter", "schema": "analytics", "table": "polizas",
      "column": "ramo", "label": "Ramo", "widget_type": "string/="},
     {"name": "aseguradora_filter", "schema": "analytics", "table": "polizas",
      "column": "aseguradora_nombre", "label": "Aseguradora", "widget_type": "string/="}
   ]
   ```

   **Convenciones**:
   - Nombre del tag en SQL: `<columna>_filter` (ej. `ramo_filter`, `comercial_filter`, `anio_filter`).
   - `WHERE 1=1` al inicio permite que los `[[ AND ]]` opcionales no rompan el SQL cuando no hay filtros. Alternativa: un `WHERE` sin la condición 1=1 si ya tienes al menos una condición fija (ej. `WHERE asesor = 'X'`).
   - `widget_type`:
     - `string/=` — multi-select para texto (el más común, default).
     - `number/=` / `number/between` — para numéricos.
     - `date/all-options` — para fechas (rango, relativo, específico).
   - El `column` debe ser la **columna real de la vista analytics**, no un alias del SELECT.

   **⚠️ Sintaxis CRÍTICA — no metas la columna dos veces**:

   ✅ **Correcto** — el tag solo, Metabase expande con la columna:
   ```sql
   [[ AND {{ramo_filter}} ]]
   ```
   Se expande internamente a `AND "analytics"."polizas"."ramo" IN ('Autos', 'Vida')`.

   ❌ **Incorrecto** — duplica la columna, Postgres lo lee como llamada a función:
   ```sql
   [[ AND polizas_auto {{filtro_autos}} ]]
   ```
   Esto produce `AND polizas_auto "polizas_auto" IN (1,2,3)` y Postgres falla con `function polizas_auto(boolean) does not exist`.

   ❌ También incorrecto — NO uses operadores de comparación antes del tag:
   ```sql
   [[ AND ramo = {{ramo_filter}} ]]       -- MAL (dimension se expande con operador propio)
   [[ AND integralidad > {{int_filter}} ]] -- MAL
   ```

   **Regla**: con filtros tipo `dimension`, el tag se expande a la cláusula completa (columna + operador + valores). Siempre solo `{{tag_name}}`.

3c. **Filtros a nivel dashboard** (afectan varios cards a la vez) — **fuertemente recomendados** cuando el dashboard tiene 2+ cards que comparten una dimensión (ej. Ramo, Aseguradora, Año). Un solo widget arriba filtra todos a la vez.

   **Receta canónica** (úsala siempre que el usuario pida "dashboard con filtros de X"):

   1. **Todas las cards del dashboard usan el MISMO nombre de template-tag**
      para la dimensión compartida. Ejemplo: todas usan `ramo_filter`.
      ```sql
      SELECT ramo, sum(prima) ...
      FROM analytics.polizas
      WHERE 1=1 [[ AND {{ramo_filter}} ]]
      GROUP BY ramo
      ```
      + `filters=[{"name":"ramo_filter","schema":"analytics","table":"polizas","column":"ramo"}]`

   2. **Crea el dashboard con el parameter correspondiente** — slug igual al
      template-tag de las cards:
      ```json
      create_dashboard(
        name="Ejecutivo — Producción",
        parameters=[{"slug": "ramo_filter", "label": "Ramo"}]
      )
      ```

   3. **En `set_dashcards`, conecta el parameter del dashboard con el tag de
      cada card** via `param_mappings`:
      ```json
      {
        "card_id": 42, "col": 0, "row": 0, "size_x": 12, "size_y": 6,
        "param_mappings": [
          {"dashboard_param_slug": "ramo_filter", "card_template_tag_name": "ramo_filter"}
        ]
      }
      ```

   Con eso el usuario ve UN filtro "Ramo" arriba del dashboard; seleccionar "Vida" filtra los 5 cards simultáneamente.

   **Cuándo usar dashboard filter vs. card filter individual**:
   - 2+ cards con la misma dimensión → **dashboard filter** (siempre).
   - Card único o filtros distintos por card → **card filter** (vía `filters` en create_card).

   **Gotcha**: si una card **no** tiene el template-tag declarado con el mismo nombre que el slug del dashboard parameter, el mapping falla silenciosamente (la card no se filtra). Asegúrate de que `create_card(filters=[...])` incluya TODOS los filtros que vayan a mapearse a nivel dashboard.

   **Para `update_card` agregando filtros a un card existente**:
   Pasa tanto `sql` (reescrito con los `[[ ]]`) como `filters`. Sin el SQL, el `update_card` deja el query viejo.
4. **Data vacía — detente y pregunta**. Si `dry_run_sql` devuelve todas las filas con la métrica principal en 0 o NULL (ej. "Cumplimiento Daños 2026" → todos los cuatrimestres con `negocios_totales=0`), **no publiques silenciosamente un chart vacío**. En el `summary` del `done` deja claro "La data está vacía para {ramo}/{periodo} — probablemente aún no ha sido cargada. ¿Quieres que use {alternativa}?" o ajusta el filtro a un periodo con data (ej. año anterior). Una respuesta "aquí está tu chart de ceros" es peor que un error.
5. **Human-in-the-loop durante beta**: al terminar, devuelve URL + summary claro sobre lo que creaste. No marques como oficial sin confirmación.
6. **Spanish first**: nombres de cards, titulos de ejes, títulos de dashboards siempre en español. La UI de Metabase también (`MB_SITE_LOCALE=es`).
7. **Si una métrica no se puede calcular con `analytics.*` actual**, dilo explícitamente ("falta exponer X columna en la vista Y") y no inventes una aproximación silenciosamente.

## Credenciales (solo para desarrollo local)

- **Metabase API**: `http://localhost:3000` — autenticar con `POST /api/session` usando credenciales del admin. Guarda el token en header `X-Metabase-Session`.
- **Postgres (validación)**: `metabase_ro @ 161.35.228.144:54320/testing`, password `mb_ro_sk_kq8vN2pLx7`.

En producción estos valores vienen de env vars / secret manager — **nunca** los hardcodees fuera de este skill.

## Ejemplos guía

### Ejemplo 1: "Muéstrame la producción mensual de Vida este año"

1. Intención: line chart, métrica=`sum(prima)`, dimensión=mes, filtros=(`ramo='Vida'`, año=actual).
2. Glosario: "producción" = prima emitida (incluye renovaciones). NO filtrar por `numero_renovacion`.
3. SQL (contra `analytics.polizas`):
   ```sql
   SELECT date_trunc('month', fecha_desde) AS mes,
          sum(prima) AS produccion
   FROM analytics.polizas
   WHERE ramo = 'Vida'
     AND fecha_desde >= date_trunc('year', CURRENT_DATE)
   GROUP BY 1 ORDER BY 1;
   ```
4. Display: `line`. Title: "Producción mensual — Vida (YTD)".

### Ejemplo 2: "Top 5 asesores por prima colocada"

1. Intención: bar chart, métrica=`sum(prima)`, dimensión=asesor, sin fecha.
2. Vista: `analytics.polizas_resumen` (tiene asesor, no tiene fecha).
3. SQL:
   ```sql
   SELECT asesor, sum(prima) AS prima_total
   FROM analytics.polizas_resumen
   WHERE asesor IS NOT NULL
   GROUP BY asesor ORDER BY prima_total DESC LIMIT 5;
   ```
4. Display: `bar`, orientación horizontal. Title: "Top 5 asesores por prima colocada".

### Ejemplo 3: "Clientes con integralidad 3+"

1. Intención: scalar (un número).
2. Glosario: "integralidad" = # de ramos distintos. En `analytics.clientes` es la columna `integralidad`.
3. SQL:
   ```sql
   SELECT count(*) FROM analytics.clientes WHERE integralidad >= 3;
   ```
4. Display: `scalar`. Title: "Clientes con integralidad 3 o más".
