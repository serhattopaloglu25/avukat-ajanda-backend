import express from 'express';
import { execSync } from 'child_process';

const router = express.Router();

let commitSha = 'unknown';
let buildTime = new Date().toISOString();

try {
  commitSha = execSync('git rev-parse HEAD').toString().trim().substring(0, 8);
} catch (e) {
  // Git not available
}

router.get('/', (req, res) => {
  res.json({
    commitSha,
    buildTime,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

export default router;
