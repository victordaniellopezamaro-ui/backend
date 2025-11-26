# 📦 Guía de Migraciones

## Descripción

Sistema de migraciones para gestionar la base de datos PostgreSQL. Todas las tablas y estructuras se crean automáticamente mediante migraciones.

## Archivo SQL Principal

**`create_all_tables.sql`** - Contiene todas las tablas del sistema:
- `bookmakers` - Información de casinos/bookmakers
- `game_rounds` - Resultados de rondas de Aviator
- `bookmaker_history` - Historial de cambios en bookmakers
- `logos` - Logos/imágenes de bookmakers
- `predictions` - Predicciones (legacy)
- `signals` - Señales emitidas por el sistema de patrones
- `signal_results` - Resultados de cada intento de señal
- `migrations` - Control de migraciones ejecutadas

## Comandos Disponibles

### Ejecutar migraciones
```bash
npm run migrate
# o
node migrate.js run
```

### Ver estado de migraciones
```bash
npm run migrate:status
# o
node migrate.js status
```

### Resetear migraciones (¡CUIDADO!)
```bash
npm run migrate:reset
# o
node migrate.js reset
```

## Migraciones Disponibles

### 001 - Crear tablas principales
- Ejecuta `create_all_tables.sql`
- Crea todas las tablas, índices, constraints y triggers

### 003 - Inicializar logos por defecto
- Carga logos desde `public/img-logos/`
- Logos: 1win, 1xslots, bet365, betplay, betwinner

### 004 - Crear tabla de logos
- Crea la tabla `logos` si no existe

### 005 - Crear tabla de migraciones
- Crea la tabla `migrations` para control de migraciones

### 006 - Agregar decoder_type a bookmakers
- Agrega columna `decoder_type` (auto, msgpack, sfs)
- Permite especificar qué decoder usar por bookmaker

## Estructura de Tablas

### game_rounds
- Constraint único: `(bookmaker_id, round_id)` - Evita duplicados
- Trigger automático: Actualiza `updated_at` en cada UPDATE
- Índices: bookmaker_id, timestamp, round_id, multiplicador

### signals
- Almacena señales emitidas por detección de patrones
- Estados: pending, won, lost
- Soporta sistema de gale (segundo intento)

### signal_results
- Almacena resultados de cada intento de señal
- attempt_number: 1 = primer intento, 2 = gale

## Notas Importantes

- Las migraciones son **idempotentes** (se pueden ejecutar múltiples veces)
- Usan `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`
- Las migraciones ejecutadas se registran en la tabla `migrations`
- No se ejecutan migraciones ya completadas

## Solución de Problemas

### Error: "relation already exists"
- Normal, las tablas ya existen
- Las migraciones usan `IF NOT EXISTS` para evitar errores

### Error: "column already exists"
- Normal, la columna ya fue agregada
- Las migraciones usan `IF NOT EXISTS` para evitar errores

### Reiniciar migraciones
```bash
node migrate.js reset
node migrate.js run
```

