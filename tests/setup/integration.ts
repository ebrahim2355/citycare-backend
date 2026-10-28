import { afterAll, beforeAll, vi } from "vitest";
import prisma from "../../src/lib/prisma";
import getRedis from "../../src/lib/redis";
import { cloudinaryTest } from "../fakes/cloudinary";
import { googleTest } from "../fakes/google";
import { mailTest } from "../fakes/mailer";
import { sslTest } from "../fakes/sslcommerz";
import { stripeTest } from "../fakes/stripe";

vi.mock("../../src/lib/mailer", () => import("../fakes/mailer"));
vi.mock("../../src/lib/stripe", () => import("../fakes/stripe"));
vi.mock("../../src/lib/sslcommerz", () => import("../fakes/sslcommerz"));
vi.mock("../../src/lib/cloudinary", () => import("../fakes/cloudinary"));
vi.mock("../../src/lib/google", () => import("../fakes/google"));

beforeAll(() => {
    mailTest.reset();
    stripeTest.reset();
    sslTest.reset();
    cloudinaryTest.reset();
    googleTest.reset();
});

afterAll(async () => {
    await prisma.$disconnect();
    getRedis()?.disconnect();
});
