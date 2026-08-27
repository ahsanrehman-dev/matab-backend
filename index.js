import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";

import adminRoutes from "./routes/adminRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import {
  securityHeaders,
  xssProtection,
  mongoSanitization,
} from "./middleware/security.js";
import {
  globalErrorHandler,
  notFound,
  requestLogger,
} from "./middleware/errorHandler.js";

// ===============================
// 🌍 Load Environment Variables
// ===============================
dotenv.config();

// ===============================
// 🚀 Initialize Express App
// ===============================
const app = express();

// ===============================
// 📁 Resolve __dirname (for ES modules)
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// 🧩 Connect to MongoDB
// ===============================
connectDB();

// ===============================
// 🔒 CORS Configuration
// ===============================
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like Postman / server-to-server)
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/+$/, "");
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      console.warn(`Blocked CORS origin: ${origin}`);
      return callback(new Error(`CORS not allowed for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

// ===============================
// 🛡️ Security Middleware
// ===============================
app.use(securityHeaders);
app.use(xssProtection);
app.use(mongoSanitization);

// ===============================
// 📦 Body Parsing Middleware
// ===============================
const maxFileSize = process.env.MAX_FILE_SIZE || "50mb";
app.use(
  express.json({
    limit: maxFileSize,
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: maxFileSize,
  })
);

// ===============================
// 📝 Request Logging
// ===============================
app.use(requestLogger);

// ===============================
// 🖼️ Static Files (Uploads)
// ===============================
const uploadsDir = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadsDir));

// ===============================
// 🔗 Routes
// ===============================
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/user/orders", orderRoutes);
app.use("/api/user/payments", paymentRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);

// ===============================
// 💓 Health Check Route
// ===============================
app.get("/", (req, res) => {
  res.send("Hello World - Backend is Running! 🚀");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    database:
      mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ===============================
// ❌ Handle Undefined Routes
// ===============================
app.all("*", notFound);

// ===============================
// ⚙️ Global Error Handler (must be last)
// ===============================
app.use(globalErrorHandler);

// ===============================
// 🚀 Start Server
// ===============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔓 Allowed CORS origins: ${allowedOrigins.join(", ")}`);
});
