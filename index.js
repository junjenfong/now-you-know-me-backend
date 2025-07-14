import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import * as dotenv from "dotenv";
import connectDB from "./config/database.js";
import routes from "./routes.js";
import {
  handleJoinGame,
  handleDisconnect,
  handleEndGame,
  handleStartGame,
  handleUpdateProfile,
  handleGetNewProfile,
  handleConfirmMatch,
  getSessionId,
} from "./socketHandlers.js";

/* global process */

dotenv.config();

const app = express();
const server = createServer(app);

// Socket.IO setup
// const io = new Server(server, {
//   cors: {
//     origin: process.env.CLIENT_URL || "http://localhost:5173",
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
// });

// Middleware
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true,
  })
);
app.use(express.json());

// app.set('io', io);

// Routes
app.use("/api", routes);

// Socket handlers
// io.on("connection", (socket) => {
//   console.log("Client connected:", socket.id);

//   socket.on("joinGame", (data) => handleJoinGame(io, socket, data));
//   socket.on("disconnect", () => handleDisconnect(io, socket));
//   socket.on("endGame", (data) => handleEndGame(io, socket, data));
//   socket.on("startGame", (data) => handleStartGame(io, socket, data));
//   socket.on("updateProfile", (data) => handleUpdateProfile(io, socket, data));
//   socket.on("getNewProfileToFind", (data) => {
//     const sessionId = getSessionId(socket);
//     if (sessionId) {
//       handleGetNewProfile(io, socket, { sessionId });
//     } else {
//       socket.emit("error", {
//         message: "Session not found. Please rejoin the game.",
//       });
//     }
//   });
//   socket.on("confirmMatch", (data) => handleConfirmMatch(io, socket, data));
// });

// Start server
const PORT = process.env.PORT || 3001;
const startServer = async () => {
  await connectDB(); // connectDB already handles its errors
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(console.error);
