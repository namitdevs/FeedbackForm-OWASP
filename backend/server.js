import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { supabase } from "./src/supabaseClient.js";
import requireAdminKey from "./src/middleware/requireAdminKey.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "thapar.edu";

// CORS configuration
const corsOriginEnv = process.env.CORS_ORIGIN;
let corsOptions = {};
if (corsOriginEnv && corsOriginEnv !== "*") {
  const allowedOrigins = corsOriginEnv.split(",").map((o) => o.trim());
  corsOptions = {
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-key"],
    credentials: true,
  };
} else {
  corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-admin-key"],
  };
}

app.use(cors(corsOptions));
app.use(express.json({ limit: "100kb" }));

// Rate limiter for submissions: 30 requests per 15 minutes per IP
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    error: "Too many feedback submissions from this IP. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check endpoint (for Render / uptime monitors)
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "OWASP PromptWars Feedback API",
    event: process.env.EVENT_NAME || "PromptWars Feedback",
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Submit Feedback Endpoint
app.post("/api/feedback", submitLimiter, async (req, res) => {
  try {
    const { name, roll, email, rating, feedback } = req.body;

    // Validation
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required." });
    }

    if (!roll || typeof roll !== "string" || !roll.trim()) {
      return res.status(400).json({ error: "Roll number is required." });
    }

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Email is required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = new RegExp(
      `^[a-zA-Z0-9._%+-]+@${ALLOWED_DOMAIN.replace(".", "\\.")}$`
    );

    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({
        error: `Invalid email. Must be a valid @${ALLOWED_DOMAIN} email address.`,
      });
    }

    const parsedRating = Number(rating);
    if (!parsedRating || isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) {
      return res
        .status(400)
        .json({ error: "Rating must be an integer between 1 and 10." });
    }

    const cleanedFeedback = feedback && typeof feedback === "string" ? feedback.trim() : "";

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        error: "Database credentials not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
      });
    }

    // Insert into Supabase
    const { data, error } = await supabase
      .from("feedback")
      .insert([
        {
          name: name.trim(),
          roll_number: roll.trim(),
          email: trimmedEmail,
          rating: parsedRating,
          feedback: cleanedFeedback,
        },
      ])
      .select("id, created_at")
      .single();

    if (error) {
      // Handle Unique constraint on email
      if (error.code === "23505" || error.message.includes("unique") || error.message.includes("duplicate")) {
        return res.status(409).json({
          error: "Feedback has already been submitted for this email address.",
        });
      }

      console.error("[DB ERROR] Insert feedback error:", error);
      return res.status(500).json({
        error: "Failed to store feedback in database. Please try again.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully.",
      ref: data.id,
      created_at: data.created_at,
    });
  } catch (err) {
    console.error("[SERVER ERROR] Submit feedback:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// Admin: Get all feedback entries
app.get("/api/feedback", requireAdminKey, async (req, res) => {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        error: "Database credentials not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
      });
    }

    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[DB ERROR] Fetch feedbacks:", error);
      return res.status(500).json({ error: "Failed to retrieve feedback." });
    }

    return res.json({
      success: true,
      count: data.length,
      data: data,
    });
  } catch (err) {
    console.error("[SERVER ERROR] Fetch feedback:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// Admin: Get aggregate feedback summary
app.get("/api/feedback/summary", requireAdminKey, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("feedback")
      .select("rating, feedback, created_at");

    if (error) {
      console.error("[DB ERROR] Fetch summary:", error);
      return res.status(500).json({ error: "Failed to retrieve summary." });
    }

    const total = data.length;
    const avgRating =
      total > 0
        ? (data.reduce((sum, item) => sum + (item.rating || 0), 0) / total).toFixed(1)
        : null;

    return res.json({
      success: true,
      total,
      avgRating,
      feedbacks: data,
    });
  } catch (err) {
    console.error("[SERVER ERROR] Fetch summary:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[SERVER] Backend is running on port ${PORT}`);
  console.log(`[CONFIG] Allowed Email Domain: @${ALLOWED_DOMAIN}`);
});
