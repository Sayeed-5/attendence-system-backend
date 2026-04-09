// routes/attendance.js
const express = require("express");
const router = express.Router();
const Attendance = require("../models/Attendance");
const Session = require("../models/Session");
const User = require("../models/User");
const { verifyToken } = require("../middleware/auth");

/**
 * Haversine formula — returns distance in meters
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * POST /api/attendance/mark
 * Student marks attendance for a session
 */
router.post("/mark", verifyToken, async (req, res) => {
  try {
    const { sessionId, lat, lng, deviceId } = req.body;

    // Get the student from Firebase auth
    const student = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!student || student.role !== "student") {
      return res.status(403).json({ msg: "Only students can mark attendance" });
    }

    // Get the session
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    // Check if session is active
    if (!session.isActive) {
      return res.status(400).json({ msg: "Session is no longer active" });
    }

    // Check for duplicate
    const existing = await Attendance.findOne({
      studentId: student._id,
      sessionId,
    });
    if (existing) {
      return res.status(400).json({ msg: "Attendance already marked" });
    }

    let flags = [];
    let score = 100;
    const now = new Date();

    // Time check removed since sessions do not have a set timer

    // Distance check — is the student within the allowed radius?
    if (lat != null && lng != null) {
      const distance = getDistance(
        lat,
        lng,
        session.location.lat,
        session.location.lng
      );

      if (distance > session.radius) {
        return res.status(400).json({ msg: "You are outside the college campus and cannot mark attendance." });
      }
    } else {
      return res.status(400).json({ msg: "Location is required to mark attendance." });
    }

    // Track device ID — flag if a device has been used by another student in this session
    if (deviceId) {
      const sameDevice = await Attendance.findOne({ sessionId, deviceId });
      if (sameDevice && sameDevice.studentId.toString() !== student._id.toString()) {
        flags.push("SHARED_DEVICE");
        score -= 40; // Reduced score by 40 to ensure it falls below 70 and gets properly flagged
      }

      // Store device ID for future checks
      if (!student.deviceIds.includes(deviceId)) {
        student.deviceIds.push(deviceId);
        await student.save();
      }
    }

    const status = score < 70 ? "flagged" : "present";

    const attendance = await Attendance.create({
      studentId: student._id,
      sessionId,
      studentName: student.name,
      studentEmail: student.email,
      timestamp: now,
      location: { lat, lng },
      deviceId: deviceId || "",
      score,
      status,
      flags,
    });

    res.json({
      success: true,
      attendance,
      message:
        status === "present"
          ? "✅ Attendance marked successfully!"
          : "⚠️ Attendance marked with flags",
    });
  } catch (err) {
    console.error("Mark attendance error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/session/:sessionId
 * Get all attendance records for a session (teacher dashboard)
 */
router.get("/session/:sessionId", verifyToken, async (req, res) => {
  try {
    const records = await Attendance.find({ sessionId: req.params.sessionId })
      .populate("studentId", "name email regNo branch semester profilePicture")
      .sort({ timestamp: 1 })
      .lean();

    res.json(records);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/teacher/stats
 * Get analytics for the logged-in teacher
 */
router.get("/teacher/stats", verifyToken, async (req, res) => {
  try {
    const teacher = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!teacher) return res.status(404).json({ msg: "User not found" });

    // Total students in system
    const totalStudents = await User.countDocuments({ role: "student" });

    // Total sessions by this teacher
    const sessions = await Session.find({ teacherId: teacher._id }).sort({ createdAt: -1 });
    const totalSessions = sessions.length;

    let totalAttendancePercentage = 0;
    const trendData = [];

    // Analyze the recent 5 sessions for trends
    const recentSessions = sessions.slice(0, 5).reverse();

    for (const session of recentSessions) {
      const attendees = await Attendance.countDocuments({ 
        sessionId: session._id,
        status: { $in: ["present", "flagged"] }
      });
      
      const sessionPct = totalStudents === 0 ? 0 : Math.round((attendees / totalStudents) * 100);
      
      trendData.push({
        label: session.subject.substring(0, 5) + " " + new Date(session.createdAt).getDate(),
        percentage: sessionPct,
        attendees
      });
    }

    // Calculate overall average based on ALL sessions
    if (totalSessions > 0 && totalStudents > 0) {
        const allAttendees = await Attendance.countDocuments({
            sessionId: { $in: sessions.map(s => s._id) },
            status: { $in: ["present", "flagged"] }
        });
        const maxPossibleAttendees = totalSessions * totalStudents;
        totalAttendancePercentage = Math.round((allAttendees / maxPossibleAttendees) * 100);
    }

    res.json({
      totalStudents,
      totalSessions,
      overallAvgPercentage: totalAttendancePercentage,
      trendData
    });
  } catch (err) {
    console.error("Teacher stats error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/student/stats
 * Get attendance statistics for the logged-in student
 */
router.get("/student/stats", verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!student) return res.status(404).json({ msg: "User not found" });

    const totalSessions = await Session.countDocuments({});
    
    const attendedSessions = await Attendance.countDocuments({
      studentId: student._id,
      status: { $in: ["present", "flagged"] }
    });

    const percentage = totalSessions === 0 ? 0 : Math.round((attendedSessions / totalSessions) * 100);

    // Calculate streak — consecutive sessions attended (most recent first)
    const allSessions = await Session.find({}).sort({ startTime: -1 }).lean();
    const studentAttendance = await Attendance.find({
      studentId: student._id,
      status: { $in: ["present", "flagged"] }
    }).lean();

    const attendedSessionIds = new Set(studentAttendance.map(a => a.sessionId.toString()));

    let streak = 0;
    for (const session of allSessions) {
      if (attendedSessionIds.has(session._id.toString())) {
        streak++;
      } else {
        break;
      }
    }

    // Check if student attended today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayAttendance = await Attendance.findOne({
      studentId: student._id,
      timestamp: { $gte: todayStart, $lte: todayEnd },
      status: { $in: ["present", "flagged"] }
    }).lean();

    const checkedInToday = !!todayAttendance;

    // Find active sessions right now
    const activeSessions = await Session.find({ isActive: true }).lean();

    res.json({ 
      totalSessions, 
      attendedSessions, 
      percentage, 
      streak,
      checkedInToday,
      activeSessionCount: activeSessions.length
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/student/history
 * Get attendance history for the logged-in student
 */
router.get("/student/history", verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!student) return res.status(404).json({ msg: "User not found" });

    const records = await Attendance.find({ studentId: student._id })
      .populate("sessionId", "subject startTime endTime sessionCode")
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    res.json(records);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/export/:sessionId
 * Export CSV of attendance for a session
 */
router.get("/export/:sessionId", verifyToken, async (req, res) => {
  try {
    const records = await Attendance.find({ sessionId: req.params.sessionId })
      .populate("studentId", "name email regNo branch")
      .sort({ timestamp: 1 })
      .lean();

    const session = await Session.findById(req.params.sessionId);

    // Build CSV manually (simple approach, no library dependency issues)
    const headers = "Name,Email,Reg No,Branch,Time,Status,Score,Flags\n";
    const rows = records
      .map((r) => {
        const student = r.studentId || {};
        return [
          `"${student.name || r.studentName || ""}"`,
          `"${student.email || r.studentEmail || ""}"`,
          `"${student.regNo || ""}"`,
          `"${student.branch || ""}"`,
          `"${new Date(r.timestamp).toLocaleString()}"`,
          r.status,
          r.score,
          `"${(r.flags || []).join(", ")}"`,
        ].join(",");
      })
      .join("\n");

    const csv = headers + rows;
    const filename = `attendance_${session ? session.subject : "export"}_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("Export error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/attendance/count/:sessionId
 * Get live attendance count for a session (polling)
 */
router.get("/count/:sessionId", verifyToken, async (req, res) => {
  try {
    const totalRegistered = await User.countDocuments({ role: "student" });
    const present = await Attendance.countDocuments({
      sessionId: req.params.sessionId,
      status: "present",
    });
    const flagged = await Attendance.countDocuments({
      sessionId: req.params.sessionId,
      status: "flagged",
    });

    const absent = Math.max(0, totalRegistered - (present + flagged));

    res.json({ total: totalRegistered, present, flagged, absent });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;