import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { AutopilotState } from "../../src/types/autopilot";
import { GameState, DatabaseGame } from "../../src/types/game";
import { AutopilotMonitor } from "./monitoring";
import { db } from "./init";
import {
  calculateAllMarketShares,
  calculateAllProfits,
} from "../../src/utils/gameCalculations";

/**
 * Process a single game round, calculating market shares and profits
 * @param {admin.database.Reference} gameRef Reference to the game in Firebase
 * @param {GameState} gameState Current state of the game
 */
async function processGameRound(
  gameRef: admin.database.Reference,
  gameState: GameState,
): Promise<void> {
  console.log("[ProcessRound] Starting round processing");

  if (!gameState || !gameState.players || !gameState.maxBid) {
    console.error("[ProcessRound] Invalid game state:", gameState);
    throw new Error("Invalid game state: required fields missing");
  }

  console.log("[ProcessRound] Initial game state:", {
    currentRound: gameState.currentRound,
    totalRounds: gameState.totalRounds,
    players: Object.keys(gameState.players),
    roundBids: gameState.roundBids,
  });

  const gameId = gameRef.key as string;

  try {
    const costPerUnit = gameState.costPerUnit;
    const maxBid = gameState.maxBid;

    // Initialize all players with maxBid, then override with actual bids if submitted
    const updatedBids: Record<string, number> = {};
    Object.keys(gameState.players).forEach((playerId) => {
      const player = gameState.players[playerId];
      // Use actual bid if submitted, otherwise use maxBid
      updatedBids[playerId] = (player.hasSubmittedBid &&
        player.currentBid &&
        player.currentBid !== null &&
        player.currentBid !== undefined) ?
        player.currentBid :
        maxBid;
    });

    console.log("[ProcessRound] Final bids:", updatedBids);

    // Calculate market shares and profits using shared utility functions
    const marketShares = calculateAllMarketShares(updatedBids);
    const profits = calculateAllProfits(updatedBids, marketShares, costPerUnit);

    console.log("[ProcessRound] Calculation results:", { marketShares, profits });

    // Prepare round result
    const roundResult = {
      round: gameState.currentRound,
      bids: updatedBids,
      marketShares,
      profits,
      timestamp: Date.now(),
    };

    console.log("[ProcessRound] Updating round history");

    // Create updates object
    const updates: { [key: string]: any } = {};

    // Add round to history under gameState
    updates["gameState/roundHistory/" + (gameState.currentRound - 1)] = roundResult;
    console.log("[ProcessRound] Adding round to history under gameState at index:", gameState.currentRound - 1);

    // Reset round state
    updates["gameState/roundBids"] = null;
    updates["gameState/roundStartTime"] = null;

    // Update player states under gameState
    Object.keys(gameState.players).forEach((playerId) => {

      // Reset bid state
      updates[`gameState/players/${playerId}/hasSubmittedBid`] = false;
      updates[`gameState/players/${playerId}/currentBid`] = null;
    });

    console.log("[ProcessRound] Game progress check:", {
      currentRound: gameState.currentRound,
      totalRounds: gameState.totalRounds,
      isLastRound: gameState.currentRound >= gameState.totalRounds,
    });

    // Check if this was the last round
    if (gameState.currentRound >= gameState.totalRounds) {
      console.log("[ProcessRound] Processing last round");

      // Calculate total profits and best round
      const allRounds = [...(gameState.roundHistory || []), roundResult];

      const allProfits = allRounds.reduce((acc, round) => {
        Object.entries(round.profits).forEach(([playerId, profit]) => {
          acc[playerId] = (acc[playerId] || 0) + profit;
        });
        return acc;
      }, {} as Record<string, number>);

      const bestRound = allRounds.reduce(
        (best, round) => {
          const maxProfit = Math.max(...Object.values(round.profits));
          return maxProfit > best.profit ? { round: round.round, profit: maxProfit } : best;
        },
        { round: 0, profit: -Infinity }
      );

      const averageMarketShare = allRounds
        .flatMap((round) => Object.values(round.marketShares))
        .reduce((sum, share) => sum + share, 0) / (gameState.totalRounds * Object.keys(gameState.players).length);

      // Update final game state
      updates["gameState/isActive"] = false;
      updates["gameState/isEnded"] = true;
      updates["gameState/totalProfit"] = Object.values(allProfits).reduce((sum, profit) => sum + profit, 0);
      updates["gameState/bestRound"] = bestRound.round;
      updates["gameState/bestRoundProfit"] = bestRound.profit;
      updates["gameState/averageMarketShare"] = averageMarketShare;
      updates["status"] = "completed";
      updates["updatedAt"] = Date.now();

      console.log("[ProcessRound] Final game updates:", {
        totalProfit: updates["gameState/totalProfit"],
        bestRound: updates["gameState/bestRound"],
        bestRoundProfit: updates["gameState/bestRoundProfit"],
        averageMarketShare,
      });
    } else {
      console.log("[ProcessRound] Advancing to next round:", gameState.currentRound + 1);
      updates["gameState/currentRound"] = gameState.currentRound + 1;
    }

    // Perform all updates atomically
    console.log("[ProcessRound] Applying updates to database");
    await gameRef.update(updates);
    console.log("[ProcessRound] Successfully completed round processing");

    // Log successful round processing
    await AutopilotMonitor.logEvent({
      gameId,
      action: "process_round",
      status: "success",
      details: {
        round: gameState.currentRound,
        playerCount: Object.keys(gameState.players).length,
        processedBids: Object.keys(updatedBids).length,
        timeoutBids: Object.keys(gameState.players).length - Object.keys(updatedBids).length,
      },
    });
  } catch (error) {
    console.error("[ProcessRound] Error during round processing:", error);
    // Log error in round processing
    await AutopilotMonitor.logEvent({
      gameId,
      action: "process_round",
      status: "failure",
      details: {
        round: gameState.currentRound,
        error: error instanceof Error ? error.message : "Unknown error",
        playerCount: Object.keys(gameState.players).length,
        processedBids: Object.keys(gameState.players).length,
      },
    });
    throw error;
  }
}

/**
 * Start a new round for the game
 * @param {admin.database.Reference} gameRef Reference to the game in Firebase
 * @param {GameState} gameState Current state of the game
 */
async function startNewRound(
  gameRef: admin.database.Reference,
  gameState: GameState,
): Promise<void> {
  console.log("[StartRound] Starting new round");

  // Check for minimum player count
  const activePlayers = Object.values(gameState.players).filter(
    (player) => !player.isTimedOut
  );

  if (activePlayers.length < 2) {
    console.log("[StartRound] Not enough active players to start round");
    return;
  }

  const updates: { [key: string]: any } = {
    "gameState/roundStartTime": Date.now(),
    "gameState/isActive": true,
  };

  // Reset player bid states for the new round
  Object.keys(gameState.players).forEach((playerId) => {
    updates[`gameState/players/${playerId}/hasSubmittedBid`] = false;
    updates[`gameState/players/${playerId}/currentBid`] = null;
  });

  // Auto-assign all players as rivals to each other if rivalries not set
  if (!gameState.rivalries || Object.keys(gameState.rivalries).length === 0) {
    const allPlayers = Object.keys(gameState.players);
    const newRivalries: Record<string, string[]> = {};

    // For each player, assign all other players as rivals
    allPlayers.forEach((player) => {
      newRivalries[player] = allPlayers.filter((p) => p !== player);
    });

    updates["gameState/rivalries"] = newRivalries;
    console.log("[StartRound] Auto-assigned rivalries:", newRivalries);
  }

  await gameRef.update(updates);
  console.log("[StartRound] New round started successfully");
}

/**
 * Check if all players have submitted their bids
 * @param {GameState} gameState Current state of the game
 * @return {boolean} True if all players have submitted bids
 */
function allPlayersSubmittedBids(gameState: GameState): boolean {
  const activePlayers = Object.values(gameState.players).filter(
    (player) => !player.isTimedOut
  );

  // Need at least 2 active players
  if (activePlayers.length < 2) {
    return false;
  }

  return activePlayers.every((player) => player.hasSubmittedBid);
}

/**
 * Check if the current round should be processed
 * @param {GameState} gameState Current state of the game
 * @param {number} currentTime Current timestamp
 * @return {boolean} True if the current round should be processed
 */
function shouldProcessRound(gameState: GameState, currentTime: number): boolean {
  if (!gameState.roundStartTime) return false;

  // Check for minimum player count
  const activePlayers = Object.values(gameState.players).filter(
    (player) => !player.isTimedOut
  );

  if (activePlayers.length < 2) {
    console.log("[ProcessRound] Not enough active players to process round");
    return false;
  }

  const timeElapsed = currentTime - gameState.roundStartTime;
  return timeElapsed >= (gameState.roundTimeLimit * 1000) || allPlayersSubmittedBids(gameState);
}

// Cleanup old logs every day
export const cleanupAutopilotLogs = onSchedule({
  schedule: "every 24 hours",
  timeZone: "America/Los_Angeles",
  retryCount: 3,
  memory: "256MiB",
}, async (event) => {
  await AutopilotMonitor.cleanup(30); // Keep 30 days of logs
});

// Process autopilot rounds every 5 minutes
export const processAutopilot = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "America/Los_Angeles",
  retryCount: 3,
  memory: "256MiB",
}, async (event) => {
  console.log("[Autopilot] Starting autopilot processing...");
  const gamesRef = db.ref("games");

  try {
    // Get all active games and games that haven't started
    console.log("[Autopilot] Fetching games...");
    const snapshot = await gamesRef
      .orderByChild("gameState/isActive")
      .equalTo(true)
      .once("value");

    const games = snapshot.val() as Record<string, DatabaseGame>;
    if (!games) {
      console.log("[Autopilot] No active games found");
      return;
    }

    console.log(`[Autopilot] Found ${Object.keys(games).length} active games`);

    // Process each active game
    const gamePromises = Object.entries(games).map(async ([gameId, game]) => {
      console.log(`[Autopilot] Processing game: ${gameId}`);
      const { gameState } = game;
      const gameRef = gamesRef.child(gameId);

      // Skip if autopilot is not enabled
      if (!gameState.autopilot?.enabled) {
        console.log(`[Autopilot] Game ${gameId}: Autopilot not enabled, skipping`);
        return;
      }

      const currentTime = Date.now();

      // Handle active game
      if (gameState.hasGameStarted && !gameState.isEnded) {
        // Check if round hasn't started yet (roundStartTime is null)
        if (!gameState.roundStartTime) {
          console.log(`[Autopilot] Game ${gameId}: Round not started, initiating new round`);
          await startNewRound(gameRef, gameState);
          return;
        }

        // Check if we need to process current round
        if (shouldProcessRound(gameState, currentTime)) {
          console.log(`[Autopilot] Game ${gameId}: Processing round ${gameState.currentRound}`);
          try {
            await processGameRound(gameRef, gameState);

            // Start next round if game hasn't ended
            const updatedSnapshot = await gameRef.child("gameState").once("value");
            const updatedState = updatedSnapshot.val() as GameState;

            if (!updatedState.isEnded) {
              await startNewRound(gameRef, updatedState);
            }
          } catch (error) {
            console.error(`[Autopilot] Game ${gameId}: Error processing round:`, error);
          }
        } else {
          console.log(`[Autopilot] Game ${gameId}: Round not ready for processing yet`);
        }
      }
    });

    console.log("[Autopilot] Waiting for all game processing to complete...");
    await Promise.all(gamePromises);
    console.log("[Autopilot] All games processed successfully");
  } catch (error) {
    console.error("[Autopilot] Error in main autopilot process:", error);
  }
});

// Toggle autopilot for a game
export const toggleAutopilot = onCall({
  memory: "256MiB",
  maxInstances: 10,
  timeoutSeconds: 30,
}, async (request) => {
  // Verify admin access
  if (!request.auth?.token?.admin) {
    throw new Error("Only admins can toggle autopilot");
  }

  const { gameId, enabled } = request.data as { gameId: string; enabled: boolean };
  const gameRef = db.ref(`games/${gameId}`);

  try {
    // Update autopilot state
    const autopilotState: AutopilotState = {
      enabled,
      lastUpdateTime: enabled ? Date.now() : null,
    };

    await gameRef.child("gameState/autopilot").set(autopilotState);

    // Log the toggle action
    await AutopilotMonitor.logEvent({
      gameId,
      action: "toggle",
      status: "success",
      details: { enabled },
    });

    return {
      success: true,
      message: `Autopilot ${enabled ? "enabled" : "disabled"} for game ${gameId}`,
    };
  } catch (error) {
    // Log the error
    await AutopilotMonitor.logEvent({
      gameId,
      action: "toggle",
      status: "failure",
      details: {
        enabled,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });

    console.error("Error toggling autopilot:", error);
    throw new Error("Failed to toggle autopilot");
  }
});
