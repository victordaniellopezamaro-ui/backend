const express = require('express');
   const router = express.Router();
const db = require('../../config/database');
const webSocketService = require('../../services/Aviator/webSocketService');
const BookmakerHistoryModel = require('../../models/Aviator/bookmakerHistoryModel');
const SignalModel = require('../../models/Aviator/signalModel');
const patternDetectionService = require('../../services/Aviator/patternDetectionService');

// Función auxiliar para formatear duración
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

  router.get('/bookmakers', async (req, res) => {
    try {
      const result = await db.query(`
        SELECT b.*
        FROM bookmakers b
        ORDER BY b.created_at DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching bookmakers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

   router.get('/bookmakers/:id', async (req, res) => {
     const { id } = req.params;
     try {
       const result = await db.query('SELECT * FROM bookmakers WHERE id = $1', [id]);
       if (result.rows.length === 0) {
         return res.status(404).json({ error: 'Bookmaker not found' });
       }
       res.json(result.rows[0]);
     } catch (error) {
       console.error('Error fetching bookmaker:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });

   router.post('/bookmakers', async (req, res) => {
     const { name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type } = req.body;
     
     console.log('Creando nuevo bookmaker:', { name, description, url_image: url_image ? 'PROVIDED' : 'NULL', recomendado, active, decoder_type: decoder_type || 'auto' });
     
     try {
       const result = await db.query(
         'INSERT INTO bookmakers (name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
         [name, description, url_image, recomendado || false, active !== false, url_websocket, first_message, second_message, third_message, decoder_type || 'auto']
       );
       
       const newBookmaker = result.rows[0];
       
       // Registrar en historial
       try {
         await BookmakerHistoryModel.createHistoryEntry(
           newBookmaker.id, 
           'created', 
           'name', 
           null, 
           name
         );
       } catch (historyError) {
         console.error('Error creating history entry:', historyError);
         // No fallar la creación si hay error en historial
       }
       
       res.status(201).json(newBookmaker);
     } catch (error) {
       console.error('Error creating bookmaker:', error);
       console.error('Error details:', {
         message: error.message,
         code: error.code,
         detail: error.detail,
         constraint: error.constraint
       });
       res.status(500).json({ 
         error: 'Internal server error',
         details: error.message,
         code: error.code
       });
     }
   });

   router.put('/bookmakers/:id', async (req, res) => {
     const { id } = req.params;
     const { name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type } = req.body;
     
     console.log('Actualizando bookmaker:', id);
     console.log('Datos recibidos:', { name, description, url_image: url_image ? `${url_image.substring(0, 50)}...` : 'null', recomendado, active, decoder_type: decoder_type || 'auto' });
     
     try {
       // Obtener datos anteriores para comparar
       const oldResult = await db.query('SELECT * FROM bookmakers WHERE id = $1', [id]);
       if (oldResult.rows.length === 0) {
         return res.status(404).json({ error: 'Bookmaker not found' });
       }
       const oldData = oldResult.rows[0];

       const result = await db.query(
         'UPDATE bookmakers SET name = $1, description = $2, url_image = $3, recomendado = $4, active = $5, url_websocket = $6, first_message = $7, second_message = $8, third_message = $9, decoder_type = $10, updated_at = CURRENT_TIMESTAMP WHERE id = $11 RETURNING *',
         [name, description, url_image, recomendado, active, url_websocket, first_message, second_message, third_message, decoder_type || 'auto', id]
       );
       
       const newData = result.rows[0];

       // Registrar cambios en historial
       try {
         const fieldsToCheck = ['name', 'description', 'url_image', 'recomendado', 'active', 'url_websocket', 'first_message', 'second_message', 'third_message', 'decoder_type'];
         
         for (const field of fieldsToCheck) {
           if (oldData[field] !== newData[field]) {
             await BookmakerHistoryModel.createHistoryEntry(
               id, 
               'updated', 
               field, 
               oldData[field], 
               newData[field]
             );
           }
         }
       } catch (historyError) {
         console.error('Error creating history entry:', historyError);
         // No fallar la actualización si hay error en historial
       }

       // Reiniciar conexiones WebSocket después de actualizar bookmaker
       try {
         const io = req.app.get('io');
         if (io) {
           await webSocketService.resetConnections(io);
           console.log(`[Bookmaker Update] Conexiones WebSocket reiniciadas después de actualizar bookmaker ${id}`);
         }
       } catch (wsError) {
         console.error('Error reiniciando conexiones WebSocket:', wsError);
         // No fallar la actualización si hay error en WebSocket
       }

       res.json(newData);
     } catch (error) {
       console.error('Error updating bookmaker:', error);
       console.error('Error details:', {
         message: error.message,
         stack: error.stack,
         code: error.code,
         detail: error.detail
       });
       res.status(500).json({ 
         error: 'Internal server error',
         details: error.message,
         code: error.code
       });
     }
   });

   router.delete('/bookmakers/:id', async (req, res) => {
     const { id } = req.params;
     try {
       // Obtener datos antes de eliminar para historial
       const oldResult = await db.query('SELECT * FROM bookmakers WHERE id = $1', [id]);
       if (oldResult.rows.length === 0) {
         return res.status(404).json({ error: 'Bookmaker not found' });
       }
       const oldData = oldResult.rows[0];

       const result = await db.query('DELETE FROM bookmakers WHERE id = $1 RETURNING *', [id]);
       
       // Registrar eliminación en historial
       try {
         await BookmakerHistoryModel.createHistoryEntry(
           id, 
           'deleted', 
           'bookmaker', 
           oldData.name, 
           null
         );
       } catch (historyError) {
         console.error('Error creating history entry:', historyError);
         // No fallar la eliminación si hay error en historial
       }
       
       res.json({ message: 'Bookmaker deleted successfully' });
     } catch (error) {
       console.error('Error deleting bookmaker:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });

  router.get('/status', async (req, res) => {
    try {
      const connectionStatus = webSocketService.getConnectionStatus();
      const bookmakers = await db.query('SELECT id, name FROM bookmakers WHERE active = true');
      
      const statusWithNames = connectionStatus.map(conn => {
        const bookmaker = bookmakers.rows.find(b => b.id === conn.bookmakerId);
        return {
          ...conn,
          bookmakerName: bookmaker ? bookmaker.name : 'Unknown'
        };
      });

      const totalBookmakers = bookmakers.rows.length;
      const connectedBookmakers = connectionStatus.filter(conn => conn.status === 'CONNECTED').length;
      const disconnectedBookmakers = totalBookmakers - connectedBookmakers;

      res.json({
        totalBookmakers,
        connectedBookmakers,
        disconnectedBookmakers,
        connections: statusWithNames
      });
    } catch (error) {
      console.error('Error fetching WebSocket status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Health check detallado de todos los bookmakers
  router.get('/health', async (req, res) => {
    try {
      const healthData = webSocketService.getAllBookmakersHealth();
      const bookmakers = await db.query('SELECT id, nombre, active, decoder_type FROM bookmakers WHERE active = true');
      
      const healthWithDetails = healthData.map(health => {
        const bookmaker = bookmakers.rows.find(b => b.id === health.bookmakerId);
        return {
          bookmakerId: health.bookmakerId,
          bookmakerName: bookmaker ? bookmaker.nombre : 'Unknown',
          decoderType: bookmaker ? bookmaker.decoder_type : 'unknown',
          status: health.status,
          isConnected: health.isConnected,
          lastActivity: health.lastActivity ? new Date(health.lastActivity).toISOString() : null,
          timeSinceActivity: health.timeSinceActivity,
          timeSinceActivityFormatted: health.timeSinceActivity ? formatDuration(health.timeSinceActivity) : 'N/A',
          consecutiveFailures: health.consecutiveFailures,
          lastCheck: health.lastCheck ? new Date(health.lastCheck).toISOString() : null,
          lastError: health.lastError
        };
      });

      // Estadísticas generales
      const stats = {
        total: healthWithDetails.length,
        healthy: healthWithDetails.filter(h => h.status === 'healthy').length,
        warning: healthWithDetails.filter(h => h.status === 'warning').length,
        down: healthWithDetails.filter(h => h.status === 'down').length,
        disconnected: healthWithDetails.filter(h => h.status === 'disconnected').length,
        unknown: healthWithDetails.filter(h => h.status === 'unknown').length
      };

      res.json({
        timestamp: new Date().toISOString(),
        stats,
        bookmakers: healthWithDetails
      });
    } catch (error) {
      console.error('Error fetching health status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

   // Endpoint para reiniciar conexiones WebSocket manualmente
   router.post('/reset-connections', async (req, res) => {
     try {
       const io = req.app.get('io');
       if (!io) {
         return res.status(500).json({ error: 'Socket.IO not available' });
       }

       const result = await webSocketService.resetConnections(io);
       res.json({ 
         success: true, 
         message: 'Conexiones WebSocket reiniciadas correctamente',
         result 
       });
     } catch (error) {
       console.error('Error resetting WebSocket connections:', error);
       res.status(500).json({ error: 'Error reiniciando conexiones WebSocket' });
     }
   });

   router.get('/rounds/:bookmakerId', async (req, res) => {
     const { bookmakerId } = req.params;
     const limit = parseInt(req.query.limit) || 1000;
     try {
       const result = await db.query(
         'SELECT id, bookmaker_id, round_id, bets_count, total_bet_amount, online_players, max_multiplier, total_cashout, casino_profit, loss_percentage, timestamp, created_at FROM game_rounds WHERE bookmaker_id = $1 ORDER BY timestamp DESC LIMIT $2',
         [bookmakerId, limit]
       );
       console.log(`Rondas devueltas para bookmakerId ${bookmakerId}: ${result.rows.length}`);
       res.json(result.rows);
     } catch (error) {
       console.error('Error fetching rounds:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });

   router.post('/rounds', async (req, res) => {
     const { bookmaker_id, round_id, bets_count, total_bet_amount, online_players, max_multiplier, total_cashout, casino_profit, loss_percentage } = req.body;
     try {
       const result = await db.query(
         'INSERT INTO game_rounds (bookmaker_id, round_id, bets_count, total_bet_amount, online_players, max_multiplier, total_cashout, casino_profit, loss_percentage, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *',
         [bookmaker_id, round_id, bets_count || 0, total_bet_amount || 0, online_players || 0, max_multiplier || 0, total_cashout || 0, casino_profit || 0, loss_percentage || 0]
       );
       const newRound = result.rows[0];
       console.log('Nueva ronda guardada:', newRound);

       const roundsResult = await db.query(
         'SELECT * FROM game_rounds WHERE bookmaker_id = $1 ORDER BY timestamp DESC LIMIT 1000',
         [bookmaker_id]
       );
       const rounds = roundsResult.rows;

      res.status(201).json(newRound);
     } catch (error) {
       console.error('Error saving round:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });

   // Obtener historial de un bookmaker específico
   router.get('/bookmakers/:id/history', async (req, res) => {
     const { id } = req.params;
     try {
       const history = await BookmakerHistoryModel.getBookmakerHistory(id);
       res.json(history);
     } catch (error) {
       console.error('Error fetching bookmaker history:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });

   // Obtener historial general
   router.get('/history', async (req, res) => {
     try {
       const history = await BookmakerHistoryModel.getAllHistory();
       res.json(history);
     } catch (error) {
       console.error('Error fetching history:', error);
       res.status(500).json({ error: 'Internal server error' });
     }
   });



// Obtener último resultado de un bookmaker específico (compatible con la ruta existente)
router.get('/rounds/:bookmakerId', async (req, res) => {
  const { bookmakerId } = req.params;
  const limit = parseInt(req.query.limit) || 1;
  
  try {
    const result = await db.query(
      'SELECT id, bookmaker_id, round_id, bets_count, total_bet_amount, online_players, max_multiplier, total_cashout, casino_profit, loss_percentage, timestamp, created_at FROM game_rounds WHERE bookmaker_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [bookmakerId, limit]
    );
    
    res.json({
      success: true,
      data: result.rows,
      bookmakerId: parseInt(bookmakerId),
      limit: limit
    });
  } catch (error) {
    console.error('Error fetching rounds for bookmaker:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});


// Obtener hora actual del servidor
router.get('/server-time', async (req, res) => {
  try {
    const serverTime = new Date();
    res.json({
      success: true,
      server_time: serverTime.toISOString(),
      timestamp: serverTime.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utc_offset: serverTime.getTimezoneOffset(),
      server_date: serverTime.toLocaleDateString('es-ES'),
      server_time_formatted: serverTime.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    });
  } catch (error) {
    console.error('Error getting server time:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// ============================================
// RUTAS DE SEÑALES Y PREDICCIONES
// ============================================

// Obtener todas las señales de un bookmaker
router.get('/signals/:bookmakerId', async (req, res) => {
  try {
    const { bookmakerId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    const signals = await SignalModel.getSignalsWithResults(parseInt(bookmakerId), limit);
    
    res.json({
      success: true,
      bookmakerId: parseInt(bookmakerId),
      signals: signals
    });
  } catch (error) {
    console.error('Error fetching signals:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Obtener todas las señales (todos los bookmakers)
router.get('/signals', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    const signals = await SignalModel.getSignalsWithResults(null, limit);
    
    res.json({
      success: true,
      signals: signals
    });
  } catch (error) {
    console.error('Error fetching all signals:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Obtener estadísticas de señales
router.get('/signals/stats/:bookmakerId?', async (req, res) => {
  try {
    const { bookmakerId } = req.params;
    const bookmakerIdInt = bookmakerId ? parseInt(bookmakerId) : null;
    
    const stats = await SignalModel.getSignalStats(bookmakerIdInt);
    
    // Calcular porcentaje de éxito
    const totalCompleted = (parseInt(stats.won_signals) || 0) + (parseInt(stats.lost_signals) || 0);
    const winRate = totalCompleted > 0 
      ? ((parseInt(stats.won_signals) || 0) / totalCompleted * 100).toFixed(2)
      : 0;
    
    res.json({
      success: true,
      bookmakerId: bookmakerIdInt,
      stats: {
        ...stats,
        win_rate: parseFloat(winRate),
        total_completed: totalCompleted
      }
    });
  } catch (error) {
    console.error('Error fetching signal stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Obtener señales pendientes
router.get('/signals/pending', async (req, res) => {
  try {
    const pendingSignals = patternDetectionService.getPendingSignals();
    
    res.json({
      success: true,
      pendingSignals: pendingSignals
    });
  } catch (error) {
    console.error('Error fetching pending signals:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

module.exports = router;