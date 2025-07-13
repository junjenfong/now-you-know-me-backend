/* global process */
import { Player, Session } from "./models/index.js";

// Utility function to get player state
const getPlayerState = async (sessionId) => {
  const allPlayers = await Player.find({ sessionId });
  const connectedPlayers = allPlayers.filter((p) => p.status === "connected");
  return { allPlayers, connectedPlayers };
};

export const getSessionId = (socket) => {
  const rooms = Array.from(socket.rooms);
  return rooms.length > 1 ? rooms[1] : null;
};

export const handleJoinGame = async (
  io,
  socket,
  { name, sessionId, playerId }
) => {
  try {
    console.log(`Player ${name} attempting to join session ${sessionId}`);

    const session = await Session.findOne({ sessionId });
    if (!session) {
      socket.emit("error", "Session not found");
      return;
    }

    if (session.status === "ended") {
      socket.emit("error", "This session has already ended.");
      return;
    }

    let player;
    // If a playerId is provided, try to find the player and reconnect
    if (playerId) {
      player = await Player.findOne({ _id: playerId, sessionId });
      if (player) {
        console.log(`Reconnecting player ${player.name}`);
        player.socketId = socket.id;
        player.status = "connected";
        await player.save();
      } else {
        // If the player ID is invalid, prevent them from creating a new player with the same name
        const existingPlayer = await Player.findOne({ name, sessionId });
        if (existingPlayer) {
          socket.emit("error", "A player with this name already exists.");
          return;
        }
      }
    }

    // If no player was found, create a new one
    if (!player) {
      if (session.status === "playing") {
        socket.emit(
          "error",
          "This session is already in progress and cannot be joined."
        );
        return;
      }
      console.log(`Creating new player ${name}`);
      player = await Player.create({
        socketId: socket.id,
        name,
        sessionId,
        score: 0,
        status: "connected",
        hasProfile: false,
      });
    }

    socket.join(sessionId);

    const { allPlayers, connectedPlayers } = await getPlayerState(sessionId);

    // Send game state to the joining player
    socket.emit("gameState", {
      sessionStatus: session.status,
      players: allPlayers,
      currentPlayer: player,
    });

    // Notify other players
    io.to(sessionId).emit("playerJoined", player);
  } catch (error) {
    console.error("Error in handleJoinGame:", error);
    socket.emit("error", { message: error.message });
  }
};

export const handleDisconnect = async (io, socket) => {
  try {
    const player = await Player.findOneAndUpdate(
      { socketId: socket.id },
      { $set: { status: "disconnected" } }
    );
    if (player) {
      io.to(player.sessionId).emit("playerLeft", player._id);
    }
  } catch (error) {
    console.error("Error in handleDisconnect:", error);
  }
};

export const handleEndGame = async (io, socket, { sessionId }) => {
  try {
    if (socket.handshake.auth.token !== process.env.ADMIN_TOKEN) {
      socket.emit("error", {
        message: "Unauthorized: Only admin can end the game.",
      });
      return;
    }
    await Session.findOneAndUpdate({ sessionId }, { status: "ended" });
    const { allPlayers } = await getPlayerState(sessionId);
    io.to(sessionId).emit("gameEnded", { players: allPlayers });
  } catch (error) {
    console.error("Error in handleEndGame:", error);
    socket.emit("error", { message: "Failed to end game" });
  }
};

export const handleStartGame = async (io, socket, { sessionId }) => {
  try {
    if (socket.handshake.auth.token !== process.env.ADMIN_TOKEN) {
      socket.emit("error", {
        message: "Unauthorized: Only admin can start the game.",
      });
      return;
    }
    await Session.findOneAndUpdate({ sessionId }, { status: "playing" });
    io.to(sessionId).emit("gameStarted");
  } catch (error) {
    console.error("Error in handleStartGame:", error);
    socket.emit("error", { message: "Failed to start game" });
  }
};

export const handleUpdateProfile = async (
  io,
  socket,
  { profile, sessionId }
) => {
  try {
    const player = await Player.findOneAndUpdate(
      { socketId: socket.id, sessionId },
      { profile, hasProfile: true },
      { new: true }
    );

    if (!player) {
      socket.emit("profileUpdated", {
        success: false,
        message: "Player not found",
      });
      return;
    }

    socket.emit("profileUpdated", { success: true });
    io.to(sessionId).emit("playerProfileUpdated", { playerId: player._id });
  } catch (error) {
    console.error("Error in handleUpdateProfile:", error);
    socket.emit("profileUpdated", { success: false, message: error.message });
  }
};

export const handleGetNewProfile = async (io, socket, { sessionId }) => {
  try {
    const currentPlayer = await Player.findOne({
      socketId: socket.id,
      sessionId,
    });
    if (!currentPlayer) {
      socket.emit("error", { message: "Player not found" });
      return;
    }

    const players = await Player.find({
      sessionId,
      hasProfile: true,
      socketId: { $ne: socket.id },
      _id: { $nin: (currentPlayer.matches || []).map((m) => m.matchedWith) },
    });

    if (players.length === 0) {
      socket.emit("noMoreProfiles", {
        message: "You've found everyone! Great job!",
      });
      return;
    }

    const randomIndex = Math.floor(Math.random() * players.length);
    const playerToFind = players[randomIndex];

    socket.emit("profileAssigned", {
      profile: playerToFind.profile,
      playerId: playerToFind._id,
    });
  } catch (error) {
    console.error("Error in handleGetNewProfile:", error);
    socket.emit("error", { message: error.message });
  }
};

export const handleConfirmMatch = async (
  io,
  socket,
  { finder, foundPlayerId, selfieUrl }
) => {
  try {
    const finderPlayer = await Player.findOne({ socketId: finder });
    const foundPlayer = await Player.findOne({ _id: foundPlayerId });

    if (!finderPlayer || !foundPlayer) {
      socket.emit("error", { message: "One or both players not found" });
      return;
    }

    const newFinderScore = (finderPlayer.score || 0) + 100;
    await Player.findOneAndUpdate(
      { socketId: finder },
      {
        score: newFinderScore,
        $push: {
          matches: {
            matchedWith: foundPlayer._id,
            matchedAt: new Date(),
            selfieUrl,
            playerName: foundPlayer.name,
          },
        },
        $inc: { peopleKnown: 1 },
      }
    );

    await Player.findOneAndUpdate(
      { _id: foundPlayer._id },
      { $inc: { peopleWhoKnowYou: 1 } }
    );

    socket.emit("matchFound", {
      finder: finderPlayer.name,
      found: foundPlayer.name,
      points: 100,
    });

    io.to(finderPlayer.sessionId).emit("scoreUpdated", {
      playerId: finderPlayer.socketId,
      newScore: newFinderScore,
    });

    const { allPlayers } = await getPlayerState(finderPlayer.sessionId);
    const leaderboard = [...allPlayers].sort((a, b) => b.score - a.score);
    io.to(finderPlayer.sessionId).emit("leaderboardUpdated", leaderboard);
  } catch (error) {
    console.error("Error in handleConfirmMatch:", error);
    socket.emit("error", { message: error.message });
  }
};
