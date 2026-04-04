import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { guestRouter } from "./guest";
import { personsRouter } from "./persons";

export const router = Router();

router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/persons", requireAuth, personsRouter);
