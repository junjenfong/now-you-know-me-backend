import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import connectDB from "./config/database.js";
import { Player } from "./models/index.js";
import routes from "./routes.js";

/* global process */

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  path: "/socket.io/",
  cors: {
    origin: "*", // Adjust for production
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

app.set('io', io);

// Routes
app.use("/api", routes);

// Socket.io connection
io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("joinSession", (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });

  socket.on("playerReady", async ({ playerId, sessionId }) => {
    try {
      await Player.findByIdAndUpdate(playerId, { hasProfile: true });
      const players = await Player.find({ sessionId });
      io.to(sessionId).emit("updatePlayers", players);
    } catch (error) {
      console.error("Error setting player ready:", error);
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
const startServer = async () => {
  await connectDB(); // connectDB already handles its errors
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(console.error);