import cors from "cors";
import * as dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import connectDB from "./config/database.js";
import routes from "./routes.js";

/* global process */

dotenv.config();

const app = express();
const server = createServer(app);

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

// Start server
const PORT = process.env.PORT || 3001;
const startServer = async () => {
  await connectDB(); // connectDB already handles its errors
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(console.error);
