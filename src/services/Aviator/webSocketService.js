const WebSocket = require('ws');
const db = require('../../config/database');
const { getBookmakersWithConfigs } = require('../../models/Aviator/bookmakerModel');
const GameRound = require('../../models/Aviator/gameRoundModel');
const unifiedDecoder = require('./decoder-unified'); // Decoder unificado (SFS + MessagePack)
const patternDetectionService = require('./patternDetectionService'); // Servicio de detección de patrones

class WebSocketService {
  constructor() {
    this.connections = new Map();
    this.roundData = new Map();
    this.pingIntervals = new Map();
    this.maxRetries = 3;
    this.retryDelay = 5000;
    this.io = null;
    this.isResetting = false;
    this.savedRounds = new Set(); // Control de duplicados
    this.pendingRounds = new Map(); // Rondas pendientes de guardar
    this.debugMode = process.env.DEBUG_MODE === 'true' || false; // Modo debug
    this.healthCheckInterval = null; // Intervalo de health check
    this.bookmakersHealth = new Map(); // Estado de salud de cada bookmaker
    this.alertThreshold = 2 * 60 * 1000; // 2 minutos sin actividad = alerta
    this.downThreshold = 5 * 60 * 1000; // 5 minutos sin actividad = caído
  }

  async initializeConnections(io) {
    this.io = io;
    console.log('[WebSocketService] Inicializando conexiones');
    
    // Inicializar servicio de detección de patrones
    patternDetectionService.initialize(io);
    
    // Limpiar rondas guardadas cada 10 minutos para evitar acumulación
    setInterval(() => {
      this.savedRounds.clear();
      console.log('[WebSocketService] 🧹 Limpiando cache de rondas guardadas');
    }, 10 * 60 * 1000);
    
    try {
      const bookmakers = await getBookmakersWithConfigs();
      for (const bookmaker of bookmakers) {
        if (this.isValidBookmaker(bookmaker)) {
          this.connectToBookmaker(bookmaker, io, 0);
        } else {
          console.warn(`[WebSocketService] Configuración inválida para bookmaker ${bookmaker.id}, omitiendo conexión`);
        }
      }

      io.on('connection', (socket) => {
        console.log(`[WebSocketService] Socket conectado: ${socket.id}`);
        socket.on('joinBookmaker', (bookmakerId) => {
          console.log(`[WebSocketService] Cliente unido a bookmaker:${bookmakerId}`);
          socket.join(`bookmaker:${bookmakerId}`);
          const roundData = this.roundData.get(bookmakerId);
          
          // Always send data, even if no active round
          const casinoProfit = roundData ? (roundData.totalBetAmount - roundData.totalCashout) : 0;
          
          socket.emit('round', {
            online_players: roundData?.onlinePlayers || 0,
            bets_count: roundData?.betsCount || 0,
            total_bet_amount: roundData?.totalBetAmount || 0,
            total_cashout: roundData?.totalCashout || 0,
            current_multiplier: roundData?.currentMultiplier || 0,
            max_multiplier: roundData?.maxMultiplier || 0,
            game_state: roundData?.gameState || 'Bet',
            casino_profit: Number(casinoProfit.toFixed(2)),
            round_id: roundData?.roundId || null,
          });
        });
      });

      setInterval(async () => {
        if (this.isResetting) return; // Evitar actualizaciones durante el reseteo
        try {
          const updatedBookmakers = await getBookmakersWithConfigs();
          updatedBookmakers.forEach((bookmaker) => {
            if (
              this.isValidBookmaker(bookmaker) &&
              !this.connections.has(bookmaker.id)
            ) {
              this.connectToBookmaker(bookmaker, io, 0);
            } else if (
              (!this.isValidBookmaker(bookmaker) && this.connections.has(bookmaker.id))
            ) {
              const connection = this.connections.get(bookmaker.id);
              if (connection.ws) {
                connection.ws.close();
                console.log(`Closed WebSocket for bookmaker ${bookmaker.id} due to invalid config`);
              }
              clearInterval(this.pingIntervals.get(bookmaker.id));
              this.connections.delete(bookmaker.id);
              this.pingIntervals.delete(bookmaker.id);
              this.roundData.delete(bookmaker.id);
            }
          });
        } catch (error) {
          console.error('Error checking bookmakers for WebSocket updates:', error.message);
        }
      }, 60000);

      // Iniciar health check automático cada 30 segundos
      this.startHealthCheckMonitoring();
    } catch (error) {
      console.error('Error initializing WebSocket connections:', error.message);
    }
  }

  // Sistema de monitoreo de salud de bookmakers
  startHealthCheckMonitoring() {
    console.log('[HealthCheck] 🏥 Iniciando monitoreo de salud de bookmakers');
    
    this.healthCheckInterval = setInterval(() => {
      this.checkAllBookmakersHealth();
    }, 30000); // Verificar cada 30 segundos
  }

  async checkAllBookmakersHealth() {
    const now = Date.now();
    const bookmakers = await getBookmakersWithConfigs();
    
    for (const bookmaker of bookmakers) {
      if (!bookmaker.active) continue;
      
      const connection = this.connections.get(bookmaker.id);
      const health = this.bookmakersHealth.get(bookmaker.id) || {
        status: 'unknown',
        lastActivity: null,
        lastCheck: now,
        consecutiveFailures: 0,
        isConnected: false,
        lastError: null
      };
      
      if (!connection || !connection.ws) {
        health.status = 'disconnected';
        health.isConnected = false;
        health.consecutiveFailures++;
      } else {
        const lastActivity = connection.lastPing ? connection.lastPing.getTime() : now;
        const timeSinceActivity = now - lastActivity;
        
        // Determinar estado basado en tiempo de inactividad
        if (connection.status === 'CONNECTED') {
          if (timeSinceActivity > this.downThreshold) {
            health.status = 'down';
            health.consecutiveFailures++;
            console.warn(`[HealthCheck] ⚠️ Bookmaker ${bookmaker.id} (${bookmaker.nombre}) CAÍDO - Sin actividad por ${Math.round(timeSinceActivity / 1000 / 60)} minutos`);
          } else if (timeSinceActivity > this.alertThreshold) {
            health.status = 'warning';
            console.warn(`[HealthCheck] 🔶 Bookmaker ${bookmaker.id} (${bookmaker.nombre}) EN ALERTA - Sin actividad por ${Math.round(timeSinceActivity / 1000)} segundos`);
          } else {
            health.status = 'healthy';
            health.consecutiveFailures = 0;
          }
          health.isConnected = true;
        } else {
          health.status = connection.status.toLowerCase();
          health.isConnected = false;
        }
        
        health.lastActivity = lastActivity;
      }
      
      health.lastCheck = now;
      this.bookmakersHealth.set(bookmaker.id, health);
      
      // Emitir estado de salud al frontend
      if (this.io) {
        this.io.emit('bookmakersHealth', this.getAllBookmakersHealth());
      }
      
      // Si un bookmaker está caído, intentar reconectar
      if (health.status === 'down' && health.consecutiveFailures >= 3) {
        console.log(`[HealthCheck] 🔄 Intentando reconectar bookmaker ${bookmaker.id} (${bookmaker.nombre})`);
        this.reconnectBookmaker(bookmaker);
      }
    }
  }

  async reconnectBookmaker(bookmaker) {
    const connection = this.connections.get(bookmaker.id);
    if (connection && connection.ws) {
      try {
        connection.ws.close();
      } catch (error) {
        console.error(`[HealthCheck] Error cerrando conexión antigua:`, error.message);
      }
    }
    
    // Limpiar datos antiguos
    clearInterval(this.pingIntervals.get(bookmaker.id));
    this.connections.delete(bookmaker.id);
    this.pingIntervals.delete(bookmaker.id);
    
    // Reintentar conexión
    this.connectToBookmaker(bookmaker, this.io, 0);
  }

  getAllBookmakersHealth() {
    const healthData = [];
    for (const [bookmakerId, health] of this.bookmakersHealth) {
      healthData.push({
        bookmakerId,
        ...health,
        timeSinceActivity: health.lastActivity ? Date.now() - health.lastActivity : null
      });
    }
    return healthData;
  }

  isValidBookmaker(bookmaker) {
    const { url_websocket, first_message, second_message, third_message } = bookmaker;
    const isValidBase64 = (str) => str && /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0;
    return (
      url_websocket &&
      url_websocket.startsWith('wss://') &&
      first_message &&
      isValidBase64(first_message) &&
      second_message &&
      isValidBase64(second_message) &&
      third_message &&
      isValidBase64(third_message)
    );
  }

  connectToBookmaker(bookmaker, io, retryCount) {
    const { id, nombre: name, url_websocket, first_message, second_message, third_message } = bookmaker;
    const headers = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Origin: 'https://aviator-next.spribegaming.com',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    };

    try {
      // Validar configuración del bookmaker
      if (!this.isValidBookmaker(bookmaker)) {
        throw new Error(`Invalid configuration for bookmaker ${id}`);
      }

      // Limpiar conexión existente
      if (this.connections.has(id)) {
        const connection = this.connections.get(id);
        if (connection.ws) {
          connection.ws.close(1000, 'Closing for reset');
          console.log(`Closed existing WebSocket for bookmaker ${id}`);
        }
        clearInterval(this.pingIntervals.get(id));
        this.connections.delete(id);
        this.pingIntervals.delete(id);
        this.roundData.delete(id);
      }

      const ws = new WebSocket(url_websocket, [], { headers });

      this.connections.set(id, { ws, status: 'CONNECTING', lastPing: null });
      this.roundData.set(id, {
        betsCount: 0,
        totalBetAmount: 0,
        onlinePlayers: 0,
        roundId: null,
        maxMultiplier: 0,
        currentMultiplier: 0,
        totalCashout: 0,
        cashoutRecords: new Set(),
        gameState: 'Bet',
      });

      ws.on('open', async () => {
        console.log(`WebSocket connected for bookmaker ${id}`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        
        
        ws.send(Buffer.from(first_message, 'base64'));
      });

      ws.on('message', async (data) => {
        try {
          // Usar el decoder apropiado según la configuración del bookmaker
          const decoderType = bookmaker.decoder_type || 'auto';
          const decodedMessage = unifiedDecoder.decodeMessage(data, decoderType);
          
          if (!decodedMessage) {
            // Silenciar logs de mensajes no decodificables (pueden ser pings/pongs)
            // Solo loggear si el buffer es significativamente grande (>10 bytes)
            if (data && data.length > 10) {
              const analysis = unifiedDecoder.analyzeMessage(data);
              // Log solo cada 20 mensajes no decodificados para evitar spam
              if (!ws.undecodedCount) ws.undecodedCount = 0;
              ws.undecodedCount++;
              if (ws.undecodedCount % 20 === 0) {
                console.log(`[WS:${id}] ⚠️ ${ws.undecodedCount} mensajes no decodificados. Último análisis:`, {
                  tipo: analysis.type,
                  tamaño: analysis.size,
                  primerByte: analysis.firstByte
                });
              }
            }
            return;
          }

          // Resetear contador de mensajes no decodificados al recibir uno exitoso
          ws.undecodedCount = 0;

          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });

          if (!ws.firstResponseReceived) {
            ws.send(Buffer.from(second_message, 'base64'));
            ws.firstResponseReceived = true;
          }

          const roundData = this.roundData.get(id);
          if (!roundData) {
            // Silenciar este warning, es normal durante la inicialización
            // console.warn(`[WS:${id}] ⚠️ No hay roundData inicializado`);
            return;
          }

          // Log de mensaje decodificado en modo debug
          if (this.debugMode && decodedMessage.p && decodedMessage.p.c) {
            console.log(`[WS:${id}] 📥 Comando: ${decodedMessage.p.c}`, JSON.stringify(decodedMessage.p.p).substring(0, 200));
          }

          if (decodedMessage.p) {
            const { p, c } = decodedMessage.p;

            if (c === 'updateCurrentBets') {
              // Actualizar conteo de apuestas
              const newBetsCount = parseInt(p.betsCount) || 0;
              roundData.betsCount = Math.max(roundData.betsCount, newBetsCount);
              
              // Calcular total apostado de forma segura
              if (p.bets && Array.isArray(p.bets)) {
                roundData.totalBetAmount = p.bets.reduce((sum, bet) => {
                  const betAmount = parseFloat(bet.bet || bet.amount || 0);
                  return sum + betAmount;
                }, 0);
              } else if (p.totalBetAmount !== undefined) {
                // Si viene el total directamente
                roundData.totalBetAmount = parseFloat(p.totalBetAmount) || 0;
              }
              
              roundData.gameState = 'Bet';
            } else if (c === 'onlinePlayers') {
              roundData.onlinePlayers = parseInt(p.onlinePlayers) || 0;
            } else if (c === 'changeState') {
              // newStateId: 1 = Bet (apuestas abiertas), 2 = Run (avión volando), 3 = End (terminó)
              
              // MEJORADO: Extraer roundId de múltiples campos posibles
              const extractedRoundId = p.roundId || p.round_id || p.id || p.gameId || p.game_id;
              
              if (p.newStateId === 1) {
                // Estado 1: Apuestas abiertas
                roundData.gameState = 'Bet';
                
                // Establecer roundId si viene en este mensaje
                if (extractedRoundId) {
                  roundData.roundId = String(extractedRoundId);
                  console.log(`[WS:${id}] 🎲 Nueva ronda ${roundData.roundId} - Apuestas abiertas`);
                } else {
                  console.log(`[WS:${id}] 🎲 Nueva ronda - Apuestas abiertas (roundId pendiente)`);
                }
                
                roundData.currentMultiplier = 0;
                
                if (roundData.roundId) {
                  this.io.to(`bookmaker:${id}`).emit('roundStart', {
                    roundId: roundData.roundId,
                    gameState: 'Bet',
                  });
                }
              } else if (p.newStateId === 2) {
                // Estado 2: Avión volando
                roundData.gameState = 'Run';
                
                // Intentar establecer roundId si aún no está establecido
                if (!roundData.roundId && extractedRoundId) {
                  roundData.roundId = String(extractedRoundId);
                  console.log(`[WS:${id}] 🆔 RoundId establecido en estado Run: ${roundData.roundId}`);
                }
                
                roundData.currentMultiplier = 0;
                
                console.log(`[WS:${id}] 🚀 Avión despegó - Round: ${roundData.roundId || 'SIN_ID'}`);
              } else if (p.newStateId === 3) {
                // Estado 3: Juego terminado (algunos bookmakers usan este estado)
                roundData.gameState = 'End';
                
                // Intentar establecer roundId si aún no está establecido
                if (!roundData.roundId && extractedRoundId) {
                  roundData.roundId = String(extractedRoundId);
                  console.log(`[WS:${id}] 🆔 RoundId establecido en estado End: ${roundData.roundId}`);
                }
                
                // IMPORTANTE: Extraer crashX o maxMultiplier del mensaje changeState si está disponible
                const stateMultiplier = parseFloat(p.crashX || p.maxMultiplier || p.max_multiplier || p.multiplier || 0);
                if (stateMultiplier > 0 && stateMultiplier > roundData.maxMultiplier) {
                  roundData.maxMultiplier = stateMultiplier;
                  roundData.currentMultiplier = stateMultiplier;
                  console.log(`[WS:${id}] 📊 Multiplicador actualizado desde changeState: ${stateMultiplier}x`);
                }
                
                console.log(`[WS:${id}] 🛬 Estado End recibido - Round: ${roundData.roundId || 'SIN_ID'}, Multi: ${roundData.maxMultiplier}x`);
                
                // NUEVO: Guardar ronda aquí si tiene maxMultiplier válido
                if (roundData.maxMultiplier > 0) {
                  console.log(`[WS:${id}] 💾 Guardando ronda desde estado End (changeState)`);
                  try {
                    await this.saveRoundData(id, name, roundData.maxMultiplier);
                    setTimeout(() => this.resetRoundData(id), 3000);
                  } catch (error) {
                    console.error(`[WS:${id}] ❌ Error guardando desde changeState:`, error);
                  }
                } else {
                  console.warn(`[WS:${id}] ⚠️ Estado End sin multiplicador válido, esperando más datos...`);
                  // Programar guardado después de 2 segundos si aún no se guardó
                  setTimeout(async () => {
                    const currentData = this.roundData.get(id);
                    if (currentData && currentData.maxMultiplier > 0 && currentData.roundId) {
                      const roundKey = `${id}_${currentData.roundId}`;
                      if (!this.savedRounds.has(roundKey)) {
                        console.log(`[WS:${id}] 💾 Guardado retrasado desde changeState`);
                        await this.saveRoundData(id, name, currentData.maxMultiplier);
                      }
                    }
                  }, 2000);
                }
              } else {
                console.warn(`[WS:${id}] ⚠️ Estado desconocido: ${p.newStateId}`);
              }
            } else if (c === 'updateCurrentCashOuts') {
              // Manejo robusto de cashouts
              const cashouts = p.cashouts || p.cashOuts || [];
              if (Array.isArray(cashouts)) {
                cashouts.forEach((cashout) => {
                  try {
                    // Crear clave única para evitar duplicados
                    const playerId = cashout.player_id || cashout.playerId || '';
                    const betId = cashout.betId || cashout.bet_id || '';
                    const multiplier = cashout.multiplier || cashout.multi || 0;
                    const cashoutKey = `${playerId}-${betId}-${multiplier}`;
                    
                    if (!roundData.cashoutRecords.has(cashoutKey)) {
                      // Obtener monto ganado
                      const winAmount = parseFloat(cashout.winAmount || cashout.win_amount || cashout.amount || 0);
                      roundData.totalCashout += winAmount;
                      roundData.cashoutRecords.add(cashoutKey);
                    }
                  } catch (cashoutError) {
                    console.error(`[WS:${id}] Error procesando cashout:`, cashoutError.message);
                  }
                });
              }
            } else if (c === 'x') {
              // Comando 'x' maneja AMBOS:
              // - crashX: multiplicador final cuando el juego termina
              // - x: multiplicador actual mientras el juego está en curso
              
              // MEJORADO: Intentar extraer roundId si viene aquí
              const extractedRoundId = p.roundId || p.round_id || p.id || p.gameId || p.game_id;
              if (!roundData.roundId && extractedRoundId) {
                roundData.roundId = String(extractedRoundId);
                console.log(`[WS:${id}] 🆔 RoundId establecido en comando 'x': ${roundData.roundId}`);
              }
              
              if (p.crashX !== undefined && p.crashX !== null) {
                // El juego terminó - crashX es el multiplicador final
                const finalMultiplier = parseFloat(p.crashX) || 0;
                roundData.maxMultiplier = finalMultiplier;
                roundData.currentMultiplier = finalMultiplier;
                roundData.gameState = 'End';
                
                console.log(`[WS:${id}] 🎯 Juego terminado - crashX: ${finalMultiplier}x (Round: ${roundData.roundId || 'GENERANDO'})`);
                
                // MEJORADO: Generar roundId temporal si no existe
                if (!roundData.roundId) {
                  const timestamp = Date.now();
                  roundData.roundId = `round_${id}_${timestamp}`;
                  console.warn(`[WS:${id}] ⚠️ RoundId generado temporalmente: ${roundData.roundId}`);
                }
                
                // SIEMPRE intentar guardar cuando hay crashX
                try {
                  console.log(`[WS:${id}] 💾 Intentando guardar ronda con crashX...`);
                  await this.saveRoundData(id, name, finalMultiplier);
                  // Resetear después de un delay para que el frontend reciba los datos
                  setTimeout(() => this.resetRoundData(id), 4000);
                } catch (saveError) {
                  console.error(`[WS:${id}] ❌ Error crítico guardando ronda:`, saveError);
                  // Guardar en backup
                  this.saveRoundToBackup(id, roundData, finalMultiplier);
                }
              } else if (p.x !== undefined && p.x !== null) {
                // El juego está en curso - x es el multiplicador actual
                const currentMulti = parseFloat(p.x) || 0;
                roundData.currentMultiplier = currentMulti;
                
                // Actualizar maxMultiplier si el actual es mayor
                if (currentMulti > roundData.maxMultiplier) {
                  roundData.maxMultiplier = currentMulti;
                }
                
                roundData.gameState = 'Run';
                
                // Emitir multiplicador actual en tiempo real
                if (this.io) {
                  this.io.to(`bookmaker:${id}`).emit('multiplier', {
                    bookmakerId: id,
                    current_multiplier: currentMulti.toFixed(2),
                  });
                }
                
                if (this.debugMode) {
                  if (!ws.multiplierLogCount) ws.multiplierLogCount = 0;
                  ws.multiplierLogCount++;
                  if (ws.multiplierLogCount % 20 === 0) {
                    console.log(`[WS:${id}] 🚀 Multiplicador actual: ${currentMulti.toFixed(2)}x (max: ${roundData.maxMultiplier.toFixed(2)}x)`);
                  }
                }
              } else {
                // Si no hay ni crashX ni x, loggear para debug
                if (this.debugMode) {
                  console.warn(`[WS:${id}] ⚠️ Comando 'x' sin crashX ni x:`, JSON.stringify(p));
                }
              }
            } else if (c === 'roundChartInfo') {
              // MEJORADO: roundChartInfo puede ser RESPALDO para guardar rondas
              const extractedRoundId = p.roundId || p.round_id || p.id;
              const extractedMultiplier = parseFloat(p.maxMultiplier || p.max_multiplier || p.multiplier || 0);
              
              if (extractedRoundId) {
                // Actualizar datos
                roundData.roundId = String(extractedRoundId);
                
                if (extractedMultiplier > 0) {
                  roundData.maxMultiplier = extractedMultiplier;
                  roundData.currentMultiplier = extractedMultiplier;
                  
                  console.log(`[WS:${id}] 📊 roundChartInfo recibido - Round: ${roundData.roundId}, Multi: ${extractedMultiplier}x`);
                  
                  // NUEVO: Guardar ronda también desde roundChartInfo como BACKUP
                  if (roundData.gameState === 'End' || extractedMultiplier > 0) {
                    console.log(`[WS:${id}] 💾 Guardando ronda desde roundChartInfo (BACKUP)`);
                    try {
                      await this.saveRoundData(id, name, extractedMultiplier);
                    } catch (error) {
                      console.error(`[WS:${id}] ❌ Error guardando desde roundChartInfo:`, error.message);
                    }
                  }
                }
                
                // Emitir al frontend
                if (this.io) {
                  this.io.to(`bookmaker:${id}`).emit('roundChartInfo', {
                    maxMultiplier: extractedMultiplier,
                    roundId: roundData.roundId,
                  });
                }
              }
            } else {
              // Comando desconocido - loggear para agregar soporte si es necesario
              // Descomentar para debug de comandos nuevos:
              // console.log(`[WS:${id}] ℹ️ Comando desconocido: ${c}`, JSON.stringify(p).substring(0, 200));
            }

            // Calcular ganancia del casino
            const casinoProfit = roundData.totalBetAmount - roundData.totalCashout;
            
            // Emitir datos actualizados de la ronda
            const roundDataToEmit = {
              online_players: roundData.onlinePlayers,
              bets_count: roundData.betsCount,
              total_bet_amount: roundData.totalBetAmount,
              total_cashout: roundData.totalCashout,
              current_multiplier: roundData.currentMultiplier,
              max_multiplier: roundData.maxMultiplier,
              game_state: roundData.gameState,
              casino_profit: Number(casinoProfit.toFixed(2)),
              round_id: roundData.roundId,
              bookmaker_id: id, // Agregar ID del bookmaker para que el frontend lo filtre
            };
            
            // Log solo si hay cambios significativos (comentar en producción si molesta)
            // if (roundData.gameState === 'End' || roundData.currentMultiplier > 0) {
            //   console.log(`[WS:${id}] 📤 Emitiendo datos - State: ${roundData.gameState}, Multi: ${roundData.currentMultiplier.toFixed(2)}x`);
            // }
            
            this.io.to(`bookmaker:${id}`).emit('round', roundDataToEmit);
          }
        } catch (error) {
          console.error(`[WS:${id}] ❌ Error processing message:`, error.message);
          console.error(`[WS:${id}] Stack:`, error.stack);
        }
      });

      ws.on('error', async (error) => {
        console.error(`WebSocket error for bookmaker ${id}: ${error.message}`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing });
        
        
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, io, retryCount);
        }
      });

      ws.on('close', async (code, reason) => {
        console.log(`WebSocket closed for bookmaker ${id} (code: ${code}, reason: ${reason || 'No reason provided'})`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing });
        
        
        const roundData = this.roundData.get(id);
        if (roundData?.roundId && roundData.maxMultiplier > 0) {
          await this.saveRoundData(id, name, roundData.maxMultiplier);
        }
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, io, retryCount);
        }
      });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(Buffer.from(third_message, 'base64'));
          } catch (error) {
            console.error(`Error sending PING for bookmaker ${id}: ${error.message}`);
            if (!this.isResetting) {
              this.handleReconnect(bookmaker, io, retryCount);
            }
          }
        } else {
          console.log(`WebSocket not OPEN for bookmaker ${id}, state: ${ws.readyState}`);
          if (!this.isResetting) {
            this.handleReconnect(bookmaker, io, retryCount);
          }
        }
      }, 10000);

      this.pingIntervals.set(id, pingInterval);

      ws.on('close', () => {
        console.log(`Cleaning up pingInterval for bookmaker ${id}`);
        clearInterval(this.pingIntervals.get(id));
        this.pingIntervals.delete(id);
      });
    } catch (error) {
      console.error(`Failed to connect WebSocket for bookmaker ${id}: ${error.message}`);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      if (!this.isResetting) {
        this.handleReconnect(bookmaker, io, retryCount);
      }
    }
  }

  handleReconnect(bookmaker, io, retryCount) {
    if (retryCount >= this.maxRetries) {
      console.log(`ACTUALIZA TU TOKEN para bookmaker ${bookmaker.id}. Máximo de intentos (${this.maxRetries}) alcanzado.`);
      // No eliminamos conexiones ni datos para mantener el servidor activo
      return;
    }

    console.log(`Attempting to reconnect for bookmaker ${bookmaker.id} (Attempt ${retryCount + 1}/${this.maxRetries})`);
    setTimeout(() => {
      this.connectToBookmaker(bookmaker, io, retryCount + 1);
    }, this.retryDelay * (retryCount + 1));
  }

  async saveRoundData(bookmaker_id, bookmaker_name, crashX) {
    const roundData = this.roundData.get(bookmaker_id);
    
    // Validaciones robustas
    if (!roundData) {
      console.error(`[SAVE:${bookmaker_id}] ❌ No hay roundData disponible`);
      return;
    }
    
    // Validar crashX primero
    let validCrashX = parseFloat(crashX) || parseFloat(roundData.maxMultiplier) || 0;
    if (validCrashX <= 0) {
      console.error(`[SAVE:${bookmaker_id}] ❌ crashX inválido: ${crashX}, no se guardará`);
      return;
    }
    
    // CORREGIDO: Validar y limitar el valor para evitar desbordamiento de decimales
    // DECIMAL(20,2) soporta hasta 999,999,999,999,999,999.99 (18 dígitos + 2 decimales)
    const MAX_MULTIPLIER_VALUE = 999999999999999999.99;
    if (validCrashX > MAX_MULTIPLIER_VALUE) {
      console.warn(`[SAVE:${bookmaker_id}] ⚠️ Multiplicador muy grande (${validCrashX}), limitando a ${MAX_MULTIPLIER_VALUE}`);
      validCrashX = MAX_MULTIPLIER_VALUE;
    }
    
    // Asegurar que el valor tenga máximo 2 decimales y no sea NaN o Infinity
    if (!isFinite(validCrashX) || isNaN(validCrashX)) {
      console.error(`[SAVE:${bookmaker_id}] ❌ crashX no es un número válido: ${crashX}, no se guardará`);
      return;
    }
    
    // Redondear a 2 decimales de forma segura
    validCrashX = Math.round(validCrashX * 100) / 100;
    
    // MEJORADO: No fallar si no hay roundId, generar uno temporal único
    if (!roundData.roundId) {
      const timestamp = Date.now();
      roundData.roundId = `temp_${bookmaker_id}_${timestamp}`;
      console.warn(`[SAVE:${bookmaker_id}] ⚠️ roundId generado: ${roundData.roundId}`);
    }
    
    // CONTROL DE DUPLICADOS EN MEMORIA: Verificar si ya se guardó esta ronda por round_id
    const roundKey = `${bookmaker_id}_${roundData.roundId}`;
    if (this.savedRounds.has(roundKey)) {
      if (this.debugMode) {
        console.log(`[SAVE:${bookmaker_id}] ⚠️ Ronda ${roundData.roundId} ya fue guardada en memoria, omitiendo duplicado`);
      }
      return;
    }
    
    // CORREGIDO: Verificar duplicados SOLO por round_id (no por multiplicador)
    // El multiplicador puede repetirse en diferentes rondas, eso es normal
    const existingByRoundId = await GameRound.findByRoundId(bookmaker_id, String(roundData.roundId));
    if (existingByRoundId) {
      console.log(`[SAVE:${bookmaker_id}] ⚠️ Ronda con round_id ${roundData.roundId} ya existe en BD - Omitiendo duplicado`);
      // Marcar como guardada en memoria para evitar reintentos
      this.savedRounds.add(roundKey);
      return;
    }
    
    // SOLO si el round_id es temporal, verificar por multiplicador + timestamp como fallback
    // Esto es para evitar duplicados cuando no llega el round_id real
    const isTemporaryId = roundData.roundId.startsWith('temp_') || roundData.roundId.startsWith('round_');
    if (isTemporaryId) {
      const similarRound = await GameRound.findSimilarRound(bookmaker_id, validCrashX);
      if (similarRound) {
        // Si la ronda similar tiene un ID temporal y la nueva también, verificar si es realmente la misma
        const isExistingTemporary = similarRound.round_id.startsWith('temp_') || similarRound.round_id.startsWith('round_');
        
        // Si la existente es temporal y la nueva también, y tienen el mismo multiplicador en ventana de tiempo,
        // probablemente es la misma ronda, actualizar con el nuevo ID temporal si es más reciente
        if (isExistingTemporary) {
          const timeDiff = Math.abs(new Date() - new Date(similarRound.timestamp || similarRound.created_at));
          // Si la ronda similar es muy reciente (menos de 30 segundos), probablemente es la misma
          if (timeDiff < 30000) {
            console.log(`[SAVE:${bookmaker_id}] 🔄 Ronda temporal similar encontrada (${similarRound.round_id}), actualizando con nuevo ID temporal`);
            await GameRound.updateRoundId(similarRound.round_id, roundData.roundId, bookmaker_id);
            this.savedRounds.add(roundKey);
            return;
          }
        }
      }
    }
    
    // Actualizar maxMultiplier si crashX es mayor
    if (validCrashX > roundData.maxMultiplier) {
      roundData.maxMultiplier = validCrashX;
    }

    try {
      // Calcular datos con validación
      const totalBetAmount = parseFloat(roundData.totalBetAmount) || 0;
      const totalCashout = parseFloat(roundData.totalCashout) || 0;
      const casinoProfit = totalBetAmount - totalCashout;
      const lossPercentage = totalBetAmount > 0 ? (casinoProfit / totalBetAmount) * 100 : 0;

      // Log de pre-guardado para debugging
      console.log(`[SAVE:${bookmaker_id}] 💾 Intentando guardar:`, {
        roundId: roundData.roundId,
        crashX: validCrashX,
        betsCount: roundData.betsCount,
        totalBetAmount,
        onlinePlayers: roundData.onlinePlayers
      });

      // Insertar en base de datos (addRound ya maneja duplicados internamente)
      let savedRound;
      try {
        // Validar y formatear valores antes de guardar
        const safeMultiplier = this.safeDecimalValue(validCrashX, 2, MAX_MULTIPLIER_VALUE);
        const safeBetAmount = this.safeDecimalValue(totalBetAmount, 2);
        const safeCashout = this.safeDecimalValue(totalCashout, 2);
        const safeProfit = this.safeDecimalValue(casinoProfit, 2);
        const safeLossPercent = this.safeDecimalValue(lossPercentage, 2);
        
        savedRound = await GameRound.addRound(
          bookmaker_id,
          String(roundData.roundId),
          parseInt(roundData.betsCount) || 0,
          safeBetAmount,
          parseInt(roundData.onlinePlayers) || 0,
          safeMultiplier,
          safeCashout,
          safeProfit,
          safeLossPercent
        );
        
        // Si se actualizó un round_id temporal, actualizar en memoria
        if (savedRound && savedRound.round_id !== roundData.roundId) {
          this.savedRounds.delete(roundKey);
          this.savedRounds.add(`${bookmaker_id}_${savedRound.round_id}`);
          roundData.roundId = savedRound.round_id;
          console.log(`[SAVE:${bookmaker_id}] 🔄 RoundId actualizado en memoria: ${savedRound.round_id}`);
        }
      } catch (dbError) {
        // Si es error de duplicado (código 23505 en PostgreSQL), verificar y retornar existente
        if (dbError.code === '23505') {
          console.warn(`[SAVE:${bookmaker_id}] ⚠️ Ronda ${roundData.roundId} ya existe en BD (duplicado ignorado)`);
          const existing = await GameRound.findByRoundId(bookmaker_id, String(roundData.roundId));
          if (existing) {
            savedRound = existing;
          } else {
            return; // No se encontró, ya fue procesada
          }
        } else if (dbError.code === '22003' || dbError.message.includes('numeric value out of range') || dbError.message.includes('overflow')) {
          // Error de desbordamiento numérico
          console.error(`[SAVE:${bookmaker_id}] ❌ ERROR: Desbordamiento numérico al guardar ronda ${roundData.roundId}`);
          console.error(`[SAVE:${bookmaker_id}] Valores originales:`, {
            crashX: validCrashX,
            totalBetAmount,
            totalCashout,
            casinoProfit,
            lossPercentage
          });
          
          // Intentar guardar con valores limitados
          try {
            const limitedMultiplier = Math.min(validCrashX, MAX_MULTIPLIER_VALUE);
            console.warn(`[SAVE:${bookmaker_id}] 🔄 Reintentando con multiplicador limitado: ${limitedMultiplier}`);
            savedRound = await GameRound.addRound(
              bookmaker_id,
              String(roundData.roundId),
              parseInt(roundData.betsCount) || 0,
              this.safeDecimalValue(totalBetAmount, 2),
              parseInt(roundData.onlinePlayers) || 0,
              this.safeDecimalValue(limitedMultiplier, 2),
              this.safeDecimalValue(totalCashout, 2),
              this.safeDecimalValue(casinoProfit, 2),
              this.safeDecimalValue(lossPercentage, 2)
            );
          } catch (retryError) {
            console.error(`[SAVE:${bookmaker_id}] ❌ Error crítico en reintento:`, retryError.message);
            throw retryError;
          }
        } else {
          throw dbError; // Re-lanzar otros errores
        }
      }

      // Preparar datos para el frontend
      const now = new Date();
      const offset = -5 * 60; // UTC-5 para Colombia
      now.setMinutes(now.getMinutes() + offset);
      const createdAt = now.toISOString();

      const newRoundData = {
        id: roundData.roundId,
        bookmaker_id,
        round_id: String(roundData.roundId),
        timestamp: createdAt,
        bets_count: parseInt(roundData.betsCount) || 0,
        total_bet_amount: Number(totalBetAmount.toFixed(2)),
        online_players: parseInt(roundData.onlinePlayers) || 0,
        max_multiplier: Number(validCrashX.toFixed(2)),
        total_cashout: Number(totalCashout.toFixed(2)),
        casino_profit: Number(casinoProfit.toFixed(2)),
        loss_percentage: Number(lossPercentage.toFixed(2)),
        created_at: createdAt,
      };

      // Invalidar caché
      try {
        GameRound.invalidateCache(bookmaker_id);
      } catch (cacheError) {
        // No crítico
        console.warn(`[SAVE:${bookmaker_id}] ⚠️ Error invalidando caché:`, cacheError.message);
      }

      // Emitir al frontend
      if (this.io) {
        try {
          this.io.to(`bookmaker:${bookmaker_id}`).emit('newRound', newRoundData);
        } catch (ioError) {
          console.warn(`[SAVE:${bookmaker_id}] ⚠️ Error emitiendo al frontend:`, ioError.message);
        }
      }

      // Log de éxito
      console.log(`[SAVE:${bookmaker_id}] ✅ Round ${roundData.roundId} guardado - crashX: ${validCrashX.toFixed(2)}x, Bets: ${roundData.betsCount}, Profit: $${casinoProfit.toFixed(2)}`);
      
      // MARCAR COMO GUARDADA para evitar duplicados
      this.savedRounds.add(roundKey);
      
      // Procesar resultado para detección de patrones y verificación de señales
      // Siempre procesar si se guardó exitosamente (savedRound existe)
      if (savedRound) {
        try {
          await patternDetectionService.processNewResult(bookmaker_id, String(savedRound.round_id || roundData.roundId), validCrashX);
        } catch (patternError) {
          console.error(`[SAVE:${bookmaker_id}] ⚠️ Error en detección de patrones:`, patternError.message);
        }
      }
      
    } catch (error) {
      console.error(`[SAVE:${bookmaker_id}] ❌ ERROR CRÍTICO guardando ronda:`, {
        roundId: roundData.roundId,
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      
      // Intentar guardar en backup
      this.saveRoundToBackup(bookmaker_id, roundData, crashX);
    }
  }

  // Sistema de BACKUP para rondas que no se pudieron guardar
  saveRoundToBackup(bookmaker_id, roundData, crashX) {
    try {
      const backupData = {
        bookmaker_id,
        roundId: roundData.roundId,
        crashX,
        betsCount: roundData.betsCount,
        totalBetAmount: roundData.totalBetAmount,
        onlinePlayers: roundData.onlinePlayers,
        totalCashout: roundData.totalCashout,
        timestamp: new Date().toISOString()
      };
      
      console.error(`[BACKUP:${bookmaker_id}] 💾 RONDA GUARDADA EN BACKUP:`, JSON.stringify(backupData));
      
      // Opcional: Guardar en archivo o sistema de backup
      // fs.appendFileSync('rounds_backup.log', JSON.stringify(backupData) + '\n');
      
    } catch (backupError) {
      console.error(`[BACKUP:${bookmaker_id}] ❌ Error crítico en backup:`, backupError.message);
    }
  }

  resetRoundData(bookmaker_id) {
    const currentRoundData = this.roundData.get(bookmaker_id);
    if (this.debugMode) {
      console.log(`[RESET:${bookmaker_id}] 🔄 Reseteando roundData (preservando ${currentRoundData?.onlinePlayers || 0} jugadores online)`);
    }
    this.roundData.set(bookmaker_id, {
      betsCount: 0,
      totalBetAmount: 0,
      onlinePlayers: currentRoundData ? currentRoundData.onlinePlayers : 0,
      roundId: null,
      maxMultiplier: 0,
      currentMultiplier: 0,
      totalCashout: 0,
      cashoutRecords: new Set(),
      gameState: 'Bet',
    });
  }

  // Activar/desactivar modo debug
  setDebugMode(enabled) {
    this.debugMode = enabled;
    console.log(`[WebSocketService] Modo debug ${enabled ? 'activado' : 'desactivado'}`);
  }

  // Obtener estadísticas de rondas guardadas
  getStats() {
    return {
      savedRoundsCount: this.savedRounds.size,
      activeConnections: this.connections.size,
      debugMode: this.debugMode
    };
  }

  /**
   * Función auxiliar para asegurar valores decimales seguros
   * @param {number} value - Valor a validar
   * @param {number} decimals - Número de decimales (default: 2)
   * @param {number} maxValue - Valor máximo permitido (default: 999999999999999999.99)
   * @returns {number} - Valor seguro para guardar en BD
   */
  safeDecimalValue(value, decimals = 2, maxValue = 999999999999999999.99) {
    if (!isFinite(value) || isNaN(value)) {
      console.warn(`[SafeDecimal] Valor no válido: ${value}, usando 0`);
      return 0;
    }
    
    // Limitar valor máximo
    if (value > maxValue) {
      console.warn(`[SafeDecimal] Valor ${value} excede máximo ${maxValue}, limitando`);
      value = maxValue;
    }
    
    // Redondear a número de decimales especificado
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  async resetConnections(io) {
    console.log('[WebSocketService] Reseteando todas las conexiones WebSocket');
    try {
      this.isResetting = true;

      // Cerrar todas las conexiones existentes
      for (const [bookmakerId, connection] of this.connections) {
        if (connection.ws && connection.ws.readyState !== WebSocket.CLOSED) {
          connection.ws.close(1000, 'Closing for reset');
          console.log(`Closed WebSocket for bookmaker ${bookmakerId}`);
        }
        clearInterval(this.pingIntervals.get(bookmakerId));
        this.pingIntervals.delete(bookmakerId);
      }
      this.connections.clear();
      this.roundData.clear();

      // Esperar un momento para asegurar que todas las conexiones estén cerradas
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Reiniciar conexiones
      await this.initializeConnections(io);
      console.log('[WebSocketService] Conexiones WebSocket reseteadas correctamente');
      this.isResetting = false;
      return { message: 'Conexiones WebSocket reseteadas correctamente' };
    } catch (error) {
      console.error(`Error al resetear conexiones WebSocket: ${error.message}`);
      this.isResetting = false;
      throw new Error(`Error al resetear conexiones WebSocket: ${error.message}`);
    }
  }

  getConnectionStatus() {
    return Array.from(this.connections.entries()).map(([bookmakerId, connection]) => ({
      bookmakerId,
      status: connection.status,
      lastPing: connection.lastPing,
    }));
  }
}

module.exports = new WebSocketService();