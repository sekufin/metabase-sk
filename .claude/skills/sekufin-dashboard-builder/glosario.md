# Glosario de negocio — Sekufin (seguros)

Referencia canónica de términos del dominio. Léelo siempre que el usuario use un término ambiguo; tradúcelo a SQL según la columna correspondiente.

## A

- **Agente**: persona física autorizada para intermediar seguros. Tiene clave de agente por aseguradora.
- **Antigüedad**: fecha desde la cual el cliente tiene cobertura continua (importante para preexistencias en GMM).
- **Asegurado**: persona cubierta por la póliza. Puede o no ser el contratante.
- **Aseguradora**: compañía de seguros (GNP, Qualitas, MetLife, etc.). Columna `aseguradora` en `analytics.polizas_resumen`.

## B

- **Beneficiario**: persona que recibe la indemnización en caso de siniestro (principalmente en Vida).
- **Bono**: incentivo económico por cumplimiento de metas de producción o siniestralidad.

## C

- **Cartera**: conjunto de pólizas/clientes asignados a un comercial o agente. Para consultar por cartera → agrupar por `asesor`.
- **Coaseguro**: porcentaje del siniestro que paga el asegurado (ej. 10% en GMM).
- **Comercial**: ejecutivo de ventas responsable de una cartera. Sinónimo de **asesor** en este contexto. Columna `asesor` en `analytics.polizas_resumen` y `analytics.clientes`.
- **Conductor habitual**: persona que normalmente conduce el vehículo asegurado.
- **Conservación**: % de pólizas que se renuevan año con año. Cálculo: `count(numero_renovacion > 0) / count(*)` en un periodo.
- **Contratante**: persona (física o moral) que firma y paga la póliza. Columna `contratante_id` en `analytics.polizas`.

## D

- **Daños**: ramo que cubre bienes materiales (hogar, negocio, maquinaria). Valor `'Daños'` en columna `ramo`.
- **Deducible**: cantidad fija que paga el asegurado antes de que aplique la cobertura.
- **Derechos**: gastos administrativos cobrados por la aseguradora.

## E

- **Emisión**: proceso de crear/activar una póliza nueva. Una póliza recién emitida tiene `numero_renovacion IS NULL` y `estatus='Vigente'`.
- **Endoso**: modificación a una póliza existente.
- **Estatus**: estado actual de la póliza. Valores en columna `estatus`: `Vigente`, `Cancelada`, `Renovada`.

## F

- **Forma de pago**: periodicidad (Contado, Mensual, Trimestral, etc.). **No expuesta todavía** en `analytics.*` — si la piden, dilo.
- **Funnel**: embudo de ventas (prospecto → cliente). **No expuesta todavía** en `analytics.*`.

## G

- **GMM**: Gastos Médicos Mayores. Valor `'GMM'` en columna `ramo`.
- **Grupo**: segmentación de clientes por valor (A, B, C, D). **No expuesta todavía** en `analytics.*`.

## I

- **IDDocto**: identificador del documento en SICAS (sistema externo).
- **Integralidad**: # de ramos **distintos** que tiene un cliente. Mayor integralidad = cliente más valioso. Columna `integralidad` en `analytics.clientes`. Rango típico 1-4.

## K

- **KPIs**: indicadores clave (producción, siniestralidad, conservación, integralidad promedio).

## L

- **Línea de negocio**: `Personal` (individuos) o `Comercial` (empresas). Columna `linea_negocio` en `analytics.polizas` y `analytics.polizas_resumen`.
- **Líneas comerciales**: seguros para empresas (`linea_negocio='Comercial'`).
- **Líneas personales**: seguros para personas físicas (`linea_negocio='Personal'`).

## M

- **Meta**: objetivo de producción por periodo. **No expuesta todavía** en `analytics.*`.
- **Monto asegurado** / **Suma asegurada**: cantidad máxima cubierta. **No expuesta todavía** en `analytics.*`.

## N

- **Nivel hospitalario**: categoría de hospitales en GMM (Nacional, Internacional). **No expuesta** en `analytics.*`.

## P

- **PAI**: Prima Anual Individual — unidad en seguros de Vida.
- **Parentesco**: relación familiar del asegurado/beneficiario con el contratante.
- **Pipeline**: flujo de prospectos y oportunidades. **No expuesta** en `analytics.*`.
- **Póliza**: contrato de seguro. Unidad principal de análisis — un renglón = una póliza en `analytics.polizas`.
- **Preexistencia**: condición médica previa (relevante en GMM).
- **Prima**: costo total del seguro (prima_neta + recargos + derechos + IVA − descuento). Columna `prima`.
- **Prima neta**: prima sin impuestos ni recargos. Columna `prima_neta`.
- **Producción**: **prima emitida en un período** (incluye emisiones nuevas y renovaciones — ambas son "nueva pluma" para el negocio). Traducción canónica:
  ```sql
  SELECT sum(prima) FROM analytics.polizas
  WHERE fecha_desde BETWEEN <inicio> AND <fin>
  ```
  ⚠️ **No filtrar por `numero_renovacion`** — en esta DB siempre es `0` (Vida/GMM) o NULL (Autos/Daños) y no permite distinguir nuevas de renovaciones. Si el usuario pide específicamente "sin contar renovaciones", filtra `estatus <> 'Renovada'` como aproximación y adviértele de la imprecisión.
- **Producto**: tipo específico de seguro de una aseguradora. Columna `producto_id`.

## R

- **Ramo**: categoría de seguro. Valores: `GMM`, `Vida`, `Autos`, `Daños`. Columna `ramo`.
- **Recargos**: costo adicional por pago fraccionado.
- **Referidor**: persona que refiere clientes a cambio de comisión.
- **Renovación**: extensión de una póliza. Se identifica por `estatus = 'Renovada'` (la póliza previa queda en ese estado al ser reemplazada). NO usar `numero_renovacion` — en esta DB no está poblado.
- **Retención**: similar a conservación. Capacidad de mantener clientes/pólizas.

## S

- **SICAS**: sistema externo de gestión de pólizas.
- **Siniestralidad**: siniestros pagados / primas cobradas. **No expuesta** en `analytics.*` (no hay tabla de siniestros).
- **Siniestro**: evento que activa indemnización. **No expuesta** en `analytics.*`.
- **Subramo**: subcategoría dentro de un ramo (ej. Daños → Hogar, Incendio, RC). Columna `subramo` en `analytics.polizas`.

## T

- **Tabulador**: tabla de costos médicos cubiertos en GMM.
- **Traspaso**: cliente que viene de otra agencia con historial. Columna `fecha_traspaso` existe en tablas legacy pero no expuesta en vista `analytics.polizas` aún.

## V

- **Vigencia**: periodo de validez de la póliza, `fecha_desde` → `fecha_hasta`.
- **Vigente**: póliza activa (`estatus='Vigente'`).

## Abreviaturas

| Abrev | Significado |
|---|---|
| GMM | Gastos Médicos Mayores |
| HC | Health Care |
| LF | Life (Vida) |
| MXN | Pesos mexicanos |
| USD | Dólares |
| UDI | Unidad de inversión |
| PAI | Prima Anual Individual |
| RC | Responsabilidad Civil |

## Patrones de traducción NL → SQL (cheat sheet)

| Usuario dice | Filtro SQL |
|---|---|
| "producción" / "emisión" / "pluma" | filtrar por `fecha_desde` en el periodo. NO filtrar por `numero_renovacion`. |
| "renovación" | `estatus = 'Renovada'` |
| "conservación" | `count(estatus='Renovada') / count(*)` en periodo |
| "póliza nueva" (excluir renovaciones) | `estatus <> 'Renovada'` (aproximación) — advertir al usuario de la imprecisión |
| "póliza vigente" | `estatus = 'Vigente'` |
| "cancelaciones" | `estatus = 'Cancelada'` o `fecha_de_cancelacion IS NOT NULL` |
| "este año" / "YTD" | `fecha_desde >= date_trunc('year', CURRENT_DATE)` |
| "este trimestre" | `fecha_desde >= date_trunc('quarter', CURRENT_DATE)` |
| "últimos 12 meses" | `fecha_desde >= CURRENT_DATE - INTERVAL '12 months'` |
| "por asesor" / "por cartera" / "por comercial" | `GROUP BY asesor` (requiere `polizas_resumen` o `clientes`) |
| "integralidad alta" | `integralidad >= 3` |
| "cliente top" | ordenar por suma de `prima_auto + prima_gmm + prima_vida + prima_danos` |
