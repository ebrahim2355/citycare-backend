import { randomBytes } from "node:crypto";
import type { UploadApiResponse } from "cloudinary";
import { StatusCodes } from "http-status-codes";
import { vi } from "vitest";
import AppError from "../../src/errors/AppError";

interface IStoredImage {
    publicId: string;
    folder: string;
    bytes: number;
}

const stored: IStoredImage[] = [];
const destroyed: string[] = [];
let configured = true;
let failNextUploads = 0;

export let isUploadConfigured = true;

export const ensureUploadConfigured = () => {
    if (!configured) {
        throw new AppError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "Image upload is not configured",
            "The Cloudinary keys are missing on the server"
        );
    }
};

export const uploadImage = vi.fn(async (buffer: Buffer, folder: string) => {
    if (failNextUploads > 0) {
        failNextUploads--;

        throw new AppError(StatusCodes.BAD_GATEWAY, "Image upload failed", "Cloudinary did not accept the image");
    }

    const publicId = `${folder}/${randomBytes(8).toString("hex")}`;

    stored.push({ publicId, folder, bytes: buffer.length });

    return {
        public_id: publicId,
        secure_url: `https://res.cloudinary.com/citycare-test/image/upload/v1/${publicId}.png`,
        format: "png",
        bytes: buffer.length,
        resource_type: "image",
    } as UploadApiResponse;
});

export const deleteImage = vi.fn(async (publicId: string) => {
    destroyed.push(publicId);
});

export const cloudinaryTest = {
    stored,
    destroyed,
    failNextUploads: (count = 1) => {
        failNextUploads = count;
    },
    configure: (value: boolean) => {
        configured = value;
        isUploadConfigured = value;
    },
    reset: () => {
        stored.length = 0;
        destroyed.length = 0;
        configured = true;
        isUploadConfigured = true;
        failNextUploads = 0;
        uploadImage.mockClear();
        deleteImage.mockClear();
    },
};
