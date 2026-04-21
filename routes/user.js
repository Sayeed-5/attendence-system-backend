// routes/user.js
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const supabaseAdmin = require("../supabaseAdminClient");
const { verifyToken } = require("../middleware/auth");
const { fromDbUser } = require("../supabase/mappers");

const mapUser = (row) => {
  if (!row) return row;
  const user = fromDbUser(row);
  return { ...user, _id: user.id };
};

/**
 * POST /api/user/login
 * Called after Supabase auth login — finds or creates app user in Supabase DB
 */
router.post("/login", verifyToken, async (req, res) => {
  try {
    const { uid, email, name, picture, provider } = req.firebaseUser;

    let { data: row, error: findError } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", uid)
      .maybeSingle();

    if (findError) throw findError;

    // Support pre-defined teacher accounts by matching email first, then binding auth uid.
    if (!row && email) {
      const { data: emailRow, error: emailError } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .maybeSingle();
      if (emailError) throw emailError;
      if (emailRow) {
        row = emailRow;
      }
    }

    if (!row) {
      const { data: newRow, error: createError } = await supabase
        .from("users")
        .insert([
          {
            auth_user_id: uid,
            name: name || email,
            email,
            profile_picture: picture || "",
            // New users default to student; teacher should be pre-defined by admin.
            role: "student",
          },
        ])
        .select()
        .single();

      if (createError) throw createError;
      row = newRow;
    } else {
      const user = fromDbUser(row);
      const updates = {};

      if (!user.authUserId || user.authUserId !== uid) {
        updates.auth_user_id = uid;
      }

      if (!user.name && name) {
        updates.name = name;
      }
      if ((!user.profilePicture || provider === "google") && picture) {
        updates.profile_picture = picture;
      }

      if (user.role === "teacher" && provider !== "email") {
        return res.status(403).json({ msg: "Teachers must use Email/Password login" });
      }

      if (Object.keys(updates).length > 0) {
        const { data: updatedRow, error: updateError } = await supabase
          .from("users")
          .update(updates)
          .eq("id", user.id)
          .select()
          .single();

        if (!updateError && updatedRow) {
          row = updatedRow;
        }
      }
    }

    res.json(mapUser(row));
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/user/me
 */
router.get("/me", verifyToken, async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", req.firebaseUser.uid)
      .maybeSingle();

    if (error) throw error;
    if (!row) return res.status(404).json({ msg: "User not found" });
    res.json(mapUser(row));
  } catch (err) {
    console.error("Get user error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * PUT /api/user/profile
 */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    const { name, regNo, branch, semester, mobileNo, date, dept, subject } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (regNo !== undefined) updateData.reg_no = regNo;
    if (branch !== undefined) updateData.branch = branch;
    if (semester !== undefined) updateData.semester = semester;
    if (mobileNo !== undefined) updateData.mobile_no = mobileNo;
    if (date !== undefined) updateData.date = date;
    if (dept !== undefined) updateData.dept = dept;
    if (subject !== undefined) updateData.subject = subject;

    const { data: row, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("auth_user_id", req.firebaseUser.uid)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!row) return res.status(404).json({ msg: "User not found" });
    res.json(mapUser(row));
  } catch (err) {
    console.error("Update profile error:", err.message);
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
 * ADMIN: GET /api/user/admin/users?role=student&page=1&limit=100
 */
router.get("/admin/users", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const role = req.query.role ? String(req.query.role) : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase.from("users").select("*", { count: "exact" });
    if (role) query = query.eq("role", role);

    const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);
    if (error) throw error;

    res.json({ data: (data || []).map(mapUser), page, limit, total: count || 0 });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: POST /api/user/admin/users
 * Body: { name, email, password, role, ...profileFields }
 */
router.post("/admin/users", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const {
      name,
      email,
      password,
      role = "student",
      regNo,
      branch,
      semester,
      mobileNo,
      dept,
      subject,
      date,
      profilePicture,
    } = req.body || {};

    if (!email || !password) return res.status(400).json({ msg: "Email and password are required" });
    if (!["student", "teacher", "admin"].includes(role)) return res.status(400).json({ msg: "Invalid role" });

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || email },
    });
    if (createError) throw createError;

    const authUserId = created?.user?.id;
    if (!authUserId) return res.status(500).json({ msg: "Failed to create auth user" });

    const insertRow = {
      auth_user_id: authUserId,
      name: name || email,
      email,
      role,
      profile_picture: profilePicture || "",
      reg_no: regNo,
      branch,
      semester,
      mobile_no: mobileNo,
      dept,
      subject,
      date,
    };

    const { data: row, error } = await supabase.from("users").insert([insertRow]).select("*").single();
    if (error) throw error;
    res.json(mapUser(row));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: PATCH /api/user/admin/users/:id
 */
router.patch("/admin/users/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const body = req.body || {};

    const updateData = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.regNo !== undefined) updateData.reg_no = body.regNo;
    if (body.branch !== undefined) updateData.branch = body.branch;
    if (body.semester !== undefined) updateData.semester = body.semester;
    if (body.mobileNo !== undefined) updateData.mobile_no = body.mobileNo;
    if (body.dept !== undefined) updateData.dept = body.dept;
    if (body.subject !== undefined) updateData.subject = body.subject;
    if (body.date !== undefined) updateData.date = body.date;

    const { data: row, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ msg: "User not found" });
    res.json(mapUser(row));
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});

/**
 * ADMIN: DELETE /api/user/admin/users/:id
 */
router.delete("/admin/users/:id", verifyToken, async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const id = req.params.id;
    const { data: row } = await supabase.from("users").select("auth_user_id").eq("id", id).maybeSingle();

    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw error;

    if (row?.auth_user_id) {
      // Supabase admin deleteUser expects a UUID. Some legacy rows may have null/invalid values.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(row.auth_user_id)
      );
      if (isUuid) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(row.auth_user_id);
        } catch (e) {
          // DB row is already deleted; don't fail the whole request for auth cleanup issues.
          console.warn("Auth user cleanup failed:", e?.message || e);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ msg: err.message || "Server error" });
  }
});
