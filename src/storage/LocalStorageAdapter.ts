import { StorageAdapter } from './StorageAdapter';
import { GameState } from '../types/game';
import { SessionMetadata } from './SessionStorageAdapter';

const DEFAULT_ALPHA = 0.5;
const DEFAULT_MARKET_SIZE = 1000;

export class LocalStorageAdapter implements StorageAdapter {
  private readonly STORAGE_KEY = 'currentGame';
  private listeners: ((gameState: GameState) => void)[] = [];

  private readonly EMPTY_GAME_STATE: GameState = {
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
    autopilot: {
      enabled: false,
      lastUpdateTime: null
    },
    alpha: DEFAULT_ALPHA,
    marketSize: DEFAULT_MARKET_SIZE
  };

  private getInitialState(): GameState {
    return {
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
      autopilot: {
        enabled: false,
        lastUpdateTime: null
      },
      alpha: DEFAULT_ALPHA,
      marketSize: DEFAULT_MARKET_SIZE
    };
  }

  async getGameState(): Promise<GameState | null> {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Error getting game state from localStorage:', error);
      return null;
    }
  }

  async updateGameState(gameState: Partial<GameState>): Promise<void> {
    try {
      const currentState = await this.getGameState() || this.getInitialState();
      const newState = { ...currentState, ...gameState };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(newState));
      this.notifyListeners(newState as GameState);
    } catch (error) {
      console.error('Error updating game state in localStorage:', error);
      throw error;
    }
  }

  subscribeToGameState(callback: (gameState: GameState) => void): () => void {
    this.listeners.push(callback);
    
    // Initialize with current state if exists
    const currentState = localStorage.getItem(this.STORAGE_KEY);
    if (currentState) {
      callback(JSON.parse(currentState));
    } else {
      callback(this.getInitialState());
    }

    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  async addPlayer(playerName: string, playerData: any): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = { ...currentState.players };
    players[playerName] = playerData;
    await this.updateGameState({ players });
  }

  async removePlayer(playerName: string): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = { ...currentState.players };
    delete players[playerName];
    await this.updateGameState({ players });
  }

  async updatePlayer(playerName: string, playerData: any): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = currentState.players || {};
    players[playerName] = { ...players[playerName], ...playerData };
    await this.updateGameState({ players });
  }

  async updateRound(roundNumber: number, roundData: any): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const roundHistory = [...(currentState.roundHistory || [])];
    roundHistory[roundNumber] = roundData;
    await this.updateGameState({ roundHistory });
  }

  async timeoutPlayer(playerName: string): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = { ...currentState.players };
    if (players[playerName]) {
      players[playerName] = { ...players[playerName], isTimedOut: true };
      await this.updateGameState({ players });
    }
  }

  async unTimeoutPlayer(playerName: string): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = { ...currentState.players };
    if (players[playerName]) {
      players[playerName] = { ...players[playerName], isTimedOut: false };
      await this.updateGameState({ players });
    }
  }

  async submitBid(playerName: string, bid: number): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    const players = { ...currentState.players };
    const roundBids = { ...currentState.roundBids };
    
    if (players[playerName]) {
      players[playerName] = {
        ...players[playerName],
        currentBid: bid,
        hasSubmittedBid: true,
        lastBidTime: Date.now()
      };
      roundBids[playerName] = bid;
      await this.updateGameState({ players, roundBids });
    }
  }

  async resetGame(): Promise<void> {
    await this.updateGameState(this.getInitialState());
  }

  async extendRoundTime(additionalSeconds: number): Promise<void> {
    const currentState = await this.getGameState() || this.getInitialState();
    await this.updateGameState({
      roundTimeLimit: currentState.roundTimeLimit + additionalSeconds
    });
  }

  async updateRivalries(rivalries: Record<string, string[]>): Promise<void> {
    await this.updateGameState({ rivalries });
  }

  // Session management methods (stub implementations for local storage)
  async createSession(name: string): Promise<string> {
    // Stub implementation for local storage
    return 'local-session';
  }

  async listSessions(): Promise<any[]> {
    throw new Error('Session management not supported in local storage adapter');
  }

  async updateSessionStatus(sessionId: string, status: 'active' | 'completed' | 'archived'): Promise<void> {
    throw new Error('Session management not supported in local storage adapter');
  }

  async deleteSession(sessionId: string): Promise<void> {
    // In LocalStorageAdapter, we only maintain one game state
    // If the current game matches the sessionId, clear it
    const currentGame = localStorage.getItem(this.STORAGE_KEY);
    if (currentGame) {
      const gameData = JSON.parse(currentGame);
      if (gameData.sessionId === sessionId) {
        localStorage.removeItem(this.STORAGE_KEY);
        // Notify listeners with empty game state
        this.listeners.forEach(listener => listener(this.EMPTY_GAME_STATE));
      }
    }
  }

  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    // Local storage doesn't support multiple sessions
    return Promise.resolve(null);
  }

  setCurrentSession(sessionId: string): void {
    throw new Error('Session management not supported in local storage adapter');
  }

  private notifyListeners(gameState: GameState): void {
    this.listeners.forEach(listener => listener(gameState));
  }

  cleanup(): void {
    this.listeners = [];
  }
}
