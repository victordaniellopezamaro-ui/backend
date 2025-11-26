/**
 * UNIFIED DECODER - MEJORADO
 * 
 * Sistema unificado que soporta AMBOS decoders:
 * - SFS (SmartFoxServer) para algunos bookmakers
 * - MessagePack para otros bookmakers modernos
 * 
 * Con mejor detección automática y manejo de errores
 */

const sfsDecoder = require('./decoder');
const msgpackDecoder = require('./decoder-msgpack');

/**
 * Tipos de decoders soportados
 */
const DECODER_TYPES = {
  SFS: 'sfs',
  MSGPACK: 'msgpack',
  AUTO: 'auto'  // Detectar automáticamente
};

/**
 * Detectar automáticamente qué tipo de decoder usar
 * MEJORADO: Mejor lógica de detección
 * @param {Buffer} binaryData 
 * @returns {string} - Tipo de decoder detectado
 */
function detectDecoderType(binaryData) {
  if (!binaryData || binaryData.length < 1) {
    return DECODER_TYPES.SFS; // Default
  }
  
  const firstByte = binaryData[0];
  
  // PRIORIDAD 1: Verificar MessagePack PRIMERO (más específico)
  // MessagePack tiene patrones muy específicos y distintos de SFS
  if (msgpackDecoder.isMessagePackMessage(binaryData)) {
    // Verificar adicionalmente que NO sea SFS comprimido (0x78 0x9c = zlib)
    if (binaryData.length >= 2) {
      const secondByte = binaryData[1];
      // Si es 0x80 seguido de un short (indicador de SFS), no es MessagePack
      if (firstByte === 0x80 && (secondByte === 0x00 || secondByte === 0x01)) {
        return DECODER_TYPES.SFS;
      }
    }
    return DECODER_TYPES.MSGPACK;
  }
  
  // PRIORIDAD 2: Verificar SFS
  // SFS: Empieza con 0x80 (bit 7 = 1) y tiene estructura específica
  if ((firstByte & 0x80) === 0x80) {
    // Verificar si tiene la estructura típica de SFS
    if (binaryData.length >= 3) {
      const secondByte = binaryData[1];
      const thirdByte = binaryData[2];
      
      // SFS comprimido: 0x80 0x00 0xXX 0x78 0x9c...
      if (binaryData.length >= 5 && binaryData[3] === 0x78 && binaryData[4] === 0x9c) {
        return DECODER_TYPES.SFS;
      }
      
      // SFS sin comprimir: 0x80 0x00 0xXX 0x12 (objeto) o 0x11 (array)
      if (binaryData.length >= 4 && (binaryData[3] === 0x12 || binaryData[3] === 0x11)) {
        return DECODER_TYPES.SFS;
      }
    }
    
    return DECODER_TYPES.SFS;
  }
  
  // Por defecto, intentar MessagePack primero (más común en bookmakers modernos)
  return DECODER_TYPES.MSGPACK;
}

/**
 * Decodificar mensaje usando el decoder apropiado
 * MEJORADO: Mejor manejo de errores y fallbacks
 * @param {Buffer} binaryData - Datos binarios
 * @param {string} decoderType - Tipo de decoder: 'sfs', 'msgpack', o 'auto'
 * @returns {Object|null} - Mensaje decodificado
 */
function decodeMessage(binaryData, decoderType = DECODER_TYPES.AUTO) {
  try {
    if (!binaryData || binaryData.length === 0) {
      console.error('[UnifiedDecoder] Buffer vacío');
      return null;
    }

    // Si es AUTO, detectar el tipo
    let actualDecoderType = decoderType;
    if (decoderType === DECODER_TYPES.AUTO) {
      actualDecoderType = detectDecoderType(binaryData);
      // Log solo para debug (descomentar si es necesario)
      // console.log(`[UnifiedDecoder] Auto-detectado: ${actualDecoderType}`);
    }
    
    // Usar el decoder apropiado
    let result = null;
    let triedDecoders = [];
    
    switch (actualDecoderType) {
      case DECODER_TYPES.MSGPACK:
        triedDecoders.push('msgpack');
        result = msgpackDecoder.decodeMessage(binaryData);
        if (result) {
          // console.log('[UnifiedDecoder] ✓ MessagePack exitoso');
          return result;
        }
        // Si MessagePack falla, intentar SFS como fallback (silenciosamente)
        triedDecoders.push('sfs-fallback');
        result = sfsDecoder.decodeMessage(binaryData);
        if (result) {
          // console.log('[UnifiedDecoder] ✓ SFS fallback exitoso');
          return result;
        }
        break;
        
      case DECODER_TYPES.SFS:
      default:
        triedDecoders.push('sfs');
        result = sfsDecoder.decodeMessage(binaryData);
        if (result) {
          // console.log('[UnifiedDecoder] ✓ SFS exitoso');
          return result;
        }
        // Si SFS falla, intentar MessagePack como fallback (silenciosamente)
        triedDecoders.push('msgpack-fallback');
        result = msgpackDecoder.decodeMessage(binaryData);
        if (result) {
          // console.log('[UnifiedDecoder] ✓ MessagePack fallback exitoso');
          return result;
        }
        break;
    }
    
    // Si llegamos aquí, ninguno funcionó
    console.error(`[UnifiedDecoder] ❌ Todos los decoders fallaron: ${triedDecoders.join(', ')}`);
    
    // Mostrar análisis del mensaje para debug
    const analysis = analyzeMessage(binaryData);
    console.error('[UnifiedDecoder] Análisis del mensaje:', JSON.stringify(analysis));
    
    return null;
    
  } catch (error) {
    console.error('[UnifiedDecoder] Error crítico decodificando mensaje:', error.message);
    console.error('[UnifiedDecoder] Stack:', error.stack);
    return null;
  }
}

/**
 * Obtener información sobre el tipo de mensaje
 * MEJORADO: Más información para debugging
 * @param {Buffer} binaryData 
 * @returns {Object} - Información del mensaje
 */
function analyzeMessage(binaryData) {
  if (!binaryData || binaryData.length < 1) {
    return { type: 'unknown', size: 0, firstByte: null };
  }
  
  const firstByte = binaryData[0];
  const detectedType = detectDecoderType(binaryData);
  
  // Obtener primeros bytes para debug
  const previewLength = Math.min(20, binaryData.length);
  const bytesPreview = Array.from(binaryData.slice(0, previewLength))
    .map(b => '0x' + b.toString(16).padStart(2, '0'))
    .join(' ');
  
  return {
    type: detectedType,
    size: binaryData.length,
    firstByte: '0x' + firstByte.toString(16).padStart(2, '0'),
    firstBytes: bytesPreview,
    isMessagePack: msgpackDecoder.isMessagePackMessage(binaryData),
    isSFS: (firstByte & 0x80) === 0x80,
    likelyFormat: detectedType === DECODER_TYPES.MSGPACK ? 'MessagePack' : 'SFS'
  };
}

module.exports = {
  decodeMessage,
  detectDecoderType,
  analyzeMessage,
  DECODER_TYPES
};

