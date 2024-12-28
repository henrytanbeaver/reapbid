import { GameState } from "../../../src/types/game";
import { shouldProcessRound, allPlayersSubmittedBids, handleAutopilot, processGameRound } from "../autopilot";

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
        isTimedOut: false,
      },
      "player2": {
        name: "Player 2",
        currentBid: 60,
        hasSubmittedBid: true,
        lastBidTime: Date.now(),
        isTimedOut: false,
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
            isTimedOut: false,
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
    let mockGameRef: any;
    let updateMock: jest.Mock;

    beforeEach(() => {
      // Create mock function that logs when it's called
      updateMock = jest.fn().mockImplementation((updates) => {
        console.log("Mock update called with:", updates);
        return Promise.resolve();
      });

      // Attach mock to game ref
      mockGameRef = {
        key: "game1",
        update: updateMock,
      };
      console.log("Created mock game ref with update mock");
    });

    it("should process bids correctly without advancing round", async () => {
      const gameState = {
        ...mockGameState,
        currentRound: 1,
        players: {
          "player1": {
            name: "Player 1",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
          "player2": {
            name: "Player 2",
            currentBid: 60,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
            isTimedOut: false,
          },
          "player3": {
            name: "Player 3",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
        },
      };

      console.log("Calling processGameRound with mock game ref");
      await processGameRound(mockGameRef, gameState);
      console.log("processGameRound completed");

      // Log all update calls to see what's happening
      console.log("Number of update calls:", updateMock.mock.calls.length);
      updateMock.mock.calls.forEach((call, index) => {
        console.log(`Update call ${index + 1}:`, call[0]);
      });

      // Verify update was called and check the arguments
      expect(updateMock).toHaveBeenCalled();
      const firstUpdateArgs = updateMock.mock.calls[0][0]; // First update call arguments

      // Check that each player's bid was marked as submitted in first update
      expect(firstUpdateArgs["gameState/players/player1/hasSubmittedBid"]).toBe(false);
      expect(firstUpdateArgs["gameState/players/player2/hasSubmittedBid"]).toBe(true);
      expect(firstUpdateArgs["gameState/players/player3/hasSubmittedBid"]).toBe(false);

      // Check that bids were set correctly in first update
      expect(firstUpdateArgs["gameState/players/player1/currentBid"]).toBe(gameState.maxBid);
      expect(firstUpdateArgs["gameState/players/player2/currentBid"]).toBe(60);
      expect(firstUpdateArgs["gameState/players/player3/currentBid"]).toBe(gameState.maxBid);

      // Optional: Verify second update contains round advancement
      if (updateMock.mock.calls.length > 1) {
        const secondUpdateArgs = updateMock.mock.calls[1][0];
        console.log("Round advancement updates:", secondUpdateArgs);
      }
    });
  });

  describe("handleAutopilot", () => {
    let mockGameRef: any;
    let updateMock: jest.Mock;

    beforeEach(() => {
      updateMock = jest.fn().mockImplementation((updates) => {
        console.log("Mock update called with:", updates);
        return Promise.resolve();
      });
      mockGameRef = {
        key: "game1",
        update: updateMock,
      };
      console.log("Created mock game ref with update mock");
    });

    it("should end game when in final round", async () => {
      const finalRoundState = {
        ...mockGameState,
        currentRound: 3, // Final round
        totalRounds: 3,
      };

      console.log("Calling handleAutopilot with mock game ref");
      await handleAutopilot(mockGameRef, finalRoundState);
      console.log("handleAutopilot completed");

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
        currentRound: 1,
        totalRounds: 3,
        players: {
          "player1": {
            name: "Player 1",
            currentBid: 50,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
            isTimedOut: false,
          },
          "player2": {
            name: "Player 2",
            currentBid: 60,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
            isTimedOut: false,
          },
        },
      };

      console.log("Calling handleAutopilot with mock game ref");
      await handleAutopilot(mockGameRef, midGameState);
      console.log("handleAutopilot completed");

      // Verify round advancement
      expect(mockGameRef.update).toHaveBeenCalledWith(
        expect.objectContaining({
          "gameState/currentRound": 2,
        })
      );
      // Verify game not ended
      expect(mockGameRef.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          "gameState/isEnded": false,
        })
      );
    });

    it("should mark all players' bids as submitted when processing round", async () => {
      const gameState = {
        ...mockGameState,
        currentRound: 1,
        players: {
          "player1": {
            name: "Player 1",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
          "player2": {
            name: "Player 2",
            currentBid: 60,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
            isTimedOut: false,
          },
          "player3": {
            name: "Player 3",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
        },
      };

      console.log("Calling handleAutopilot with mock game ref");
      await handleAutopilot(mockGameRef, gameState);
      console.log("handleAutopilot completed");

      // Verify update was called and check the arguments
      expect(updateMock).toHaveBeenCalled();
      const firstUpdateArgs = updateMock.mock.calls[0][0]; // First update call arguments

      // Check that each player's bid was marked as submitted in first update
      expect(firstUpdateArgs["gameState/players/player1/hasSubmittedBid"]).toBe(false);
      expect(firstUpdateArgs["gameState/players/player2/hasSubmittedBid"]).toBe(true);
      expect(firstUpdateArgs["gameState/players/player3/hasSubmittedBid"]).toBe(false);

      // Check that bids were set correctly in first update
      expect(firstUpdateArgs["gameState/players/player1/currentBid"]).toBe(gameState.maxBid);
      expect(firstUpdateArgs["gameState/players/player2/currentBid"]).toBe(60);
      expect(firstUpdateArgs["gameState/players/player3/currentBid"]).toBe(gameState.maxBid);

      // Optional: Verify second update contains round advancement
      if (updateMock.mock.calls.length > 1) {
        const secondUpdateArgs = updateMock.mock.calls[1][0];
        console.log("Round advancement updates:", secondUpdateArgs);
      }
    });

    it("should handle timed out players correctly when processing round", async () => {
      const gameState = {
        ...mockGameState,
        currentRound: 1,
        players: {
          "player1": {
            name: "Player 1",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
          "player2": {
            name: "Player 2",
            currentBid: 60,
            hasSubmittedBid: true,
            lastBidTime: Date.now(),
            isTimedOut: true, // Timed out player
          },
          "player3": {
            name: "Player 3",
            currentBid: null,
            hasSubmittedBid: false,
            lastBidTime: null,
            isTimedOut: false,
          },
        },
      };

      console.log("Calling handleAutopilot with mock game ref");
      await handleAutopilot(mockGameRef, gameState);
      console.log("handleAutopilot completed");

      const firstUpdateArgs = updateMock.mock.calls[0][0]; // First update call arguments

      // Check that active players' bids were marked as submitted in first update
      expect(firstUpdateArgs["gameState/players/player1/hasSubmittedBid"]).toBe(false);
      expect(firstUpdateArgs["gameState/players/player3/hasSubmittedBid"]).toBe(false);

      // Check that timed out player's bid state wasn't changed
      expect(firstUpdateArgs["gameState/players/player2/hasSubmittedBid"]).toBe(true);
      expect(firstUpdateArgs["gameState/players/player2/currentBid"]).toBe(60);
    });
  });
});
