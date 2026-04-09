// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    regNo: {
      type: String,
      default: "",
    },
    branch: {
      type: String,
      default: "",
    },
    semester: {
      type: String,
      default: "",
    },
    mobileNo: {
      type: String,
      default: "",
    },
    date: {
      type: String,
      default: "",
    },
    dept: {
      type: String,
      default: "",
    },
    subject: {
      type: String,
      default: "",
    },
    role: {
      type: String,
      enum: ["student", "teacher"],
      default: "student",
    },
    profilePicture: {
      type: String,
      default: "",
    },
    deviceIds: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);