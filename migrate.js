const db = require('./src/config/database');
const fs = require('fs');
const path = require('path');

class DatabaseMigrator {
    constructor() {
        this.migrations = [];
        this.setupMigrations();
    }

    setupMigrations() {
        // Migración 1: Crear todas las tablas principales
        this.migrations.push({
            id: '001_create_main_tables',
            name: 'Crear tablas principales',
            up: async () => {
                console.log('📝 Creando tablas principales...');
                
                // Leer y ejecutar el script SQL completo
                const sql = fs.readFileSync('./create_all_tables.sql', 'utf8');
                await db.query(sql);
                
                console.log('✅ Tablas principales creadas');
            }
        });

        // Migración 2: Crear tablas de predicciones
        // DESHABILITADA: Las tablas de predicciones ya están en create_all_tables.sql
        /*
        this.migrations.push({
            id: '002_create_prediction_tables',
            name: 'Crear tablas de predicciones',
            up: async () => {
                console.log('📝 Creando tablas de predicciones...');
                
                // Leer y ejecutar el script SQL de predicciones
                const sql = fs.readFileSync('./create_prediction_tables.sql', 'utf8');
                await db.query(sql);
                
                console.log('✅ Tablas de predicciones creadas');
            }
        });
        */

        // Migración 3: Actualizar tablas de predicciones para incluir bookmaker_id
        // DESHABILITADA: Ya incluido en create_all_tables.sql
        /*
        this.migrations.push({
            id: '003_update_prediction_tables_bookmaker',
            name: 'Actualizar tablas de predicciones para incluir bookmaker_id',
            up: async () => {
                console.log('📝 Actualizando tablas de predicciones para incluir bookmaker_id...');
                
                // Leer y ejecutar el script SQL de actualización
                const sql = fs.readFileSync('./update_prediction_tables.sql', 'utf8');
                await db.query(sql);
                
                console.log('✅ Tablas de predicciones actualizadas para bookmaker_id');
            }
        });
        */

        // Migración 4: Crear tabla de logos
        this.migrations.push({
            id: '004_create_logos_table',
            name: 'Crear tabla de logos',
            up: async () => {
                console.log('📝 Creando tabla de logos...');
                
                const createLogosTable = `
                    CREATE TABLE IF NOT EXISTS logos (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        filename VARCHAR(255) NOT NULL,
                        original_name VARCHAR(255) NOT NULL,
                        mime_type VARCHAR(100) NOT NULL,
                        file_size INTEGER NOT NULL,
                        file_data BYTEA NOT NULL,
                        url_path VARCHAR(500) NOT NULL,
                        is_default BOOLEAN DEFAULT false,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE INDEX IF NOT EXISTS idx_logos_name ON logos(name);
                    CREATE INDEX IF NOT EXISTS idx_logos_url_path ON logos(url_path);
                    CREATE INDEX IF NOT EXISTS idx_logos_is_default ON logos(is_default);
                `;
                
                await db.query(createLogosTable);
                console.log('✅ Tabla de logos creada');
            }
        });

        // Migración 3: Inicializar logos por defecto
        this.migrations.push({
            id: '003_initialize_default_logos',
            name: 'Inicializar logos por defecto',
            up: async () => {
                console.log('🖼️ Inicializando logos por defecto...');
                
                const logosDir = path.join(__dirname, 'public/img-logos');
                const defaultLogos = [
                    { name: '1win', file: '1win.jpg' },
                    { name: '1xslots', file: '1xslots.webp' },
                    { name: 'bet365', file: 'bet365.png' },
                    { name: 'betplay', file: 'betplay.webp' },
                    { name: 'betwinner', file: 'betwinner.png' }
                ];

                for (const logo of defaultLogos) {
                    const filePath = path.join(logosDir, logo.file);
                    
                    if (fs.existsSync(filePath)) {
                        // Verificar si el logo ya existe
                        const existingLogo = await db.query(`
                            SELECT id FROM logos WHERE name = $1 AND is_default = true
                        `, [logo.name]);
                        
                        if (existingLogo.rows.length === 0) {
                            // Leer el archivo
                            const fileData = fs.readFileSync(filePath);
                            const stats = fs.statSync(filePath);
                            
                            // Determinar MIME type
                            const ext = path.extname(logo.file).toLowerCase();
                            let mimeType = 'image/jpeg';
                            if (ext === '.png') mimeType = 'image/png';
                            else if (ext === '.webp') mimeType = 'image/webp';
                            else if (ext === '.gif') mimeType = 'image/gif';
                            
                            // Crear URL path
                            const urlPath = `/api/logos/image/${logo.name}`;
                            
                            // Insertar en la base de datos
                            await db.query(`
                                INSERT INTO logos (name, filename, original_name, mime_type, file_size, file_data, url_path, is_default)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                            `, [
                                logo.name,
                                logo.file,
                                logo.file,
                                mimeType,
                                stats.size,
                                fileData,
                                urlPath
                            ]);
                            
                            console.log(`✅ Logo ${logo.name} inicializado`);
                        } else {
                            console.log(`ℹ️ Logo ${logo.name} ya existe`);
                        }
                    } else {
                        console.log(`⚠️ Archivo ${logo.file} no encontrado`);
                    }
                }
                
                console.log('✅ Logos por defecto inicializados');
            }
        });

        // Migración 4: Actualizar tabla de predicciones
        this.migrations.push({
            id: '004_update_predictions_table',
            name: 'Actualizar tabla de predicciones',
            up: async () => {
                console.log('🎯 Actualizando tabla de predicciones...');
                
                // Agregar columnas faltantes si no existen
                const addColumns = `
                    ALTER TABLE predictions 
                    ADD COLUMN IF NOT EXISTS prediction_time TIMESTAMP,
                    ADD COLUMN IF NOT EXISTS prediction_date DATE,
                    ADD COLUMN IF NOT EXISTS entry_time TIMESTAMP,
                    ADD COLUMN IF NOT EXISTS final_result DECIMAL(10,2),
                    ADD COLUMN IF NOT EXISTS final_time TIMESTAMP;
                `;
                
                await db.query(addColumns);
                
                // Crear índices si no existen
                const createIndexes = `
                    CREATE INDEX IF NOT EXISTS idx_predictions_bookmaker_id ON predictions(bookmaker_id);
                    CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
                    CREATE INDEX IF NOT EXISTS idx_predictions_prediction_time ON predictions(prediction_time);
                    CREATE INDEX IF NOT EXISTS idx_predictions_prediction_date ON predictions(prediction_date);
                `;
                
                await db.query(createIndexes);
                console.log('✅ Tabla de predicciones actualizada');
            }
        });

        // Migración 5: Crear tabla de migraciones
        this.migrations.push({
            id: '005_create_migrations_table',
            name: 'Crear tabla de migraciones',
            up: async () => {
                console.log('📝 Creando tabla de migraciones...');
                
                const createMigrationsTable = `
                    CREATE TABLE IF NOT EXISTS migrations (
                        id SERIAL PRIMARY KEY,
                        migration_id VARCHAR(255) UNIQUE NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                
                await db.query(createMigrationsTable);
                console.log('✅ Tabla de migraciones creada');
            }
        });

        // Migración 6: Agregar columna decoder_type a bookmakers
        this.migrations.push({
            id: '006_add_decoder_type_to_bookmakers',
            name: 'Agregar columna decoder_type a bookmakers (Sistema Dual Decoder)',
            up: async () => {
                console.log('🔧 Agregando columna decoder_type a bookmakers...');
                
                // Agregar columna decoder_type si no existe
                const addDecoderTypeColumn = `
                    ALTER TABLE bookmakers 
                    ADD COLUMN IF NOT EXISTS decoder_type VARCHAR(20) DEFAULT 'auto';
                `;
                
                await db.query(addDecoderTypeColumn);
                console.log('✅ Columna decoder_type agregada');
                
                // Actualizar bookmakers existentes para usar auto-detección
                const updateExistingBookmakers = `
                    UPDATE bookmakers 
                    SET decoder_type = 'auto' 
                    WHERE decoder_type IS NULL;
                `;
                
                await db.query(updateExistingBookmakers);
                console.log('✅ Bookmakers existentes actualizados con decoder_type = auto');
                
                // Agregar comentario a la columna (opcional, puede fallar en algunas versiones de PostgreSQL)
                try {
                    const addComment = `
                        COMMENT ON COLUMN bookmakers.decoder_type IS 'Tipo de decoder a usar: sfs, msgpack, o auto (detectar automáticamente)';
                    `;
                    await db.query(addComment);
                    console.log('✅ Comentario agregado a columna decoder_type');
                } catch (error) {
                    console.log('ℹ️ No se pudo agregar comentario (opcional)');
                }
                
                console.log('🎉 Sistema Dual Decoder (MessagePack + SFS) configurado correctamente!');
            }
        });
    }

    async runMigrations() {
        try {
            console.log('🚀 Iniciando migraciones de base de datos...\n');
            
            // Verificar qué migraciones ya se ejecutaron
            const executedMigrations = await this.getExecutedMigrations();
            
            for (const migration of this.migrations) {
                if (executedMigrations.includes(migration.id)) {
                    console.log(`⏭️ Migración ${migration.id} ya ejecutada - omitiendo`);
                    continue;
                }
                
                console.log(`🔄 Ejecutando migración: ${migration.name}`);
                await migration.up();
                
                // Registrar migración como ejecutada
                await this.recordMigration(migration);
                console.log(`✅ Migración ${migration.id} completada\n`);
            }
            
            console.log('🎉 Todas las migraciones completadas exitosamente!');
            
        } catch (error) {
            console.error('❌ Error ejecutando migraciones:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    async getExecutedMigrations() {
        try {
            const result = await db.query('SELECT migration_id FROM migrations ORDER BY executed_at');
            return result.rows.map(row => row.migration_id);
        } catch (error) {
            // Si la tabla no existe, retornar array vacío
            return [];
        }
    }

    async recordMigration(migration) {
        try {
            await db.query(`
                INSERT INTO migrations (migration_id, name) 
                VALUES ($1, $2)
            `, [migration.id, migration.name]);
        } catch (error) {
            console.error(`⚠️ Error registrando migración ${migration.id}:`, error.message);
        }
    }

    async resetMigrations() {
        try {
            console.log('🔄 Reiniciando migraciones...');
            await db.query('DELETE FROM migrations');
            console.log('✅ Migraciones reiniciadas');
        } catch (error) {
            console.error('❌ Error reiniciando migraciones:', error.message);
        }
    }

    async showStatus() {
        try {
            console.log('📊 Estado de migraciones:');
            
            const executedMigrations = await this.getExecutedMigrations();
            
            console.log(`\n✅ Migraciones ejecutadas (${executedMigrations.length}):`);
            executedMigrations.forEach(id => {
                const migration = this.migrations.find(m => m.id === id);
                console.log(`   - ${id}: ${migration ? migration.name : 'Desconocida'}`);
            });
            
            const pendingMigrations = this.migrations.filter(m => !executedMigrations.includes(m.id));
            console.log(`\n⏳ Migraciones pendientes (${pendingMigrations.length}):`);
            pendingMigrations.forEach(migration => {
                console.log(`   - ${migration.id}: ${migration.name}`);
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo estado:', error.message);
        }
    }
}

// Función principal
async function main() {
    const migrator = new DatabaseMigrator();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'run':
            await migrator.runMigrations();
            break;
        case 'status':
            await migrator.showStatus();
            break;
        case 'reset':
            await migrator.resetMigrations();
            break;
        default:
            console.log('📖 Uso: node migrate.js [run|status|reset]');
            console.log('   run    - Ejecutar migraciones pendientes');
            console.log('   status - Mostrar estado de migraciones');
            console.log('   reset  - Reiniciar migraciones');
            break;
    }
    
    process.exit(0);
}

// Ejecutar si se llama directamente
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error fatal:', error);
        process.exit(1);
    });
}

module.exports = DatabaseMigrator;


