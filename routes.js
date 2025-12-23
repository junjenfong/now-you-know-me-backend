import archiver from "archiver";
import express from "express";
import { Connection, Player, Session } from "./models/index.js";

const router = express.Router();

// Throttling map for leaderboard updates
const sessionUpdateTimers = new Map();
const THROTTLE_INTERVAL = 5000; // 5 seconds

const emitLeaderboardUpdate = async (req, sessionId) => {
  const now = Date.now();
  const lastUpdate = sessionUpdateTimers.get(sessionId) || 0;

  if (now - lastUpdate >= THROTTLE_INTERVAL) {
    // Emit immediately
    const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
    req.app.get("io").to(sessionId).emit("updateLeaderboard", players);
    sessionUpdateTimers.set(sessionId, now);
  } else {
    // Schedule update if not already scheduled
    if (!sessionUpdateTimers.has(`${sessionId}_scheduled`)) {
      sessionUpdateTimers.set(`${sessionId}_scheduled`, true);
      setTimeout(async () => {
        const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
        req.app.get("io").to(sessionId).emit("updateLeaderboard", players);
        sessionUpdateTimers.set(sessionId, Date.now());
        sessionUpdateTimers.delete(`${sessionId}_scheduled`);
      }, THROTTLE_INTERVAL - (now - lastUpdate));
    }
  }
};

// health check
router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

// Get session details
router.get("/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const [players, connections] = await Promise.all([
      Player.find({ sessionId }),
      Connection.find({ sessionId }),
    ]);

    res.json({ session, players, connections });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all sessions
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await Session.aggregate([
      {
        $lookup: {
          from: "players",
          localField: "sessionId",
          foreignField: "sessionId",
          as: "players",
        },
      },
      {
        $project: {
          sessionId: 1,
          status: 1,
          createdAt: 1,
          playerCount: { $size: "$players" },
          isActive: { $in: ["$status", ["playing", "ended"]] },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    res.json({ sessions });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create new session
router.post("/sessions", async (req, res) => {
  try {
    const { name, maxPlayers, customQuestions } = req.body;
    const sessionId = name || Math.random().toString(36).substr(2, 9);

    let questions;
    if (customQuestions && customQuestions.length === 5) {
      questions = customQuestions.map(q => ({
        title: q,
        field: q.toLowerCase().replace(/[^a-z0-9]/gi, '')
      }));
    } else {
      questions = [
        { title: "What's your favorite food?", field: "favoriteFood" },
        { title: "What's your hobby?", field: "hobby" },
        { title: "What's your favorite color?", field: "favoriteColor" },
        { title: "Who's your favorite artist?", field: "favoriteArtist" },
        { title: "Who's your idol?", field: "idol" },
      ];
    }

    const session = new Session({
      sessionId,
      name,
      maxPlayers,
      status: "waiting",
      questions,
    });

    await session.save();
    res.status(201).json(session);
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ error: error.message });
  }
});

// Check session status
router.get("/sessions/:sessionId/check", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const playerCount = await Player.countDocuments({
      sessionId,
      status: "connected",
    });

    res.json({
      sessionId: session.sessionId,
      status: session.status,
      name: session.name,
      playerCount,
    });
  } catch (error) {
    console.error("Error checking session:", error);
    res.status(500).json({ error: "Failed to check session status" });
  }
});

// Join session
router.post("/sessions/:sessionId/join", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { name } = req.body;

    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const player = new Player({
      name,
      sessionId,
      score: 0,
      status: "connected",
      preserveData: true,
    });

    await player.save();

    // const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
    // req.app.get("io").to(sessionId).emit("updateLeaderboard", players);
    emitLeaderboardUpdate(req, sessionId);

    res.status(201).json(player);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update player profile
router.post("/players/:playerId/profile", async (req, res) => {
  try {
    const { playerId } = req.params;
    const { profile } = req.body;

    const updatedPlayer = await Player.findByIdAndUpdate(
      playerId,
      { $set: { profile, hasProfile: true } },
      { new: true }
    );
    console.log(updatedPlayer);
    if (!updatedPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    // Emit an update to all clients in the session
    // const players = await Player.find({ sessionId: updatedPlayer.sessionId }).sort({ score: -1, lastMatchAt: 1 });
    // req.app.get("io").to(updatedPlayer.sessionId).emit("updateLeaderboard", players);
    emitLeaderboardUpdate(req, updatedPlayer.sessionId);

    res.json(updatedPlayer);
  } catch (error) {
    console.error("Error updating player profile:", error);
    res.status(500).json({ error: "Failed to update player profile" });
  }
});

// Admin: Update player score
router.patch("/players/:playerId/score", async (req, res) => {
  try {
    const { playerId } = req.params;
    const { score } = req.body;

    if (score === undefined || isNaN(parseInt(score))) {
      return res.status(400).json({ error: "Invalid score provided" });
    }

    const updatedPlayer = await Player.findByIdAndUpdate(
      playerId,
      { $set: { score: parseInt(score) } },
      { new: true }
    );

    if (!updatedPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    // Emit an update to all clients in the session
    // const players = await Player.find({ sessionId: updatedPlayer.sessionId }).sort({ score: -1, lastMatchAt: 1 });
    // req.app.get("io").to(updatedPlayer.sessionId).emit("updateLeaderboard", players);
    emitLeaderboardUpdate(req, updatedPlayer.sessionId);
    console.log("Emitting updateLeaderboard after score update for session", updatedPlayer.sessionId);

    res.json(updatedPlayer);
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(500).json({ error: "Failed to update score" });
  }
});


// Start session
router.post("/sessions/:sessionId/start", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updatedSession = await Session.findOneAndUpdate(
      { sessionId },
      { status: "playing" },
      { new: true }
    );

    if (!updatedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    const players = await Player.find({ sessionId });
    req.app.get("io").to(sessionId).emit("gameStarted", players);

    res.json(updatedSession);
  } catch (error) {
    console.error("Error starting session:", error);
    res.status(500).json({ error: "Failed to start session" });
  }
});

// End session
router.post("/sessions/:sessionId/end", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updatedSession = await Session.findOneAndUpdate(
      { sessionId },
      { status: "ended" },
      { new: true }
    );

    if (!updatedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
    req.app.get("io").to(sessionId).emit("gameEnded", players);

    res.json(updatedSession);
  } catch (error) {
    console.error("Error ending session:", error);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Get session players
router.get("/sessions/:sessionId/players", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const players = await Player.find({ sessionId })
      .sort({ score: -1, lastMatchAt: 1 })
      .select("-status");

    res.json({ players });
  } catch (error) {
    console.error("Error fetching players:", error);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

// Get session results for download
router.get("/sessions/:sessionId/results", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findOne({ sessionId });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const players = await Player.find({ sessionId });

    res.json({ questions: session.questions, players });
  } catch (error) {
    console.error("Error fetching session results:", error);
    res.status(500).json({ error: "Failed to fetch session results" });
  }
});

// Admin login
router.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  console.log(username, process);
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    res.json({ token: process.env.ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: "Invalid credentials" });
  }
});

// Admin logout
router.post("/admin/logout", (req, res) => {
  res.json({ message: "Logout successful" });
});

// Download all images from a session
router.get("/sessions/:sessionId/images", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const players = await Player.find({ sessionId });

    if (!players) {
      return res.status(404).json({ error: "Session not found" });
    }

    const archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level.
    });

    res.attachment(`${sessionId}-images.zip`);
    archive.pipe(res);

    for (const player of players) {
      if (player.matches && player.matches.length > 0) {
        for (const match of player.matches) {
          if (match.selfieUrl) {
            const base64Data = match.selfieUrl.replace(
              /^data:image\/(png|jpeg);base64,/,
              ""
            );
            const imgBuffer = Buffer.from(base64Data, "base64");
            archive.append(imgBuffer, {
              name: `${player.name}-${match.playerName}.png`,
            });
          }
        }
      }
    }

    archive.finalize();
  } catch (error) {
    console.error("Error creating image archive:", error);
    res.status(500).json({ error: "Failed to create image archive" });
  }
});

// Confirm a match and update scores
router.post("/sessions/:sessionId/match", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { finderId, foundPlayerId, selfieUrl } = req.body;

    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Atomic update: Only update if the match doesn't already exist
    const finderPlayer = await Player.findOneAndUpdate(
      {
        _id: finderId,
        "matches.playerId": { $ne: foundPlayerId }, // Condition: Match must not exist
      },
      {
        $inc: { score: 100, peopleKnown: 1 },
        $push: {
          matches: {
            playerId: foundPlayerId,
            matchedAt: matchTime,
            selfieUrl,
            playerName: foundPlayer.name,
          },
        },
        lastMatchAt: matchTime,
      },
      { new: true }
    );

    if (!finderPlayer) {
      // If no document returned, it means the match already exists (race condition handled)
      console.log("Match already exists or player not found. Skipping update.");
      return res.status(400).json({ error: "Match already recorded" });
    }

    // Update found player's counter
    await Player.findByIdAndUpdate(foundPlayerId, {
      $inc: { peopleWhoKnowYou: 1, score: 50 },
    });

    // Check if finder completed all matches
    const totalOtherPlayers = await Player.countDocuments({
      sessionId,
      _id: { $ne: finderId },
      profile: { $exists: true, $ne: null },
    });

    const matchCount = (finderPlayer.matches || []).length;

    // If this player just completed all matches, record completion time
    if (matchCount >= totalOtherPlayers && !finderPlayer.completedAt) {
      await Player.findByIdAndUpdate(finderId, {
        completedAt: matchTime,
        isCompleted: true,
      });

      console.log(
        `🎉 Player ${finderPlayer.name} completed all matches at ${matchTime}`
      );
    }

    res.json({
      message: "Match confirmed successfully",
      isCompleted: matchCount >= totalOtherPlayers,
      totalMatches: matchCount,
      totalRequired: totalOtherPlayers,
      points: {
        finder: 100,
        found: 50,
      },
    });

    // const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
    // req.app.get("io").to(sessionId).emit("updateLeaderboard", players);
    emitLeaderboardUpdate(req, sessionId);
  } catch (error) {
    console.error("Error confirming match:", error);
    res.status(500).json({ error: "Failed to confirm match" });
  }
});

router.post("/sessions/:sessionId/wrong-match", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { finderId } = req.body;

    await Player.findByIdAndUpdate(finderId, {
      $inc: { score: -10, wrongGuesses: 1 },
    });

    // const players = await Player.find({ sessionId }).sort({ score: -1, lastMatchAt: 1 });
    // req.app.get("io").to(sessionId).emit("updateLeaderboard", players);
    emitLeaderboardUpdate(req, sessionId);

    res.json({ message: "Score updated successfully" });
  } catch (error) {
    console.error("Error updating score:", error);
    res.status(500).json({ error: "Failed to update score" });
  }
});
// Get a new profile to find
router.get(
  "/sessions/:sessionId/player/:playerId/new-profile",
  async (req, res) => {
    try {
      const { sessionId, playerId } = req.params;
      const { skip } = req.query; // Get the skipped profile ID from the query params

      console.log(
        `Fetching new profile for player ${playerId} in session ${sessionId}`
      );

      const currentPlayer = await Player.findById(playerId);
      if (!currentPlayer) {
        console.log(`Player ${playerId} not found`);
        return res.status(404).json({ error: "Player not found" });
      }
      console.log("Current player found:", currentPlayer.name);

      // Get all matched player IDs (convert to strings for comparison)
      const matchedIds = (currentPlayer.matches || []).map((m) => m.playerId);
      console.log("Already matched IDs:", matchedIds);

      const exclusionIds = [...matchedIds];
      if (skip) {
        exclusionIds.push(skip);
      }

      // Find and atomically update the player with the lowest timesAssigned
      let playerToFind = await Player.findOneAndUpdate(
        {
          sessionId,
          _id: {
            $ne: playerId, // Exclude self
            $nin: exclusionIds, // Exclude already matched and skipped
          },
          hasProfile: true, // Only players with profiles
        },
        { $inc: { timesAssigned: 1 } },
        { sort: { timesAssigned: 1 }, new: true }
      );

      // If no player found AND we were skipping someone, try again without the skip
      // This handles the case where the skipped player was the ONLY available player
      if (!playerToFind && skip) {
        console.log("No new players found, retrying with skipped player included.");
        playerToFind = await Player.findOneAndUpdate(
            {
              sessionId,
              _id: {
                $ne: playerId, // Exclude self
                $nin: matchedIds, // Exclude ONLY already matched (allow skipped)
              },
              hasProfile: true,
            },
            { $inc: { timesAssigned: 1 } },
            { sort: { timesAssigned: 1 }, new: true }
          );
      }

      if (!playerToFind) {
        console.log(`No more profiles to find for player ${playerId}`);
        return res.status(200).json({ message: "ALL_PLAYERS_FOUND" });
      }

      console.log(
        `Assigned profile of ${playerToFind.name} to player ${currentPlayer.name}`
      );
      res.json({
        profile: playerToFind.profile,
        playerId: playerToFind._id,
        playerName: playerToFind.name,
      });
    } catch (error) {
      console.error("Error getting new profile:", error);
      res.status(500).json({ error: "Failed to get new profile" });
    }
  }
);

export default router;
