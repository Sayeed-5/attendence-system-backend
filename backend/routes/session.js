// routes/session.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const Session = require("../models/Session");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const { verifyToken } = require("../middleware/auth");

/**
 * POST /api/session/create
 * Teacher creates a new attendance session
 */
router.post("/create", verifyToken, async (req, res) => {
  try {
    // Verify user is a teacher
    const teacher = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!teacher || teacher.role !== "teacher") {
      return res.status(403).json({ msg: "Only teachers can create sessions" });
    }

    const { subject } = req.body;

    if (!subject) {
      return res.status(400).json({ msg: "Subject is required" });
    }

    // Force strict hardcoded college location
    const lat = 20.217426;
    const lng = 85.682104;

    // Generate unique session code (short, 8 chars)
    const sessionCode = uuidv4().slice(0, 8).toUpperCase();

    const startTime = new Date();

    // Generate QR code as base64 data URL
    const qrData = JSON.stringify({ sessionCode });
    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: "#1e1b4b", light: "#ffffff" },
    });

    const session = await Session.create({
      teacherId: teacher._id,
      subject,
      sessionCode,
      startTime,
      qrCode,
      location: { lat, lng },
      radius: 50,
      isActive: true,
    });

    res.json(session);
  } catch (err) {
    console.error("Create session error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/teacher/sessions
 * Get all sessions created by the logged-in teacher
 */
router.get("/teacher/sessions", verifyToken, async (req, res) => {
  try {
    const teacher = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!teacher) return res.status(404).json({ msg: "User not found" });

    const sessions = await Session.find({ teacherId: teacher._id })
      .sort({ createdAt: -1 })
      .lean();

    // Fetch attendance count for each session
    const sessionsWithStats = await Promise.all(sessions.map(async (session) => {
      const attendees = await Attendance.countDocuments({ sessionId: session._id, status: { $in: ["present", "flagged"] } });
      return {
        ...session,
        attendees
      };
    }));

    res.json(sessionsWithStats);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/code/:sessionCode
 * Get session by its short code (used after QR scan)
 */
router.get("/code/:sessionCode", verifyToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      sessionCode: req.params.sessionCode,
    });
    if (!session) return res.status(404).json({ msg: "Session not found" });

    // Session auto-close logic removed - managed manually now
    
    res.json(session);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/:id
 * Get session by MongoDB ID
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ msg: "Session not found" });
    res.json(session);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * PATCH /api/session/:id/end
 * Teacher manually ends a session
 */
router.patch("/:id/end", verifyToken, async (req, res) => {
  try {
    const teacher = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    const session = await Session.findById(req.params.id);

    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.teacherId.toString() !== teacher._id.toString()) {
      return res.status(403).json({ msg: "Not your session" });
    }

    session.isActive = false;
    session.endTime = new Date(); // Using endTime to mark when session actually ended
    await session.save();

    res.json(session);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * PATCH /api/session/:id/refresh-qr
 * Refresh the session QR code and sessionCode
 */
router.patch("/:id/refresh-qr", verifyToken, async (req, res) => {
  try {
    const teacher = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    const session = await Session.findById(req.params.id);

    if (!session) return res.status(404).json({ msg: "Session not found" });
    if (session.teacherId.toString() !== teacher._id.toString()) {
      return res.status(403).json({ msg: "Not your session" });
    }
    if (!session.isActive) {
      return res.status(400).json({ msg: "Session is already ended" });
    }

    // Generate new session code
    const sessionCode = uuidv4().slice(0, 8).toUpperCase();
    
    const qrData = JSON.stringify({ sessionCode });
    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: "#1e1b4b", light: "#ffffff" },
    });

    session.sessionCode = sessionCode;
    session.qrCode = qrCode;
    await session.save();

    res.json(session);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;