import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { AutopilotState } from "../../src/types/autopilot";
import { GameState, RoundResult, DatabaseGame } from "../../src/types/game";
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
 * @param {boolean} updateDatabase Whether to update Firebase with the new bids
 */
export async function processGameRound(
  gameRef: admin.database.Reference,
  gameState: GameState,
  updateDatabase = true
): Promise<RoundResult> {
  try {
    const { maxBid, costPerUnit, players = {} } = gameState;
    const playerIds = Object.keys(players);
    const activePlayerIds = playerIds.filter((id) => !players[id]?.isTimedOut);
    const timedOutPlayerIds = playerIds.filter((id) => players[id]?.isTimedOut);

    console.log("[ProcessRound] Player states before processing:", {
      activePlayerIds,
      timedOutPlayerIds,
      players: Object.fromEntries(
        playerIds.map((id) => [id, {
          currentBid: players[id]?.currentBid,
          hasSubmittedBid: players[id]?.hasSubmittedBid,
          isTimedOut: players[id]?.isTimedOut,
        }])
      ),
    });

    // Initialize all players with maxBid, then override with actual bids if submitted
    const updatedBids: Record<string, number> = {};
    const updates: { [key: string]: any } = {};

    // Handle active players' bids
    activePlayerIds.forEach((playerId) => {
      const player = players[playerId];
      if (player?.hasSubmittedBid && typeof player.currentBid === "number" && !isNaN(player.currentBid)) {
        updatedBids[playerId] = player.currentBid;
        if (updateDatabase) {
          updates[`gameState/players/${playerId}/currentBid`] = player.currentBid;
          updates[`gameState/players/${playerId}/hasSubmittedBid`] = player.hasSubmittedBid;
        }
      } else {
        updatedBids[playerId] = maxBid;
        if (updateDatabase) {
          updates[`gameState/players/${playerId}/currentBid`] = maxBid;
          updates[`gameState/players/${playerId}/hasSubmittedBid`] = false;
        }
      }
    });

    // Handle timed out players - preserve their original bid and submission state
    timedOutPlayerIds.forEach((playerId) => {
      const player = players[playerId];
      // Use their original bid if valid, otherwise use maxBid
      const currentBid = typeof player.currentBid === "number" ? player.currentBid : maxBid;
      updatedBids[playerId] = currentBid;
      if (updateDatabase) {
        // Preserve both the original bid and submission state
        updates[`gameState/players/${playerId}/currentBid`] = currentBid;
        updates[`gameState/players/${playerId}/hasSubmittedBid`] = player.hasSubmittedBid;
      }
    });

    console.log("[ProcessRound] Bid updates:", {
      updatedBids,
      activePlayerBids: Object.fromEntries(
        activePlayerIds.map((id) => [id, updatedBids[id]])
      ),
      timedOutPlayerBids: Object.fromEntries(
        timedOutPlayerIds.map((id) => [id, updatedBids[id]])
      ),
    });

    // Calculate market shares and profits
    const marketShares = calculateAllMarketShares(updatedBids);
    const profits = calculateAllProfits(updatedBids, marketShares, costPerUnit);

    console.log("[ProcessRound] Calculation results:", {
      marketShares,
      profits,
      bidsUsedForCalculation: updatedBids,
    });

    // Prepare round result
    const roundResult: RoundResult = {
      round: gameState.currentRound,
      bids: updatedBids,
      marketShares,
      profits,
      timestamp: Date.now(),
    };

    if (updateDatabase) {
      await gameRef.update(updates);
    }

    console.log("[ProcessRound] Round result:", roundResult);
    return roundResult;
  } catch (error) {
    console.error("[ProcessRound] Error processing round:", error);
    throw error;
  }
}

/**
 * Advances the game state after a round has been processed. This function handles:
 * 1. Storing round results in game history
 * 2. Updating game state (ending game or advancing to next round)
 * 3. Resetting player bid states for the next round
 *
 * @param {admin.database.Reference} gameRef - Reference to the game in Firebase
 * @param {GameState} gameState - Current state of the game
 * @param {RoundResult} roundResult - Results from the processed round including bids, market shares, and profits
 * @return {Promise<void>} Promise that resolves when all updates are complete
 * @throws {Error} If there's an error updating the game state
 */
export async function advanceGameState(
  gameRef: admin.database.Reference,
  gameState: GameState,
  roundResult: RoundResult
): Promise<void> {
  try {
    const updates: { [key: string]: any } = {};
    const { players = {} } = gameState;
    const playerIds = Object.keys(players);

    // Add round to history
    const roundIndex = Math.max(0, (gameState.currentRound || 1) - 1);
    updates[`gameState/roundHistory/${roundIndex}`] = roundResult;

    // Reset round state
    updates["gameState/roundBids"] = null;
    updates["gameState/roundStartTime"] = null;

    // Update player bids based on round result
    Object.entries(roundResult.bids).forEach(([playerId, bid]) => {
      updates[`gameState/players/${playerId}/currentBid`] = bid;
    });

    // Check if game should end
    if (gameState.currentRound >= gameState.totalRounds) {
      console.log("[AdvanceGame] Final round completed, ending game");
      updates["gameState/isEnded"] = true;
      updates["gameState/isActive"] = false;
      updates["gameState/endTime"] = Date.now();
      updates["status"] = "completed";
      updates["updatedAt"] = Date.now();
    } else {
      console.log("[AdvanceGame] Advancing to next round:", {
        from: gameState.currentRound,
        to: (gameState.currentRound || 1) + 1,
        totalRounds: gameState.totalRounds,
      });
      updates["gameState/currentRound"] = (gameState.currentRound || 1) + 1;
      updates["gameState/isActive"] = true;

      // Reset bid states for next round
      playerIds.forEach((playerId) => {
        // Don't reset timed out players
        if (!players[playerId]?.isTimedOut) {
          updates[`gameState/players/${playerId}/currentBid`] = null;
          // Don't reset hasSubmittedBid here since we need it for the current round
        }
      });
    }

    console.log("[AdvanceGame] Final updates to be applied:", {
      gameState: Object.fromEntries(
        Object.entries(updates)
          .filter(([key]) => key.startsWith("gameState/") && !key.includes("players/"))
      ),
      playerUpdates: Object.fromEntries(
        Object.entries(updates)
          .filter(([key]) => key.includes("players/"))
          .map(([key, value]) => [key.split("/")[2], value])
      ),
    });

    // Perform all updates atomically
    await gameRef.update(updates);
    console.log("[AdvanceGame] Successfully updated game state");
  } catch (error) {
    console.error("[AdvanceGame] Error advancing game state:", error);
    throw error;
  }
}

/**
 * Main handler for autopilot functionality. This function orchestrates the entire round processing flow:
 * 1. Processes the current round (calculating market shares and profits)
 * 2. Advances the game state (storing results and preparing for next round)
 *
 * @param {admin.database.Reference} gameRef - Reference to the game in Firebase
 * @param {GameState} gameState - Current state of the game
 * @return {Promise<void>} Promise that resolves when round processing is complete
 * @throws {Error} If there's an error during round processing or state advancement
 */
export async function handleAutopilot(
  gameRef: admin.database.Reference,
  gameState: GameState
): Promise<void> {
  try {
    // 1. Process current round
    const roundResult = await processGameRound(gameRef, gameState);

    // 2. Advance game state
    await advanceGameState(gameRef, gameState, roundResult);
  } catch (error) {
    console.error("[Autopilot] Error in autopilot handler:", error);
    throw error;
  }
}

// Cleanup old logs every day
export const cleanupAutopilotLogs = onSchedule({
  schedule: "every day 00:00",
  region: "us-central1",
}, async (/* event=*/) => {
  try {
    const logsRef = db.ref("logs");
    const snapshot = await logsRef.once("value");
    const logs = snapshot.val() || {};

    // Delete logs older than 7 days
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const updates: { [key: string]: null } = {};

    Object.entries(logs).forEach(([key, log]: [string, any]) => {
      if (log.timestamp < cutoffTime) {
        updates[key] = null;
      }
    });

    if (Object.keys(updates).length > 0) {
      await logsRef.update(updates);
      console.log(`Cleaned up ${Object.keys(updates).length} old logs`);
    }
  } catch (error) {
    console.error("Error cleaning up logs:", error);
    throw error;
  }
});

// Process autopilot games every minute
export const processAutopilot = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "America/Los_Angeles",
  retryCount: 3,
  memory: "256MiB",
}, async (/* event=*/) => {
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

            // Process the current round
            await handleAutopilot(gameRef, gameState);

            // Get the updated state AFTER processing
            const updatedSnapshot = await gameRef.child("gameState").once("value");
            const updatedState = updatedSnapshot.val() as GameState;

            // Only start a new round if:
            // 1. Game state exists
            // 2. Game hasn't ended
            // 3. Current round is less than total rounds (we're not in the final round)
            if (updatedState &&
                !updatedState.isEnded &&
                updatedState.currentRound < updatedState.totalRounds) {
              console.log(`[Autopilot] Game ${gameId}: Starting next round`);
              await startNewRound(gameRef, updatedState);
            } else {
              console.log(`[Autopilot] Game ${gameId}: Game complete, not starting new round`, {
                currentRound: updatedState?.currentRound,
                totalRounds: updatedState?.totalRounds,
                isEnded: updatedState?.isEnded,
              });
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
  if (!gameId) {
    throw new Error("No game ID provided");
  }

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

/**
 * Start a new round for the game
 * @param {admin.database.Reference} gameRef Reference to the game in Firebase
 * @param {GameState} gameState Current state of the game
 */
async function startNewRound(
  gameRef: admin.database.Reference,
  gameState: GameState
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
export function allPlayersSubmittedBids(gameState: GameState): boolean {
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
export function shouldProcessRound(gameState: GameState, currentTime: number): boolean {
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
