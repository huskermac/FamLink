import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";

export const personsRouter = Router();

personsRouter.get("/me", requireAuth, (req, res) => {
  res.json({ userId: (req as AuthedRequest).userId });
});
