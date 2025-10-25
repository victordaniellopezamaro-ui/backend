const express = require('express');
const router = express.Router();
const LogoModel = require('../models/logoModel');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Configurar multer para subir archivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo
    },
    fileFilter: (req, file, cb) => {
        // Solo permitir imágenes
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos de imagen'), false);
        }
    }
});

// Obtener todos los logos
router.get('/', async (req, res) => {
    try {
        const logos = await LogoModel.getAllLogos();
        res.json(logos);
    } catch (error) {
        console.error('Error obteniendo logos:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener logos por defecto
router.get('/default', async (req, res) => {
    try {
        const logos = await LogoModel.getDefaultLogos();
        res.json(logos);
    } catch (error) {
        console.error('Error obteniendo logos por defecto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Verificar si existe un logo con ese nombre
router.get('/check/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const logo = await LogoModel.getLogoByName(name);
        res.json({ exists: !!logo });
    } catch (error) {
        console.error('Error verificando logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener logo por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const logo = await LogoModel.getLogoById(id);
        
        if (!logo) {
            return res.status(404).json({ error: 'Logo no encontrado' });
        }
        
        res.json(logo);
    } catch (error) {
        console.error('Error obteniendo logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Servir imagen del logo
router.get('/image/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const urlPath = `/api/logos/image/${name}`;
        const logo = await LogoModel.getLogoByUrlPath(urlPath);
        
        if (!logo) {
            return res.status(404).json({ error: 'Logo no encontrado' });
        }
        
        // Configurar headers para la imagen
        res.set({
            'Content-Type': logo.mime_type,
            'Content-Length': logo.file_size,
            'Cache-Control': 'public, max-age=31536000', // Cache por 1 año
            'ETag': `"${logo.id}-${logo.created_at ? logo.created_at.getTime() : Date.now()}"`
        });
        
        // Enviar los datos binarios de la imagen
        res.send(logo.file_data);
    } catch (error) {
        console.error('Error sirviendo logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Crear nuevo logo
router.post('/', upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
        }
        
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'El nombre del logo es requerido' });
        }
        
        // Generar nombre único para el archivo
        const fileExtension = path.extname(req.file.originalname);
        const uniqueFilename = `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}${fileExtension}`;
        
        // Crear URL path
        const urlPath = `/api/logos/image/${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        
        // Crear datos del logo
        const logoData = {
            name: name,
            filename: uniqueFilename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            fileSize: req.file.size,
            fileData: req.file.buffer,
            urlPath: urlPath,
            isDefault: false
        };
        
        const newLogo = await LogoModel.createLogo(logoData);
        res.status(201).json(newLogo);
    } catch (error) {
        console.error('Error creando logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Actualizar logo
router.put('/:id', upload.single('logo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        // Verificar si el logo existe
        const existingLogo = await LogoModel.getLogoById(id);
        if (!existingLogo) {
            return res.status(404).json({ error: 'Logo no encontrado' });
        }
        
        // Si no se proporciona nuevo archivo, solo actualizar el nombre
        if (!req.file) {
            const logoData = {
                name: name || existingLogo.name,
                filename: existingLogo.filename,
                originalName: existingLogo.original_name,
                mimeType: existingLogo.mime_type,
                fileSize: existingLogo.file_size,
                fileData: existingLogo.file_data,
                urlPath: existingLogo.url_path,
                isDefault: existingLogo.is_default
            };
            
            const updatedLogo = await LogoModel.updateLogo(id, logoData);
            return res.json(updatedLogo);
        }
        
        // Actualizar con nuevo archivo
        const fileExtension = path.extname(req.file.originalname);
        const uniqueFilename = `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}${fileExtension}`;
        const urlPath = `/api/logos/image/${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        
        const logoData = {
            name: name || existingLogo.name,
            filename: uniqueFilename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            fileSize: req.file.size,
            fileData: req.file.buffer,
            urlPath: urlPath,
            isDefault: existingLogo.is_default
        };
        
        const updatedLogo = await LogoModel.updateLogo(id, logoData);
        res.json(updatedLogo);
    } catch (error) {
        console.error('Error actualizando logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Eliminar logo
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedLogo = await LogoModel.deleteLogo(id);
        
        if (!deletedLogo) {
            return res.status(404).json({ error: 'Logo no encontrado' });
        }
        
        res.json({ message: 'Logo eliminado correctamente', logo: deletedLogo });
    } catch (error) {
        console.error('Error eliminando logo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Inicializar logos por defecto
router.post('/initialize-defaults', async (req, res) => {
    try {
        const result = await LogoModel.initializeDefaultLogos();
        res.json({ 
            message: 'Logos por defecto inicializados correctamente',
            restored: result.restored || 0
        });
    } catch (error) {
        console.error('Error inicializando logos por defecto:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
