const { Pool } = require('pg');

// ============================================
// CONFIGURACIÓN SIMPLIFICADA DE BASE DE DATOS
// ============================================
// Soporta dos métodos de configuración:
// 
// MÉTODO 1 (RECOMENDADO): URL completa de PostgreSQL
// DATABASE_URL=postgresql://usuario:password@host:puerto/database
//
// MÉTODO 2 (LEGACY): Variables separadas
// DATABASE_USER, DATABASE_HOST, DATABASE_NAME, DATABASE_PASSWORD, DATABASE_PORT
// ============================================

// URL completa de la base de datos (configurar aquí directamente o en variable de entorno)
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://postgres:kGCxRkcpwnEkAXumSupCBICcdGGgsKpu@yamanote.proxy.rlwy.net:41002/railway';

// Configuración del pool
let dbConfig;

if (DATABASE_URL) {
  // ✅ MÉTODO 1: Usar URL completa (MÁS SIMPLE)
  console.log('🔗 Conectando a PostgreSQL usando DATABASE_URL');
  dbConfig = {
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Necesario para Render, Railway, Heroku
    },
    // Configuración del pool de conexiones
    max: 10, // Máximo de conexiones en el pool
    idleTimeoutMillis: 60000, // Tiempo de inactividad antes de cerrar conexión
    connectionTimeoutMillis: 10000, // Tiempo de espera para nueva conexión
    acquireTimeoutMillis: 10000, // Tiempo de espera para adquirir conexión
    createTimeoutMillis: 10000, // Tiempo de espera para crear conexión
  };
} else {
  // ⚠️ MÉTODO 2: Usar variables separadas (legacy)
  console.log('🔧 Conectando a PostgreSQL usando variables separadas');
  
  if (!process.env.DATABASE_USER || !process.env.DATABASE_HOST || 
      !process.env.DATABASE_NAME || !process.env.DATABASE_PASSWORD) {
    console.error('❌ ERROR: Variables de entorno de base de datos no configuradas');
    console.error('📝 Configura DATABASE_URL o las variables separadas (DATABASE_USER, DATABASE_HOST, etc.)');
  }
  
  dbConfig = {
    user: process.env.DATABASE_USER,
    host: process.env.DATABASE_HOST,
    database: process.env.DATABASE_NAME,
    password: process.env.DATABASE_PASSWORD,
    port: process.env.DATABASE_PORT || 5432,
    ssl: {
      rejectUnauthorized: false
    },
    max: 10,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
    acquireTimeoutMillis: 10000,
    createTimeoutMillis: 10000,
  };
}

// Configura el pool de conexiones
const pool = new Pool(dbConfig);

// Event listeners para debugging
pool.on('connect', () => {
  console.log('✅ Nueva conexión establecida con PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
});

// Exportamos una función para hacer consultas
module.exports = {
  query: async (text, params) => {
    let retries = 3;
    while (retries > 0) {
      try {
        return await pool.query(text, params);
      } catch (error) {
        retries--;
        
        // Si es error de conexión, reintentar
        if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.message.includes('timeout')) {
          if (retries > 0) {
            console.log(`[DB] Error de conexión, reintentando... (${retries} intentos restantes)`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }
        
        throw error;
      }
    }
  },
};