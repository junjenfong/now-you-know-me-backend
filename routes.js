import archiver from "archiver";
import express from "express";
import { Connection, Player, Session } from "./models/index.js";

const router = express.Router();

// health check
app.get("/api/health", (req, res) => {
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
    const { name, maxPlayers } = req.body;
    const sessionId = name || Math.random().toString(36).substr(2, 9);

    const session = new Session({
      sessionId,
      name,
      maxPlayers,
      status: "waiting",
      adminSocketId: null,
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

    res.json(updatedPlayer);
  } catch (error) {
    console.error("Error updating player profile:", error);
    res.status(500).json({ error: "Failed to update player profile" });
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

    // req.app.get('io').to(sessionId).emit('gameStarted');

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

    // Optional: Emit a socket event to notify clients
    // req.app.get('io').to(sessionId).emit('gameEnded');

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
      .sort({ score: -1 })
      .select("-status");

    res.json({ players });
  } catch (error) {
    console.error("Error fetching players:", error);
    res.status(500).json({ error: "Failed to fetch players" });
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

    const finderPlayer = await Player.findById(finderId);
    const foundPlayer = await Player.findById(foundPlayerId);

    if (!finderPlayer || !foundPlayer) {
      return res.status(404).json({ error: "One or both players not found" });
    }

    const newFinderScore = (finderPlayer.score || 0) + 100;
    const matchTime = new Date();

    // Update finder's matches
    await Player.findByIdAndUpdate(finderId, {
      score: newFinderScore,
      $push: {
        matches: {
          _id: foundPlayer._id,
          matchedAt: matchTime,
          selfieUrl,
          playerName: foundPlayer.name,
        },
      },
      $inc: { peopleKnown: 1 },
    });

    // Update found player's counter
    await Player.findByIdAndUpdate(foundPlayerId, {
      $inc: { peopleWhoKnowYou: 1 },
    });

    // Check if finder completed all matches
    const totalOtherPlayers = await Player.countDocuments({
      sessionId,
      _id: { $ne: finderId },
      profile: { $exists: true, $ne: null },
    });

    const finderWithMatches = await Player.findById(finderId);
    const matchCount = (finderWithMatches.matches || []).length;

    // If this player just completed all matches, record completion time
    if (matchCount >= totalOtherPlayers && !finderWithMatches.completedAt) {
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
    });
  } catch (error) {
    console.error("Error confirming match:", error);
    res.status(500).json({ error: "Failed to confirm match" });
  }
});
// Get a new profile to find
router.get(
  "/sessions/:sessionId/player/:playerId/new-profile",
  async (req, res) => {
    try {
      const { sessionId, playerId } = req.params;
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
      console.log(currentPlayer.matches);
      const matchedIds = (currentPlayer.matches || []).map((m) => m._id);
      console.log("Already matched IDs:", matchedIds);

      // Find all other players in the session (excluding self and already matched)
      const availablePlayers = await Player.find({
        sessionId,
        _id: {
          $ne: playerId, // Exclude self
          $nin: matchedIds, // Exclude already matched
        },
        hasProfile: true, // Only players with profiles
      });

      console.log(
        `Found ${availablePlayers.length} potential players to find.`
      );
      console.log(
        "Available players:",
        availablePlayers.map((p) => ({ name: p.name, id: p._id }))
      );

      if (availablePlayers.length === 0) {
        console.log(`No more profiles to find for player ${playerId}`);
        return res.status(404).json({ error: "No more profiles to find" });
      }

      // Random selection
      const randomIndex = Math.floor(Math.random() * availablePlayers.length);
      const playerToFind = availablePlayers[randomIndex];

      if (!playerToFind) {
        console.log(`No player found at randomIndex, potential issue.`);
        return res.status(404).json({ error: "No more profiles to find" });
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
