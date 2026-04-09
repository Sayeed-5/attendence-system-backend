// models/Attendance.js
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    studentName: {
      type: String,
      default: "",
    },
    studentEmail: {
      type: String,
      default: "",
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    location: {
      lat: Number,
      lng: Number,
    },
    deviceId: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["present", "flagged"],
      default: "present",
    },
    score: {
      type: Number,
      default: 100,
    },
    flags: [String],
  },
  { timestamps: true }
);

// Compound index to prevent duplicate attendance
attendanceSchema.index({ studentId: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);