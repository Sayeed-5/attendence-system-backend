// routes/attendance.js
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const { verifyToken } = require("../middleware/auth");
const { fromDbUser, fromDbSession, fromDbAttendance } = require("../supabase/mappers");

const mapRecord = (row) => {
  if (!row) return row;
  const r = fromDbAttendance(row);
  return { ...r, _id: r.id };
};

function getDistance(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);

  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getSessionEndTime(session) {
  if (session.endTime) {
    return new Date(session.endTime);
  }

  const durationMinutes =
    Number.isFinite(Number(session.timeLimit)) && Number(session.timeLimit) > 0
      ? Number(session.timeLimit)
      : 60;

  return new Date(new Date(session.startTime).getTime() + durationMinutes * 60 * 1000);
}

function isSessionActiveNow(session, now = new Date()) {
  const startTime = new Date(session.startTime);
  const endTime = getSessionEndTime(session);

  return Boolean(session.isActive) && now >= startTime && now <= endTime;
}

/**
 * POST /api/attendance/mark
 */
router.post("/mark", verifyToken, async (req, res) => {
  try {
    const { sessionId, lat, lng, deviceId } = req.body;

    const { data: studentRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const student = fromDbUser(studentRow);
    if (!student || student.role !== "student") {
      return res.status(403).json({ msg: "Only students can mark attendance" });
    }

    const { data: sessionRow } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    const session = fromDbSession(sessionRow);
    if (!sessionRow || !session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    const now = new Date();
    if (!isSessionActiveNow(session, now)) {
      if (session.isActive && getSessionEndTime(session) < now) {
        await supabase.from("sessions").update({ is_active: false }).eq("id", session.id);
      }

      return res.status(400).json({
        success: false,
        msg: "Session is not active right now",
      });
    }

    const { data: existing } = await supabase
      .from("attendance")
      .select("id")
      .eq("student_id", student.id)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        msg: "Attendance already marked",
      });
    }

    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
      return res.status(400).json({
        success: false,
        msg: "Location is required to mark attendance",
      });
    }

    const distance = getDistance(
      numericLat,
      numericLng,
      session.location.lat,
      session.location.lng
    );
    const allowedRadius = session.radius || 100;
    if (distance > allowedRadius) {
      return res.status(400).json({
        success: false,
        msg: "You are outside the allowed attendance radius",
      });
    }

    const flags = [];
    let score = 100;

    let deviceIds = student.deviceIds || [];

    if (deviceId) {
      const { data: sameDevice } = await supabase
        .from("attendance")
        .select("student_id")
        .eq("session_id", sessionId)
        .eq("device_id", deviceId)
        .maybeSingle();

      if (sameDevice && sameDevice.student_id !== student.id) {
        flags.push("SHARED_DEVICE");
        score -= 40;
      }

      if (!deviceIds.includes(deviceId)) {
        deviceIds.push(deviceId);
        await supabase.from("users").update({ device_ids: deviceIds }).eq("id", student.id);
      }
    }

    const status = score < 70 ? "flagged" : "present";

    const { data: attendanceRow, error } = await supabase
      .from("attendance")
      .insert([
        {
          student_id: student.id,
          session_id: sessionId,
          student_name: student.name,
          student_email: student.email,
          timestamp: now.toISOString(),
          location: { lat: numericLat, lng: numericLng },
          latitude: numericLat,
          longitude: numericLng,
          device_id: deviceId || "",
          score,
          status,
          flags,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      status,
      attendance: mapRecord(attendanceRow),
      message: status === "present" ? "Attendance marked successfully" : "Attendance marked with flags",
    });
  } catch (err) {
    console.error("Mark attendance error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

async function populateStudentRecords(records) {
  if (!records || records.length === 0) return records;

  const studentIds = records.map((r) => r.student_id).filter(Boolean);
  const { data: studentRows } = await supabase
    .from("users")
    .select("id, name, email, reg_no, branch, semester, profile_picture")
    .in("id", studentIds);

  const studentMap = (studentRows || []).reduce((acc, row) => {
    const u = fromDbUser(row);
    acc[u.id] = { ...u, _id: u.id };
    return acc;
  }, {});

  return records.map((record) => ({
    ...mapRecord(record),
    studentId: studentMap[record.student_id] || fromDbAttendance(record).studentId,
  }));
}

router.get("/session/:sessionId", verifyToken, async (req, res) => {
  try {
    const { data: records, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("timestamp", { ascending: true });

    if (error) throw error;

    const populatedRecords = await populateStudentRecords(records);
    res.json(populatedRecords);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/session/:sessionId/roster", verifyToken, async (req, res) => {
  try {
    const { data: teacherRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const teacher = fromDbUser(teacherRow);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(403).json({ msg: "Only teachers can view this roster" });
    }

    const { data: sessionRow } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", req.params.sessionId)
      .maybeSingle();

    const session = fromDbSession(sessionRow);
    if (!sessionRow || !session) {
      return res.status(404).json({ msg: "Session not found" });
    }

    if (session.teacherId !== teacher.id) {
      return res.status(403).json({ msg: "Not your session" });
    }

    const { data: studentRows } = await supabase
      .from("users")
      .select("id, name, email, reg_no, branch, semester, profile_picture")
      .eq("role", "student")
      .order("name", { ascending: true });

    const { data: rawRecords } = await supabase
      .from("attendance")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("timestamp", { ascending: true });

    const populatedRecords = await populateStudentRecords(rawRecords);

    const recordByStudentId = new Map(
      populatedRecords
        .filter((record) => record.studentId?._id)
        .map((record) => [record.studentId._id, record])
    );

    const students = (studentRows || []).map(fromDbUser);
    const absentRecords = students
      .filter((s) => !recordByStudentId.has(s.id))
      .map((s) => ({
        _id: `absent-${req.params.sessionId}-${s.id}`,
        studentId: { ...s, _id: s.id },
        studentName: s.name,
        studentEmail: s.email,
        status: "absent",
        score: 0,
        flags: [],
        synthetic: true,
        timestamp: session.endTime || session.startTime || session.createdAt,
      }));

    const records = [...populatedRecords, ...absentRecords];
    const presentCount = (rawRecords || []).filter((record) => record.status === "present").length;
    const flaggedCount = (rawRecords || []).filter((record) => record.status === "flagged").length;
    const absentCount = absentRecords.length;
    const attendedCount = presentCount + flaggedCount;
    const totalStudents = students.length;
    const attendancePercentage =
      totalStudents === 0 ? 0 : Math.round((attendedCount / totalStudents) * 100);

    res.json({
      records,
      presentCount,
      flaggedCount,
      absentCount,
      attendedCount,
      totalStudents,
      attendancePercentage,
    });
  } catch (err) {
    console.error("Session roster error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/teacher/stats", verifyToken, async (req, res) => {
  try {
    const { data: teacherRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const teacher = fromDbUser(teacherRow);
    if (!teacher) return res.status(404).json({ msg: "User not found" });

    const { count: totalStudents } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "student");

    const { data: sessionRows } = await supabase
      .from("sessions")
      .select("*")
      .eq("teacher_id", teacher.id)
      .order("created_at", { ascending: false });

    const sessions = (sessionRows || []).map(fromDbSession);
    const totalSessions = sessions.length;

    let totalAttendancePercentage = 0;
    const trendData = [];
    const recentSessions = sessions.slice(0, 5).reverse();

    for (const session of recentSessions) {
      const { count: attendees } = await supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session.id)
        .in("status", ["present", "flagged"]);

      const sessionPct =
        totalStudents === 0 ? 0 : Math.round(((attendees || 0) / totalStudents) * 100);

      trendData.push({
        label: `${session.subject.substring(0, 5)} ${new Date(session.createdAt || session.startTime).getDate()}`,
        percentage: sessionPct,
        attendees: attendees || 0,
      });
    }

    if (totalSessions > 0 && totalStudents > 0) {
      const sessionIds = sessions.map((s) => s.id);
      const chunkSize = 200;
      let allAttendees = 0;

      for (let i = 0; i < sessionIds.length; i += chunkSize) {
        const chunk = sessionIds.slice(i, i + chunkSize);
        const { count } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .in("session_id", chunk)
          .in("status", ["present", "flagged"]);
        allAttendees += count || 0;
      }

      const maxPossibleAttendees = totalSessions * totalStudents;
      totalAttendancePercentage = Math.round((allAttendees / maxPossibleAttendees) * 100);
    }

    res.json({
      totalStudents: totalStudents || 0,
      totalSessions,
      overallAvgPercentage: totalAttendancePercentage,
      trendData,
    });
  } catch (err) {
    console.error("Teacher stats error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/student/stats", verifyToken, async (req, res) => {
  try {
    const { data: studentRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const student = fromDbUser(studentRow);
    if (!student) return res.status(404).json({ msg: "User not found" });

    const { count: totalSessions } = await supabase
      .from("sessions")
      .select("*", { count: "exact", head: true });

    const { count: attendedSessions } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .in("status", ["present", "flagged"]);

    const percentage =
      totalSessions === 0 ? 0 : Math.round(((attendedSessions || 0) / totalSessions) * 100);

    const { data: allSessionRows } = await supabase
      .from("sessions")
      .select("id, start_time")
      .order("start_time", { ascending: false });

    const { data: studentAttendanceRows } = await supabase
      .from("attendance")
      .select("session_id")
      .eq("student_id", student.id)
      .in("status", ["present", "flagged"]);

    const attendedSessionIds = new Set(
      (studentAttendanceRows || []).map((att) => att.session_id)
    );

    let streak = 0;
    for (const row of allSessionRows || []) {
      if (attendedSessionIds.has(row.id)) {
        streak += 1;
      } else {
        break;
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const { data: todayAttendance } = await supabase
      .from("attendance")
      .select("id")
      .eq("student_id", student.id)
      .in("status", ["present", "flagged"])
      .gte("timestamp", todayStart.toISOString())
      .lte("timestamp", todayEnd.toISOString())
      .maybeSingle();

    const checkedInToday = !!todayAttendance;

    const now = new Date().toISOString();
    const { count: activeSessionCount } = await supabase
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .lte("start_time", now)
      .gte("end_time", now);

    res.json({
      totalSessions: totalSessions || 0,
      attendedSessions: attendedSessions || 0,
      percentage,
      streak,
      checkedInToday,
      activeSessionCount: activeSessionCount || 0,
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/student/history", verifyToken, async (req, res) => {
  try {
    const { data: studentRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const student = fromDbUser(studentRow);
    if (!student) return res.status(404).json({ msg: "User not found" });

    const { data: attendanceRows } = await supabase
      .from("attendance")
      .select("*")
      .eq("student_id", student.id)
      .order("timestamp", { ascending: false });

    const attendedSessionIds = (attendanceRows || [])
      .map((record) => record.session_id)
      .filter(Boolean);

    const { data: unattendedSessionRows } = await supabase
      .from("sessions")
      .select("*")
      .eq("is_active", false)
      .order("end_time", { ascending: false })
      .limit(200);

    const unattendedSessions = (unattendedSessionRows || [])
      .filter((s) => !attendedSessionIds.includes(s.id))
      .slice(0, 50);

    const sessionIdsToFetch = Array.from(
      new Set([...attendedSessionIds, ...unattendedSessions.map((s) => s.id)])
    );

    let sessionsMap = {};
    if (sessionIdsToFetch.length > 0) {
      const { data: sessionsData } = await supabase
        .from("sessions")
        .select(
          "id, subject, start_time, end_time, session_code, location, radius, teacher_id, is_active, created_at"
        )
        .in("id", sessionIdsToFetch.slice(0, 150));

      const teacherIdsToFetch = Array.from(new Set((sessionsData || []).map((s) => s.teacher_id)));
      let teachersMap = {};
      if (teacherIdsToFetch.length > 0) {
        const { data: teachersData } = await supabase
          .from("users")
          .select("id, name")
          .in("id", teacherIdsToFetch);
        teachersMap = (teachersData || []).reduce((acc, t) => ({ ...acc, [t.id]: t }), {});
      }

      sessionsMap = (sessionsData || []).reduce((acc, row) => {
        const s = fromDbSession(row);
        const teacher = teachersMap[row.teacher_id];
        acc[s.id] = {
          ...s,
          _id: s.id,
          teacherId: teacher
            ? { id: teacher.id, name: teacher.name, _id: teacher.id }
            : s.teacherId,
        };
        return acc;
      }, {});
    }

    const populatedAttendance = (attendanceRows || []).map((record) => ({
      ...mapRecord(record),
      sessionId: sessionsMap[record.session_id] || record.session_id,
    }));

    const absentRecords = unattendedSessions.map((row) => {
      const session = fromDbSession(row);
      return {
        _id: `absent-${session.id}-${student.id}`,
        studentId: student.id,
        sessionId: sessionsMap[session.id] || { ...session, _id: session.id },
        status: "absent",
        timestamp: session.endTime || session.startTime || session.createdAt,
        synthetic: true,
      };
    });

    const records = [...populatedAttendance, ...absentRecords]
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, 50);

    res.json(records);
  } catch (err) {
    console.error("Student history error:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/export/:sessionId", verifyToken, async (req, res) => {
  try {
    const { data: recordsRaw } = await supabase
      .from("attendance")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("timestamp", { ascending: true });

    const records = await populateStudentRecords(recordsRaw);

    const { data: sessionRow } = await supabase
      .from("sessions")
      .select("subject")
      .eq("id", req.params.sessionId)
      .maybeSingle();

    const session = sessionRow ? fromDbSession(sessionRow) : null;

    const headers = "Name,Email,Reg No,Branch,Time,Status,Score,Flags\n";
    const rows = (records || [])
      .map((record) => {
        const stu = record.studentId || {};
        return [
          `"${stu.name || record.studentName || ""}"`,
          `"${stu.email || record.studentEmail || ""}"`,
          `"${stu.regNo || ""}"`,
          `"${stu.branch || ""}"`,
          `"${new Date(record.timestamp).toLocaleString()}"`,
          record.status,
          record.score,
          `"${(record.flags || []).join(", ")}"`,
        ].join(",");
      })
      .join("\n");

    const csv = headers + rows;
    const filename = `attendance_${session ? session.subject : "export"}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error("Export error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

router.get("/count/:sessionId", verifyToken, async (req, res) => {
  try {
    const { count: totalRegistered } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "student");

    const { count: present } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("session_id", req.params.sessionId)
      .eq("status", "present");

    const { count: flagged } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("session_id", req.params.sessionId)
      .eq("status", "flagged");

    const absent = Math.max(0, (totalRegistered || 0) - ((present || 0) + (flagged || 0)));

    res.json({
      total: totalRegistered || 0,
      present: present || 0,
      flagged: flagged || 0,
      absent,
    });
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;

async function requireAdmin(req, res) {
  const { data: me, error } = await supabase
    .from("users")
    .select("id, role")
    .eq("auth_user_id", req.firebaseUser.uid)
    .maybeSingle();
  if (error) {
    res.status(500).json({ msg: "Server error" });
    return null;
  }
  if (!me || me.role !== "admin") {
    res.status(403).json({ msg: "Admin only" });
    return null;
  }
  return me;
}

/**
 * ADMIN: GET /api/attendance/admin/records?page=1&limit=100
 */
router.get("/admin/records", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from("attendance")
      .select("*", { count: "exact" })
      .order("timestamp", { ascending: false })
      .range(from, to);
    if (error) throw error;

    res.json({ data: (data || []).map(mapRecord), page, limit, total: count || 0 });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: POST /api/attendance/admin/records
 * Body: { studentId, sessionId, status, score, adminNote }
 */
router.post("/admin/records", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { studentId, sessionId, status, score } = req.body || {};
    if (!studentId || !sessionId) return res.status(400).json({ msg: "studentId and sessionId are required" });

    const { data: attRow, error } = await supabase
      .from("attendance")
      .insert([
        {
          student_id: studentId,
          session_id: sessionId,
          timestamp: new Date().toISOString(),
          status: status || "present",
          score: Number.isFinite(Number(score)) ? Number(score) : 100,
          flags: [],
        },
      ])
      .select()
      .single();
    if (error) throw error;

    res.json(mapRecord(attRow));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: PATCH /api/attendance/admin/records/:id
 */
router.patch("/admin/records/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const { status, score } = req.body || {};
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (score !== undefined) updateData.score = Number(score);

    const { data: row, error } = await supabase
      .from("attendance")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ msg: "Record not found" });
    res.json(mapRecord(row));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: DELETE /api/attendance/admin/records/:id
 */
router.delete("/admin/records/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const { error } = await supabase.from("attendance").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});
