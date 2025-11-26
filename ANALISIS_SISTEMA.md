# 📊 Análisis Completo del Sistema de Extracción de Datos de Casino

## 🎯 Resumen Ejecutivo

Sistema backend en Node.js para extraer, procesar y almacenar datos de juegos Aviator en tiempo real desde múltiples bookmakers mediante conexiones WebSocket. El sistema incluye detección de patrones, emisión de señales de trading y una API REST completa.

---

## 🏗️ Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────────────────────────────────────────────────┐
│                    SERVER.JS (Entry Point)                 │
│  - Express Server                                            │
│  - Socket.IO Server                                          │
│  - CORS Configuration                                        │
│  - Database Initialization                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐          ┌────────▼────────┐
│  WebSocket     │          │   API Routes     │
│  Service       │          │   (REST)         │
└───────┬────────┘          └──────────────────┘
        │
┌───────▼──────────────────────────────────────┐
│         DECODER LAYER                        │
│  - Unified Decoder (Router)                  │
│  - SFS Decoder (SmartFoxServer)              │
│  - MessagePack Decoder                       │
└───────┬──────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────┐
│         DATA PROCESSING                      │
│  - Pattern Detection Service                 │
│  - Signal Generation                         │
│  - Round Data Processing                     │
└───────┬──────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────┐
│         DATABASE LAYER (PostgreSQL)          │
│  - game_rounds                                │
│  - signals                                    │
│  - signal_results                             │
│  - bookmakers                                 │
│  - bookmaker_history                          │
└──────────────────────────────────────────────┘
```

---

## 📁 Estructura de Archivos

### `/src/config/`
- **`database.js`**: Configuración del pool de conexiones PostgreSQL
  - Soporta URL completa o variables separadas
  - Pool con máximo 10 conexiones
  - Reintentos automáticos en caso de errores de conexión
  - SSL configurado para servicios cloud (Render, Railway, Heroku)

### `/src/services/Aviator/`

#### **`webSocketService.js`** (Componente Principal)
**Responsabilidades:**
- Gestión de conexiones WebSocket a múltiples bookmakers
- Decodificación de mensajes binarios
- Procesamiento de eventos de juego (apuestas, multiplicadores, cashouts)
- Persistencia de datos de rondas
- Monitoreo de salud de conexiones
- Reconexión automática

**Características Clave:**
- ✅ Manejo de múltiples bookmakers simultáneamente
- ✅ Sistema de health check cada 30 segundos
- ✅ Prevención de duplicados (en memoria y BD)
- ✅ Generación de roundId temporales si no llegan del servidor
- ✅ Múltiples puntos de guardado (changeState, comando 'x', roundChartInfo)
- ✅ Sistema de backup para rondas fallidas

**Estados del Juego:**
- `Bet` (1): Apuestas abiertas
- `Run` (2): Avión volando
- `End` (3): Juego terminado

**Comandos Procesados:**
- `updateCurrentBets`: Actualiza conteo de apuestas y monto total
- `onlinePlayers`: Actualiza jugadores en línea
- `changeState`: Cambia estado del juego (Bet/Run/End)
- `updateCurrentCashOuts`: Registra cashouts de jugadores
- `x`: Multiplicador actual (x) o final (crashX)
- `roundChartInfo`: Información de la ronda (backup)

#### **`decoder-unified.js`** (Router de Decoders)
**Funcionalidad:**
- Detecta automáticamente el tipo de mensaje (SFS o MessagePack)
- Intenta decodificar con el decoder apropiado
- Fallback automático si un decoder falla
- Análisis de mensajes para debugging

**Tipos de Decoders:**
- `sfs`: SmartFoxServer (formato binario con zlib)
- `msgpack`: MessagePack (formato moderno)
- `auto`: Detección automática (default)

#### **`decoder.js`** (SFS Decoder)
**Implementación:**
- Decodifica mensajes binarios de SmartFoxServer
- Soporta compresión zlib
- Lee tipos de datos: NULL, BOOL, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, STRING, ARRAYS, OBJECTS
- Maneja estructuras anidadas (SFS_OBJECT, SFS_ARRAY)

#### **`decoder-msgpack.js`** (MessagePack Decoder)
**Implementación:**
- Decodifica mensajes MessagePack usando `msgpack-lite`
- Normaliza estructuras para compatibilidad con SFS
- Detecta comandos automáticamente basado en campos presentes
- Soporta múltiples formatos de MessagePack (arrays, maps, objetos directos)

#### **`patternDetectionService.js`** (Sistema de Señales)
**Patrón Detectado:**
```
Resultado 1: > 1.50x
Resultado 2: > 1.50x
Resultado 3: < 2.00x
→ EMITE SEÑAL
```

**Lógica de Verificación:**
- **Primer Intento**: Si resultado > 1.50x → GANA, si ≤ 1.50x → Espera gale
- **Segundo Intento (Gale)**: Si resultado > 1.50x → GANA, si ≤ 1.50x → PIERDE

**Características:**
- Prevención de duplicados en procesamiento
- Una señal pendiente por bookmaker
- Emisión de eventos WebSocket para frontend
- Registro completo en BD (signals + signal_results)

### `/src/models/Aviator/`

#### **`bookmakerModel.js`**
- CRUD de bookmakers
- Obtiene bookmakers activos con configuraciones WebSocket
- Campos: id, name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type

#### **`gameRoundModel.js`**
**Funcionalidades:**
- `addRound()`: Inserta nueva ronda con prevención de duplicados
- `findSimilarRound()`: Busca rondas similares (mismo multiplicador, timestamp cercano)
- `findByRoundId()`: Busca por round_id único
- `updateRoundId()`: Actualiza round_id temporal con ID real
- `getLastResults()`: Obtiene últimos N resultados (sin duplicados)

**Prevención de Duplicados:**
- Constraint único: `(bookmaker_id, round_id)`
- Verificación por multiplicador similar (±0.01) en ventana de 5 minutos
- Actualización de IDs temporales cuando llega el ID real

#### **`signalModel.js`**
**Funcionalidades:**
- `createSignal()`: Crea nueva señal con patrón detectado
- `updateFirstAttempt()`: Registra resultado del primer intento
- `updateSecondAttempt()`: Registra resultado del gale
- `getSignalsWithResults()`: Obtiene señales con sus resultados
- `getSignalStats()`: Estadísticas de señales (ganadas, perdidas, pendientes)

**Estados de Señal:**
- `pending`: Esperando verificación
- `won`: Ganada
- `lost`: Perdida

#### **`bookmakerHistoryModel.js`**
- Registra todos los cambios en bookmakers (creación, actualización, eliminación)
- Campos: bookmaker_id, action, field_name, old_value, new_value, created_at

### `/src/routes/Aviator/`

#### **`aviatorRoutes.js`** (API REST Completa)

**Endpoints de Bookmakers:**
- `GET /api/aviator/bookmakers` - Lista todos los bookmakers
- `GET /api/aviator/bookmakers/:id` - Obtiene un bookmaker
- `POST /api/aviator/bookmakers` - Crea nuevo bookmaker
- `PUT /api/aviator/bookmakers/:id` - Actualiza bookmaker (reinicia WebSocket)
- `DELETE /api/aviator/bookmakers/:id` - Elimina bookmaker

**Endpoints de Rondas:**
- `GET /api/aviator/rounds/:bookmakerId` - Obtiene rondas de un bookmaker
- `POST /api/aviator/rounds` - Crea ronda manualmente

**Endpoints de Estado:**
- `GET /api/aviator/status` - Estado de conexiones WebSocket
- `GET /api/aviator/health` - Health check detallado de bookmakers
- `POST /api/aviator/reset-connections` - Reinicia todas las conexiones

**Endpoints de Señales:**
- `GET /api/aviator/signals/:bookmakerId` - Señales de un bookmaker
- `GET /api/aviator/signals` - Todas las señales
- `GET /api/aviator/signals/stats/:bookmakerId?` - Estadísticas de señales
- `GET /api/aviator/signals/pending` - Señales pendientes

**Endpoints de Historial:**
- `GET /api/aviator/bookmakers/:id/history` - Historial de un bookmaker
- `GET /api/aviator/history` - Historial general

**Otros:**
- `GET /api/aviator/server-time` - Hora del servidor

### `/src/routes/`

#### **`logoRoutes.js`**
- CRUD de logos de bookmakers
- Almacenamiento en base de datos (BLOB)
- Endpoints para servir imágenes
- Inicialización de logos por defecto

---

## 🔄 Flujo de Datos

### 1. Inicialización
```
Server.js → initializeDatabase() → migrate.js
         → aviatorWebSocketService.initializeConnections(io)
         → getBookmakersWithConfigs()
         → connectToBookmaker() para cada bookmaker activo
```

### 2. Conexión WebSocket
```
connectToBookmaker()
  → Crea WebSocket con headers personalizados
  → Envía first_message (base64)
  → Espera respuesta
  → Envía second_message (base64)
  → Inicia ping cada 10 segundos (third_message)
```

### 3. Procesamiento de Mensajes
```
WebSocket.on('message')
  → unifiedDecoder.decodeMessage(data, decoderType)
    → detectDecoderType() o usa decoder_type del bookmaker
    → decoder.decodeMessage() (SFS o MessagePack)
  → Normaliza estructura a { p: { c: 'comando', p: {...} } }
  → Procesa según comando:
    - updateCurrentBets → Actualiza roundData
    - changeState → Cambia estado, guarda ronda si End
    - x → Actualiza multiplicador, guarda si crashX
    - updateCurrentCashOuts → Suma cashouts
  → Emite evento 'round' al frontend
```

### 4. Guardado de Ronda
```
saveRoundData()
  → Valida crashX > 0
  → Verifica duplicados (findSimilarRound)
  → Genera roundId temporal si no existe
  → GameRound.addRound()
    → Verifica duplicados por round_id
    → Verifica duplicados por multiplicador similar
    → INSERT con ON CONFLICT DO UPDATE
  → patternDetectionService.processNewResult()
    → Verifica señales pendientes
    → Detecta nuevos patrones
    → Emite señal si detecta patrón
  → Emite evento 'newRound' al frontend
```

### 5. Detección de Patrones
```
processNewResult()
  → getLastResults(bookmakerId, 5)
  → Filtra duplicados por round_id
  → detectPattern(results)
    → Verifica: >1.50x, >1.50x, <2.00x
  → Si detecta: emitSignal()
    → SignalModel.createSignal()
    → Guarda en pendingSignals
    → Emite evento 'signalEmitted'
```

### 6. Verificación de Señales
```
verifySignal()
  → Obtiene señal pendiente
  → Si primer intento:
    → updateFirstAttempt()
    → Si gana (>1.50x): status = 'won', elimina pendiente
    → Si pierde: status = 'pending', espera gale
  → Si segundo intento:
    → updateSecondAttempt()
    → status = 'won' o 'lost'
    → Elimina pendiente
  → Emite evento 'signalResult'
```

---

## 🗄️ Esquema de Base de Datos

### Tabla: `bookmakers`
```sql
- id (SERIAL PRIMARY KEY)
- name (VARCHAR)
- description (TEXT)
- url_image (TEXT)
- recomendado (BOOLEAN)
- active (BOOLEAN)
- url_websocket (TEXT)
- first_message (TEXT, base64)
- second_message (TEXT, base64)
- third_message (TEXT, base64)
- decoder_type (VARCHAR, default: 'auto')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### Tabla: `game_rounds`
```sql
- id (SERIAL PRIMARY KEY)
- bookmaker_id (INTEGER, FK)
- round_id (VARCHAR)
- bets_count (INTEGER)
- total_bet_amount (DECIMAL)
- online_players (INTEGER)
- max_multiplier (DECIMAL)
- total_cashout (DECIMAL)
- casino_profit (DECIMAL)
- loss_percentage (DECIMAL)
- timestamp (TIMESTAMP)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- UNIQUE(bookmaker_id, round_id)
```

### Tabla: `signals`
```sql
- id (SERIAL PRIMARY KEY)
- bookmaker_id (INTEGER, FK)
- pattern_detected (JSONB)
- signal_timestamp (TIMESTAMP)
- first_attempt_result (DECIMAL)
- first_attempt_timestamp (TIMESTAMP)
- second_attempt_result (DECIMAL)
- second_attempt_timestamp (TIMESTAMP)
- gale_used (BOOLEAN)
- status (VARCHAR: 'pending', 'won', 'lost')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### Tabla: `signal_results`
```sql
- id (SERIAL PRIMARY KEY)
- signal_id (INTEGER, FK)
- attempt_number (INTEGER: 1 o 2)
- result_multiplier (DECIMAL)
- is_win (BOOLEAN)
- round_id (VARCHAR)
- result_timestamp (TIMESTAMP)
```

### Tabla: `bookmaker_history`
```sql
- id (SERIAL PRIMARY KEY)
- bookmaker_id (INTEGER, FK)
- action (VARCHAR: 'created', 'updated', 'deleted')
- field_name (VARCHAR)
- old_value (TEXT)
- new_value (TEXT)
- created_at (TIMESTAMP)
```

### Tabla: `logos`
```sql
- id (SERIAL PRIMARY KEY)
- name (VARCHAR)
- filename (VARCHAR)
- original_name (VARCHAR)
- mime_type (VARCHAR)
- file_size (INTEGER)
- file_data (BYTEA)
- url_path (VARCHAR)
- is_default (BOOLEAN)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

---

## 🔐 Seguridad y Configuración

### Variables de Entorno
- `DATABASE_URL`: URL completa de PostgreSQL (recomendado)
- `DATABASE_USER`, `DATABASE_HOST`, `DATABASE_NAME`, `DATABASE_PASSWORD`, `DATABASE_PORT`: Variables separadas (legacy)
- `DEBUG_MODE`: Activa logs detallados (true/false)
- `PORT`: Puerto del servidor (default: 3001)

### Configuración de Conexión
- Pool máximo: 10 conexiones
- Timeout de conexión: 10 segundos
- SSL habilitado para servicios cloud
- Reintentos automáticos en errores de conexión

### Headers WebSocket
```javascript
{
  'User-Agent': 'Mozilla/5.0...',
  'Origin': 'https://aviator-next.spribegaming.com',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'es-419,es;q=0.9',
  'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
}
```

---

## 📊 Métricas y Monitoreo

### Health Check System
- Verificación cada 30 segundos
- Estados: `healthy`, `warning`, `down`, `disconnected`, `unknown`
- Alertas:
  - ⚠️ Warning: Sin actividad por 2 minutos
  - 🔴 Down: Sin actividad por 5 minutos
- Reconexión automática después de 3 fallos consecutivos

### Estadísticas Disponibles
- Total de bookmakers activos
- Bookmakers conectados/desconectados
- Rondas guardadas por bookmaker
- Señales emitidas/ganadas/perdidas
- Tasa de éxito de señales (win rate)

---

## 🚀 Características Avanzadas

### 1. Prevención de Duplicados
- **En Memoria**: Set de `savedRounds` (se limpia cada 10 min)
- **En BD**: Constraint único `(bookmaker_id, round_id)`
- **Por Multiplicador**: Búsqueda de rondas similares (±0.01) en ventana de 5 min
- **Actualización de IDs**: Convierte IDs temporales a reales cuando llegan

### 2. Sistema de Backup
- Guarda rondas fallidas en logs
- Permite recuperación manual
- No bloquea el flujo principal

### 3. Modo Debug
- Logs detallados de comandos
- Análisis de mensajes no decodificados
- Contadores de multiplicadores
- Activable por variable de entorno

### 4. Gestión de IDs Temporales
- Genera `temp_{bookmakerId}_{timestamp}` si no llega roundId
- Genera `round_{bookmakerId}_{timestamp}` como alternativa
- Actualiza automáticamente cuando llega el ID real

### 5. Múltiples Puntos de Guardado
- `changeState` con `newStateId === 3` (End)
- Comando `x` con `crashX` (final)
- `roundChartInfo` como backup
- Guardado retrasado si falta información

---

## ⚠️ Puntos de Atención

### 1. Duplicados
- ✅ Sistema robusto de prevención implementado
- ⚠️ Pueden ocurrir si hay múltiples fuentes del mismo evento
- ✅ Se resuelven automáticamente con constraints y verificaciones

### 2. RoundId Faltantes
- ✅ Generación automática de IDs temporales
- ✅ Actualización cuando llega el ID real
- ⚠️ Algunos bookmakers pueden no enviar roundId

### 3. Decodificación
- ✅ Soporte para SFS y MessagePack
- ✅ Detección automática
- ⚠️ Algunos mensajes pueden no decodificarse (pings/pongs)

### 4. Reconexión
- ✅ Sistema automático de reconexión
- ⚠️ Máximo 3 intentos por defecto
- ⚠️ Requiere tokens válidos (first_message, second_message, third_message)

### 5. Performance
- ✅ Pool de conexiones limitado a 10
- ✅ Limpieza periódica de caché en memoria
- ⚠️ Puede necesitar optimización si hay muchos bookmakers (>50)

---

## 🔧 Mejoras Sugeridas

1. **Caché de Resultados**: Implementar Redis para caché de últimas rondas
2. **Rate Limiting**: Limitar requests a la API
3. **Autenticación**: Agregar JWT para endpoints sensibles
4. **Métricas Avanzadas**: Integrar Prometheus/Grafana
5. **Alertas**: Sistema de notificaciones (email, Slack) para bookmakers caídos
6. **Testing**: Unit tests y integration tests
7. **Documentación API**: Swagger/OpenAPI
8. **Compresión**: Comprimir respuestas JSON grandes
9. **Paginación**: Implementar en endpoints de rondas/señales
10. **Backup Automático**: Backup periódico de BD

---

## 📝 Notas Técnicas

### Dependencias Principales
- `express`: Servidor HTTP
- `socket.io`: WebSocket server
- `ws`: WebSocket client
- `pg`: PostgreSQL driver
- `msgpack-lite`: Decoder MessagePack
- `winston`: Logging
- `multer`: Upload de archivos

### Compatibilidad
- Node.js: >= 14.x
- PostgreSQL: >= 12.x
- Plataformas: Railway, Render, Heroku, VPS

### Formato de Mensajes
Los mensajes WebSocket vienen en formato binario y se decodifican a:
```javascript
{
  p: {
    c: 'comando',  // Comando (updateCurrentBets, changeState, x, etc.)
    p: { ... }     // Parámetros del comando
  }
}
```

---

## 🎯 Conclusión

Sistema robusto y bien estructurado para extracción de datos de casino en tiempo real. Incluye:
- ✅ Soporte multi-bookmaker
- ✅ Decodificación dual (SFS + MessagePack)
- ✅ Prevención de duplicados
- ✅ Sistema de señales inteligente
- ✅ API REST completa
- ✅ Monitoreo de salud
- ✅ Reconexión automática

El código está bien organizado, documentado y preparado para producción.

---

**Fecha de Análisis**: 2024
**Versión del Sistema**: 2.0.0

