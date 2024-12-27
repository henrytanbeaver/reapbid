import React, { createContext, useContext, useState, useEffect } from "react";
import { StorageFactory, StorageType } from "../storage/StorageFactory";
import { useSession } from "./SessionContext";
import { GameState, Player, RoundResult, VisibilitySettings } from "../types/game";
import { 
  calculateMarketShare, 
  calculateProfit, 
  calculateAllMarketShares, 
  DEFAULT_MARKET_SIZE 
} from "../utils/gameCalculations";

// Re-export types for backward compatibility
export type { GameState, Player, RoundResult, VisibilitySettings };

export interface GameConfig {
  totalRounds: number;
  roundTimeLimit: number;
  minBid: number;
  maxBid: number;
  costPerUnit: number;
  maxPlayers: number;
  alpha?: number; // Price sensitivity parameter for logit model
  marketSize?: number; // Total market size Q
  visibilitySettings?: VisibilitySettings; // Optional settings for what information to show players
}

interface GameContextType {
  gameState: GameState;
  startGame: (config: GameConfig) => void;
  startRound: () => void;
  endCurrentRound: () => void;
  endGame: () => void;
  submitBid: (playerName: string, bid: number) => void;
  unregisterPlayer: (playerName: string) => void;
  timeoutPlayer: (playerName: string) => void;
  unTimeoutPlayer: (playerName: string) => void;
  registerPlayer: (playerName: string) => void;
  resetGame: () => void;
  extendRoundTime: (additionalSeconds: number) => void;
  updateRivalries: (rivalries: Record<string, string[]>) => void;
  autoAssignRivals: () => void;
}

const initialGameState: GameState = {
  hasGameStarted: false,
  isActive: false,
  isEnded: false,
  currentRound: 1,
  totalRounds: 3,
  roundTimeLimit: 60,
  roundStartTime: null,
  minBid: 0,
  maxBid: 100,
  costPerUnit: 50,
  maxPlayers: 4,
  players: {},
  roundBids: {},
  roundHistory: [],
  rivalries: {},
  totalProfit: 0,
  averageMarketShare: 0,
  bestRound: 0,
  bestRoundProfit: 0,
  visibilitySettings: {
    showRounds: true,
    showCostPerUnit: true,
    showPriceRange: true
  }
};

const defaultContextValue: GameContextType = {
  gameState: initialGameState,
  startGame: () => {},
  startRound: () => {},
  endCurrentRound: () => {},
  endGame: () => {},
  submitBid: () => {},
  unregisterPlayer: () => {},
  timeoutPlayer: () => {},
  unTimeoutPlayer: () => {},
  registerPlayer: () => {},
  resetGame: () => {},
  extendRoundTime: () => {},
  updateRivalries: () => {},
  autoAssignRivals: () => {}
};

const GameContext = createContext<GameContextType>(defaultContextValue);

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [isUpdating, setIsUpdating] = useState(false);
  const { currentSessionId } = useSession();
  const storage = StorageFactory.getInstance(currentSessionId ? StorageType.Session : StorageType.Firebase);

  useEffect(() => {
    let mounted = true;

    if (!currentSessionId) {
      storage.setCurrentSession('current');
    } else {
      storage.setCurrentSession(currentSessionId);
    }

    // Initialize game state from storage
    const initializeGameState = async () => {
      if (!mounted) return;
      
      try {
        setIsUpdating(true);
        const storedState = await storage.getGameState();
        
        if (!mounted) return;

        if (storedState) {
          // Ensure we preserve all fields and their proper types
          const normalizedState = {
            ...initialGameState,  // Start with default values
            ...storedState,       // Override with stored values
            // Ensure critical fields are properly typed
            hasGameStarted: Boolean(storedState.hasGameStarted),
            isActive: Boolean(storedState.isActive),
            isEnded: Boolean(storedState.isEnded),
            players: storedState.players || {},
            roundBids: storedState.roundBids || {},
            roundHistory: storedState.roundHistory || [],
            rivalries: storedState.rivalries || {},
            visibilitySettings: storedState.visibilitySettings || {
              showRounds: true,
              showCostPerUnit: true,
              showPriceRange: true
            }
          };
          setGameState(normalizedState);
        } else {
          setGameState(initialGameState);
        }
      } catch (error) {
        // Handle error silently
      } finally {
        if (mounted) {
          setIsUpdating(false);
        }
      }
    };

    initializeGameState();

    // Subscribe to game state changes
    const unsubscribe = storage.subscribeToGameState((newState: GameState) => {
      if (!mounted) return;

      const normalizedState = {
        ...initialGameState,
        ...newState,
        hasGameStarted: Boolean(newState.hasGameStarted),
        isActive: Boolean(newState.isActive),
        isEnded: Boolean(newState.isEnded),
        players: newState.players || {},
        roundBids: newState.roundBids || {},
        roundHistory: newState.roundHistory || [],
        rivalries: newState.rivalries || {},
        visibilitySettings: newState.visibilitySettings || {
          showRounds: true,
          showCostPerUnit: true,
          showPriceRange: true
        }
      };
      setGameState(normalizedState);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [currentSessionId, storage]);

  const startGame = async (config: GameConfig) => {
    const newState: GameState = {
      hasGameStarted: true,
      isActive: true,
      isEnded: false,
      currentRound: 1,
      totalRounds: config.totalRounds,
      roundTimeLimit: config.roundTimeLimit,
      roundStartTime: null,
      minBid: config.minBid,
      maxBid: config.maxBid,
      costPerUnit: config.costPerUnit,
      maxPlayers: config.maxPlayers,
      players: {},
      roundBids: {},
      roundHistory: [],
      rivalries: {},
      totalProfit: 0,
      averageMarketShare: 0,
      bestRound: 0,
      bestRoundProfit: 0,
      // Only include visibilitySettings if they exist in config
      ...(config.visibilitySettings && {
        visibilitySettings: {
          showRounds: config.visibilitySettings.showRounds,
          showCostPerUnit: config.visibilitySettings.showCostPerUnit,
          showPriceRange: config.visibilitySettings.showPriceRange
        }
      })
    };

    try {
      await storage.updateGameState(newState);
    } catch (error) {
      console.error('Error starting game:', error);
      throw error;
    }
  };

  const startRound = async () => {
    if (!gameState) return;

    try {
      // Reset all player states for the new round
      const updatedPlayers = Object.fromEntries(
        Object.entries(gameState.players ?? {}).map(([name, player]) => [
          name,
          { ...player, hasSubmittedBid: false, currentBid: null, isTimedOut: false }
        ])
      );

      // Auto-assign all players as rivals to each other
      const allPlayers = Object.keys(gameState.players ?? {});
      const newRivalries: Record<string, string[]> = {};
      
      // For each player, assign all other players as rivals
      allPlayers.forEach(player => {
        newRivalries[player] = allPlayers.filter(p => p !== player);
      });

      // Update game state for the new round
      const updatedState = {
        ...gameState,
        hasGameStarted: true,
        isActive: true,
        isEnded: false,
        roundStartTime: Date.now(),
        roundBids: {},
        players: updatedPlayers,
        rivalries: newRivalries,  // Set new rivalries every round
        totalProfit: gameState.totalProfit || 0,
        averageMarketShare: gameState.averageMarketShare || 0,
        bestRound: gameState.bestRound || 0,
        bestRoundProfit: gameState.bestRoundProfit || 0,
        roundHistory: gameState.roundHistory || []
      };

      await storage.updateGameState(updatedState);
    } catch (error) {
      console.error('Error starting round:', error);
      throw error;
    }
  };

  const endCurrentRound = async () => {
    if (!gameState) return;

    // Get all players and their rivals with safe accessors
    const allPlayers = Object.keys(gameState.players || {});
    const marketShares: Record<string, number> = {};
    const profits: Record<string, number> = {};
    const roundBids: Record<string, number> = {};

    // Initialize all players with maxBid for non-submitted bids
    allPlayers.forEach(player => {
      roundBids[player] = gameState.roundBids?.[player] ?? gameState.maxBid;
      marketShares[player] = 0;
      profits[player] = 0;
    });

    // Calculate market shares for all players at once
    const calculatedMarketShares = calculateAllMarketShares(roundBids, gameState.alpha);
    Object.assign(marketShares, calculatedMarketShares);

    // Calculate profits
    allPlayers.forEach(player => {
      profits[player] = calculateProfit(
        roundBids[player],
        marketShares[player],
        gameState.costPerUnit,
        gameState.marketSize
      );
    });

    // Calculate total profit (sum of all profits from all rounds for current player)
    const newTotalProfit = (gameState.totalProfit || 0) + profits[Object.keys(gameState.players)[0]] || 0;
    
    // Calculate average market share (average of all market shares from all rounds for current player)
    const currentPlayerHistory = [...(gameState.roundHistory || []), {
      round: gameState.currentRound,
      bids: roundBids,
      marketShares,
      profits,
      timestamp: Date.now()
    }];
    const totalMarketShare = currentPlayerHistory.reduce((sum, round) => {
      const playerName = Object.keys(gameState.players)[0];
      return sum + (round.marketShares[playerName] || 0);
    }, 0);
    const newAverageMarketShare = totalMarketShare / currentPlayerHistory.length;

    // Check if this is the best round
    const currentPlayerProfit = profits[Object.keys(gameState.players)[0]] || 0;
    const isBestRound = currentPlayerProfit > (gameState.bestRoundProfit || 0);

    // Update game state
    const newState = {
      ...gameState,
      roundStartTime: null,
      currentRound: gameState.currentRound + 1,
      roundHistory: [...(gameState.roundHistory || []), {
        round: gameState.currentRound,
        bids: roundBids,
        marketShares,
        profits,
        timestamp: Date.now()
      }],
      totalProfit: newTotalProfit,
      averageMarketShare: newAverageMarketShare,
      bestRound: isBestRound ? gameState.currentRound : (gameState.bestRound || 0),
      bestRoundProfit: isBestRound ? currentPlayerProfit : (gameState.bestRoundProfit || 0)
    };

    await storage.updateGameState(newState);
  };

  const endGame = async () => {
    setIsUpdating(true);
    try {
      const newState = {
        ...gameState,
        isActive: false,
        isEnded: true
      };
      await storage.updateGameState(newState);
      
      // Automatically update session status to completed when game ends
      if (currentSessionId) {
        try {
          await storage.updateSessionStatus(currentSessionId, 'completed');
        } catch (error) {
          throw error;
        }
      }
    } catch (error) {
      throw error;
    } finally {
      setIsUpdating(false);
    }
  };

  const registerPlayer = async (playerName: string) => {
    if (!gameState) {
      throw new Error('Game state not initialized');
    }

    // Check if player already exists
    if (gameState.players?.[playerName]) {
      return;
    }

    // Create new player data
    const playerData: Player = {
      name: playerName,
      currentBid: null,
      hasSubmittedBid: false,
      lastBidTime: null,
    };

    try {
      await storage.addPlayer(playerName, playerData);
    } catch (error) {
      throw error;
    }
  };

  const unregisterPlayer = async (playerName: string) => {
    await storage.removePlayer(playerName);
  };

  const timeoutPlayer = async (playerName: string) => {
    await storage.timeoutPlayer(playerName);
  };

  const unTimeoutPlayer = async (playerName: string) => {
    await storage.unTimeoutPlayer(playerName);
  };

  const submitBid = async (playerName: string, bid: number) => {
    await storage.submitBid(playerName, bid);
  };

  const resetGame = async () => {
    await storage.resetGame();
  };

  const extendRoundTime = async (additionalSeconds: number) => {
    await storage.extendRoundTime(additionalSeconds);
  };

  const updateRivalries = async (rivalries: Record<string, string[]>) => {
    await storage.updateRivalries(rivalries);
  };

  const autoAssignRivals = async () => {
    if (!gameState) {
      return;
    }

    try {
      const allPlayers = Object.keys(gameState.players || {});
      if (allPlayers.length < 2) {
        return;
      }

      // Assign all players as rivals to each other
      const newRivalries: Record<string, string[]> = {};
      allPlayers.forEach(player => {
        newRivalries[player] = allPlayers.filter(p => p !== player);
      });
      
      await storage.updateGameState({
        ...gameState,
        rivalries: newRivalries
      });
    } catch (error) {
      console.error('Error auto-assigning rivals:', error);
      throw error;
    }
  };

  return (
    <GameContext.Provider value={{
      gameState,
      startGame,
      startRound,
      endCurrentRound,
      endGame,
      submitBid,
      unregisterPlayer,
      timeoutPlayer,
      unTimeoutPlayer,
      registerPlayer,
      resetGame,
      extendRoundTime,
      updateRivalries,
      autoAssignRivals
    }}>
      {children}
    </GameContext.Provider>
  );
};

export default GameProvider;
