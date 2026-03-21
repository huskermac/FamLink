import { Router } from "express";
import { guestRouter } from "./guest";
import { healthRouter } from "./health";
import { personsRouter } from "./persons";

export const router = Router();

router.use(healthRouter);
router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/persons", personsRouter);
