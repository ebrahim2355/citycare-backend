import config from "../src/config";
import { CategoryType, ComplaintPaymentStatus, ComplaintStatus, Priority, Role } from "../src/generated/prisma/client";
import prisma from "../src/lib/prisma";
import getRedis from "../src/lib/redis";
import { addHours, generateTrackingCode } from "../src/modules/complaint/complaint.utils";
import { invalidateCatalogCache } from "../src/utils/cache";
import { hashPassword } from "../src/utils/password";
import { buildHistory, historyCitizens, type ISampleComplaint } from "./seed-history";

const departments = [
    { name: "Roads & Transport", description: "Roads, footpaths, bridges and traffic signals", contactEmail: "roads@citycare.com" },
    { name: "Water & Sewerage", description: "Water supply, drains and sewer lines", contactEmail: "water@citycare.com" },
    { name: "Waste Management", description: "Garbage collection, dumping and recycling", contactEmail: "waste@citycare.com" },
    { name: "Electricity & Street Lights", description: "Street lights and public electrical lines", contactEmail: "lights@citycare.com" },
    { name: "Parks & Environment", description: "Parks, trees and public green areas", contactEmail: "parks@citycare.com" },
];

const categories = [
    { name: "Pothole", description: "Holes and broken road surface", department: "Roads & Transport", slaHours: 72 },
    { name: "Broken footpath", description: "Damaged or blocked footpaths", department: "Roads & Transport", slaHours: 120 },
    { name: "Water leakage", description: "Leaking pipes and water waste", department: "Water & Sewerage", slaHours: 24 },
    { name: "Blocked drain", description: "Blocked or overflowing drains", department: "Water & Sewerage", slaHours: 48 },
    { name: "Garbage not collected", description: "Missed garbage collection", department: "Waste Management", slaHours: 24 },
    { name: "Illegal dumping", description: "Waste dumped in a public place", department: "Waste Management", slaHours: 72 },
    {
        name: "Street light not working",
        description: "Dark or broken street lights",
        department: "Electricity & Street Lights",
        slaHours: 48,
    },
    { name: "Fallen tree", description: "Fallen trees or dangerous branches", department: "Parks & Environment", slaHours: 24 },
    {
        name: "Bulk waste pickup",
        description: "Pickup of furniture and other large items",
        department: "Waste Management",
        slaHours: 72,
        fee: 15,
    },
    {
        name: "Septic tank cleaning",
        description: "Cleaning of a household septic tank",
        department: "Water & Sewerage",
        slaHours: 96,
        fee: 40,
    },
    {
        name: "Water tanker delivery",
        description: "One tanker of clean water to your address",
        department: "Water & Sewerage",
        slaHours: 24,
        fee: 20,
    },
    { name: "Tree trimming", description: "Trimming of trees on private land", department: "Parks & Environment", slaHours: 120, fee: 25 },
];

const demoPassword = { staff: "Staff12345", citizen: "Citizen12345" };

const staffMembers = [
    { name: "Rafiq Ahmed", email: "roads.staff@citycare.com", department: "Roads & Transport" },
    { name: "Nusrat Jahan", email: "roads.staff2@citycare.com", department: "Roads & Transport" },
    { name: "Imran Hossain", email: "water.staff@citycare.com", department: "Water & Sewerage" },
    { name: "Shila Akter", email: "waste.staff@citycare.com", department: "Waste Management" },
    { name: "Tanvir Islam", email: "lights.staff@citycare.com", department: "Electricity & Street Lights" },
    { name: "Mitu Rahman", email: "parks.staff@citycare.com", department: "Parks & Environment" },
];

const citizens = [
    { name: "Demo Citizen", email: "citizen@citycare.com", phone: "+8801700000001", address: "House 12, Road 5, Dhanmondi, Dhaka" },
    { name: "Sadia Karim", email: "citizen2@citycare.com", phone: "+8801700000002", address: "House 44, Road 9, Sector 7, Uttara, Dhaka" },
];

const sampleComplaints: ISampleComplaint[] = [
    {
        title: "Deep pothole in front of the school gate",
        description: "A deep pothole on the main road is causing accidents during school hours.",
        category: "Pothole",
        area: "Dhanmondi",
        address: "Road 8, near Dhanmondi Boys School",
        priority: Priority.HIGH,
        status: ComplaintStatus.SUBMITTED,
        citizen: "citizen@citycare.com",
        daysAgo: 0,
    },
    {
        title: "Garbage was not collected for four days",
        description: "The garbage van did not come to our lane this week and the bins are full.",
        category: "Garbage not collected",
        area: "Mirpur",
        address: "Lane 3, Block C, Mirpur 10",
        priority: Priority.MEDIUM,
        status: ComplaintStatus.SUBMITTED,
        citizen: "citizen2@citycare.com",
        daysAgo: 1,
    },
    {
        title: "Street light is off on the whole road",
        description: "Six street lights in a row have been dark for a week. The road is not safe at night.",
        category: "Street light not working",
        area: "Uttara",
        address: "Road 9, Sector 7, Uttara",
        priority: Priority.HIGH,
        status: ComplaintStatus.ASSIGNED,
        citizen: "citizen2@citycare.com",
        staff: "lights.staff@citycare.com",
        daysAgo: 2,
    },
    {
        title: "Water pipe is leaking beside the main road",
        description: "Clean water has been flowing from a broken pipe since yesterday morning.",
        category: "Water leakage",
        area: "Banani",
        address: "Road 11, in front of House 27, Banani",
        priority: Priority.URGENT,
        status: ComplaintStatus.IN_PROGRESS,
        citizen: "citizen@citycare.com",
        staff: "water.staff@citycare.com",
        daysAgo: 2,
    },
    {
        title: "Broken footpath tiles near the bus stand",
        description: "Several tiles are missing and people are falling on the footpath.",
        category: "Broken footpath",
        area: "Mirpur",
        address: "Mirpur 10 bus stand, east side",
        priority: Priority.MEDIUM,
        status: ComplaintStatus.RESOLVED,
        citizen: "citizen@citycare.com",
        staff: "roads.staff@citycare.com",
        daysAgo: 5,
        resolutionNote: "The missing tiles were replaced and the footpath was levelled.",
    },
    {
        title: "Fallen tree is blocking the park entrance",
        description: "A large tree fell during the storm and blocks the east gate of the park.",
        category: "Fallen tree",
        area: "Gulshan",
        address: "East gate, Gulshan Lake Park",
        priority: Priority.HIGH,
        status: ComplaintStatus.CLOSED,
        citizen: "citizen2@citycare.com",
        staff: "parks.staff@citycare.com",
        daysAgo: 8,
        resolutionNote: "The tree was cut and removed. The gate is open again.",
        rating: 5,
    },
    {
        title: "Blocked drain is flooding the lane",
        description: "The drain is blocked with plastic waste and dirty water is on the road.",
        category: "Blocked drain",
        area: "Dhanmondi",
        address: "Lane beside Road 5, Dhanmondi",
        priority: Priority.MEDIUM,
        status: ComplaintStatus.REJECTED,
        citizen: "citizen@citycare.com",
        daysAgo: 6,
        rejectionReason: "This drain is inside a private housing society. Please contact the society office.",
    },
    {
        title: "Pickup needed for an old sofa and a fridge",
        description: "Two large items need to be collected from the ground floor.",
        category: "Bulk waste pickup",
        area: "Dhanmondi",
        address: "House 12, Road 5, Dhanmondi",
        priority: Priority.LOW,
        status: ComplaintStatus.PENDING_PAYMENT,
        citizen: "citizen@citycare.com",
        daysAgo: 0,
    },
];

const daysBefore = (days: number, hours = 0) => new Date(Date.now() - days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000);

const seedAdmin = async () => {
    const password = await hashPassword(config.admin.password);

    const admin = await prisma.user.upsert({
        where: { email: config.admin.email },
        update: { password, role: Role.ADMIN, deletedAt: null },
        create: { name: "City Admin", email: config.admin.email, password, role: Role.ADMIN },
    });

    console.log(`Admin is ready: ${config.admin.email}`);

    return admin;
};

const seedDepartments = async () => {
    for (const department of departments) {
        await prisma.department.upsert({
            where: { name: department.name },
            update: { description: department.description, contactEmail: department.contactEmail },
            create: department,
        });
    }

    console.log(`${departments.length} departments are ready`);
};

const seedCategories = async () => {
    for (const category of categories) {
        const department = await prisma.department.findUniqueOrThrow({ where: { name: category.department } });
        const data = {
            description: category.description,
            type: category.fee ? CategoryType.SERVICE : CategoryType.COMPLAINT,
            fee: category.fee ?? 0,
            slaHours: category.slaHours,
            departmentId: department.id,
        };

        await prisma.category.upsert({
            where: { name: category.name },
            update: data,
            create: { name: category.name, ...data },
        });
    }

    console.log(`${categories.length} categories are ready`);
};

const seedUsers = async () => {
    const staffPassword = await hashPassword(demoPassword.staff);
    const citizenPassword = await hashPassword(demoPassword.citizen);

    for (const staff of staffMembers) {
        const department = await prisma.department.findUniqueOrThrow({ where: { name: staff.department } });

        await prisma.user.upsert({
            where: { email: staff.email },
            update: {},
            create: { name: staff.name, email: staff.email, password: staffPassword, role: Role.STAFF, departmentId: department.id },
        });
    }

    for (const citizen of [...citizens, ...historyCitizens]) {
        await prisma.user.upsert({
            where: { email: citizen.email },
            update: {},
            create: { ...citizen, password: citizenPassword },
        });
    }

    console.log(`${staffMembers.length} demo staff members and ${citizens.length + historyCitizens.length} demo citizens are ready`);
};

const createSample = async (sample: ISampleComplaint, adminId: string) => {
    const category = await prisma.category.findUniqueOrThrow({ where: { name: sample.category } });
    const citizen = await prisma.user.findUniqueOrThrow({ where: { email: sample.citizen } });
    const staff = sample.staff ? await prisma.user.findUniqueOrThrow({ where: { email: sample.staff } }) : null;
    const createdAt = daysBefore(sample.daysAgo);
    const needsPayment = sample.status === ComplaintStatus.PENDING_PAYMENT;
    const isResolved = sample.status === ComplaintStatus.RESOLVED || sample.status === ComplaintStatus.CLOSED;
    const isRejected = sample.status === ComplaintStatus.REJECTED;
    const timing = sample.timing ?? { assignAfterHours: 3, startAfterHours: 8, resolveAfterHours: 30, closeAfterHours: 40 };
    const assignedAt = staff ? addHours(createdAt, timing.assignAfterHours) : null;
    const resolvedAt = isResolved ? addHours(createdAt, timing.resolveAfterHours) : null;
    const closedAt =
        sample.status === ComplaintStatus.CLOSED ? addHours(createdAt, timing.closeAfterHours) : isRejected ? addHours(createdAt, 5) : null;

    const updates: { actorId: string; fromStatus: ComplaintStatus | null; toStatus: ComplaintStatus; note: string; createdAt: Date }[] = [
        {
            actorId: citizen.id,
            fromStatus: null,
            toStatus: needsPayment ? ComplaintStatus.PENDING_PAYMENT : ComplaintStatus.SUBMITTED,
            note: needsPayment ? "Request created. Waiting for the service fee payment." : "Complaint submitted",
            createdAt,
        },
    ];

    if (staff && assignedAt) {
        updates.push({
            actorId: adminId,
            fromStatus: ComplaintStatus.SUBMITTED,
            toStatus: ComplaintStatus.ASSIGNED,
            note: `Assigned to ${staff.name}`,
            createdAt: assignedAt,
        });

        if (sample.status !== ComplaintStatus.ASSIGNED) {
            updates.push({
                actorId: staff.id,
                fromStatus: ComplaintStatus.ASSIGNED,
                toStatus: ComplaintStatus.IN_PROGRESS,
                note: "Work started",
                createdAt: addHours(createdAt, timing.startAfterHours),
            });
        }

        if (resolvedAt) {
            updates.push({
                actorId: staff.id,
                fromStatus: ComplaintStatus.IN_PROGRESS,
                toStatus: ComplaintStatus.RESOLVED,
                note: sample.resolutionNote ?? "Resolved",
                createdAt: resolvedAt,
            });
        }
    }

    if (sample.status === ComplaintStatus.CLOSED && closedAt) {
        updates.push({
            actorId: citizen.id,
            fromStatus: ComplaintStatus.RESOLVED,
            toStatus: ComplaintStatus.CLOSED,
            note: `Closed by the citizen with a ${sample.rating} star rating`,
            createdAt: closedAt,
        });
    }

    if (isRejected && closedAt) {
        updates.push({
            actorId: adminId,
            fromStatus: ComplaintStatus.SUBMITTED,
            toStatus: ComplaintStatus.REJECTED,
            note: sample.rejectionReason ?? "Rejected",
            createdAt: closedAt,
        });
    }

    await prisma.complaint.create({
        data: {
            trackingCode: generateTrackingCode(createdAt),
            title: sample.title,
            description: sample.description,
            type: category.type,
            priority: sample.priority,
            status: sample.status,
            address: sample.address,
            area: sample.area,
            latitude: sample.latitude ?? null,
            longitude: sample.longitude ?? null,
            fee: category.fee,
            paymentStatus: needsPayment ? ComplaintPaymentStatus.UNPAID : ComplaintPaymentStatus.NOT_REQUIRED,
            citizenId: citizen.id,
            categoryId: category.id,
            departmentId: category.departmentId,
            assignedStaffId: staff?.id ?? null,
            submittedAt: needsPayment ? null : createdAt,
            assignedAt,
            dueAt: needsPayment ? null : addHours(createdAt, category.slaHours),
            resolvedAt,
            closedAt,
            resolutionNote: sample.resolutionNote ?? null,
            rejectionReason: sample.rejectionReason ?? null,
            createdAt,
            updates: { create: updates },
            ...(sample.rating
                ? {
                      feedback: {
                          create: {
                              citizenId: citizen.id,
                              rating: sample.rating,
                              comment: sample.comment === undefined ? "Quick work, thank you." : sample.comment || null,
                              createdAt: closedAt ?? createdAt,
                          },
                      },
                  }
                : {}),
        },
    });
};

const seedComplaints = async (adminId: string) => {
    const existing = await prisma.complaint.count({ where: { citizen: { email: { in: citizens.map((citizen) => citizen.email) } } } });

    if (existing > 0) {
        console.log("Sample complaints already exist, skipped");
        return;
    }

    for (const sample of sampleComplaints) {
        await createSample(sample, adminId);
    }

    console.log(`${sampleComplaints.length} sample complaints are ready`);
};

const seedHistory = async (adminId: string) => {
    const existing = await prisma.complaint.count({
        where: { citizen: { email: { in: historyCitizens.map((citizen) => citizen.email) } } },
    });

    if (existing > 0) {
        console.log("History complaints already exist, skipped");
        return;
    }

    const history = buildHistory();

    for (const sample of history) {
        await createSample(sample, adminId);
    }

    console.log(`${history.length} history complaints are ready`);
};

const main = async () => {
    const admin = await seedAdmin();

    await seedDepartments();
    await seedCategories();
    await seedUsers();
    await seedComplaints(admin.id);
    await seedHistory(admin.id);
    await invalidateCatalogCache();
};

main()
    .catch((error) => {
        console.error("Seeding failed", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        getRedis()?.disconnect();
    });
