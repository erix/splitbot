import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import apiRouter from "./index.js";

const app = express();
const PORT = 3000;

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const publicDir = path.resolve(currentDir, "../../public");

app.use(express.json());
app.use("/api", apiRouter);
app.use(express.static(publicDir));

app.get(["/", "/dashboard"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`💸 Splitbot dashboard running on http://localhost:${PORT}`);
});
