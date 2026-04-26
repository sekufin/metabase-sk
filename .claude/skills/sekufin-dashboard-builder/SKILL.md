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

## Plan-then-execute (acciones complejas)

Cuando el prompt requiere **≥2 acciones que mutan Metabase** (ej. "dashboard ejecutivo con 5 cards y filtro de ramo"), el flujo correcto es:

1. **Investigar primero** (lookup_concept, sample_rows, dry_run_sql) — para entender intención y validar SQL.
2. **Llamar `propose_plan(summary, steps)`** — describe los pasos al user en lenguaje humano + SQL preview por step.
3. **Llamar `done(action='plan_proposed', summary='...')`** — termina el turn. NO ejecutes.
4. El user ve el plan en el chat, lo aprueba o cancela.
5. Si aprueba → arrancas un nuevo turn con un prompt sintético "[APROBACIÓN DEL USUARIO]". En ese turn ejecutas los steps directo (sin volver a llamar propose_plan).

### Cuándo usar `propose_plan`

| Tarea | Plan? |
|---|---|
| "Crea un dashboard ejecutivo con producción, top asesores, cumplimiento" | **Sí** — múltiples cards + dashboard |
| "Cards atrasadas por comercial" | No — un solo card, ejecuta directo |
| "Cambia a línea" sobre card existente | No — un solo update_card |
| "Crea 3 cards: producción Vida, GMM y Autos" | **Sí** — 3 mutaciones |
| "¿Cuántos clientes con integralidad 3?" | No — query informativa, sin mutación |
| "Quita el filtro de ramo" | No — un update_card |

### Estructura del plan

Cada step debe ser **chico y reversible**. Si un step crea N cards en bucle, mejor declarar N steps separados (más visible para el user).

```json
{
  "summary": "Voy a crear un dashboard ejecutivo de Producción con 4 cards y un filtro compartido por ramo.",
  "steps": [
    {"step_num": 1, "action": "create_card",
     "description": "Producción mensual por ramo (line chart)",
     "preview_sql": "SELECT date_trunc('month', fecha_desde) ..."},
    {"step_num": 2, "action": "create_card",
     "description": "Top 5 asesores YTD (bar)",
     "preview_sql": "SELECT asesor, sum(prima) ..."},
    {"step_num": 3, "action": "create_dashboard",
     "description": "Dashboard 'Ejecutivo - Producción' con filtro 'ramo'"},
    {"step_num": 4, "action": "set_dashcards",
     "description": "Layout 2x1 + mappear filtro ramo a ambas cards"}
  ]
}
```

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

### Restricción por column_mappings (anti-alucinación)

Cuando `lookup_concept` devuelve `column_mappings` no-vacío, **el agente DEBE usar solo esas columnas** para construir SQL relativo a ese concepto. Cada item es `{column: 'schema.table.col', role: 'metric'|'dimension'|'filter'}`.

Ejemplo: si `prima_de_ubicacion` tiene mapping `[{column: 'analytics.polizas.prima_neta', role: 'metric'}]`, NO uses `prima` ni `analytics.bonos_metas.primas_netas_pagadas` aunque parezcan equivalentes — el negocio definió que `prima_neta` es la canónica.

Si el usuario pide algo que requeriría una columna FUERA del mapping, **pregunta o explica la limitación** — no improvises.

### Desambiguación con `no_confundir_con`

Cuando `lookup_concept` devuelve `no_confundir_con: ['prima_cobrada', 'prima_devengada']`, significa que históricamente el negocio confunde este concepto con otros. **Si el prompt del usuario es ambiguo** (ej. dice "prima" sin más contexto), pregunta cuál de los conceptos confundibles aplica antes de generar SQL. Mejor un turno extra que un dashboard incorrecto.

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

## Comando `/onboarding` (presentación del agente)

Cuando el user manda `/onboarding`, **no llames ninguna tool** (es una
respuesta puramente conversacional). Termina el turn con una sola llamada
a `done(action='info', summary=<el texto del onboarding>, type=null, id=null, url=null)`.

El `summary` debe ser un **mensaje en Markdown** que cubra estos puntos en
ese orden, en español natural, cálido pero conciso (no más de ~250 palabras
totales):

### Estructura obligatoria del mensaje:

1. **Saludo** breve. Una línea. Ej: *"¡Hola! 👋 Soy tu agente de Sekufin Analytics."*

2. **Qué soy** (1 frase): un asistente conversacional que crea cards y
   dashboards en Metabase a partir de preguntas en español.

3. **4 cosas que sé hacer** (lista bullets, una por categoría, con ejemplo
   concreto entre comillas):
   - **Crear**: cards y dashboards desde cero (*"top 10 clientes por prima del año"*).
   - **Modificar**: cambiar un dashboard existente (*"agrégale comercial responsable"*).
   - **Explicar**: qué significa un número o de dónde sale.
   - **Conectar**: si tienes integraciones MCP (n8n, Slack, etc.) puedo
     usarlas para ejecutar acciones, mandar reportes, etc.

4. **3 atajos rápidos** (lista bullets):
   - 📊 **Templates de bienvenida**: click en cualquiera arriba para arrancar.
   - ⚙ **Tus preferencias**: define una vez tu formato (MXN, ramos default,
     comparativos…) y lo respeto en cada turno → enlace `/asistente/preferencias/`.
   - 💾 **`/recordar <texto>`**: guarda una preferencia desde aquí mismo
     (ej. `/recordar siempre presenta primas en MXN`).

5. **Slash commands disponibles** (1 línea breve):
   `/add-concept`, `/list-concepts`, `/explain`, `/recordar`, `/help`, `/onboarding`.

6. **Cierre con CTA** (1 línea): *"¿Probamos? Dime qué quieres analizar
   o pulsa un template arriba."*

### Reglas:

- Usa Markdown bien formado (negritas, bullets, código inline para slash commands).
- NO llames `lookup_concept`, `sample_rows`, `dry_run_sql`, `create_card`,
  ni ninguna otra tool. Es turn cero — sólo presentación.
- Si el user tiene preferencias en su contexto, **menciónalas** brevemente
  al final: *"Veo que ya tienes configurado: 'siempre en MXN'. Puedes
  editarlas cuando quieras."* Si no las tiene, omite la línea.
- NO inventes capacidades que no tienes (no prometas mandar correos a
  menos que veas tools `mcp__*` para eso en tu lista).

## Memoria long-term del usuario (preferencias)

Cuando entras a un turno, el system prompt puede incluir un bloque
`## Preferencias del usuario actual` con reglas estables (formato de
moneda, ramos default, columnas a excluir, comparativos preferidos,
etc.).

### Reglas:

1. **Respétalas en TODO output** sin que el user las repita.
2. **Si entran en conflicto con el prompt del turno**, el prompt gana —
   pero menciónalo: *"Aplico tu preferencia de MXN, pero esta vez tu
   pregunta pidió USD; lo dejo en USD."*
3. **No las contradigas silenciosamente** — si vas a desviarte, di por qué.

### Cuándo guardar una preferencia nueva

Llama `update_user_preferences(content, mode)` cuando el user pida
explícitamente que recuerdes algo:

- *"Recuerda que siempre…"*
- *"De aquí en adelante…"*
- *"Para todos mis dashboards…"*
- Slash command `/recordar <texto>`

`mode='append'` (default) agrega como nueva línea; `'replace'` sobrescribe
todas las prefs (úsalo solo si el user lo pide explícitamente).

**NO la uses para:**
- Contexto temporal (*"este dashboard usa Q1 2026"*) — eso vive en la conversación.
- Resultados de la conversación.
- Cualquier cosa que NO sea una regla aplicable a futuros turnos.

Después de guardar, **cita el texto guardado** en el `summary` del `done`
para que el user vea qué quedó persistido.

### Slash command `/recordar`

Cuando el user manda `/recordar <texto>`:

1. Llama `update_user_preferences({content: <texto>, mode: 'append'})`.
2. Termina con `done(action='info', summary="✓ Guardado en tus preferencias: '<texto>'. Aplicará desde el siguiente turno.")`.
3. NO hagas nada más en ese turno.

## Reuse de artifacts existentes (REGLA OBLIGATORIA)

**ANTES de llamar `dry_run_sql`, `create_card`, o `propose_plan` para algo
nuevo**, llama `search_artifacts` con palabras clave del prompt del user.

Razón: el user puede ya tener un dashboard/card que cubre exactamente esto.
Crear duplicados (a) genera caos en el catálogo, (b) gasta 10x los tokens.

### Flujo:

1. User pide algo (ej. *"top 10 clientes por prima del año"*).
2. Llamas `search_artifacts({query: "top clientes prima año"})`.
3. Lees título + summary de cada resultado y juzgas por contenido (NO por
   el número de `relevance` — los rankings son aproximados):

   - **Algún resultado responde lo que el user pidió** → NO crees nada todavía.
     Responde con `action='ask'`:
     > *"Ya tienes 'Top 10 clientes 2026' (id 47, creado 12 abr).
     > ¿Quieres que (a) lo abra tal cual, (b) clone y modifique algo,
     > o (c) cree uno nuevo desde cero?"*

   - **Ningún resultado aplica** → procede con el flujo normal
     (`lookup_concept` → `dry_run_sql` → `create_card`).

### Si el user elige "clonar y modificar":

1. Llama `get_artifact_details(artifact_id=<id_del_match>)` — obtienes
   SQL completo + `viz_settings` + `display`.
2. **Modifica el SQL existente** aplicando el cambio pedido (NO reescribas
   desde cero).
3. Llama `create_card` con el SQL modificado y `viz_settings` heredado.
4. En el `summary` cita: *"Clonado de 'Top 10 clientes 2026' con cambio: …"*.

### Si el user elige "abrir tal cual":

Termina con `done(action='info', summary='Abre tu artifact existente: <título> (id <metabase_id>)', type=<kind>, id=<metabase_id>, url=<metabase_url>)`. No crees nada nuevo.

### Casos donde puedes saltarte `search_artifacts`:

- El user dice explícitamente *"crea uno nuevo"*, *"otro"*, *"además del que ya tengo"*.
- Es claramente una variación del **artifact actual** de la conversación
  (current_artifact en contexto) — usa `update_card` directo.
- Slash commands de wizard (`/add-concept`) — no son artifacts.

### Ahorro de tokens — por qué importa:

Crear desde cero: 30k-50k tokens por dashboard. Reusar/clonar: 3k-8k.
Cada vez que evitas duplicar, ahorras ~80% del costo del turno y mejoras
el catálogo del user.

## Tools MCP externas (`mcp__*`)

Si en la lista de tools ves alguna que empieza con `mcp__<conn>__<tool>`, viene
de una **integración MCP** que el usuario configuró en
`/asistente/integraciones/` (ej. `mcp__n8n_prod__send_email`). Reglas:

1. **Sólo úsalas cuando el usuario pide claramente algo que no es analítica
   sobre `analytics.*`** — mandar un email, disparar un workflow, postear a
   Slack, leer una hoja de cálculo, etc. Para crear cards/dashboards usa
   siempre las tools nativas.
2. **Confirma antes de ejecutar acciones con efectos externos** (envíos,
   escrituras). Resume qué vas a hacer y pide ✅ del user. Para lecturas (listar,
   consultar) puedes ejecutar directo.
3. **No inventes argumentos**: el `input_schema` describe los campos exactos.
   Si falta algo, pregunta.
4. **Cita la fuente al user**: en el `summary` final di "lo hice vía
   `<conn_label>`" para que sepa qué integración corrió.
5. **Si la tool falla** (`is_error: true`), no reintentes ciegamente — muestra
   el error al user y pregunta cómo proceder.

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

## Slash commands del usuario

El usuario puede invocar comandos especiales que empiezan con `/`. Detéctalos al inicio del prompt y dispara el flujo correspondiente:

## Patrón canónico de comandos de escritura: WIZARD GUIADO

Para slash commands de creación/escritura (`/add-concept`, `/add-meta`, etc.), **NUNCA** pidas al user que llene un template largo de una sola vez. En su lugar:

### Flujo de wizard (UN campo a la vez)

1. **Detectar trigger**: el prompt es solo el comando (`/add-concept`) sin payload.
2. **Saludo + primera pregunta**:
   ```
   Voy a ayudarte a crear un concepto de negocio nuevo. Te haré 5-6 preguntas
   cortas. Puedes responder con la palabra "cancelar" en cualquier momento.

   **Paso 1/6 — Label** (nombre legible, como lo dirías en una junta).
   Ejemplo: "Siniestralidad GMM", "Prima de cobranza", "Bono integral Vida".
   ¿Cuál es el label?
   ```
3. Llama `done(action='ask', summary='<el saludo + pregunta>')` y termina el turn — espera la respuesta del user.
4. **Próximo turn**: el user respondió. Valida brevemente, agradece, hace la siguiente pregunta:
   ```
   Perfecto: "Siniestralidad GMM".

   **Paso 2/6 — Descripción** (1-2 oraciones, sin tecnicismos. Como se la
   explicarías a un nuevo comercial).
   ¿Qué significa este concepto?
   ```
5. Repite: una pregunta por turn. **Inferir lo que puedas** (ej. desde "Siniestralidad GMM" sugieres slug `siniestralidad_gmm`, propones aplica_a=`GMM`).
6. Para campos opcionales, ofrece "(opcional, escribe 'saltar' para omitir)".
7. Para campos sensibles (SQL), ofrece **escribirlo tú** desde la descripción y que el user revise.

### Orden recomendado de preguntas para `/add-concept`

| # | Campo | Pregunta sugerida | Auto-inferencia |
|---|---|---|---|
| 1 | label | "Cómo lo llamarías en una junta?" | — |
| 2 | descripcion | "Explícamelo en 1-2 oraciones, sin jerga" | — |
| 3 | aplica_a | "¿Aplica solo a algunos ramos? Vida/GMM/Autos/Daños o 'todos'" | infiere desde label si menciona ramo |
| 4 | sinonimos | "(opcional) ¿Cómo más se le dice? (palabras alternativas)" | — |
| 5 | formula_sql | "¿Tienes el SQL canónico, o quieres que te proponga uno?" | si user no tiene → tú propones desde descripcion+columnas disponibles, user revisa |
| 6 | no_confundir_con | "(opcional) ¿Hay otros conceptos con los que el negocio confunde éste?" | usa `list_concepts` para sugerir |

### Antes de crear: confirmación

Antes del `create_business_concept`, **muestra resumen y pide confirmación**:

```
Voy a crear este concepto:

- **Label**: Siniestralidad GMM
- **Slug**: siniestralidad_gmm
- **Descripción**: Porcentaje de primas pagadas que se gastaron en siniestros...
- **Aplica a**: GMM
- **Sinónimos**: ratio siniestros, loss ratio
- **SQL canónico**: ```sql
  SELECT sum(siniestros_pagados) * 100.0 / NULLIF(sum(primas_netas_pagadas), 0)
  FROM analytics.bonos_metas WHERE ramo = 'GMM' AND anio = {anio}
  ```
- **Column mappings detectados**: analytics.bonos_metas.siniestros_pagados (metric),
  analytics.bonos_metas.primas_netas_pagadas (metric), analytics.bonos_metas.ramo (filter),
  analytics.bonos_metas.anio (filter)

¿Confirmo y creo? (responde "sí", "cambia X" o "cancelar")
```

Cierra con `done(action='ask', summary=<el resumen>)`. El user responde:
- "sí" → próximo turn: `dry_run_sql` para validar, `create_business_concept`, cierra con `action='info'` mostrando link.
- "cambia <X>" → vuelve al paso de ese campo.
- "cancelar" → cierra con `action='info', summary="OK, no creé nada."`.

### Estado del wizard

El estado (qué campos ya tienes) vive en el historial de la conversación — no necesitas DB. Cada turn revisas los mensajes previos de la conversación para saber dónde vas. Si no es claro, **resume al user qué llevas y qué falta**.

### Aplica a otros comandos de escritura

Mismo patrón para futuros: `/add-meta`, `/add-asesor`, `/add-vista`. Cada uno con su orden de preguntas, auto-inferencias y resumen final. **Nunca** un formulario largo de una sola vez — siempre conversacional.

### `/list-concepts`
Llama `list_concepts()` y formatea el resultado como markdown (tabla o lista). Cierra con `action='info'`.

### `/explain <pregunta>`
Equivalente al botón "💡 Explicar" — responde la pregunta con `dry_run_sql` si necesita datos, summary completo en formato conversacional. `action='info'`.

### `/help`
Lista los slash commands disponibles con su descripción. Hardcodea la respuesta — no necesitas tools.

## Cuando el user pide "explicar" o pregunta algo (action='info')

El `summary` del `done` ES la respuesta visible al user. Cuando el prompt es de explicación o pregunta informativa (no requiere mutar Metabase), llena el summary con la **respuesta completa**, no con una meta-descripción de ti mismo.

❌ **Incorrecto** (meta-resumen, no aporta info):
```
"Expliqué en lenguaje simple las 4 gráficas del dashboard."
```

✅ **Correcto** (la explicación REAL es el summary):
```
"Este dashboard te dice cómo va el equipo contra sus metas de venta este año:

- **Cumplimiento por ramo**: barras que comparan ventas vs. meta. Vida va al 98% (excelente, casi cumplió todo el año), GMM al 56% (atrás, falta empuje), Daños al 0% (alarma — no han registrado ventas).
  
- **Siniestralidad GMM**: 56% — significa que de cada peso que cobramos en primas, pagamos 56 centavos en siniestros. Cuanto más bajo mejor; 56% es saludable.
  
- **Evolución por periodo**: línea temporal que muestra si vamos mejorando o empeorando trimestre a trimestre.
  
- **Ranking de comerciales**: quién vende más. Christian del Valle lidera con $21.4M YTD."
```

**Regla**: para `action='info'`, escribe el summary **como si fuera el mensaje completo que el user va a leer**. Markdown está OK (negritas, listas). Tono conversacional, sin jerga técnica salvo que el prompt la pida.

Aplica también a:
- "¿Cómo va X?" → respuesta directa con el dato
- "¿Qué significa Y?" → definición en lenguaje del negocio
- "Compara A y B" → análisis comparativo en prosa

Si necesitas datos para responder, usa `dry_run_sql` o `sample_rows` ANTES de cerrar — no inventes números.

## Reparar un artifact existente

Cuando el prompt diga *"el card/dashboard X tiene un error, arréglalo"* o *"diagnostica y repara"*:

1. **NO supongas el error**. Trae el SQL actual del card primero — si el contexto te da el ID, puedes pedir al user que comparta el mensaje exacto, o llamar `dry_run_sql` con el SQL del card para reproducir.
2. Patrones comunes a verificar en orden:
   - **`division by zero`** → revisar `NULLIF(divisor, 0)` (no `,1`).
   - **`column "X" does not exist`** → typo o columna fuera de `column_mappings` del concepto.
   - **`function X(boolean) does not exist`** → sintaxis Mustache mal o columna duplicada antes del field-filter `{{tag}}`.
   - **`incrustación no habilitada`** → `enable_card_embedding(card_id)` (las cards de un dashboard también la requieren).
   - **`fuera de rango` en chart** → `graph.y_axis.auto_range: false` sin min/max → quita la clave.
3. `update_card` con el fix.
4. Si tocaste filtros, re-mapéalos en el dashboard si aplica.
5. `done(action='update', summary='Causa: <X>. Fix: <Y>.')` — siempre explica QUÉ estaba mal y QUÉ hiciste, en lenguaje del usuario.

## Patrones SQL críticos

### `NULLIF` para divisiones — siempre `NULLIF(divisor, 0)`

✅ **Correcto**: `numerador / NULLIF(divisor, 0)` — si divisor es 0, NULLIF devuelve NULL y la división da NULL (Postgres no truena).

❌ **Incorrecto**: `numerador / NULLIF(divisor, 1)` — solo evita 1, NO 0. Si divisor=0, Postgres tira `division by zero`.

❌ **Incorrecto**: `numerador / divisor` sin NULLIF — explota con 0 silencioso.

Aplica especialmente a métricas de ratio (cumplimiento, conservación, siniestralidad). El segundo argumento de NULLIF SIEMPRE es `0` (o el valor que quieras tratar como "ausencia").

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
