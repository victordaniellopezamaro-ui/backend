/**
 * MESSAGEPACK DECODER
 * 
 * Decoder especializado para bookmakers que usan MessagePack
 * Compatible con el decoder SFS existente
 * Soporta múltiples formatos de MessagePack
 * 
 * Características:
 * - Decodificación robusta con manejo de errores
 * - Soporta arrays y maps anidados
 * - Extrae datos de rondas de Aviator automáticamente
 * - Compatible con diferentes formatos de MessagePack
 */

const msgpack = require('msgpack-lite');

/**
 * Decodificar mensaje usando MessagePack
 * @param {Buffer} binaryData - Datos binarios recibidos del WebSocket
 * @returns {Object|null} - Objeto decodificado o null si falla
 */
function decodeMessagePackMessage(binaryData) {
  try {
    if (!binaryData || binaryData.length === 0) {
      // Silenciar logs de buffers vacíos (pueden ser pings)
      return null;
    }

    // Verificar si es un mensaje MessagePack válido
    if (!isMessagePackMessage(binaryData)) {
      // No es MessagePack, retornar null silenciosamente
      return null;
    }

    // Intentar decodificar directamente con MessagePack
    const decoded = msgpack.decode(binaryData);
    
    // Si el mensaje decodificado es válido, procesarlo
    if (decoded) {
      // Normalizar estructura para compatibilidad con SFS
      const normalized = normalizeMessagePackStructure(decoded);
      
      // Log para comandos de ronda terminada (debugging)
      if (normalized && normalized.p && normalized.p.c) {
        const cmd = normalized.p.c;
        const params = normalized.p.p;
        
        // Log especial para eventos de fin de ronda
        if (cmd === 'changeState' && params.newStateId === 3) {
          console.log(`[MessagePack] 🛬 Estado End detectado:`, {
            roundId: params.roundId || params.round_id || 'N/A',
            crashX: params.crashX || params.maxMultiplier || 'N/A'
          });
        } else if (cmd === 'x' && params.crashX !== undefined) {
          console.log(`[MessagePack] 🎯 CrashX detectado:`, {
            crashX: params.crashX,
            roundId: params.roundId || params.round_id || 'N/A'
          });
        }
      }
      
      return normalized;
    }
    
    return null;
  } catch (error) {
    // Solo loggear errores genuinos (no buffers inválidos)
    if (error.message && !error.message.includes('Invalid MessagePack')) {
      console.error('[MessagePack] Error decodificando:', error.message);
      
      // Mostrar primeros bytes solo en caso de error real
      if (binaryData && binaryData.length > 0 && binaryData.length < 100) {
        const preview = Array.from(binaryData.slice(0, Math.min(20, binaryData.length)))
          .map(b => '0x' + b.toString(16).padStart(2, '0'))
          .join(' ');
        console.error('[MessagePack] Primeros bytes:', preview);
      }
    }
    
    return null;
  }
}

/**
 * Normalizar estructura MessagePack para que sea compatible con SFS
 * Diferentes bookmakers pueden usar estructuras diferentes
 * @param {any} decoded - Objeto decodificado de MessagePack
 * @returns {Object|null} - Objeto normalizado o null
 */
function normalizeMessagePackStructure(decoded) {
  if (!decoded) return null;
  
  try {
    // Caso 1: Ya tiene la estructura esperada { p: { c: 'comando', p: {...} } }
    if (decoded.p && typeof decoded.p === 'object') {
      return decoded;
    }
    
    // Caso 2: Array con estructura [tipo, comando, datos]
    if (Array.isArray(decoded) && decoded.length >= 2) {
      return normalizeArrayMessage(decoded);
    }
    
    // Caso 3: Map directo con comandos
    if (typeof decoded === 'object' && decoded.c && decoded.p) {
      // Ya tiene comando y parámetros, envolverlo
      return { p: decoded };
    }
    
    // Caso 4: Map con campos específicos de Aviator
    if (typeof decoded === 'object') {
      return normalizeDirectMessage(decoded);
    }
    
    // Caso 5: String o número simple (probablemente ping/pong)
    if (typeof decoded === 'string' || typeof decoded === 'number') {
      return null; // Ignorar mensajes simples
    }
    
    // Si no se puede normalizar, retornar tal cual
    return { p: { c: 'unknown', p: decoded } };
    
  } catch (error) {
    console.error('[MessagePack] Error normalizando estructura:', error.message);
    return null;
  }
}

/**
 * Normalizar mensaje que viene como array
 * Formato típico: [tipo, comando, {datos}] o [comando, {datos}]
 * @param {Array} arr - Array decodificado
 * @returns {Object|null}
 */
function normalizeArrayMessage(arr) {
  try {
    // Formato: [tipo, comando, datos]
    if (arr.length >= 3 && typeof arr[1] === 'string') {
      return {
        p: {
          c: arr[1],
          p: arr[2] || {}
        }
      };
    }
    
    // Formato: [comando, datos]
    if (arr.length >= 2 && typeof arr[0] === 'string') {
      return {
        p: {
          c: arr[0],
          p: arr[1] || {}
        }
      };
    }
    
    // Formato: [datos] (sin comando explícito)
    if (arr.length === 1 && typeof arr[0] === 'object') {
      return normalizeDirectMessage(arr[0]);
    }
    
    return null;
  } catch (error) {
    console.error('[MessagePack] Error normalizando array:', error.message);
    return null;
  }
}

/**
 * Normalizar mensaje directo con datos de Aviator
 * Detectar automáticamente el comando basado en los campos presentes
 * @param {Object} obj - Objeto con datos
 * @returns {Object|null}
 */
function normalizeDirectMessage(obj) {
  try {
    // Detectar comando basado en campos presentes
    let command = 'unknown';
    let params = obj;
    
    // Comando: updateCurrentBets (tiene betsCount, bets array)
    if (obj.betsCount !== undefined || obj.bets !== undefined) {
      command = 'updateCurrentBets';
    }
    // Comando: onlinePlayers (tiene onlinePlayers)
    else if (obj.onlinePlayers !== undefined) {
      command = 'onlinePlayers';
    }
    // Comando: changeState (tiene newStateId, roundId)
    else if (obj.newStateId !== undefined || obj.stateId !== undefined) {
      command = 'changeState';
      // Normalizar newStateId
      if (obj.stateId !== undefined && obj.newStateId === undefined) {
        params = { ...obj, newStateId: obj.stateId };
      }
    }
    // Comando: updateCurrentCashOuts (tiene cashouts)
    else if (obj.cashouts !== undefined || obj.cashOuts !== undefined) {
      command = 'updateCurrentCashOuts';
      // Normalizar cashouts
      if (obj.cashOuts !== undefined && obj.cashouts === undefined) {
        params = { ...obj, cashouts: obj.cashOuts };
      }
    }
    // Comando: x (multiplicador - tiene crashX o x)
    else if (obj.crashX !== undefined || obj.x !== undefined) {
      command = 'x';
    }
    // Comando: roundChartInfo (tiene roundId y maxMultiplier)
    else if (obj.roundId !== undefined && obj.maxMultiplier !== undefined) {
      command = 'roundChartInfo';
    }
    
    return {
      p: {
        c: command,
        p: params
      }
    };
    
  } catch (error) {
    console.error('[MessagePack] Error normalizando mensaje directo:', error.message);
    return null;
  }
}

/**
 * Verificar si un mensaje es MessagePack
 * MessagePack típicamente empieza con bytes específicos
 * @param {Buffer} binaryData 
 * @returns {boolean}
 */
function isMessagePackMessage(binaryData) {
  if (!binaryData || binaryData.length < 1) return false;
  
  const firstByte = binaryData[0];
  
  // MessagePack puede empezar con varios tipos:
  // - fixmap: 0x80-0x8f (map de 0-15 elementos)
  // - fixarray: 0x90-0x9f (array de 0-15 elementos)
  // - map16: 0xde
  // - map32: 0xdf
  // - array16: 0xdc
  // - array32: 0xdd
  // - fixstr: 0xa0-0xbf (string de 0-31 bytes)
  // - nil: 0xc0
  // - false: 0xc2
  // - true: 0xc3
  // - bin8: 0xc4
  // - bin16: 0xc5
  // - bin32: 0xc6
  // - ext8: 0xc7
  // - ext16: 0xc8
  // - ext32: 0xc9
  // - float32: 0xca
  // - float64: 0xcb
  // - uint8: 0xcc
  // - uint16: 0xcd
  // - uint32: 0xce
  // - uint64: 0xcf
  // - int8: 0xd0
  // - int16: 0xd1
  // - int32: 0xd2
  // - int64: 0xd3
  // - fixext1: 0xd4
  // - fixext2: 0xd5
  // - fixext4: 0xd6
  // - fixext8: 0xd7
  // - fixext16: 0xd8
  // - str8: 0xd9
  // - str16: 0xda
  // - str32: 0xdb
  
  // Verificar si es un tipo válido de MessagePack
  const isMessagePack = (
    (firstByte >= 0x80 && firstByte <= 0x8f) || // fixmap
    (firstByte >= 0x90 && firstByte <= 0x9f) || // fixarray
    (firstByte >= 0xa0 && firstByte <= 0xbf) || // fixstr
    (firstByte >= 0xc0 && firstByte <= 0xdf) || // tipos especiales, bin, ext, números
    (firstByte >= 0xd9 && firstByte <= 0xdb) || // str8, str16, str32
    (firstByte >= 0xdc && firstByte <= 0xdf)    // array16, array32, map16, map32
  );
  
  return isMessagePack;
}

/**
 * Analizar estructura del mensaje MessagePack
 * @param {Buffer} binaryData 
 * @returns {Object} - Información del mensaje
 */
function analyzeMessagePack(binaryData) {
  if (!binaryData || binaryData.length === 0) {
    return { type: 'empty', size: 0 };
  }
  
  const firstByte = binaryData[0];
  let type = 'unknown';
  
  if (firstByte >= 0x80 && firstByte <= 0x8f) {
    type = 'fixmap';
  } else if (firstByte >= 0x90 && firstByte <= 0x9f) {
    type = 'fixarray';
  } else if (firstByte >= 0xa0 && firstByte <= 0xbf) {
    type = 'fixstr';
  } else if (firstByte === 0xde) {
    type = 'map16';
  } else if (firstByte === 0xdf) {
    type = 'map32';
  } else if (firstByte === 0xdc) {
    type = 'array16';
  } else if (firstByte === 0xdd) {
    type = 'array32';
  }
  
  return {
    type,
    firstByte: '0x' + firstByte.toString(16).padStart(2, '0'),
    size: binaryData.length,
    isMessagePack: isMessagePackMessage(binaryData)
  };
}

module.exports = {
  decodeMessage: decodeMessagePackMessage,
  isMessagePackMessage,
  analyzeMessagePack
};

