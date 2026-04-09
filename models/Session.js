// models/Session.js
const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
    },
    sessionCode: {
      type: String,
      unique: true,
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    timeLimit: {
      type: Number,
    },
    qrCode: {
      type: String, // base64 data URL
    },
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    radius: {
      type: Number,
      default: 120, // meters
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);