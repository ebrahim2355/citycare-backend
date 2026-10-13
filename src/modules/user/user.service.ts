import prisma from "../../lib/prisma";
import { safeUserSelect } from "./user.constant";
import type { TUpdateProfilePayload } from "./user.validation";

const getMe = async (userId: string) => {
    return prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: safeUserSelect,
    });
};

const updateProfile = async (userId: string, payload: TUpdateProfilePayload) => {
    return prisma.user.update({
        where: { id: userId },
        data: payload,
        select: safeUserSelect,
    });
};

export const UserService = {
    getMe,
    updateProfile,
};
