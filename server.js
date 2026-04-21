const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.set("etag", false);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Routes
const sessionRoutes = require("./routes/session");
const attendanceRoutes = require("./routes/attendance");
const userRoutes = require("./routes/user");

app.use("/api/session", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/user", userRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log("✅ Connected to Supabase");
  console.log(`🚀 Server running on port ${PORT}`);
});

// Keep a strong reference to the server in case runtime/tooling unrefs it.
if (typeof server.ref === "function") {
  server.ref();
}

server.on("error", (err) => {
  console.error("❌ HTTP server error:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
});
