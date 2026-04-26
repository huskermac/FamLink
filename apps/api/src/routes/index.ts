import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { familiesRouter } from "./families";
import { guestRouter } from "./guest";
import { householdsRouter } from "./households";
import { calendarRouter } from "./calendar";
import { familyEventsRouter, eventsRouter } from "./events";
import {
  familyRelationshipsRouter,
  personRelationshipsRouter,
  relationshipsRouter
} from "./relationships";
import { personsRouter } from "./persons";
import { aiRouter } from "./ai";
import { photosRouter } from "./photos";

export const router = Router();

router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/families", requireAuth, familiesRouter);
router.use("/api/v1/families", requireAuth, familyRelationshipsRouter);
router.use("/api/v1/families", requireAuth, familyEventsRouter);
router.use("/api/v1/families", requireAuth, calendarRouter);
router.use("/api/v1/households", requireAuth, householdsRouter);
router.use("/api/v1/persons", requireAuth, personRelationshipsRouter);
router.use("/api/v1/persons", requireAuth, personsRouter);
router.use("/api/v1/relationships", requireAuth, relationshipsRouter);
router.use("/api/v1/events", requireAuth, eventsRouter);
router.use("/api/v1/ai", requireAuth, aiRouter);
router.use("/api/v1/photos", requireAuth, photosRouter);
