import { Router } from "express";
import { guestRouter } from "./guest";
import { personsRouter } from "./persons";

export const router = Router();

router.use("/api/v1/guest", guestRouter);
router.use("/api/v1/persons", personsRouter);
