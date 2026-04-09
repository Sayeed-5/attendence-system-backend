const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (uses Application Default Credentials or service account)
// For now we use the project ID directly — in production, use a service account JSON
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "attendance-system-6c1d1",
  });
}

/**
 * Auth middleware — verifies Firebase ID token from Authorization header
 * Attaches decoded user info to req.firebaseUser
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "No token provided" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.email,
      picture: decoded.picture || "",
      provider: decoded.firebase?.sign_in_provider || "unknown",
    };
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
};

module.exports = { verifyToken };
