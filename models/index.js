import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    name: String,
    score: { type: Number, default: 0 },
    wrongGuesses: { type: Number, default: 0 },
    peopleWhoKnowYou: { type: Number, default: 0 },
    avatar: String,
    sessionId: String,
    status: {
      type: String,
      enum: ["connected", "disconnected"],
      default: "connected",
    },
    profile: {
      type: mongoose.Schema.Types.Mixed,
    },
    matches: [
      {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: "Player" },
        playerName: { type: String },
        selfieUrl: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    gameEndedAt: { type: Date },
    preserveData: { type: Boolean, default: true },
    hasProfile: { type: Boolean, default: false },
    lastMatchAt: { type: Date },
    timesAssigned: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    capped: false,
  }
);

playerSchema.index({ sessionId: 1, score: -1, lastMatchAt: 1 }); // For Leaderboard
playerSchema.index({ sessionId: 1, timesAssigned: 1 }); // For Profile Assignment
playerSchema.set("collection", "players");

const connectionSchema = new mongoose.Schema({
  sessionId: String,
  timestamp: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, unique: true },
    name: { type: String, required: true },
    maxPlayers: { type: Number, required: true, min: 2, max: 300 },
    status: {
      type: String,
      enum: ["waiting", "playing", "ended"],
      default: "waiting",
    },
    questions: [
      {
        title: { type: String, required: true },
        field: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

export const Player = mongoose.model("Player", playerSchema);
export const Connection = mongoose.model("Connection", connectionSchema);
export const Session = mongoose.model("Session", sessionSchema);
