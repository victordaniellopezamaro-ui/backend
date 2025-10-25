-- Migración: Agregar decoder_type a bookmakers
-- Fecha: 2025-01-22
-- Descripción: Permite especificar qué tipo de decoder usar para cada bookmaker

-- Agregar columna decoder_type si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookmakers' 
        AND column_name = 'decoder_type'
    ) THEN
        ALTER TABLE bookmakers 
        ADD COLUMN decoder_type VARCHAR(20) DEFAULT 'auto';
        
        -- Agregar comentario para documentación
        COMMENT ON COLUMN bookmakers.decoder_type IS 
        'Tipo de decoder: auto (detecta automáticamente), msgpack (MessagePack), sfs (SmartFoxServer)';
        
        RAISE NOTICE 'Columna decoder_type agregada exitosamente';
    ELSE
        RAISE NOTICE 'Columna decoder_type ya existe';
    END IF;
END $$;

-- Actualizar bookmakers existentes que usen MessagePack
-- Puedes identificarlos manualmente y actualizarlos
-- UPDATE bookmakers SET decoder_type = 'msgpack' WHERE id = X; -- Para bookmakers con MessagePack
