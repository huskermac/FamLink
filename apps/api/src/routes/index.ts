import { Router } from "express";
import { healthRouter } from "./health";
import { personsRouter } from "./persons";

export const router = Router();

router.use(healthRouter);
router.use("/api/v1/persons", personsRouter);
