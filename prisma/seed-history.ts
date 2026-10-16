import { ComplaintStatus, Priority } from "../src/generated/prisma/client";

export interface ISampleTiming {
    assignAfterHours: number;
    startAfterHours: number;
    resolveAfterHours: number;
    closeAfterHours: number;
}

export interface ISampleComplaint {
    title: string;
    description: string;
    category: string;
    area: string;
    address: string;
    priority: Priority;
    status: ComplaintStatus;
    citizen: string;
    staff?: string;
    daysAgo: number;
    resolutionNote?: string;
    rejectionReason?: string;
    rating?: number;
    comment?: string;
    timing?: ISampleTiming;
    latitude?: number;
    longitude?: number;
}

export const historyCitizens = [
    { name: "Farhana Hoque", email: "citizen3@citycare.com", phone: "+8801700000003", address: "House 7, Road 3, Mohammadpur, Dhaka" },
    { name: "Arif Chowdhury", email: "citizen4@citycare.com", phone: "+8801700000004", address: "Plot 21, Block D, Bashundhara, Dhaka" },
    { name: "Nadia Sultana", email: "citizen5@citycare.com", phone: "+8801700000005", address: "House 15, Road 2, Banani, Dhaka" },
    { name: "Kamal Uddin", email: "citizen6@citycare.com", phone: "+8801700000006", address: "32 Lalbagh Road, Old Dhaka" },
];

interface ICategoryTemplate {
    category: string;
    slaHours: number;
    staff: string[];
    problems: { title: string; description: string }[];
    fixes: string[];
}

const templates: ICategoryTemplate[] = [
    {
        category: "Pothole",
        slaHours: 72,
        staff: ["roads.staff@citycare.com", "roads.staff2@citycare.com"],
        problems: [
            {
                title: "Pothole full of rain water on the main road",
                description: "The pothole is hidden under water after rain and rickshaws keep falling into it.",
            },
            {
                title: "Large pothole next to the bus stop",
                description: "Buses swerve to avoid a large pothole and it slows down the whole road.",
            },
            {
                title: "Road surface broken after the gas line work",
                description: "The road was dug for the gas line and never repaired. It is now full of loose stones.",
            },
            {
                title: "Several potholes along the market road",
                description: "There are at least five potholes on the market road and traffic is stuck every evening.",
            },
        ],
        fixes: [
            "The pothole was filled with asphalt and compacted.",
            "The broken part of the road was cut and patched again.",
            "Loose stones were removed and the surface was repaired.",
        ],
    },
    {
        category: "Broken footpath",
        slaHours: 120,
        staff: ["roads.staff@citycare.com", "roads.staff2@citycare.com"],
        problems: [
            {
                title: "Footpath slabs are broken near the mosque",
                description: "Old people coming to the mosque trip on the broken slabs every day.",
            },
            {
                title: "Footpath is blocked by a broken railing",
                description: "A fallen railing blocks half of the footpath and people walk on the road.",
            },
            {
                title: "Missing slab leaves an open drain on the footpath",
                description: "One slab is missing and there is an open drain under it. It is dangerous at night.",
            },
        ],
        fixes: [
            "New slabs were placed and the footpath is safe again.",
            "The railing was removed and fixed back in place.",
            "The missing slab was replaced.",
        ],
    },
    {
        category: "Water leakage",
        slaHours: 24,
        staff: ["water.staff@citycare.com"],
        problems: [
            {
                title: "Water line leaking in front of the market",
                description: "Clean water is flowing from the pipe all day and the road is always wet.",
            },
            {
                title: "Leaking valve wastes water every morning",
                description: "The street valve leaks a lot during the supply hours every morning.",
            },
            {
                title: "Broken pipe is flooding the lane",
                description: "A pipe broke under the lane and the water pressure in our houses is very low.",
            },
        ],
        fixes: [
            "The broken joint of the pipe was replaced.",
            "The valve was changed and there is no leak now.",
            "The pipe was repaired and the lane was cleaned.",
        ],
    },
    {
        category: "Blocked drain",
        slaHours: 48,
        staff: ["water.staff@citycare.com"],
        problems: [
            {
                title: "Drain overflows after a little rain",
                description: "Even ten minutes of rain makes the drain overflow into the houses.",
            },
            {
                title: "Drain is blocked with plastic bottles",
                description: "The drain in front of the school is full of plastic bottles and smells bad.",
            },
        ],
        fixes: ["The drain was cleaned and the water flows again.", "Plastic waste was removed and a net was put at the drain mouth."],
    },
    {
        category: "Garbage not collected",
        slaHours: 24,
        staff: ["waste.staff@citycare.com"],
        problems: [
            {
                title: "Bins have not been emptied for three days",
                description: "The bins on our road are overflowing and dogs are spreading the waste.",
            },
            {
                title: "Garbage van skipped our block again",
                description: "The van came to the next block but skipped ours two days in a row.",
            },
            {
                title: "Waste pile at the corner of the road",
                description: "Waste is piling up at the corner and it blocks the way to the shops.",
            },
        ],
        fixes: [
            "The bins were emptied and the route of the van was updated.",
            "The waste was collected and the area was cleaned.",
            "The pile was removed and the van now comes every morning.",
        ],
    },
    {
        category: "Illegal dumping",
        slaHours: 72,
        staff: ["waste.staff@citycare.com"],
        problems: [
            {
                title: "Construction waste dumped on the roadside",
                description: "A truck dumped bricks and sand on the side of the road at night.",
            },
            {
                title: "People dump waste beside the canal",
                description: "The bank of the canal is used as a dumping place and the canal is getting blocked.",
            },
        ],
        fixes: [
            "The waste was removed and a warning sign was placed.",
            "The canal bank was cleaned and the place is now checked every week.",
        ],
    },
    {
        category: "Street light not working",
        slaHours: 48,
        staff: ["lights.staff@citycare.com"],
        problems: [
            {
                title: "Street light flickers all night",
                description: "The light in front of our house flickers the whole night and then goes off.",
            },
            {
                title: "Three poles in a row have no light",
                description: "The whole lane is dark because three street lights are not working.",
            },
            {
                title: "Street light is on during the day",
                description: "The light stays on all day and goes off at night. The timer seems broken.",
            },
        ],
        fixes: [
            "The lamp and the starter were replaced.",
            "The cable was repaired and all three lights work now.",
            "The timer of the light was replaced.",
        ],
    },
    {
        category: "Fallen tree",
        slaHours: 24,
        staff: ["parks.staff@citycare.com"],
        problems: [
            {
                title: "Tree branch is hanging over the road",
                description: "A big branch broke in the storm and hangs over the road. It can fall on a car.",
            },
            {
                title: "Tree fell on the park boundary wall",
                description: "A tree fell on the boundary wall of the park and the wall is cracked.",
            },
        ],
        fixes: ["The branch was cut and removed.", "The tree was removed and the wall was made safe."],
    },
];

const areas = [
    {
        area: "Mohammadpur",
        streets: ["Road 3, Mohammadpur", "Tajmahal Road, Mohammadpur", "Shia Masjid Road, Mohammadpur"],
        lat: 23.7658,
        lng: 90.3584,
    },
    { area: "Bashundhara", streets: ["Road 8, Block D, Bashundhara", "Block C main road, Bashundhara"], lat: 23.8193, lng: 90.4526 },
    { area: "Banani", streets: ["Road 11, Banani", "Kamal Ataturk Avenue, Banani"], lat: 23.7937, lng: 90.4066 },
    { area: "Lalbagh", streets: ["Lalbagh Road, Old Dhaka", "Azimpur Road, Lalbagh"], lat: 23.7188, lng: 90.3882 },
    { area: "Mirpur", streets: ["Section 2, Mirpur", "Mirpur 10 roundabout", "Road 4, Section 6, Mirpur"], lat: 23.8069, lng: 90.3687 },
    { area: "Uttara", streets: ["Sector 4, Uttara", "Road 13, Sector 10, Uttara"], lat: 23.8759, lng: 90.3795 },
    { area: "Dhanmondi", streets: ["Road 27, Dhanmondi", "Satmasjid Road, Dhanmondi"], lat: 23.7461, lng: 90.3742 },
    { area: "Motijheel", streets: ["Motijheel C/A", "Dilkusha, Motijheel"], lat: 23.7333, lng: 90.4172 },
    { area: "Badda", streets: ["Middle Badda main road", "Link Road, Badda"], lat: 23.7806, lng: 90.4267 },
    { area: "Gulshan", streets: ["Road 90, Gulshan 2", "Gulshan Avenue"], lat: 23.7925, lng: 90.4078 },
];

const comments = [
    "Quick work, thank you.",
    "The team was polite and fixed it well.",
    "It took a bit long but the result is good.",
    "Very happy with the service.",
    "Fixed, but they left some mess behind.",
    "",
];

const rejections = [
    "This place is private property. Please contact the owner of the building.",
    "This is a duplicate of a complaint that is already being handled.",
    "The photos and the address do not match any public place.",
];

const createRandom = (seed: number) => {
    let state = seed;

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const activeWork: Record<string, { status: ComplaintStatus; daysAgo: number; late?: boolean }[]> = {
    "roads.staff@citycare.com": [
        { status: ComplaintStatus.IN_PROGRESS, daysAgo: 4.2, late: true },
        { status: ComplaintStatus.ASSIGNED, daysAgo: 0.6 },
    ],
    "water.staff@citycare.com": [{ status: ComplaintStatus.ASSIGNED, daysAgo: 0.4 }],
    "waste.staff@citycare.com": [{ status: ComplaintStatus.IN_PROGRESS, daysAgo: 0.9 }],
};

export const buildHistory = (): ISampleComplaint[] => {
    const random = createRandom(2026);
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
    const between = (min: number, max: number) => min + random() * (max - min);
    const priorities = [Priority.LOW, Priority.MEDIUM, Priority.MEDIUM, Priority.HIGH, Priority.HIGH, Priority.URGENT];
    const history: ISampleComplaint[] = [];

    const makeBase = (template: ICategoryTemplate, daysAgo: number) => {
        const problem = pick(template.problems);
        const place = pick(areas);

        return {
            title: problem.title,
            description: problem.description,
            category: template.category,
            area: place.area,
            address: pick(place.streets),
            priority: pick(priorities),
            citizen: pick(historyCitizens).email,
            daysAgo,
            ...(random() < 0.4
                ? {
                      latitude: Number((place.lat + between(-0.004, 0.004)).toFixed(5)),
                      longitude: Number((place.lng + between(-0.004, 0.004)).toFixed(5)),
                  }
                : {}),
        };
    };

    for (let index = 0; index < 34; index++) {
        const template = pick(templates);
        const daysAgo = Number(between(2, 56).toFixed(2));
        const base = makeBase(template, daysAgo);

        if (random() < 0.1) {
            history.push({ ...base, status: ComplaintStatus.REJECTED, rejectionReason: pick(rejections) });
            continue;
        }

        const assignAfterHours = between(1, 10);
        const startAfterHours = assignAfterHours + between(1, 8);
        const resolveAfterHours = startAfterHours + template.slaHours * between(0.15, 1.15);
        const closeAfterHours = resolveAfterHours + between(3, 40);
        const ageHours = daysAgo * 24;
        const canClose = closeAfterHours < ageHours;
        const rated = canClose && random() < 0.85;
        const rating = Math.min(5, Math.max(2, Math.round(between(2.6, 5.4))));

        if (resolveAfterHours >= ageHours) {
            continue;
        }

        history.push({
            ...base,
            status: rated ? ComplaintStatus.CLOSED : ComplaintStatus.RESOLVED,
            staff: pick(template.staff),
            resolutionNote: pick(template.fixes),
            timing: { assignAfterHours, startAfterHours, resolveAfterHours, closeAfterHours },
            ...(rated ? { rating, comment: pick(comments) } : {}),
        });
    }

    for (const [staff, items] of Object.entries(activeWork)) {
        for (const item of items) {
            const template = templates.find((entry) => entry.staff.includes(staff)) as ICategoryTemplate;
            const base = makeBase(template, item.daysAgo);
            const assignAfterHours = Math.min(item.daysAgo * 24 * 0.3, 6);

            history.push({
                ...base,
                priority: item.late ? Priority.HIGH : base.priority,
                status: item.status,
                staff,
                timing: {
                    assignAfterHours,
                    startAfterHours: assignAfterHours + Math.min(item.daysAgo * 24 * 0.2, 5),
                    resolveAfterHours: 0,
                    closeAfterHours: 0,
                },
            });
        }
    }

    for (const daysAgo of [0.15, 0.8, 1.3]) {
        history.push({ ...makeBase(pick(templates), daysAgo), status: ComplaintStatus.SUBMITTED });
    }

    return history;
};
