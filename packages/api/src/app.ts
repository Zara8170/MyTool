import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getEnv } from "./env.js";
import { errorHandler } from "./middleware/error.js";
import { authRoute } from "./routes/auth.js";
import { eventsRoute } from "./routes/events.js";
import { healthRoute } from "./routes/health.js";
import { orgsRoute } from "./routes/orgs.js";
import { projectsRoute } from "./routes/projects.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { syncRoute } from "./routes/sync.js";

export function buildApp() {
  const env = getEnv();
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: [env.WEB_URL],
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      credentials: true,
    }),
  );

  app.onError(errorHandler);

  app.route("/health", healthRoute);
  app.route("/api/auth", authRoute);
  app.route("/api/events", eventsRoute);
  app.route("/api/orgs", orgsRoute);
  app.route("/api/projects", projectsRoute);
  // Dashboard는 /api/projects/:id/dashboard/* 경로에 마운트
  app.route("/api/projects", dashboardRoute);
  app.route("/api/sync", syncRoute);

  return app;
}
