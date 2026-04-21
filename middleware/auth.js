const supabaseAdmin = require("../supabaseAdminClient");

/**
 * Auth middleware — verifies Supabase access token from Authorization header.
 * Keeps req.firebaseUser key for backward compatibility with existing routes.
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "No token provided" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ msg: "Invalid or expired token" });
    }

    const authUser = data.user;
    const provider = authUser.app_metadata?.provider || "unknown";
    req.firebaseUser = {
      uid: authUser.id,
      email: authUser.email,
      name:
        authUser.user_metadata?.name ||
        authUser.user_metadata?.full_name ||
        authUser.email,
      picture:
        authUser.user_metadata?.avatar_url ||
        authUser.user_metadata?.picture ||
        "",
      provider,
    };
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
};

module.exports = { verifyToken };
