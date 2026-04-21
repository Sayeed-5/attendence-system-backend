// routes/session.js
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const supabase = require("../supabaseClient");
const { verifyToken } = require("../middleware/auth");
const { fromDbUser, fromDbSession } = require("../supabase/mappers");

const mapSession = (row) => {
  if (!row) return row;
  const session = fromDbSession(row);
  return { ...session, _id: session.id };
};

function getDistance(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function closeExpiredSessions(teacherId = null) {
  const now = new Date().toISOString();

  let query = supabase
    .from("sessions")
    .update({ is_active: false })
    .eq("is_active", true)
    .lt("end_time", now);

  if (teacherId) {
    query = query.eq("teacher_id", teacherId);
  }

  await query;
}

/**
 * POST /api/session/create
 */
router.post("/create", verifyToken, async (req, res) => {
  try {
    let { data: teacherRow, error: teacherError } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    if (teacherError) throw teacherError;

    // Fallback for legacy/admin-created rows: bind by email if auth_user_id is missing/mismatched.
    if (!teacherRow && req.firebaseUser.email) {
      const { data: emailRow, error: emailError } = await supabase
        .from("users")
        .select("*")
        .eq("email", req.firebaseUser.email)
        .maybeSingle();
      if (emailError) throw emailError;
      if (emailRow) {
        teacherRow = emailRow;
        await supabase
          .from("users")
          .update({ auth_user_id: req.firebaseUser.uid })
          .eq("id", emailRow.id);
      }
    }

    const teacher = fromDbUser(teacherRow);
    if (!teacherRow || !teacher || teacher.role !== "teacher") {
      return res.status(403).json({ msg: "Only teachers can create sessions" });
    }

    const { subject, timeLimit } = req.body;

    if (!subject) {
      return res.status(400).json({ msg: "Subject is required" });
    }

    const lat = 20.217426;
    const lng = 85.682104;

    const durationMinutes =
      Number.isFinite(Number(timeLimit)) && Number(timeLimit) > 0
        ? Number(timeLimit)
        : 60;

    await supabase
      .from("sessions")
      .update({ is_active: false, end_time: new Date().toISOString() })
      .eq("teacher_id", teacher.id)
      .eq("is_active", true);

    const sessionCode = uuidv4().slice(0, 8).toUpperCase();
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const { data: sessionRow, error } = await supabase
      .from("sessions")
      .insert([
        {
          teacher_id: teacher.id,
          subject,
          session_code: sessionCode,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          time_limit: durationMinutes,
          location: { lat, lng },
          latitude: lat,
          longitude: lng,
          radius: 100,
          is_active: true,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.json(mapSession(sessionRow));
  } catch (err) {
    console.error("Create session error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/teacher/sessions
 */
router.get("/teacher/sessions", verifyToken, async (req, res) => {
  try {
    let { data: teacherRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    if (!teacherRow && req.firebaseUser.email) {
      const { data: emailRow } = await supabase
        .from("users")
        .select("*")
        .eq("email", req.firebaseUser.email)
        .maybeSingle();
      if (emailRow) {
        teacherRow = emailRow;
        await supabase.from("users").update({ auth_user_id: req.firebaseUser.uid }).eq("id", emailRow.id);
      }
    }

    const teacher = fromDbUser(teacherRow);
    if (!teacher) return res.status(404).json({ msg: "User not found" });

    await closeExpiredSessions(teacher.id);

    const { data: sessionRows, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("teacher_id", teacher.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const sessionsWithStats = await Promise.all(
      (sessionRows || []).map(async (row) => {
        const session = fromDbSession(row);
        const { count } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("session_id", session.id)
          .in("status", ["present", "flagged"]);

        return {
          ...mapSession(row),
          attendees: count || 0,
        };
      })
    );

    res.json(sessionsWithStats);
  } catch (err) {
    console.error("Teacher sessions error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/active
 */
router.get("/active", verifyToken, async (req, res) => {
  try {
    await closeExpiredSessions();

    const nowIso = new Date().toISOString();

    const { data: activeSessionRows, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("is_active", true)
      .lte("start_time", nowIso)
      .gte("end_time", nowIso)
      .order("start_time", { ascending: false })
      .limit(1);

    if (error) throw error;

    const activeSession = activeSessionRows?.[0] ? fromDbSession(activeSessionRows[0]) : null;

    // Time window is already enforced in SQL (start_time <= now <= end_time). A second
    // JS-only check was rejecting valid rows when Postgres `timestamp` vs Date parsing differed.
    if (!activeSession) {
      return res.json(null);
    }

    const { data: teacherData } = await supabase
      .from("users")
      .select("name")
      .eq("id", activeSession.teacherId)
      .maybeSingle();

    const { count: totalMarked } = await supabase
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("session_id", activeSession.id);

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasLocation =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      activeSession.location &&
      Number.isFinite(activeSession.location.lat) &&
      Number.isFinite(activeSession.location.lng);

    let isWithinRadius = null;
    if (hasLocation) {
      const distance = getDistance(
        lat,
        lng,
        activeSession.location.lat,
        activeSession.location.lng
      );
      isWithinRadius = distance <= (activeSession.radius || 100);
    }

    let alreadyMarked = false;
    const { data: currentUserRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    const currentUser = fromDbUser(currentUserRow);
    if (currentUser?.role === "student") {
      const { data: att } = await supabase
        .from("attendance")
        .select("id")
        .eq("student_id", currentUser.id)
        .eq("session_id", activeSession.id)
        .maybeSingle();

      alreadyMarked = !!att;
    }

    res.json({
      _id: activeSession.id,
      sessionId: activeSession.id,
      sessionCode: activeSession.sessionCode,
      teacherName: teacherData?.name || "Teacher",
      subject: activeSession.subject,
      startTime: activeSession.startTime,
      endTime: activeSession.endTime,
      location: activeSession.location,
      radius: activeSession.radius || 100,
      totalMarked: totalMarked || 0,
      isWithinRadius,
      alreadyMarked,
      isActive: true,
    });
  } catch (err) {
    console.error("Active session error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/code/:sessionCode
 */
router.get("/code/:sessionCode", verifyToken, async (req, res) => {
  try {
    const { data: sessionRow, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_code", req.params.sessionCode)
      .maybeSingle();

    if (error) throw error;
    if (!sessionRow) return res.status(404).json({ msg: "Session not found" });

    res.json(mapSession(sessionRow));
  } catch (err) {
    console.error("Code lookup error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/session/:id
 */
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const { data: sessionRow, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!sessionRow) return res.status(404).json({ msg: "Session not found" });

    res.json(mapSession(sessionRow));
  } catch (err) {
    console.error("ID lookup error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * PATCH /api/session/:id/end
 */
router.patch("/:id/end", verifyToken, async (req, res) => {
  try {
    let { data: teacherRow } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    if (!teacherRow && req.firebaseUser.email) {
      const { data: emailRow } = await supabase
        .from("users")
        .select("*")
        .eq("email", req.firebaseUser.email)
        .maybeSingle();
      if (emailRow) {
        teacherRow = emailRow;
        await supabase.from("users").update({ auth_user_id: req.firebaseUser.uid }).eq("id", emailRow.id);
      }
    }

    const teacher = fromDbUser(teacherRow);
    if (!teacherRow || !teacher) {
      return res.status(404).json({ msg: "User not found" });
    }

    const { data: sessionRow } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (!sessionRow) return res.status(404).json({ msg: "Session not found" });

    const session = fromDbSession(sessionRow);
    if (session.teacherId !== teacher.id) {
      return res.status(403).json({ msg: "Not your session" });
    }

    const { error: updateError } = await supabase
      .from("sessions")
      .update({ is_active: false, end_time: new Date().toISOString() })
      .eq("id", session.id);

    if (updateError) throw updateError;
    
    const { data: updatedRow } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", session.id)
      .maybeSingle();

    res.json(mapSession(updatedRow || session));
  } catch (err) {
    console.error("End session error:", err.message);
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
 * ADMIN: GET /api/session/admin/sessions?page=1&limit=100
 */
router.get("/admin/sessions", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = String(req.query.search || "").trim();

    let query = supabase
      .from("sessions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(`subject.ilike.%${search}%,session_code.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data: (data || []).map(mapSession), page, limit, total: count || 0 });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: POST /api/session/admin/sessions
 * Body: { teacherId, subject, timeLimit, radius, isActive }
 */
router.post("/admin/sessions", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { teacherId, subject, timeLimit, radius, isActive, startTime, endTime, locationLabel } = req.body || {};
    if (!teacherId || !subject) return res.status(400).json({ msg: "teacherId and subject are required" });

    const durationMinutes =
      Number.isFinite(Number(timeLimit)) && Number(timeLimit) > 0 ? Number(timeLimit) : 60;
    const startDate = startTime ? new Date(startTime) : new Date();
    const endDate = endTime
      ? new Date(endTime)
      : new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    const sessionCode = uuidv4().slice(0, 8).toUpperCase();
    const resolvedLocation = locationLabel
      ? { label: String(locationLabel).trim() }
      : null;

    const { data: sessionRow, error } = await supabase
      .from("sessions")
      .insert([
        {
          teacher_id: teacherId,
          subject,
          session_code: sessionCode,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          time_limit: durationMinutes,
          radius: Number(radius) > 0 ? Number(radius) : 100,
          is_active: Boolean(isActive),
          location: resolvedLocation,
        },
      ])
      .select()
      .single();
    if (error) throw error;

    res.json(mapSession(sessionRow));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: PATCH /api/session/admin/sessions/:id
 */
router.patch("/admin/sessions/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const body = req.body || {};

    const updateData = {};
    if (body.subject !== undefined) updateData.subject = body.subject;
    if (body.isActive !== undefined) updateData.is_active = Boolean(body.isActive);
    if (body.endTime !== undefined) updateData.end_time = body.endTime;
    if (body.startTime !== undefined) updateData.start_time = body.startTime;
    if (body.timeLimit !== undefined) updateData.time_limit = Number(body.timeLimit) || 60;
    if (body.radius !== undefined) updateData.radius = Number(body.radius) || 100;
    if (body.locationLabel !== undefined) {
      updateData.location = body.locationLabel ? { label: String(body.locationLabel).trim() } : null;
    }

    const { data: row, error } = await supabase
      .from("sessions")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ msg: "Session not found" });

    res.json(mapSession(row));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: DELETE /api/session/admin/sessions/:id
 */
router.delete("/admin/sessions/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});
