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
| [schema.md](schema.md) | Siempre al traducir NL → SQL. Define las vistas `analytics.*`, sus columnas y reglas de negocio críticas (ej. "póliza nueva = numero_renovacion IS NULL"). |
| [api.md](api.md) | Al llamar la API de Metabase (crear card, crear dashboard, agregar card al dashboard, obtener database_id). |

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
4. **Human-in-the-loop durante beta**: al terminar, devuelve URL + pregunta "¿se ve bien? ¿lo muevo a tu colección personal o lo borro?". No marques como oficial sin confirmación.
5. **Spanish first**: nombres de cards, titulos de ejes, títulos de dashboards siempre en español. La UI de Metabase también (`MB_SITE_LOCALE=es`).
6. **Si una métrica no se puede calcular con `analytics.*` actual**, dilo explícitamente ("falta exponer X columna en la vista Y") y no inventes una aproximación silenciosamente.

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
