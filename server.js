const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const aviatorRoutes = require('./src/routes/Aviator/aviatorRoutes');
const logoRoutes = require('./src/routes/logoRoutes');
const aviatorWebSocketService = require('./src/services/Aviator/webSocketService');
const DatabaseMigrator = require('./migrate');
const winston = require('winston');
const db = require('./src/config/database');

// Función para inicializar la base de datos
async function initializeDatabase() {
  try {
    console.log('🔍 Inicializando base de datos...');
    console.log('🔍 Variables de entorno:', {
      DATABASE_HOST: process.env.DATABASE_HOST ? 'SET' : 'NOT SET',
      DATABASE_NAME: process.env.DATABASE_NAME ? 'SET' : 'NOT SET',
      DATABASE_USER: process.env.DATABASE_USER ? 'SET' : 'NOT SET',
      DATABASE_PASSWORD: process.env.DATABASE_PASSWORD ? 'SET' : 'NOT SET'
    });
    
    // Ejecutar migraciones
    const migrator = new DatabaseMigrator();
    await migrator.runMigrations();
    
    console.log('✅ Base de datos inicializada correctamente!');
  } catch (error) {
    console.error('❌ Error inicializando la base de datos:', error.message);
    // No salir del proceso, solo loggear el error
  }
}

const app = express();
const server = http.createServer(app);

// Configuración de CORS - Permitir todas las conexiones
const corsOptions = {
  origin: true, // Permitir cualquier origen
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin'],
  credentials: true, // Permitir credenciales
  optionsSuccessStatus: 200 // Para navegadores legacy
};

const io = new Server(server, {
  cors: corsOptions,
});

// Middleware CORS más robusto
app.use(cors(corsOptions));

// Middleware adicional para CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Access-Control-Allow-Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public')); // Servir archivos estáticos
app.set('io', io);

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'app.log' }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

app.use((req, res, next) => {
  logger.info(`Solicitud recibida: ${req.method} ${req.url}`, { 
    origin: req.get('origin'),
    userAgent: req.get('user-agent'),
    ip: req.ip
  });
  next();
});

// Rutas
app.use('/api/aviator', aviatorRoutes);
app.use('/api/logos', logoRoutes);

io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  
  socket.on('joinBookmaker', (bookmakerId) => {
    socket.join(`bookmaker:${bookmakerId}`);
    console.log(`📡 Cliente ${socket.id} se unió al bookmaker ${bookmakerId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente desconectado:', socket.id);
  });
});

// Inicializar servicios
aviatorWebSocketService.initializeConnections(io);

// Configuración de puerto para Railway
const PORT = process.env.PORT || 3001;

// Ruta de health check para Railway
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Ruta para verificar configuración de CORS
app.get('/api/cors-info', (req, res) => {
  res.status(200).json({
    corsEnabled: true,
    allowedOrigins: '*',
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin'],
    credentials: true,
    requestOrigin: req.get('origin'),
    requestMethod: req.method,
    timestamp: new Date().toISOString()
  });
});

// Inicializar la base de datos y luego iniciar el servidor
async function startServer() {
  await initializeDatabase();
  
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Servidor corriendo en el puerto ${PORT}`);
    logger.info(`Entorno: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();