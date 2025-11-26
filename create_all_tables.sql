-- Script completo para crear todas las tablas necesarias


-- Crear tabla bookmakers
CREATE TABLE IF NOT EXISTS bookmakers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    url_image VARCHAR(500),
    recomendado BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    url_websocket VARCHAR(500),
    first_message TEXT,
    second_message TEXT,
    third_message TEXT,
    decoder_type VARCHAR(20) DEFAULT 'auto', -- auto, msgpack, sfs
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla game_rounds
CREATE TABLE IF NOT EXISTS game_rounds (
    id SERIAL PRIMARY KEY,
    bookmaker_id INTEGER NOT NULL REFERENCES bookmakers(id) ON DELETE CASCADE,
    round_id VARCHAR(255) NOT NULL,
    bets_count INTEGER DEFAULT 0,
    total_bet_amount DECIMAL(15,2) DEFAULT 0,
    online_players INTEGER DEFAULT 0,
    max_multiplier DECIMAL(20,2) DEFAULT 0,
    total_cashout DECIMAL(15,2) DEFAULT 0,
    casino_profit DECIMAL(15,2) DEFAULT 0,
    loss_percentage DECIMAL(5,2) DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de historial de modificaciones de bookmakers
CREATE TABLE IF NOT EXISTS bookmaker_history (
    id SERIAL PRIMARY KEY,
    bookmaker_id INTEGER NOT NULL REFERENCES bookmakers(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'deleted'
    field_name VARCHAR(100), -- nombre del campo modificado
    old_value TEXT, -- valor anterior
    new_value TEXT, -- valor nuevo
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de logos
CREATE TABLE IF NOT EXISTS logos (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_data BYTEA NOT NULL, -- Datos binarios de la imagen
    url_path VARCHAR(500) NOT NULL, -- Ruta para acceder al logo
    is_default BOOLEAN DEFAULT false, -- Si es un logo por defecto
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de predicciones
CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    bookmaker_id INTEGER NOT NULL REFERENCES bookmakers(id) ON DELETE CASCADE,
    prediction_time TIMESTAMP NOT NULL, -- Hora predicha (solo hora, minuto, segundo)
    prediction_date DATE NOT NULL, -- Fecha de la predicción
    status VARCHAR(20) DEFAULT 'pending', -- pending, active, won, lost
    trigger_result DECIMAL(10,2), -- Resultado que activó la predicción (>3.0x)
    trigger_time TIMESTAMP, -- Hora del resultado que activó la predicción
    entry_time TIMESTAMP, -- Hora cuando se activó la entrada
    final_result DECIMAL(10,2), -- Resultado final de la entrada
    final_time TIMESTAMP, -- Hora del resultado final
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para almacenar señales emitidas
CREATE TABLE IF NOT EXISTS signals (
    id SERIAL PRIMARY KEY,
    bookmaker_id INTEGER NOT NULL REFERENCES bookmakers(id) ON DELETE CASCADE,
    pattern_detected JSONB NOT NULL, -- Patrón detectado: [result1, result2, result3]
    signal_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- pending, won, lost
    gale_used BOOLEAN DEFAULT false, -- Si se usó el gale (segundo intento)
    first_attempt_result DECIMAL(10,2), -- Resultado del primer intento
    first_attempt_timestamp TIMESTAMP,
    second_attempt_result DECIMAL(10,2), -- Resultado del segundo intento (gale)
    second_attempt_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para almacenar resultados de cada intento de señal
CREATE TABLE IF NOT EXISTS signal_results (
    id SERIAL PRIMARY KEY,
    signal_id INTEGER NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL, -- 1 = primer intento, 2 = gale
    result_multiplier DECIMAL(10,2) NOT NULL,
    is_win BOOLEAN NOT NULL, -- true si result_multiplier > 1.50
    result_timestamp TIMESTAMP NOT NULL,
    round_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla de migraciones
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    migration_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_game_rounds_bookmaker_id ON game_rounds(bookmaker_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_timestamp ON game_rounds(timestamp);
CREATE INDEX IF NOT EXISTS idx_game_rounds_round_id ON game_rounds(round_id);
CREATE INDEX IF NOT EXISTS idx_bookmaker_history_bookmaker_id ON bookmaker_history(bookmaker_id);
CREATE INDEX IF NOT EXISTS idx_bookmaker_history_created_at ON bookmaker_history(created_at);
CREATE INDEX IF NOT EXISTS idx_logos_name ON logos(name);
CREATE INDEX IF NOT EXISTS idx_logos_url_path ON logos(url_path);
CREATE INDEX IF NOT EXISTS idx_logos_is_default ON logos(is_default);
CREATE INDEX IF NOT EXISTS idx_predictions_bookmaker_id ON predictions(bookmaker_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_prediction_time ON predictions(prediction_time);
CREATE INDEX IF NOT EXISTS idx_predictions_prediction_date ON predictions(prediction_date);

-- Índices para señales
CREATE INDEX IF NOT EXISTS idx_signals_bookmaker_id ON signals(bookmaker_id);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_signal_timestamp ON signals(signal_timestamp);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signal_results_signal_id ON signal_results(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_results_attempt_number ON signal_results(attempt_number);

-- Constraint único para evitar duplicados en game_rounds
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'game_rounds_bookmaker_round_unique'
    ) THEN
        ALTER TABLE game_rounds 
        ADD CONSTRAINT game_rounds_bookmaker_round_unique 
        UNIQUE (bookmaker_id, round_id);
    END IF;
END $$;

-- Índices adicionales para game_rounds
CREATE INDEX IF NOT EXISTS idx_game_rounds_bookmaker_multiplier_timestamp 
ON game_rounds(bookmaker_id, max_multiplier, timestamp);
CREATE INDEX IF NOT EXISTS idx_game_rounds_duplicate_detection 
ON game_rounds(bookmaker_id, max_multiplier, timestamp);

-- Trigger para actualizar updated_at automáticamente en game_rounds
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_game_rounds_updated_at ON game_rounds;
CREATE TRIGGER update_game_rounds_updated_at
    BEFORE UPDATE ON game_rounds
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insertar algunos bookmakers de ejemplo
INSERT INTO bookmakers (name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message) VALUES
('1win', '1win Casino', '/api/logos/image/1win', true, true, 'wss://eu-central-1-game9.spribegaming.com/BlueBox/websocket', 'gAAyEgADAAFjAgAAAWEDAAAAAXASAAIAA2FwaQgABTEuOC40AAJjbAgACkphdmFTY3JpcHQ=', 'gALMEgADAAFjAgAAAWEDAAEAAXASAAQAAnpuCAASYXZpYXRvcl9jb3JlX2luc3Q3AAJ1bggAETc1MzA5ODEwNyYmMXhzbG90AAJwdwgAAAABcBIABgAFdG9rZW4IACQxY2Q4NjI1OS0yYzJjLTQwM2EtODMwNi0zZDdiNzQ4YjFkMTkACGN1cnJlbmN5CAADQ09QAARsYW5nCAACZXMADHNlc3Npb25Ub2tlbggAQDFva2dCbktLSFpjQXhuRUdlNVh5VXZqTzRFcmlLVFZYYTBzNFZMb1ZReUZaN0U5bThlcWExY1A2TEZPbEhRUHYACHBsYXRmb3JtEgADAApkZXZpY2VJbmZvCAEdeyJ1c2VyQWdlbnQiOiJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTQwLjAuMC4wIFNhZmFyaS81MzcuMzYiLCJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiVW5rbm93biIsIm9zX3ZlcnNpb24iOiJ3aW5kb3dzLTEwIiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTQwLjAuMC4wIiwiZGV2aWNlVHlwZSI6ImRlc2t0b3AiLCJvcmllbnRhdGlvbiI6ImxhbmRzY2FwZSJ9AAl1c2VyQWdlbnQIAHEiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0MC4wLjAuMCBTYWZhcmkvNTM3LjM2IgAKZGV2aWNlVHlwZQgAB2Rlc2t0b3AAB3ZlcnNpb24IAAY0LjIuODg=', 'gAA0EgADAAFjAgEAAWEDAA0AAXASAAMAAWMIAAxQSU5HX1JFUVVFU1QAAXIE/////wABcBIAAA=='),
('Bet365', 'Bet365 Casino', '/api/logos/image/bet365', true, true, 'wss://example.com/ws', 'first_message_base64', 'second_message_base64', 'third_message_base64'),
('Betwinner', 'Betwinner Casino', '/api/logos/image/betwinner', true, true, 'wss://example.com/ws', 'first_message_base64', 'second_message_base64', 'third_message_base64')
ON CONFLICT DO NOTHING;

-- Nota: Los logos por defecto se insertarán automáticamente por el servidor
-- cuando se ejecute el script de inicialización de logos



