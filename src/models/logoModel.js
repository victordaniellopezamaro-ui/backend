const db = require('../config/database');
const fs = require('fs');
const path = require('path');

class LogoModel {
    // Obtener todos los logos
    static async getAllLogos() {
        try {
            const result = await db.query(`
                SELECT id, name, filename, original_name, mime_type, file_size, 
                       url_path, is_default, created_at
                FROM logos 
                ORDER BY is_default DESC, name ASC
            `);
            return result.rows;
        } catch (error) {
            throw error;
        }
    }

    // Obtener logo por ID
    static async getLogoById(id) {
        try {
            const result = await db.query(`
                SELECT id, name, filename, original_name, mime_type, file_size, 
                       file_data, url_path, is_default, created_at
                FROM logos 
                WHERE id = $1
            `, [id]);
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Obtener logo por URL path
    static async getLogoByUrlPath(urlPath) {
        try {
            const result = await db.query(`
                SELECT id, name, filename, original_name, mime_type, file_size, 
                       file_data, url_path, is_default, created_at
                FROM logos 
                WHERE url_path = $1
            `, [urlPath]);
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Obtener logo por nombre
    static async getLogoByName(name) {
        try {
            const result = await db.query(`
                SELECT id, name, filename, original_name, mime_type, file_size, 
                       file_data, url_path, is_default, created_at
                FROM logos 
                WHERE name = $1
            `, [name]);
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Crear nuevo logo
    static async createLogo(logoData) {
        try {
            const { name, filename, originalName, mimeType, fileSize, fileData, urlPath, isDefault = false } = logoData;
            
            const result = await db.query(`
                INSERT INTO logos (name, filename, original_name, mime_type, file_size, file_data, url_path, is_default)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, name, filename, original_name, mime_type, file_size, url_path, is_default, created_at
            `, [name, filename, originalName, mimeType, fileSize, fileData, urlPath, isDefault]);
            
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Actualizar logo
    static async updateLogo(id, logoData) {
        try {
            const { name, filename, originalName, mimeType, fileSize, fileData, urlPath, isDefault } = logoData;
            
            const result = await db.query(`
                UPDATE logos 
                SET name = $2, filename = $3, original_name = $4, mime_type = $5, 
                    file_size = $6, file_data = $7, url_path = $8, is_default = $9,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING id, name, filename, original_name, mime_type, file_size, url_path, is_default, updated_at
            `, [id, name, filename, originalName, mimeType, fileSize, fileData, urlPath, isDefault]);
            
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Eliminar logo
    static async deleteLogo(id) {
        try {
            const result = await db.query(`
                DELETE FROM logos 
                WHERE id = $1
                RETURNING id, name, is_default
            `, [id]);
            
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Inicializar logos por defecto
    static async initializeDefaultLogos() {
        try {
            console.log('🖼️ Inicializando logos por defecto...');
            
            const logosDir = path.join(__dirname, '../../public/img-logos');
            const defaultLogos = [
                { name: '1win', file: '1win.jpg' },
                { name: '1xslots', file: '1xslots.webp' },
                { name: 'bet365', file: 'bet365.png' },
                { name: 'betplay', file: 'betplay.webp' },
                { name: 'betwinner', file: 'betwinner.png' }
            ];

            let restored = 0;

            for (const logo of defaultLogos) {
                const filePath = path.join(logosDir, logo.file);
                
                // Verificar si el archivo existe
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
                        restored++;
                    } else {
                        console.log(`ℹ️ Logo ${logo.name} ya existe`);
                    }
                } else {
                    console.log(`⚠️ Archivo ${logo.file} no encontrado`);
                }
            }
            
            console.log(`✅ Logos por defecto inicializados correctamente. ${restored} logos restaurados.`);
            return { restored };
        } catch (error) {
            console.error('❌ Error inicializando logos por defecto:', error.message);
            throw error;
        }
    }

    // Obtener solo logos por defecto
    static async getDefaultLogos() {
        try {
            const result = await db.query(`
                SELECT id, name, filename, original_name, mime_type, file_size, 
                       url_path, is_default, created_at
                FROM logos 
                WHERE is_default = true
                ORDER BY name ASC
            `);
            return result.rows;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = LogoModel;
