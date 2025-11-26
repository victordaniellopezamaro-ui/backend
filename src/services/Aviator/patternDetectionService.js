const GameRound = require('../../models/Aviator/gameRoundModel');
const SignalModel = require('../../models/Aviator/signalModel');

/**
 * Servicio de detección de patrones para emitir señales
 * 
 * Patrón a detectar:
 * - Resultado 1: > 1.50x
 * - Resultado 2: > 1.50x
 * - Resultado 3: < 2.00x
 * 
 * Cuando se detecta este patrón, se emite una señal.
 * La señal se verifica con el siguiente resultado:
 * - Gana si el resultado es > 1.50x
 * - Pierde si el resultado es <= 1.50x (se permite 1 gale)
 */
class PatternDetectionService {
  constructor() {
    this.pendingSignals = new Map(); // bookmakerId -> signalId
    this.io = null;
  }

  /**
   * Inicializar el servicio
   */
  initialize(io) {
    this.io = io;
    console.log('[PatternDetection] ✅ Servicio de detección de patrones inicializado');
  }

  /**
   * Detectar patrón en los últimos resultados
   * Definir múltiples patrones
   */
  detectPattern(results) {
    if (!results || results.length < 3) {
      return { detected: false, allResults: [] };
    }

    // Convertir TODOS los resultados a números (hasta 70 datos)
    const allMultipliers = results.slice(0, 70)
      .map(r => parseFloat(r.max_multiplier) || 0);

    // Tomar solo los primeros 20 valores
    const first20 = allMultipliers.slice(0, 20);

    // 🔥 NUEVA LÓGICA CON CONTADOR ACUMULATIVO DESDE EL ÚLTIMO AL PRIMERO
    console.log("[TrendAnalysis] 🔍 Analizando niveles de tendencia (primeros 20 valores, del último al primero)...");
    
    // 1. Lista de niveles de tendencia con contador acumulativo (del último al primero)
    const trendLevels = [];
    let currentCount = 0;
    
    // Recorrer del último al primer valor
    for (let i = first20.length - 1; i >= 0; i--) {
        if (first20[i] >= 2) {
            currentCount++; // Incrementa si >=2
        } else {
            currentCount--; // Decrementa si <2
        }
        trendLevels.unshift(currentCount); // Insertar al inicio para mantener orden original
    }
    
    // 2. DETECCIÓN MEJORADA - AL MENOS 2 POSICIONES CUMPLAN EL PATRÓN
    const supportList = new Array(first20.length).fill(false);
    const resistanceList = new Array(first20.length).fill(false);
    
    // Solo evaluar el primer valor (posición 0) - el más reciente
    if (first20.length >= 5) {
        const currentTrend = trendLevels[0]; // Nivel de tendencia actual
        
        // Encontrar TODAS las posiciones donde aparece el nivel actual (EXCLUYENDO posición 0)
        const positionsWithCurrentLevel = [];
        for (let i = 0; i < trendLevels.length; i++) {
            if (trendLevels[i] === currentTrend) {
                positionsWithCurrentLevel.push(i);
            }
        }
        
        const sameLevelCount = positionsWithCurrentLevel.length;
        
        // Contar cuántas posiciones cumplen cada patrón
        let supportPatternCount = 0;
        let resistancePatternCount = 0;
        
        for (const pos of positionsWithCurrentLevel) {
            // Excluir posición 0 del análisis de patrón (es el valor actual)
            if (pos === 0) continue;
            
            // Solo verificar posiciones que tengan vecinos (no extremos)
            if (pos > 0 && pos < trendLevels.length - 1) {
                const prev = trendLevels[pos - 1];
                const curr = trendLevels[pos];
                const next = trendLevels[pos + 1];
                
                // Para soporte: debe cumplir X+1, X, X+1 en ESTA posición
                const hasSupportHere = prev === currentTrend + 1 && next === currentTrend + 1;
                if (hasSupportHere) {
                    supportPatternCount++;
                }
                
                // Para resistencia: debe cumplir X-1, X, X-1 en ESTA posición
                const hasResistanceHere = prev === currentTrend - 1 && next === currentTrend - 1;
                if (hasResistanceHere) {
                    resistancePatternCount++;
                }
            }
        }
        
        // 🔥 CONDICIÓN MEJORADA: al menos 3 valores iguales Y AL MENOS 2 cumplen el patrón
        supportList[0] = sameLevelCount >= 3 && supportPatternCount >= 2;
        resistanceList[0] = sameLevelCount >= 3 && resistancePatternCount >= 2;
        
        console.log(`[PatternAnalysis] 🔍 Nivel actual: ${currentTrend}`);
        console.log(`[PatternAnalysis] 📊 Valores iguales: ${sameLevelCount} (posiciones: [${positionsWithCurrentLevel.join(', ')}])`);
        console.log(`[PatternAnalysis] 🛡️ Posiciones que cumplen patrón soporte: ${supportPatternCount}`);
        console.log(`[PatternAnalysis] 🚀 Posiciones que cumplen patrón resistencia: ${resistancePatternCount}`);
    }

    // 🔥 IMPRIMIR LAS 4 LISTAS EN HORIZONTAL
    console.log("=".repeat(80));
    console.log("📊 NIVELES DE TENDENCIA (contador acumulativo del último al primero):");
    console.log("[" + trendLevels.join(", ") + "]");
    
    console.log("🛡️ LISTA SOPORTES (true = al menos 2 posiciones cumplen patrón):");
    console.log("[" + supportList.join(", ") + "]");
    
    console.log("🚀 LISTA RESISTENCIAS (true = al menos 2 posiciones cumplen patrón):");
    console.log("[" + resistanceList.join(", ") + "]");
    
    console.log("📈 DATOS ORIGINALES (primeros 20):");
    console.log("[" + first20.map(val => val.toFixed(2)).join(", ") + "]");
    console.log("=".repeat(80));

    // 🔥 CONTINÚA CON LA LÓGICA ORIGINAL DE PATRONES
    const patterns = [
      {
        name: "patron_3_signals",
        requiredResults: 3,
        conditions: (r) =>
          r[0] > 1.50 &&
          r[1] > 1.50 &&
          r[2] < 2.00
      },
      {
        name: "patron_3_signals_second",
        requiredResults: 3,
        conditions: (r) =>
          r[0] < 2.00 &&
          r[1] > 1.50 &&
          r[2] > 1.50
      },
      {
        name: "patron_6_signals",
        requiredResults: 6,
        conditions: (r) =>
          r[0] < 2.00 &&
          r[1] < 2.00 &&
          r[2] < 2.00 &&
          r[3] > 2.00 &&
          r[4] > 2.00 &&
          r[5] > 2.00
      },
      {
        name: "patron_6_signals_second",
        requiredResults: 6,
        conditions: (r) =>
          r[0] > 2.00 &&
          r[1] > 2.00 &&
          r[2] > 2.00 &&
          r[3] < 2.00 &&
          r[4] < 2.00 &&
          r[5] < 2.00
      }
    ];

    const maxRequired = Math.max(...patterns.map(p => p.requiredResults));
    const patternMultipliers = allMultipliers.slice(0, maxRequired);

    for (const pattern of patterns) {
      if (patternMultipliers.length >= pattern.requiredResults) {
        const patternValues = patternMultipliers.slice(0, pattern.requiredResults);
        const matches = pattern.conditions(patternValues);

        if (matches) {
          console.log(`[PatternDetection] 🎯 Patrón "${pattern.name}" detectado`);
          return {
            detected: true,
            patternName: pattern.name,
            pattern: patternValues,
            allResults: allMultipliers,
            trendLevels: trendLevels,
            supportList: supportList,
            resistanceList: resistanceList
          };
        }
      }
    }

    return { 
      detected: false, 
      allResults: allMultipliers,
      trendLevels: trendLevels,
      supportList: supportList,
      resistanceList: resistanceList
    };
  }





  /**
   * Procesar nuevo resultado y verificar señales pendientes
   */
  async processNewResult(bookmakerId, roundId, multiplier) {
    try {
      // Verificar si este resultado ya fue procesado (evitar duplicados)
      const resultKey = `${bookmakerId}_${roundId}_${multiplier}`;
      if (this.processedResults && this.processedResults.has(resultKey)) {
        console.log(`[PatternDetection] ⚠️ Resultado ${roundId} (${multiplier}x) ya fue procesado, omitiendo`);
        return;
      }

      // Marcar como procesado
      if (!this.processedResults) {
        this.processedResults = new Set();
      }
      this.processedResults.add(resultKey);

      // Limpiar resultados procesados antiguos (mantener solo últimos 1000)
      if (this.processedResults.size > 1000) {
        const array = Array.from(this.processedResults);
        this.processedResults = new Set(array.slice(-500)); // Mantener últimos 500
      }

      // Verificar si hay señales pendientes para este bookmaker
      const pendingSignalId = this.pendingSignals.get(bookmakerId);

      if (pendingSignalId) {
        // Hay una señal pendiente, verificar resultado
        await this.verifySignal(pendingSignalId, bookmakerId, roundId, multiplier);
      }

      // Obtener últimos 20 resultados para detectar nuevos patrones
      // IMPORTANTE: Usar DISTINCT para evitar duplicados en la consulta
      const lastResults = await GameRound.getLastResults(bookmakerId, 70);

      // Filtrar duplicados por round_id antes de analizar
      const uniqueResults = [];
      const seenRoundIds = new Set();
      for (const result of lastResults) {
        if (!seenRoundIds.has(result.round_id)) {
          seenRoundIds.add(result.round_id);
          uniqueResults.push(result);
        }
      }

      if (uniqueResults.length >= 3) {
        const patternCheck = this.detectPattern(uniqueResults);

        if (patternCheck.detected) {
          // Emitir nueva señal
          await this.emitSignal(bookmakerId, patternCheck.pattern);
        }
      }
    } catch (error) {
      console.error(`[PatternDetection] ❌ Error procesando resultado:`, error.message);
    }
  }

  /**
   * Emitir una nueva señal
   */
  async emitSignal(bookmakerId, pattern) {
    try {
      // Verificar si ya hay una señal pendiente para este bookmaker
      if (this.pendingSignals.has(bookmakerId)) {
        console.log(`[PatternDetection] ⚠️ Ya existe una señal pendiente para bookmaker ${bookmakerId}`);
        return;
      }

      // Crear señal en la base de datos
      const signal = await SignalModel.createSignal(bookmakerId, pattern);

      // Guardar referencia de señal pendiente
      this.pendingSignals.set(bookmakerId, signal.id);

      console.log(`[PatternDetection] 🚨 SEÑAL EMITIDA para bookmaker ${bookmakerId} - Signal ID: ${signal.id}`);
      console.log(`[PatternDetection] 📊 Patrón: ${pattern.map(p => p.toFixed(2) + 'x').join(', ')}`);

      // Emitir evento WebSocket
      if (this.io) {
        this.io.emit('signalEmitted', {
          signalId: signal.id,
          bookmakerId: bookmakerId,
          pattern: pattern,
          timestamp: signal.signal_timestamp
        });
      }

      return signal;
    } catch (error) {
      console.error(`[PatternDetection] ❌ Error emitiendo señal:`, error.message);
      throw error;
    }
  }

  /**
   * Verificar resultado de una señal pendiente
   */
  async verifySignal(signalId, bookmakerId, roundId, multiplier) {
    try {
      const multiplierValue = parseFloat(multiplier) || 0;
      const isWin = multiplierValue > 1.50; //CALCULO DE CUANDO ES WIN

      // Obtener la señal actual
      const pendingSignals = await SignalModel.getPendingSignals(bookmakerId);
      const signal = pendingSignals.find(s => s.id === signalId);

      if (!signal) {
        console.log(`[PatternDetection] ⚠️ Señal ${signalId} no encontrada o ya procesada`);
        this.pendingSignals.delete(bookmakerId);
        return;
      }

      // Verificar si es el primer intento o el gale
      const isFirstAttempt = !signal.first_attempt_result;

      if (isFirstAttempt) {
        // Primer intento
        console.log(`[PatternDetection] 🎲 Primer intento - Resultado: ${multiplierValue.toFixed(2)}x - ${isWin ? '✅ GANÓ' : '❌ PERDIÓ'}`);

        await SignalModel.updateFirstAttempt(signalId, multiplierValue, roundId);

        if (isWin) {
          // Ganó en el primer intento, señal completada
          console.log(`[PatternDetection] ✅ Señal ${signalId} GANADA en primer intento`);
          this.pendingSignals.delete(bookmakerId);

          // Emitir evento
          if (this.io) {
            this.io.emit('signalResult', {
              signalId: signalId,
              bookmakerId: bookmakerId,
              attempt: 1,
              result: multiplierValue,
              status: 'won',
              galeUsed: false
            });
          }
        } else {
          // Perdió, esperar gale (siguiente resultado)
          console.log(`[PatternDetection] ⏳ Señal ${signalId} perdió primer intento, esperando gale...`);

          // Emitir evento
          if (this.io) {
            this.io.emit('signalResult', {
              signalId: signalId,
              bookmakerId: bookmakerId,
              attempt: 1,
              result: multiplierValue,
              status: 'pending_gale',
              galeUsed: false
            });
          }
        }
      } else {
        // Segundo intento (gale)
        console.log(`[PatternDetection] 🎲 Segundo intento (GALE) - Resultado: ${multiplierValue.toFixed(2)}x - ${isWin ? '✅ GANÓ' : '❌ PERDIÓ'}`);

        await SignalModel.updateSecondAttempt(signalId, multiplierValue, roundId);

        // Señal completada (ganó o perdió)
        this.pendingSignals.delete(bookmakerId);

        const finalStatus = isWin ? 'won' : 'lost';
        console.log(`[PatternDetection] ${isWin ? '✅' : '❌'} Señal ${signalId} ${finalStatus.toUpperCase()} en gale`);

        // Emitir evento
        if (this.io) {
          this.io.emit('signalResult', {
            signalId: signalId,
            bookmakerId: bookmakerId,
            attempt: 2,
            result: multiplierValue,
            status: finalStatus,
            galeUsed: true
          });
        }
      }
    } catch (error) {
      console.error(`[PatternDetection] ❌ Error verificando señal:`, error.message);
      // Limpiar señal pendiente en caso de error
      this.pendingSignals.delete(bookmakerId);
    }
  }

  /**
   * Obtener señales pendientes
   */
  getPendingSignals() {
    return Array.from(this.pendingSignals.entries()).map(([bookmakerId, signalId]) => ({
      bookmakerId,
      signalId
    }));
  }
}

module.exports = new PatternDetectionService();

