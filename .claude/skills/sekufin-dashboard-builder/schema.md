# Catálogo semántico — schema `analytics.*`

Fuente canónica de lo que el agente puede consultar. **Si una columna/vista no está aquí, no existe todavía** — dilo al usuario en vez de inventar.

Conexión (validación SQL):
```
host=161.35.228.144 port=54320 db=testing user=metabase_ro password=mb_ro_sk_kq8vN2pLx7
```
El rol `metabase_ro` tiene `SELECT` exclusivamente sobre `analytics.*`. `public.*` está bloqueado.

---

## `analytics.polizas` — pólizas con fechas, asesor, agente, grupo (~1,967 filas)

**Cuándo usar**: queries con dimensión temporal, o que agrupen por aseguradora/producto/grupo/agente/referidor.

| Columna | Tipo | Descripción |
|---|---|---|
| `poliza_id` | bigint | ID dentro del ramo. **No es PK global** — combinar con `ramo` si necesitas uniqueness |
| `ramo` | text | `'Vida' \| 'Autos' \| 'Daños' \| 'GMM'` |
| `numero_de_poliza` | varchar | Identificador emitido por la aseguradora |
| `fecha_desde` | date | Inicio de vigencia. **Fecha de emisión para producción** |
| `fecha_hasta` | date | Fin de vigencia |
| `fecha_de_cancelacion` | date | NULL si no cancelada |
| `prima` | numeric | Prima total (con impuestos y recargos) |
| `prima_neta` | numeric | Prima sin impuestos ni recargos |
| `estatus` | varchar | `'Vigente' \| 'Cancelada' \| 'Renovada'` (Vida también: `'Plazo de pago finalizado'`, `'Terminado'`) |
| `linea_negocio` | varchar | `'Personal' \| 'Comercial'` (en testing casi todo Personal) |
| `subramo` | varchar | Subcategoría (Daños → 'Hogar', 'Incendio', 'RC'; etc.) |
| `aseguradora_id` | bigint | FK |
| `aseguradora_nombre` | varchar | Nombre legible (GNP, Qualitas, AXA, etc.) — LEFT JOINed |
| `producto_id` | bigint | FK |
| `producto_nombre` | varchar | Nombre del producto — LEFT JOINed |
| `contratante_id` | bigint | FK al contratante |
| `grupo` | varchar | Grupo empresarial/familiar (texto libre, no FK). ⚠️ Daños no tiene columna (NULL). En testing todos NULL |
| `referidor_id` | bigint | FK a `analytics.referidores`. En testing: no hay matches |
| `clave_de_agente` | varchar | Clave del agente autorizado por la aseguradora |
| `nombre_de_agente` | varchar | **Agente intermediario autorizado por la aseguradora** (no es el comercial interno de Sekufin) |

### Distribución actual

| Ramo | Pólizas | Aseguradoras | Agentes distintos |
|---|---|---|---|
| Autos | 577 | 4 | 21 |
| Daños | 189 | 4 | 16 |
| GMM | 703 | 9 | 32 |
| Vida | 498 | 7 | 25 |

Top aseguradora: **GNP** (1,414 pólizas, 72% del total). Los nombres oficiales son largos ("Grupo Nacional Provincial, S.A.B."); al graficar conviene un `CASE` para acortar (`ILIKE 'grupo nacional%'` → `'GNP'`).

### Limitaciones conocidas

- `numero_renovacion` **no es confiable** — siempre 0 (Vida/GMM) o NULL (Autos/Daños). Usa `estatus` para distinguir nuevas vs renovadas.
- `grupo` en testing siempre NULL (columna existe en Vida/Autos/GMM, ausente en Daños).
- `referidor_id` no matchea con `analytics.referidores.id` en testing.

---

## `analytics.polizas_resumen` — pólizas con asesor interno (~1,122 filas)

Wrapper de la MV `dashboard_overview`. **Sin fechas**, con nombre del asesor comercial interno.

**Cuándo usar**: queries que agrupan por `asesor` (comercial Sekufin) sin dimensión temporal.

**Diferencia clave con `polizas.nombre_de_agente`**:
- `polizas_resumen.asesor` = **comercial interno Sekufin** (ventas, cartera)
- `polizas.nombre_de_agente` = **intermediario autorizado por la aseguradora**

| Columna | Tipo | Descripción |
|---|---|---|
| `poliza_id`, `numero_de_poliza`, `ramo`, `aseguradora`, `prima`, `prima_neta`, `estatus`, `linea_negocio` | como `polizas` |
| `asesor` | varchar | Nombre del comercial interno Sekufin. Puede ser NULL |

---

## `analytics.clientes` — clientes con integralidad (~1,425 filas)

Wrapper de `dashboard_integrality`. Un renglón por cliente con métricas agregadas por ramo.

| Columna | Tipo | Descripción |
|---|---|---|
| `nombre_completo`, `rfc`, `email`, `telefono`, `edad`, `genero`, `estado_civil` | identificación |
| `asesor`, `asesor_id` | comercial asignado |
| `es_contratante` | bool | TRUE si es contratante en ≥1 póliza |
| `polizas_auto` / `prima_auto` | # y suma por Autos |
| `polizas_gmm` / `prima_gmm` | GMM |
| `polizas_vida` / `prima_vida` | Vida |
| `polizas_danos` / `prima_danos` | Daños |
| `integralidad` | integer | # de ramos distintos con ≥1 póliza (1-4) |

### Derivaciones comunes

- **Prima total por cliente**: `COALESCE(prima_auto,0) + COALESCE(prima_gmm,0) + COALESCE(prima_vida,0) + COALESCE(prima_danos,0)`
- **Top cliente del asesor X**: filtrar por `asesor`, ordenar por suma de primas desc.

---

## `analytics.asesores` — staff interno (14 filas)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint | PK (match `asesor_id` en `clientes`) |
| `nombre` | varchar | Nombre completo |
| `rol` | varchar | `SA` Super Admin, `AD` Admin, `SL` Ventas, `OP` Operador, `RF` Referrer, `TC` Tech |
| `telefono` | varchar | |

Para rankings de producción, filtrar `rol IN ('SL','AD','SA')`. `RF` son referidores internos, no productores.

---

## `analytics.bonos_metas` — metas y avance de bono por periodo (10 filas)

Union de `sekufin_valores{vida,gmm,danos,autosgnp,autosqualitas}`. Cada renglón = meta/avance de un periodo.

**Cuándo usar**: reportes de bonos, cumplimiento de meta vs. realizado, comparativas año contra año.

| Columna | Tipo | Descripción |
|---|---|---|
| `ramo` | text | `'Vida' \| 'GMM' \| 'Daños' \| 'Autos'` |
| `aseguradora` | varchar | Solo Autos: `'GNP' \| 'Qualitas'`. NULL en otros |
| `anio` | integer | 2025, 2026 en data actual |
| `periodo_tipo` | text | `'T'` (trimestral, solo Vida) o `'C'` (cuatrimestral, resto) |
| `periodo_num` | integer | Vida: 1-4; otros: 1-3 |
| `meta` | numeric | Monto meta en MXN |
| `negocios_totales` | integer | Count cerrados (Daños) |
| `base_retencion` | numeric | Base medida de conservación (Vida) |
| `base_conservada` | numeric | Primas de pólizas renovadas (Vida/GMM) |
| `base_a_conservar` | numeric | Base esperada (Vida) |
| `prima_renovacion` | numeric | Prima generada por renovaciones (Vida, Daños) |
| `siniestros_pagados` | numeric | GMM y Autos GNP |
| `primas_netas_pagadas` | numeric | Solo GMM |

### Patrones de query

- **% cumplimiento de meta (Daños)**: `negocios_totales * 1.0 / meta * 100`
- **% conservación (Vida)**: `base_conservada * 1.0 / base_a_conservar * 100`
- **Meta anual por ramo**: `sum(meta) GROUP BY ramo, anio`
- **Comparativa YoY**: `GROUP BY ramo, anio, periodo_num` → line o pivot

### Limitaciones

- `tabla_productividad` y `tabla_conservacion` (JSONB en las tablas originales) **no expuestas** — tienen estructura por subramo/aseguradora que requiere vista específica.
- Solo hay data 2025 y 2026.

---

## `analytics.referidores` — dimensión (25 filas)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint | PK (target de `polizas.referidor_id`) |
| `nombre` | varchar | Nombre |
| `rol` | varchar | `'prospectador'` u otros roles externos |

⚠️ En testing los IDs no matchean con los `referidor_id` registrados en pólizas.

---

## `analytics.grupos` — dimensión (4 filas)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint | PK |
| `nombre` | varchar | Nombre del grupo |

⚠️ `polizas.grupo` es texto libre, **no FK** a este id. Para agrupar pólizas por grupo, usar `polizas.grupo` directamente (y en testing está vacío).

---

## Qué NO está disponible (todavía)

Si el usuario pide algo aquí, responde explícitamente "aún no está en el catálogo analytics":

- **Siniestros detallados** (tabla por siniestro individual): solo agregados en `bonos_metas.siniestros_pagados`.
- **Tabla productividad/conservación por aseguradora** (JSONB): no expuesta.
- **LC (líneas comerciales) — pólizas y clientes**: tablas existen (`sekufin_polizavidalc`, `sekufin_clientelc`), vacías en testing.
- **Forma de pago**: columna en tablas crudas, no expuesta.
- **Suma asegurada / monto asegurado**: no expuesta.
- **Nivel hospitalario (GMM)**: no expuesto.
- **Pipeline / prospectos / funnel**: vive en Pipefy, no sincronizado aquí.
