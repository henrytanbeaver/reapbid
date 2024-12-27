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

  if (!gameRef?.key || !gameState || !gameState.players || !gameState.maxBid) {
    console.error("[ProcessRound] Invalid game state or reference:", {
      hasGameRef: !!gameRef,
      hasKey: !!gameRef?.key,
      hasGameState: !!gameState,
      hasPlayers: !!gameState?.players,
      hasMaxBid: !!gameState?.maxBid,
    });
    throw new Error("Invalid game state or reference: required fields missing");
  }

  const gameId = gameRef.key;
  const players = gameState.players || {};
  const playerIds = Object.keys(players);

  if (playerIds.length === 0) {
    console.error("[ProcessRound] No players found in game state");
    throw new Error("No players found in game state");
  }

  console.log("[ProcessRound] Initial game state:", {
    currentRound: gameState.currentRound,
    totalRounds: gameState.totalRounds,
    players: playerIds,
    roundBids: gameState.roundBids,
  });

  try {
    const costPerUnit = gameState.costPerUnit;
    const maxBid = gameState.maxBid;

    // Initialize all players with maxBid, then override with actual bids if submitted
    const updatedBids: Record<string, number> = {};
    playerIds.forEach((playerId) => {
      const player = players[playerId];
      // Use actual bid if submitted, otherwise use maxBid
      updatedBids[playerId] = (player?.hasSubmittedBid &&
        typeof player.currentBid === "number" &&
        !isNaN(player.currentBid)) ?
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
    const roundIndex = Math.max(0, (gameState.currentRound || 1) - 1);
    updates[`gameState/roundHistory/${roundIndex}`] = roundResult;
    console.log("[ProcessRound] Adding round to history under gameState at index:", roundIndex);

    // Reset round state
    updates["gameState/roundBids"] = null;
    updates["gameState/roundStartTime"] = null;

    // Update player states under gameState
    playerIds.forEach((playerId) => {
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
        Object.entries(round.profits || {}).forEach(([playerId, profit]) => {
          acc[playerId] = (acc[playerId] || 0) + (profit || 0);
        });
        return acc;
      }, {} as Record<string, number>);

      const bestRound = allRounds.reduce(
        (best, round) => {
          const maxProfit = Math.max(...Object.values(round.profits || {}));
          return maxProfit > best.profit ? { round: round.round || 0, profit: maxProfit } : best;
        },
        { round: 0, profit: -Infinity }
      );

      const totalRoundCount = allRounds.length * playerIds.length || 1;
      const averageMarketShare = allRounds
        .flatMap((round) => Object.values(round.marketShares || {}))
        .reduce((sum, share) => sum + (share || 0), 0) / totalRoundCount;

      // Update final game state
      updates["gameState/isActive"] = false;
      updates["gameState/isEnded"] = true;
      updates["gameState/totalProfit"] = Object.values(allProfits).reduce((sum, profit) => sum + (profit || 0), 0);
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
      console.log("[ProcessRound] Advancing to next round:", (gameState.currentRound || 0) + 1);
      updates["gameState/currentRound"] = (gameState.currentRound || 0) + 1;
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
        round: gameState.currentRound || 0,
        playerCount: playerIds.length,
        processedBids: Object.keys(updatedBids).length,
        timeoutBids: playerIds.length - Object.keys(updatedBids).length,
      },
    });
  } catch (error) {
    console.error("[ProcessRound] Error during round processing:", error);
    // Log error in round processing
    await AutopilotMonitor.logEvent({
      gameId,
      action: "error",
      status: "failure",
      details: {
        round: gameState.currentRound || 0,
        error: error instanceof Error ? error.message : "Unknown error",
        playerCount: playerIds.length,
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

  if (!gameRef?.key || !gameState || !gameState.players) {
    console.error("[StartRound] Invalid game state or reference:", {
      hasGameRef: !!gameRef,
      hasKey: !!gameRef?.key,
      hasGameState: !!gameState,
      hasPlayers: !!gameState?.players,
    });
    throw new Error("Invalid game state or reference: required fields missing");
  }

  const players = gameState.players || {};
  const playerIds = Object.keys(players);

  // Check for minimum player count
  const activePlayers = Object.values(players).filter(
    (player) => player && !player.isTimedOut
  );

  if (activePlayers.length < 2) {
    console.log("[StartRound] Not enough active players to start round:", {
      totalPlayers: playerIds.length,
      activePlayers: activePlayers.length,
    });
    return;
  }

  const updates: { [key: string]: any } = {
    "gameState/roundStartTime": Date.now(),
    "gameState/isActive": true,
  };

  // Reset player bid states for the new round
  playerIds.forEach((playerId) => {
    updates[`gameState/players/${playerId}/hasSubmittedBid`] = false;
    updates[`gameState/players/${playerId}/currentBid`] = null;
  });

  // Auto-assign all players as rivals to each other if rivalries not set
  const rivalries = gameState.rivalries || {};
  if (!rivalries || Object.keys(rivalries).length === 0) {
    const newRivalries: Record<string, string[]> = {};

    // For each player, assign all other players as rivals
    playerIds.forEach((player) => {
      newRivalries[player] = playerIds.filter((p) => p !== player);
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
  if (!gameState?.players) {
    console.log("[CheckBids] No players in game state");
    return false;
  }

  const players = gameState.players || {};
  const activePlayers = Object.values(players).filter(
    (player) => player && !player.isTimedOut
  );

  // Need at least 2 active players
  if (activePlayers.length < 2) {
    console.log("[CheckBids] Not enough active players:", activePlayers.length);
    return false;
  }

  return activePlayers.every((player) => player?.hasSubmittedBid === true);
}

/**
 * Check if the current round should be processed
 * @param {GameState} gameState Current state of the game
 * @param {number} currentTime Current timestamp
 * @return {boolean} True if the current round should be processed
 */
function shouldProcessRound(gameState: GameState, currentTime: number): boolean {
  if (!gameState?.roundStartTime || !gameState?.players || !gameState?.roundTimeLimit) {
    console.log("[ProcessCheck] Missing required game state fields:", {
      hasStartTime: !!gameState?.roundStartTime,
      hasPlayers: !!gameState?.players,
      hasTimeLimit: !!gameState?.roundTimeLimit,
    });
    return false;
  }

  const players = gameState.players || {};
  const activePlayers = Object.values(players).filter(
    (player) => player && !player.isTimedOut
  );

  if (activePlayers.length < 2) {
    console.log("[ProcessCheck] Not enough active players:", {
      totalPlayers: Object.keys(players).length,
      activePlayers: activePlayers.length,
    });
    return false;
  }

  const timeElapsed = currentTime - gameState.roundStartTime;
  const shouldProcess = timeElapsed >= (gameState.roundTimeLimit * 1000) || allPlayersSubmittedBids(gameState);

  console.log("[ProcessCheck] Round processing check:", {
    timeElapsed,
    timeLimit: gameState.roundTimeLimit * 1000,
    allBidsSubmitted: allPlayersSubmittedBids(gameState),
    shouldProcess,
  });

  return shouldProcess;
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

      if (!game?.gameState) {
        console.error(`[Autopilot] Game ${gameId}: Invalid game state`);
        return;
      }

      const { gameState } = game;
      const gameRef = gamesRef.child(gameId);

      // Skip if autopilot is not enabled
      if (!gameState.autopilot?.enabled) {
        console.log(`[Autopilot] Game ${gameId}: Autopilot not enabled, skipping`);
        return;
      }

      const currentTime = Date.now();

      try {
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
            console.log(`[Autopilot] Game ${gameId}: Processing round ${gameState.currentRound || 1}`);

            await processGameRound(gameRef, gameState);

            // Start next round if game hasn't ended
            const updatedSnapshot = await gameRef.child("gameState").once("value");
            const updatedState = updatedSnapshot.val() as GameState;

            if (updatedState && !updatedState.isEnded) {
              await startNewRound(gameRef, updatedState);
            }
          }
        }
      } catch (error) {
        console.error(`[Autopilot] Game ${gameId}: Error processing game:`, error);
        await AutopilotMonitor.logEvent({
          gameId,
          action: "error",
          status: "failure",
          details: {
            round: gameState.currentRound || 0,
            error: error instanceof Error ? error.message : "Unknown error",
            playerCount: Object.keys(gameState.players || {}).length,
          },
        });
      }
    });

    await Promise.all(gamePromises);
    console.log("[Autopilot] Completed processing all games");
  } catch (error) {
    console.error("[Autopilot] Error in main autopilot process:", error);
    throw error;
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
