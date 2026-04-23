# API de Metabase — referencia para el skill

Endpoint base: `http://localhost:3000/api` (dev) — en producción, el subdominio de Metabase.

## Autenticación

Metabase usa sesiones (no API keys por default en OSS).

### Login

```bash
curl -s -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{"username":"luis.cervantes@sekufin.com","password":"<admin-pass>"}'
# → {"id": "<session-token-uuid>"}
```

Todas las llamadas posteriores llevan:

```
X-Metabase-Session: <session-token-uuid>
```

El token expira después de inactividad — si obtienes `401`, re-login.

## Paso 0 — obtener el `database_id` de la conexión analytics

```bash
curl -s -H "X-Metabase-Session: $TOKEN" http://localhost:3000/api/database | \
  python3 -c "import sys,json; [print(d['id'], d['name']) for d in json.load(sys.stdin)['data']]"
```

Guarda el `id` de la DB cuyo nombre contiene "core-dashboard" o "analytics". Ejemplo: `2`.

## Crear una pregunta (card)

```bash
curl -s -X POST http://localhost:3000/api/card \
  -H "X-Metabase-Session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Producción mensual — Vida (YTD)",
    "description": "Prima nueva de Vida agrupada por mes, año actual.",
    "dataset_query": {
      "type": "native",
      "native": {
        "query": "SELECT date_trunc('\''month'\'', fecha_desde) AS mes, sum(prima) AS produccion FROM analytics.polizas WHERE ramo='\''Vida'\'' AND numero_renovacion IS NULL AND fecha_desde >= date_trunc('\''year'\'', CURRENT_DATE) GROUP BY 1 ORDER BY 1"
      },
      "database": 2
    },
    "display": "line",
    "visualization_settings": {
      "graph.dimensions": ["mes"],
      "graph.metrics": ["produccion"],
      "graph.x_axis.title_text": "Mes",
      "graph.y_axis.title_text": "Producción (MXN)"
    },
    "collection_id": null
  }'
# → {"id": 42, ...}
```

URL resultante: `http://localhost:3000/question/42`.

### `display` más comunes

| Display | Cuándo |
|---|---|
| `scalar` | 1 número |
| `bar` | Categórico vs. métrica (pocas categorías o rankings) |
| `row` | Bar horizontal (top-N) |
| `line` | Tiempo vs. métrica |
| `area` | Tiempo vs. métrica apilada |
| `pie` | Proporción (≤6 categorías) |
| `table` | Detalle / listado |
| `combo` | Líneas + barras combinadas |
| `pivot` | Matriz cruzada |

### `visualization_settings` por tipo

**bar / line**:
```json
{
  "graph.dimensions": ["<col_x>"],
  "graph.metrics": ["<col_y>"],
  "graph.x_axis.title_text": "...",
  "graph.y_axis.title_text": "..."
}
```

**scalar**:
```json
{
  "scalar.field": "<col_name>",
  "scalar.locale": "es"
}
```

**table**:
```json
{
  "table.columns": [
    {"name": "<col>", "enabled": true}
  ]
}
```

**pie**:
```json
{
  "pie.dimension": "<col_categoria>",
  "pie.metric": "<col_valor>"
}
```

## Crear un dashboard

```bash
curl -s -X POST http://localhost:3000/api/dashboard \
  -H "X-Metabase-Session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Producción YTD",
    "description": "Vista ejecutiva de producción del año.",
    "collection_id": null
  }'
# → {"id": 7, ...}
```

## Agregar cards al dashboard

Metabase usa un grid de 24 columnas. Cada dashcard tiene `col`, `row`, `size_x`, `size_y`.

La API actual (v0.50+) requiere `PUT /api/dashboard/:id` con el **dashboard completo** y un campo `dashcards` (no `cards`, cambió). El patrón correcto:

```python
# 1. GET el dashboard actual
dash = GET /api/dashboard/7

# 2. Sobrescribe dashcards
dash["dashcards"] = [
  {
    "id": -1,  # id negativo temporal para dashcards nuevos (Metabase le asigna el real)
    "card_id": 42, "col": 0, "row": 0, "size_x": 12, "size_y": 6,
    "visualization_settings": {}, "parameter_mappings": []
  },
  ...
]

# 3. PUT el dashboard completo
PUT /api/dashboard/7 body=dash
```

⚠️ El endpoint viejo `PUT /api/dashboard/:id/cards` fue removido. Si intentas usarlo obtienes `500`.

### Layout sugerido para dashboards ejecutivos

- Fila 0 (`row=0`): 3-4 KPIs scalar (`size_x=6, size_y=4` cada uno).
- Fila 1 (`row=4`): gráfica principal ancha (`size_x=24, size_y=8`).
- Filas siguientes: breakdowns en pares de `size_x=12`.

## Colecciones

Listar:
```bash
curl -s -H "X-Metabase-Session: $TOKEN" http://localhost:3000/api/collection
```

Crear (ej. colección personal de un usuario beta):
```bash
curl -s -X POST http://localhost:3000/api/collection \
  -H "X-Metabase-Session: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mis Dashboards — Luis",
    "description": "Dashboards generados por el agente IA, borradores.",
    "color": "#509EE3",
    "parent_id": null
  }'
```

Luego pasa `"collection_id": <id>` al crear cards y dashboards para dejarlos en la colección correcta.

## Validación antes de publicar

Antes de `POST /api/card` con tu SQL, valida con `EXPLAIN` usando Postgres directo:

```bash
PGPASSWORD='mb_ro_sk_kq8vN2pLx7' psql -h 161.35.228.144 -p 54320 -U metabase_ro -d testing -c "EXPLAIN <tu SQL>"
```

Si falla, **no llames la API**. Debug primero. Un card roto publicado genera un issue que luego hay que borrar manualmente.

## Borrar (rollback de iteración)

Durante desarrollo puedes borrar libremente tus propias cards/dashboards:

```bash
curl -s -X DELETE http://localhost:3000/api/card/42 -H "X-Metabase-Session: $TOKEN"
curl -s -X DELETE http://localhost:3000/api/dashboard/7 -H "X-Metabase-Session: $TOKEN"
```

Pero **no** borres nada que no hayas creado tú en esta sesión.

## Errores comunes

| HTTP | Causa habitual |
|---|---|
| 401 | Session token expirado → re-login |
| 400 `dataset_query is invalid` | SQL inválido o `database` id equivocado |
| 403 | Intentaste borrar algo de otro admin, o no tienes permiso sobre la colección |
| 500 `query execution failed` | El card se creó pero la query falla al ejecutarse — Metabase igual devuelve 201 al crear; valida con `POST /api/card/:id/query` |

## Probar que el card realmente corre

Después de crear el card, ejecútalo para confirmar que Metabase puede correrlo end-to-end:

```bash
curl -s -X POST http://localhost:3000/api/card/42/query \
  -H "X-Metabase-Session: $TOKEN"
# → {"data": {"rows": [...], ...}}
```

Si `rows` está vacío o hay `error`, el card está roto — bórralo y debug.
