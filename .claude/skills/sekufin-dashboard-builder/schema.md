# Catálogo semántico — schema `analytics.*`

Fuente canónica de lo que el agente puede consultar. **Si una columna/vista no está aquí, no existe todavía** — dilo al usuario en vez de inventar.

Conexión (validación SQL):
```
host=161.35.228.144 port=54320 db=testing user=metabase_ro password=mb_ro_sk_kq8vN2pLx7
```
El rol `metabase_ro` tiene `SELECT` exclusivamente sobre `analytics.*`. `public.*` está bloqueado.

---

## `analytics.polizas` — pólizas con fechas (1,967 filas)

**Cuándo usar**: cualquier query con dimensión temporal (producción por mes, renovaciones en el trimestre, cancelaciones YTD, etc.).

**Cuándo NO usar**: si la query agrupa por `asesor` o `aseguradora` (no están en esta vista) → usa `polizas_resumen`.

| Columna | Tipo | Descripción |
|---|---|---|
| `ramo` | text | `'Vida' \| 'Autos' \| 'Daños' \| 'GMM'` |
| `numero_de_poliza` | varchar | Identificador emitido por la aseguradora |
| `fecha_desde` | date | Inicio de vigencia. **Esta es la fecha de emisión para queries de producción.** |
| `fecha_hasta` | date | Fin de vigencia |
| `prima` | numeric | Prima total (con impuestos y recargos) |
| `prima_neta` | numeric | Prima sin impuestos ni recargos |
| `estatus` | varchar | `'Vigente' \| 'Cancelada' \| 'Renovada'` |
| `linea_negocio` | varchar | `'Personal' \| 'Comercial'` |
| `subramo` | varchar | Subcategoría (p.ej. Daños → 'Hogar', 'Incendio', 'RC') |
| `aseguradora_id` | bigint | FK (nombre no expuesto aquí — usa `polizas_resumen` si necesitas el nombre) |
| `contratante_id` | bigint | FK al contratante |
| `producto_id` | bigint | FK al producto |
| `fecha_de_cancelacion` | date | NULL si la póliza no ha sido cancelada |
| `numero_renovacion` | integer | ⚠️ **No usar para filtrar renovaciones**. En esta DB siempre es `0` (Vida/GMM) o NULL (Autos/Daños). Para identificar renovaciones usa `estatus = 'Renovada'`. |

### Distribución actual

| Ramo | Filas | Prima total |
|---|---|---|
| Autos | 577 | $7,258,222 |
| Daños | 189 | $2,721,905 |
| GMM | 703 | $45,164,732 |
| Vida | 498 | $39,353,112 |

### Limitaciones conocidas

- `numero_renovacion` **no es confiable** en esta DB (ver nota en la columna). Usa `estatus` para distinguir nuevas vs. renovadas.
- No tiene `asesor` ni `aseguradora` (nombre). Join imposible directamente → usa `polizas_resumen` para esos cortes.
- `estatus` tiene valores extra en Vida: `'Plazo de pago finalizado'`, `'Terminado'` (raros, <5 rows). Los 3 canónicos son `Vigente`, `Cancelada`, `Renovada`.

---

## `analytics.polizas_resumen` — pólizas con asesor y aseguradora (1,122 filas)

Wrapper de la materialized view `dashboard_overview` del core. **Sin fechas.**

**Cuándo usar**: cualquier query que agrupe por `asesor`, `aseguradora`, o cruce ambos, sin dimensión temporal.

| Columna | Tipo | Descripción |
|---|---|---|
| `poliza_id` | bigint | ID dentro del ramo (puede colisionar entre ramos — **no usar como PK sin combinar con `ramo`**) |
| `numero_de_poliza` | varchar | Identificador emitido por la aseguradora |
| `ramo` | text | `'Vida' \| 'Autos' \| 'Daños' \| 'GMM'` |
| `aseguradora` | varchar | Nombre de la aseguradora (GNP, Qualitas, MetLife, etc.) |
| `prima` | numeric | Prima total |
| `prima_neta` | numeric | Prima sin impuestos |
| `estatus` | varchar | `'Vigente' \| 'Cancelada' \| 'Renovada'` |
| `linea_negocio` | varchar | `'Personal' \| 'Comercial'` |
| `asesor` | varchar | Nombre completo del comercial/asesor. Puede ser NULL para pólizas sin asignar. |

### Limitaciones conocidas

- Solo 1,122 filas (vs. 1,967 en `polizas`). La MV del core filtra algunas pólizas — investigar si aparece discrepancia en dashboards.

---

## `analytics.clientes` — clientes con integralidad (1,425 filas)

Wrapper de `dashboard_integrality`. Un renglón por cliente con métricas agregadas por ramo.

**Cuándo usar**: queries centradas en cliente — ranking de clientes, integralidad, prima total por cliente/asesor.

| Columna | Tipo | Descripción |
|---|---|---|
| `nombre_completo` | varchar | Nombre del cliente |
| `rfc` | varchar | RFC |
| `email`, `telefono` | varchar | Contacto |
| `edad` | numeric | Edad actual |
| `genero` | varchar | Género |
| `estado_civil` | varchar | |
| `asesor` | varchar | Nombre del comercial asignado |
| `asesor_id` | bigint | FK a `sekufin_staff` |
| `es_contratante` | boolean | TRUE si es contratante en al menos una póliza |
| `polizas_auto` | bigint | # de pólizas de Autos |
| `prima_auto` | numeric | Suma de prima en Autos |
| `polizas_gmm` | bigint | # de pólizas GMM |
| `prima_gmm` | numeric | Suma en GMM |
| `polizas_vida` | bigint | # de pólizas Vida |
| `prima_vida` | numeric | Suma en Vida |
| `polizas_danos` | bigint | # de pólizas Daños |
| `prima_danos` | numeric | Suma en Daños |
| `integralidad` | integer | # de ramos distintos con al menos una póliza (1-4) |

### Derivaciones comunes

- **Prima total por cliente**:
  ```sql
  COALESCE(prima_auto,0) + COALESCE(prima_gmm,0) + COALESCE(prima_vida,0) + COALESCE(prima_danos,0)
  ```
- **Top cliente del asesor X**: filtrar por `asesor` y ordenar por prima total desc.

---

## `analytics.asesores` — staff interno (14 filas)

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigint | PK (coincide con `asesor_id` en `clientes`) |
| `nombre` | varchar | Nombre completo |
| `rol` | varchar | Código de rol: `SA` Super Admin, `AD` Admin, `SL` Ventas, `OP` Operador, `RF` Referrer, `TC` Tech |
| `telefono` | varchar | |

**Nota**: para rankings de ventas, filtrar `rol IN ('SL','AD','SA')` (los que cierran pólizas). Los `RF` (referidores) no deben aparecer en rankings de producción.

---

## Qué NO está disponible (todavía)

Si el usuario pide alguna de estas, responde explícitamente "aún no está en el catálogo analytics" y sugiere agregar una vista:

- **Siniestros**: no hay tabla expuesta.
- **Metas / bonos**: no hay tabla expuesta.
- **Pipeline / prospectos**: no expuesto.
- **Forma de pago**: columna existe en tablas crudas pero no en `analytics.*`.
- **Suma asegurada / monto asegurado**: no expuesta.
- **Siniestralidad**: depende de tabla de siniestros que no existe.
- **Nivel hospitalario**: no expuesto.
- **Grupo (A/B/C/D)**: no expuesto.

Para exponer uno nuevo → extender `/tmp/analytics_v0.sql` con una nueva vista, o pedirle al equipo core que lo agregue.
