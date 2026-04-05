import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { familiesRouter } from "./families";
import { guestRouter } from "./guest";
import { householdsRouter } from "./households";
import { personsRouter } from "./persons";

export const router = Router();

router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/families", requireAuth, familiesRouter);
router.use("/api/v1/households", requireAuth, householdsRouter);
router.use("/api/v1/persons", requireAuth, personsRouter);
