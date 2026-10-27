import { CategoryType, ComplaintStatus, NotificationType, Role, UserStatus } from "../src/generated/prisma/client";
import prisma from "../src/lib/prisma";
import { pointNear } from "./seed-geo";

const OPEN_STATUSES = [ComplaintStatus.SUBMITTED, ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS];
const HOUR = 60 * 60 * 1000;

const label = (complaint: { trackingCode: string; title: string }) => `${complaint.trackingCode} · ${complaint.title}`;

const notAfterNow = (time: number) => new Date(Math.min(time, Date.now()));

const backfillLocations = async (citizenEmails: string[]) => {
    const owned = { citizen: { email: { in: citizenEmails } } };
    const missing = await prisma.complaint.findMany({ where: { ...owned, latitude: null }, select: { id: true, area: true, title: true } });

    for (const complaint of missing) {
        await prisma.complaint.update({
            where: { id: complaint.id },
            data: pointNear(complaint.area, `${complaint.title}:${complaint.id}`),
        });
    }

    if (!(await prisma.complaint.count({ where: { ...owned, isPublic: true } }))) {
        await prisma.complaint.updateMany({ where: { ...owned, type: CategoryType.COMPLAINT }, data: { isPublic: true } });
    }

    return missing.length;
};

const seedSupports = async (citizenEmails: string[]) => {
    const owned = { citizen: { email: { in: citizenEmails } } };

    if (await prisma.complaintSupport.count({ where: { complaint: owned } })) {
        return 0;
    }

    const citizens = await prisma.user.findMany({
        where: { email: { in: citizenEmails } },
        select: { id: true },
        orderBy: { email: "asc" },
    });
    const open = await prisma.complaint.findMany({
        where: { ...owned, isPublic: true, deletedAt: null, status: { in: OPEN_STATUSES } },
        select: { id: true, citizenId: true },
        orderBy: { createdAt: "asc" },
    });
    const data = open.flatMap((complaint, index) =>
        citizens
            .filter((citizen) => citizen.id !== complaint.citizenId)
            .slice(0, (index % 4) + 1)
            .map((citizen) => ({ complaintId: complaint.id, userId: citizen.id }))
    );

    await prisma.complaintSupport.createMany({ data, skipDuplicates: true });

    return data.length;
};

const seedConversation = async (adminId: string) => {
    const leak = await prisma.complaint.findFirst({
        where: { title: "Water pipe is leaking beside the main road", citizen: { email: "citizen@citycare.com" } },
        select: { id: true, citizenId: true, assignedStaffId: true, createdAt: true, _count: { select: { comments: true } } },
    });

    if (!leak || leak._count.comments || !leak.assignedStaffId) {
        return 0;
    }

    const at = (hours: number) => notAfterNow(leak.createdAt.getTime() + hours * HOUR);
    const messages = [
        { authorId: leak.citizenId, body: "The water is now running onto the footpath too. People are walking around it.", hours: 9 },
        {
            authorId: leak.assignedStaffId,
            body: "We found the broken joint under the footpath. A new pipe section arrives this afternoon.",
            hours: 11,
        },
        {
            authorId: adminId,
            body: "Overtime for the night shift is approved, so the road can open by morning.",
            hours: 12,
            isInternal: true,
        },
        { authorId: leak.citizenId, body: "Thank you, the area around it is marked now.", hours: 14 },
    ];

    await prisma.complaintComment.createMany({
        data: messages.map((message) => ({
            complaintId: leak.id,
            authorId: message.authorId,
            body: message.body,
            isInternal: message.isInternal ?? false,
            createdAt: at(message.hours),
        })),
    });

    return messages.length;
};

const seedNotifications = async (demoEmails: string[]) => {
    if (await prisma.notification.count({ where: { user: { email: { in: demoEmails } } } })) {
        return 0;
    }

    const admins = await prisma.user.findMany({
        where: { role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true },
    });
    const recent = new Date(Date.now() - 14 * 24 * HOUR);
    const complaints = await prisma.complaint.findMany({
        where: {
            deletedAt: null,
            citizen: { email: { in: demoEmails } },
            OR: [{ status: { in: OPEN_STATUSES } }, { status: ComplaintStatus.RESOLVED, resolvedAt: { gte: recent } }],
        },
        select: {
            id: true,
            trackingCode: true,
            title: true,
            area: true,
            status: true,
            citizenId: true,
            assignedStaffId: true,
            createdAt: true,
            assignedAt: true,
            resolvedAt: true,
            assignedStaff: { select: { name: true } },
            department: { select: { name: true } },
            _count: { select: { supports: true } },
        },
    });

    const data = complaints.flatMap((complaint) => {
        const base = { complaintId: complaint.id };
        const rows: { userId: string; type: NotificationType; title: string; body: string; complaintId: string; createdAt: Date }[] = [];

        if (complaint.status === ComplaintStatus.SUBMITTED) {
            rows.push(
                ...admins.map((admin) => ({
                    ...base,
                    userId: admin.id,
                    type: NotificationType.COMPLAINT_SUBMITTED,
                    title: "New complaint",
                    body: `${label(complaint)} in ${complaint.area}, for ${complaint.department.name}.`,
                    createdAt: complaint.createdAt,
                }))
            );
        }

        if (complaint.assignedStaffId && complaint.assignedAt && complaint.status !== ComplaintStatus.RESOLVED) {
            rows.push(
                {
                    ...base,
                    userId: complaint.assignedStaffId,
                    type: NotificationType.COMPLAINT_ASSIGNED,
                    title: "New job for you",
                    body: `${label(complaint)} in ${complaint.area}.`,
                    createdAt: complaint.assignedAt,
                },
                {
                    ...base,
                    userId: complaint.citizenId,
                    type: NotificationType.COMPLAINT_ASSIGNED,
                    title: "A staff member has your report",
                    body: `${label(complaint)} is now with ${complaint.assignedStaff?.name ?? "the city team"} from ${complaint.department.name}.`,
                    createdAt: complaint.assignedAt,
                }
            );
        }

        if (complaint.status === ComplaintStatus.IN_PROGRESS) {
            rows.push({
                ...base,
                userId: complaint.citizenId,
                type: NotificationType.COMPLAINT_STATUS_CHANGED,
                title: "Work has started",
                body: `${label(complaint)} is being worked on now.`,
                createdAt: notAfterNow((complaint.assignedAt ?? complaint.createdAt).getTime() + 2 * HOUR),
            });
        }

        if (complaint.status === ComplaintStatus.RESOLVED && complaint.resolvedAt) {
            rows.push({
                ...base,
                userId: complaint.citizenId,
                type: NotificationType.COMPLAINT_STATUS_CHANGED,
                title: "Your report was resolved",
                body: `${label(complaint)} is fixed. Check the result and rate the work.`,
                createdAt: complaint.resolvedAt,
            });
        }

        if (complaint._count.supports) {
            rows.push({
                ...base,
                userId: complaint.citizenId,
                type: NotificationType.REPORT_SUPPORTED,
                title:
                    complaint._count.supports === 1
                        ? "A neighbour supports your report"
                        : `${complaint._count.supports} people support your report`,
                body: `${label(complaint)} is getting attention from people nearby.`,
                createdAt: notAfterNow(complaint.createdAt.getTime() + 6 * HOUR),
            });
        }

        return rows;
    });

    await prisma.notification.createMany({ data });

    return data.length;
};

export const seedCommunity = async (citizenEmails: string[], demoEmails: string[], adminId: string) => {
    const located = await backfillLocations(citizenEmails);
    const supports = await seedSupports(citizenEmails);
    const messages = await seedConversation(adminId);
    const notifications = await seedNotifications(demoEmails);

    console.log(
        `Community data is ready: ${located} locations added, ${supports} supporters, ${messages} messages, ${notifications} notifications`
    );
};
