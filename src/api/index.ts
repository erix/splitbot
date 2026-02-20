import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Splitbot API" });
});

// GET /groups/:id/balances - Get group balances
app.get("/groups/:id/balances", (req, res) => {
  res.status(501).json({
    error: "Not Implemented",
    message: "REST API not yet implemented. Use the Telegram bot instead.",
    endpoint: `GET /groups/${req.params.id}/balances`,
  });
});

// POST /groups/:id/expenses - Create an expense
app.post("/groups/:id/expenses", (req, res) => {
  res.status(501).json({
    error: "Not Implemented",
    message: "REST API not yet implemented. Use the Telegram bot instead.",
    endpoint: `POST /groups/${req.params.id}/expenses`,
  });
});

// POST /groups/:id/settlements - Record a settlement
app.post("/groups/:id/settlements", (req, res) => {
  res.status(501).json({
    error: "Not Implemented",
    message: "REST API not yet implemented. Use the Telegram bot instead.",
    endpoint: `POST /groups/${req.params.id}/settlements`,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: "Endpoint not found. This is a stub API.",
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Splitbot API stub running on http://localhost:${PORT}`);
  console.log("⚠️  All endpoints return 501 Not Implemented");
});
