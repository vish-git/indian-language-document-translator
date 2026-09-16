import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import translationRouter from "./routes/translation.js";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 8000;
const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: FRONTEND_URL,
  })
);

app.use(
  express.json({
    limit: "2mb",
  })
);

/*
 * Health check
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "translation-backend",
  });
});

/*
 * Translation routes
 */
app.use("/api/translate", translationRouter);

/*
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

/*
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  res.status(500).json({
    error: "Internal server error",
  });
});

/*
 * Start server
 */
app.listen(PORT, () => {
  console.log(
    `Translation backend running at http://localhost:${PORT}`
  );
});