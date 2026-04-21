/**
 * Map Supabase/Postgres snake_case rows ↔ camelCase used by API + route logic.
 */

/**
 * Postgres `timestamp` (no tz) often returns without offset; our API writes UTC via toISOString().
 * Parse as UTC so Node + browsers agree with DB comparisons and local display (e.g. IST).
 */
function normalizeTimestamp(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const t = value.trim();
  if (!t) return null;
  if (/[zZ]$/.test(t)) return new Date(t).toISOString();
  if (/[+-]\d{2}:?\d{2}$/.test(t)) return new Date(t).toISOString();
  const spacer = t.includes("T") ? t : t.replace(" ", "T");
  const asUtc = new Date(`${spacer.endsWith("Z") ? spacer.slice(0, -1) : spacer}Z`);
  if (!Number.isNaN(asUtc.getTime())) return asUtc.toISOString();
  const fallback = new Date(t);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function asArray(jsonbVal) {
  if (Array.isArray(jsonbVal)) return jsonbVal;
  if (jsonbVal == null) return [];
  return [];
}

function locationFromRow(row) {
  if (row.location && typeof row.location === "object") {
    const lat = row.location.lat;
    const lng = row.location.lng ?? row.location.lon;
    const location = { ...row.location };
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      location.lat = Number(lat);
      location.lng = Number(lng);
    }
    if (Object.keys(location).length > 0) return location;
  }
  if (Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
    return { lat: Number(row.latitude), lng: Number(row.longitude) };
  }
  return null;
}

function fromDbUser(row) {
  if (!row) return row;
  const authUserId = row.auth_user_id ?? row.firebase_uid;
  return {
    id: row.id,
    authUserId,
    firebaseUid: authUserId,
    name: row.name,
    email: row.email,
    profilePicture: row.profile_picture ?? "",
    role: row.role,
    regNo: row.reg_no,
    branch: row.branch,
    semester: row.semester,
    mobileNo: row.mobile_no,
    date: row.date,
    dept: row.dept,
    subject: row.subject,
    deviceIds: asArray(row.device_ids),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function fromDbSession(row) {
  if (!row) return row;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    subject: row.subject,
    sessionCode: row.session_code,
    startTime: normalizeTimestamp(row.start_time),
    endTime: normalizeTimestamp(row.end_time),
    timeLimit:
      Number.isFinite(Number(row.time_limit)) && Number(row.time_limit) > 0
        ? Number(row.time_limit)
        : 60,
    location: locationFromRow(row),
    locationLabel: row.location?.label ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    radius: row.radius,
    isActive: row.is_active === true || row.is_active === "true" || row.is_active === "t",
    createdAt: normalizeTimestamp(row.created_at),
  };
}

function fromDbAttendance(row) {
  if (!row) return row;
  return {
    id: row.id,
    studentId: row.student_id,
    sessionId: row.session_id,
    studentName: row.student_name,
    studentEmail: row.student_email,
    timestamp: normalizeTimestamp(row.timestamp),
    location: locationFromRow(row),
    deviceId: row.device_id,
    score: row.score,
    status: row.status,
    flags: asArray(row.flags),
    createdAt: normalizeTimestamp(row.created_at),
  };
}

module.exports = {
  fromDbUser,
  fromDbSession,
  fromDbAttendance,
  locationFromRow,
  normalizeTimestamp,
};
