# 🎰 Base de Datos - Sistema de Aviator

Sistema backend para tracking y análisis en tiempo real de juegos Aviator de múltiples bookmakers.

## 📋 Características

- ✅ Conexión WebSocket en tiempo real con múltiples bookmakers
- ✅ Sistema de decoders unificado (SFS y MessagePack)
- ✅ Almacenamiento de rondas en PostgreSQL
- ✅ API REST para consultas
- ✅ Dashboard web interactivo
- ✅ Sistema de logging avanzado
- ✅ Modo debug para desarrollo

## 🚀 Instalación

### 1. Clonar el repositorio


### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
# Crear archivo .env desde la plantilla
cp env.example .env
```

Edita el archivo `.env` con tus credenciales:

```env
# PostgreSQL
DATABASE_USER=tu_usuario
DATABASE_HOST=tu_host
DATABASE_NAME=tu_database
DATABASE_PASSWORD=tu_password
DATABASE_PORT=5432

# Servidor
PORT=3001
NODE_ENV=development

# Debug (opcional)
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

## 📚 Documentación

### Guías disponibles

- 📘 [DECODER_GUIDE.md](./DECODER_GUIDE.md) - Guía completa del sistema de decoders
- 📗 [MEJORAS_DECODER_Y_GUARDADO.md](./MEJORAS_DECODER_Y_GUARDADO.md) - Changelog de mejoras

### API Endpoints

Visita `http://localhost:3001` para ver la documentación interactiva de la API.

Principales endpoints:

- `GET /api/health` - Health check
- `GET /api/aviator/bookmakers` - Lista de bookmakers
- `GET /api/aviator/rounds/:id` - Rondas de un bookmaker
- `GET /api/aviator/status` - Estado de conexiones

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
base-de-datos/
├── src/
│   ├── config/
│   │   └── database.js          # Configuración de BD
│   ├── models/                  # Modelos de datos
│   ├── routes/                  # Rutas de API
│   └── services/
│       └── Aviator/
│           ├── decoder.js       # Decoder SFS
│           ├── decoder-msgpack.js # Decoder MessagePack
│           ├── decoder-unified.js # Decoder unificado
│           └── webSocketService.js # Servicio WebSocket
├── public/
│   └── index.html              # Dashboard web
├── migrations/                 # Migraciones de BD
├── server.js                   # Punto de entrada
├── migrate.js                  # Sistema de migraciones
└── env.example                # Plantilla de variables de entorno
```

## 🔒 Seguridad

### ⚠️ IMPORTANTE

- **NUNCA** subas el archivo `.env` a Git
- El archivo `.env` está en `.gitignore` por seguridad
- Usa variables de entorno en producción
- No compartas credenciales de base de datos

### Variables de entorno requeridas

```env
DATABASE_USER=       # Usuario de PostgreSQL
DATABASE_HOST=       # Host de la base de datos
DATABASE_NAME=       # Nombre de la base de datos
DATABASE_PASSWORD=   # Contraseña (¡NUNCA la compartas!)
DATABASE_PORT=       # Puerto (default: 5432)
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

