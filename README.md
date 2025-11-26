# 🎰 Sistema de Aviator - Backend

Sistema backend para tracking y análisis en tiempo real de juegos Aviator de múltiples bookmakers con sistema automatizado de predicciones basado en patrones.

## 📋 Características Principales

- ✅ Conexión WebSocket en tiempo real con múltiples bookmakers
- ✅ Sistema de decoders unificado (SFS y MessagePack)
- ✅ Almacenamiento de rondas en PostgreSQL
- ✅ **Sistema automatizado de señales y predicciones**
- ✅ **Detección de patrones en tiempo real**
- ✅ API REST para consultas
- ✅ Sistema de logging avanzado
- ✅ Modo debug para desarrollo
- ✅ Prevención de duplicados automática

## 🚀 Instalación

### 1. Clonar el repositorio


### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar base de datos

Edita `src/config/database.js` con tu URL de PostgreSQL:

```javascript
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://usuario:password@host:puerto/database';
```

O usa variables de entorno:
```env
DATABASE_URL=postgresql://usuario:password@host:puerto/database
PORT=3001
DEBUG_MODE=false
```

### 4. Inicializar base de datos

```bash
# Ejecutar migraciones
npm run migrate

# Ver estado de migraciones
npm run migrate:status
```

### 5. Iniciar servidor

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

## 🎯 Sistema de Señales y Predicciones

### Funcionamiento Automatizado

El sistema detecta patrones automáticamente y emite señales para cada casino por separado.

**Patrón detectado:**
```
> 1.50x  → Primer resultado mayor a 1.50x
> 1.50x  → Segundo resultado mayor a 1.50x
< 2.00x  → Tercer resultado menor a 2.00x
```

**Verificación:**
- Gana si el siguiente resultado es **> 1.50x**
- Sistema de gale: 1 intento adicional si el primero pierde
- Se marca como perdida si ambos intentos fallan

### Procesamiento por Casino

- Cada casino se analiza **independientemente**
- Cada casino tiene sus propias señales pendientes
- El sistema funciona **100% automáticamente** sin intervención manual

### API Endpoints de Señales

- `GET /api/aviator/signals/:bookmakerId` - Señales de un casino
- `GET /api/aviator/signals` - Todas las señales
- `GET /api/aviator/signals/stats/:bookmakerId?` - Estadísticas
- `GET /api/aviator/signals/pending` - Señales pendientes

### Eventos WebSocket

- `signalEmitted` - Cuando se detecta un patrón y se emite señal
- `signalResult` - Cuando se verifica el resultado de una señal

### API Endpoints

Visita `http://localhost:3001` para ver la documentación interactiva de la API.

Principales endpoints:

- `GET /api/health` - Health check
- `GET /api/aviator/bookmakers` - Lista de bookmakers
- `GET /api/aviator/rounds/:id` - Rondas de un bookmaker
- `GET /api/aviator/status` - Estado de conexiones WebSocket
- `GET /api/aviator/signals/:bookmakerId` - Señales de un casino
- `GET /api/aviator/signals/stats` - Estadísticas de señales

### WebSocket

```javascript
const io = require('socket.io-client');

// Conectar
const socket = io('http://localhost:3001');

// Unirse a un bookmaker
socket.emit('joinBookmaker', 1);

// Escuchar rondas
socket.on('round', (data) => {
  console.log('Datos de ronda:', data);
});

// Escuchar señales emitidas
socket.on('signalEmitted', (data) => {
  console.log('Señal emitida:', data);
});

// Escuchar resultados de señales
socket.on('signalResult', (data) => {
  console.log('Resultado de señal:', data);
});
```

## 🔧 Scripts disponibles

```bash
npm start              # Iniciar servidor
npm run dev            # Modo desarrollo con nodemon
npm run migrate        # Ejecutar migraciones
npm run migrate:status # Ver estado de migraciones
npm run migrate:reset  # Resetear base de datos (¡CUIDADO!)
npm test:decoder       # Probar decoders
npm run clean:duplicates # Limpiar rondas duplicadas
```

## 🐛 Modo Debug

### Activar en servidor:

```bash
DEBUG_MODE=true npm start
```

### Activar en cliente:

1. Ir a http://localhost:3001
2. Navegar a **Configuración**
3. Activar **"Modo Debug"**
4. Abrir consola del navegador (F12)

## 🏗️ Estructura del Proyecto

```
backend/
├── src/
│   ├── config/
│   │   └── database.js          # Configuración de BD
│   ├── models/
│   │   ├── Aviator/
│   │   │   ├── bookmakerModel.js
│   │   │   ├── gameRoundModel.js
│   │   │   ├── signalModel.js      # Modelo de señales
│   │   │   └── bookmakerHistoryModel.js
│   │   └── logoModel.js
│   ├── routes/
│   │   ├── Aviator/aviatorRoutes.js
│   │   └── logoRoutes.js
│   └── services/
│       └── Aviator/
│           ├── decoder.js           # Decoder SFS
│           ├── decoder-msgpack.js   # Decoder MessagePack
│           ├── decoder-unified.js   # Decoder unificado
│           ├── webSocketService.js   # Servicio WebSocket
│           └── patternDetectionService.js # Detección de patrones
├── public/
│   └── index.html              # Dashboard web
├── create_all_tables.sql       # Script SQL completo
├── server.js                   # Punto de entrada
├── migrate.js                  # Sistema de migraciones
└── README.md                   # Esta documentación
```

## 🔒 Seguridad

### ⚠️ IMPORTANTE

- **NUNCA** subas el archivo `.env` a Git
- El archivo `.env` está en `.gitignore` por seguridad
- Usa variables de entorno en producción
- No compartas credenciales de base de datos

### Variables de entorno

```env
DATABASE_URL=postgresql://usuario:password@host:puerto/database
PORT=3001
NODE_ENV=production
DEBUG_MODE=false
```

## 📦 Despliegue

### Railway

1. Conecta tu repositorio en Railway
2. Agrega las variables de entorno desde el dashboard
3. Railway detectará automáticamente el `package.json`
4. El servidor se iniciará con `npm start`

### Render

1. Conecta tu repositorio en Render
2. Configura las variables de entorno
3. Build Command: `npm install`
4. Start Command: `npm start`

### Variables de entorno en plataformas

En Railway/Render, agrega:

```
DATABASE_USER=tu_usuario
DATABASE_HOST=tu_host
DATABASE_NAME=tu_database
DATABASE_PASSWORD=tu_password
DATABASE_PORT=5432
PORT=3001
NODE_ENV=production
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto es privado y confidencial.

## 💬 Soporte

Para reportar problemas o sugerencias:

1. Abre un issue en GitHub
2. Incluye logs relevantes
3. Describe los pasos para reproducir el problema

---

**Desarrollado con ❤️ para análisis de Aviator**

