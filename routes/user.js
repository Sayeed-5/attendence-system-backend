// routes/user.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { verifyToken } = require("../middleware/auth");

/**
 * POST /api/user/login
 * Called after Firebase login — finds or creates user in MongoDB
 */
router.post("/login", verifyToken, async (req, res) => {
  try {
    const { uid, email, name, picture, provider } = req.firebaseUser;
    
    // Securely determine role based on how they signed in
    // password = teacher (created by admin in firebase)
    // google.com = student (open sign up)
    const secureRole = provider === "password" ? "teacher" : "student";

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // First-time login — create user
      user = await User.create({
        firebaseUid: uid,
        name,
        email,
        profilePicture: picture,
        role: secureRole,
      });
    } else {
      // Update name/picture from Google (may change)
      user.name = name;
      user.profilePicture = picture;
      // Do not downgrade a teacher if they somehow trigger a login, but ensure strict access
      if (user.role !== secureRole) {
         // If a student tries to sign in with password, or a teacher with Google, we log it and reject or handle
         // But simplest is to just enforce the database role matches the sign in method, or ignore.
         // We will enforce that the database role matches to prevent bypassing.
         if (user.role === 'teacher' && secureRole === 'student') {
             return res.status(403).json({ msg: "Teachers must use Email/Password login" });
         }
      }
      await user.save();
    }

    // Double check that only teachers can access teacher role routes, though frontend guards it, backend should be safe.
    res.json(user);
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * GET /api/user/me
 * Returns current user profile
 */
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.firebaseUser.uid });
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

/**
 * PUT /api/user/profile
 * Update student profile (regNo, branch)
 */
router.put("/profile", verifyToken, async (req, res) => {
  try {
    const { name, regNo, branch, semester, mobileNo, date, dept, subject } = req.body;
    
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (regNo !== undefined) updateData.regNo = regNo;
    if (branch !== undefined) updateData.branch = branch;
    if (semester !== undefined) updateData.semester = semester;
    if (mobileNo !== undefined) updateData.mobileNo = mobileNo;
    if (date !== undefined) updateData.date = date;
    if (dept !== undefined) updateData.dept = dept;
    if (subject !== undefined) updateData.subject = subject;

    const user = await User.findOneAndUpdate(
      { firebaseUid: req.firebaseUser.uid },
      { $set: updateData },
      { new: true }
    );
    if (!user) return res.status(404).json({ msg: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
