import { GameState } from "../../../src/types/game";
import { shouldProcessRound, allPlayersSubmittedBids, processGameRound } from "../autopilot";

// Mock Firebase Admin
jest.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: jest.fn(),
  database: () => ({
    ref: jest.fn(),
  }),
}));

// Mock init.ts to prevent actual Firebase initialization
jest.mock("../init", () => ({
  db: {
    ref: jest.fn(),
  },
}));

// Mock monitoring
jest.mock("../monitoring", () => ({
  AutopilotMonitor: {
    logEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

describe("Autopilot Functions", () => {
  // Mock data
  const mockGameState: GameState = {
    hasGameStarted: true,
    isActive: true,
    isEnded: false,
    currentRound: 1,
    totalRounds: 3,
    roundTimeLimit: 60,
    roundStartTime: Date.now(),
    minBid: 0,
    maxBid: 100,
    costPerUnit: 50,
    maxPlayers: 4,
    players: {
      "player1": {
        name: "Player 1",
        currentBid: 50,
        hasSubmittedBid: true,
        lastBidTime: Date.now(),
      },
      "player2": {
        name: "Player 2",
        currentBid: 60,
        hasSubmittedBid: true,
        lastBidTime: Date.now(),
      },
    },
    roundBids: {},
    roundHistory: [],
    rivalries: {},
    totalProfit: 0,
    averageMarketShare: 0,
    bestRound: 0,
    bestRoundProfit: 0,
    autopilot: {
      enabled: true,
      lastUpdateTime: Date.now(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("shouldProcessRound", () => {
    it("should return true when all players submitted bids", () => {
      const currentTime = Date.now();
      const result = shouldProcessRound(mockGameState, currentTime);
      expect(result).toBe(true);
    });

    it("should return true when time limit is exceeded", () => {
      const gameState = {
        ...mockGameState,
        roundStartTime: Date.now() - (mockGameState.roundTimeLimit * 1000 + 1000), // Exceed time limit by 1 second
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            hasSubmittedBid: false,
          },
          "player2": {
            ...mockGameState.players["player2"],
            hasSubmittedBid: false,
          },
        },
      };
      const currentTime = Date.now();
      const result = shouldProcessRound(gameState, currentTime);
      expect(result).toBe(true);
    });

    it("should return false when not all players submitted and time limit not exceeded", () => {
      const gameState = {
        ...mockGameState,
        roundStartTime: Date.now(), // Just started
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            hasSubmittedBid: false,
          },
          "player2": {
            ...mockGameState.players["player2"],
            hasSubmittedBid: true,
          },
        },
      };
      const currentTime = Date.now();
      const result = shouldProcessRound(gameState, currentTime);
      expect(result).toBe(false);
    });

    it("should return false when less than 2 active players", () => {
      const gameState = {
        ...mockGameState,
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            isTimedOut: true,
          },
          "player2": {
            ...mockGameState.players["player2"],
          },
        },
      };
      const currentTime = Date.now();
      const result = shouldProcessRound(gameState, currentTime);
      expect(result).toBe(false);
    });
  });

  describe("allPlayersSubmittedBids", () => {
    it("should return true when all active players submitted bids", () => {
      const result = allPlayersSubmittedBids(mockGameState);
      expect(result).toBe(true);
    });

    it("should return false when not all active players submitted bids", () => {
      const gameState = {
        ...mockGameState,
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            hasSubmittedBid: false,
          },
          "player2": {
            ...mockGameState.players["player2"],
            hasSubmittedBid: true,
          },
        },
      };
      const result = allPlayersSubmittedBids(gameState);
      expect(result).toBe(false);
    });

    it("should ignore timed out players", () => {
      const gameState = {
        ...mockGameState,
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            hasSubmittedBid: true,
          },
          "player2": {
            ...mockGameState.players["player2"],
            hasSubmittedBid: false,
            isTimedOut: true,
          },
          "player3": {
            name: "Player 3",
            currentBid: 70,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
          },
        },
      };
      const result = allPlayersSubmittedBids(gameState);
      expect(result).toBe(true);
    });

    it("should return false when there are less than 2 active players", () => {
      const gameState = {
        ...mockGameState,
        players: {
          "player1": {
            ...mockGameState.players["player1"],
            hasSubmittedBid: true,
          },
        },
      };
      const result = allPlayersSubmittedBids(gameState);
      expect(result).toBe(false);
    });
  });

  describe("processGameRound", () => {
    const mockGameRef = {
      key: "game1",
      update: jest.fn().mockResolvedValue(undefined),
      child: jest.fn().mockReturnThis(),
      once: jest.fn().mockResolvedValue({
        val: () => ({ /* mock game state */ }),
      }),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should end game when in final round", async () => {
      const finalRoundState = {
        ...mockGameState,
        currentRound: 3, // Final round
        totalRounds: 3,
      };

      await processGameRound(mockGameRef as any, finalRoundState);

      // Verify game ending updates
      expect(mockGameRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          "gameState/isActive": false,
          "gameState/isEnded": true,
          "status": "completed",
        })
      );
    });

    it("should advance to next round when not in final round", async () => {
      const midGameState = {
        ...mockGameState,
        currentRound: 2,
        totalRounds: 3,
      };

      await processGameRound(mockGameRef as any, midGameState);

      // Verify round advancement
      expect(mockGameRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          "gameState/currentRound": 3,
        })
      );
      // Verify game not ended
      expect(mockGameRef.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          "gameState/isEnded": true,
        })
      );
    });
  });
});
