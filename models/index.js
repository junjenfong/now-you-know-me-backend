import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    socketId: String,
    name: String,
    score: { type: Number, default: 0 },
    avatar: String,
    sessionId: String,
    status: {
      type: String,
      enum: ["connected", "disconnected"],
      default: "connected",
    },
    profile: {
      favoriteFood: { type: String, default: "" },
      hobby: { type: String, default: "" },
      favoriteColor: { type: String, default: "" },
      favoriteArtist: { type: String, default: "" },
      idol: { type: String, default: "" },
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
  },
  {
    timestamps: true,
    capped: false,
  }
);

playerSchema.index({ sessionId: 1 });
playerSchema.set("collection", "players");

const connectionSchema = new mongoose.Schema({
  sessionId: String,
  timestamp: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, unique: true },
    name: { type: String, required: true },
    maxPlayers: { type: Number, required: true, min: 2, max: 50 },
    status: {
      type: String,
      enum: ["waiting", "playing", "ended"],
      default: "waiting",
    },
  },
  { timestamps: true }
);

export const Player = mongoose.model("Player", playerSchema);
export const Connection = mongoose.model("Connection", connectionSchema);
export const Session = mongoose.model("Session", sessionSchema);
