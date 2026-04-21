const supabase = require("../supabaseClient");
const { fromDbUser } = require("../supabase/mappers");

let usersSoftDeleteSupported = null;

async function ensureUsersSoftDeleteSupport() {
  if (usersSoftDeleteSupported !== null) return usersSoftDeleteSupported;

  const { error } = await supabase
    .from("users")
    .select("id")
    .eq("is_deleted", false)
    .limit(1);

  usersSoftDeleteSupported = !error || !String(error.message || "").includes("is_deleted");
  return usersSoftDeleteSupported;
}

function withActiveUsersFilter(query) {
  if (usersSoftDeleteSupported === true) return query.eq("is_deleted", false);
  return query;
}

async function resolveCurrentUser(req, res, next) {
  try {
    const authUserId = req.firebaseUser?.uid;
    if (!authUserId) {
      return res.status(401).json({ msg: "Unauthorized" });
    }

    await ensureUsersSoftDeleteSupport();

    const { data: userRow, error } = await withActiveUsersFilter(
      supabase.from("users").select("*").eq("auth_user_id", authUserId)
    ).maybeSingle();

    if (error) throw error;
    if (!userRow) return res.status(401).json({ msg: "User account not found" });

    req.currentUser = fromDbUser(userRow);
    next();
  } catch (err) {
    console.error("Resolve current user error:", err.message);
    return res.status(500).json({ msg: "Server error" });
  }
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return async (req, res, next) => {
    await resolveCurrentUser(req, res, async () => {
      if (!req.currentUser || !allowedRoles.includes(req.currentUser.role)) {
        return res.status(403).json({ msg: "Forbidden" });
      }
      next();
    });
  };
}

module.exports = {
  resolveCurrentUser,
  requireRole,
};
