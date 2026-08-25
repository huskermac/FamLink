import { Router } from "express";
import { requireAuth, requirePerson } from "../middleware/requireAuth";
import { consentRouter } from "./consent";
import { familiesRouter } from "./families";
import { guestRouter } from "./guest";
import { householdsRouter } from "./households";
import { linkRequestsRouter } from "./linkRequests";
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
import { billingRouter } from "./billing";

export const router = Router();

router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/consent", consentRouter);
// families/persons/relationships routers resolve Person themselves: family
// creation has an onboarding-specific error, person creation must work
// without a Person, and requirePerson on a shared path prefix would run for
// sibling routers too (Express runs mount middleware before route matching).
router.use("/api/v1/families", requireAuth, familiesRouter);
router.use("/api/v1/families", requireAuth, familyRelationshipsRouter);
router.use("/api/v1/families", requireAuth, requirePerson, familyEventsRouter);
router.use("/api/v1/families", requireAuth, requirePerson, calendarRouter);
router.use("/api/v1/households", requireAuth, requirePerson, householdsRouter);
router.use("/api/v1/link-requests", requireAuth, requirePerson, linkRequestsRouter);
router.use("/api/v1/persons", requireAuth, personRelationshipsRouter);
router.use("/api/v1/persons", requireAuth, personsRouter);
router.use("/api/v1/relationships", requireAuth, relationshipsRouter);
router.use("/api/v1/events", requireAuth, requirePerson, eventsRouter);
router.use("/api/v1/ai", requireAuth, requirePerson, aiRouter);
router.use("/api/v1/photos", requireAuth, requirePerson, photosRouter);
router.use("/api/v1/billing", billingRouter);
