import { describe, expect, it } from "vitest";
import { AuthValidation } from "../../src/modules/auth/auth.validation";
import { ComplaintValidation } from "../../src/modules/complaint/complaint.validation";

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
    (result.error?.issues ?? []).map((issue) => `${issue.path.slice(1).join(".")}: ${issue.message}`);

const complaint = (extra: Record<string, unknown> = {}) => ({
    body: {
        title: "Deep pothole near the school gate",
        description: "A deep pothole on the main road is causing accidents every day.",
        categoryId: "6f1c4b7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
        address: "Road 7, Block C, Mirpur 10",
        area: "Mirpur",
        ...extra,
    },
});

describe("complaint create schema", () => {
    const schema = ComplaintValidation.createComplaintSchema;

    it("accepts a valid complaint and fills the default priority", () => {
        const result = schema.safeParse(complaint());

        expect(result.success).toBe(true);
        expect(result.data?.body.priority).toBe("MEDIUM");
    });

    it("trims text before checking the length", () => {
        const result = schema.safeParse(complaint({ title: "   Hole   " }));

        expect(issuesOf(result)).toContain("title: Title must be at least 5 characters");
    });

    it("needs latitude and longitude together and inside their ranges", () => {
        expect(issuesOf(schema.safeParse(complaint({ latitude: 23.8 })))).toContain("longitude: Send latitude and longitude together");
        expect(issuesOf(schema.safeParse(complaint({ latitude: 91, longitude: 90 })))).toContain(
            "latitude: latitude must be between -90 and 90"
        );
        expect(schema.safeParse(complaint({ latitude: 23.8103, longitude: 90.4125 })).success).toBe(true);
    });

    it("refuses an unknown priority and a category id that is not a uuid", () => {
        const fields = issuesOf(schema.safeParse(complaint({ priority: "NOW", categoryId: "pothole" }))).map(
            (issue) => issue.split(":")[0]
        );

        expect(fields).toEqual(expect.arrayContaining(["priority", "categoryId"]));
    });
});

describe("register schema", () => {
    const schema = AuthValidation.registerSchema;
    const body = (extra: Record<string, unknown> = {}) => ({
        body: { name: "Karim Uddin", email: "  KARIM@Example.com ", password: "Citizen12345", ...extra },
    });

    it("normalizes the email", () => {
        expect(schema.parse(body()).body.email).toBe("karim@example.com");
    });

    it.each([
        ["short1", "Password must be at least 8 characters"],
        ["onlyletters", "Password must have at least one number"],
        ["12345678", "Password must have at least one letter"],
    ])("refuses the weak password %s", (password, message) => {
        expect(issuesOf(schema.safeParse(body({ password })))).toContain(`password: ${message}`);
    });

    it("checks the phone format", () => {
        expect(schema.safeParse(body({ phone: "+8801712345678" })).success).toBe(true);
        expect(issuesOf(schema.safeParse(body({ phone: "call me" })))).toContain("phone: Phone must be 7 to 15 digits");
    });
});
